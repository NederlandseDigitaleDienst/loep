import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { chromium, type Browser } from "playwright";
import { INJECTED_FAULTS, methodById, packageVersion } from "../src/instruments/methods/registry.ts";
import { readAloud, REVEALED_NOTE, SIMULATED_NOTE, speechDifferences, speechSource, startListening, stopListening } from "../src/instruments/methods/speech.ts";
import { Daemon, type Response } from "../src/session/daemon.ts";
import type { Observation } from "../src/session/observations.ts";
import type { SpeakAnswer } from "../src/session/speak.ts";
import { startServer, type FixtureServer } from "./fixtures/session-site/server.ts";

let site: FixtureServer;
let run: string;
let daemon: Daemon;
let browser: Browser;

before(async () => {
  site = await startServer();
  run = mkdtempSync(join(tmpdir(), "loep-speak-"));
  daemon = await Daemon.create(run, { hosts: ["127.0.0.1"], baseUrl: `${site.origin}/`, strict: false }, { navigationDelayMs: 0, secondBrowsers: false });
  assert.equal((await daemon.handle({ op: "start", session: "main" })).ok, true);
  browser = await chromium.launch();
});

after(async () => {
  await browser.close();
  await daemon.close();
  await site.close();
  rmSync(run, { recursive: true, force: true });
});

type Print = Record<string, unknown> & { id: string };

function raw(command: string, args: (string | number)[] = [], options: Record<string, string | boolean> = {}): Promise<Response> {
  return daemon.handle({ op: "command", session: "main", command, args: args.map(String), options });
}

async function loep(command: string, args: (string | number)[] = [], options: Record<string, string | boolean> = {}): Promise<Print> {
  const response = await raw(command, args, options);
  assert.equal(response.ok, true, `${command} ${args.join(" ")}: ${JSON.stringify(response.print)}`);
  return response.print as Print;
}

async function ref(query: string): Promise<number> {
  const first = ((await loep("find", [query])).found as string[])[0];
  assert.ok(first, `nothing found for ${query}`);
  return Number(first.split(" ")[0]);
}

interface Source {
  method: string;
  implementation: string;
  version: string;
  principle: string;
  result: SpeakAnswer;
}

interface Recorded {
  methods: Source[];
  agreement: string;
  differences: string[];
  failed: unknown[];
  probe: string;
}

function record(id: string): Recorded {
  const [session, nr] = [id.slice(0, id.lastIndexOf("-")), id.slice(id.lastIndexOf("-") + 1)];
  return (JSON.parse(readFileSync(join(run, "observations", session, `${nr}.json`), "utf8")) as Observation & { result: Recorded }).result;
}

const size = (print: Print): number => JSON.stringify(print).length;
const READER = `virtual-screen-reader ${packageVersion("@guidepup/virtual-screen-reader")}`;

test("speak says what is read at an element: role, name, description and state, by a reader that says it is simulated", async () => {
  await loep("open", ["/speech.html"]);
  const button = await loep("speak", [await ref("css:#save")]);
  assert.equal(button.spoken, "button, Opslaan, Bewaart het concept., not pressed");
  // Every answer says which reader it was and that it is not a real one.
  assert.equal(button.reader, READER);
  assert.equal(button.readerNote, SIMULATED_NOTE);
  assert.match(SIMULATED_NOTE, /nagebootste schermlezer die de standaard volgt, geen echte: eigenaardigheden van NVDA, JAWS of VoiceOver ziet hij niet/);
  assert.ok(size(button) < 500, `speak printed ${size(button)} characters`);
  // The record has the shape that holds every reader side by side: one source with name, version and what it said, and a list of differences.
  const recorded = record(button.id);
  assert.equal(recorded.probe, "element");
  assert.equal(recorded.methods.length, 1);
  const [source] = recorded.methods as [Source];
  assert.equal(source.method, "screen-reader-simulation");
  assert.equal(source.implementation, "@guidepup/virtual-screen-reader");
  assert.equal(source.version, packageVersion("@guidepup/virtual-screen-reader"));
  assert.equal(source.principle, methodById("virtual-screen-reader").principle);
  assert.deepEqual(source.result.spoken, ["button, Opslaan, Bewaart het concept., not pressed"]);
  assert.equal(source.result.simulated, true);
  assert.equal(recorded.agreement, "single");
  assert.deepEqual(recorded.differences, []);
  assert.deepEqual(recorded.failed, []);

  // A field before its error: only that it is required.
  assert.equal((await loep("speak", [await ref("css:#mail")])).spoken, "textbox, E-mailadres, required");
  // An element that is hidden from assistive technology says nothing, and the answer says why.
  const hidden = await loep("speak", [await ref("css:#thanks-unseen")]);
  assert.equal(hidden.spoken, null);
  assert.deepEqual(hidden.remarks, ["het element is verborgen voor hulpsoftware: er wordt niets voorgelezen"]);
  // An element that is no item of its own: the first thing in it.
  const form = await loep("speak", [await ref("css:label[for=mail]")]);
  assert.equal(form.spoken, "E-mailadres");
  assert.deepEqual(form.remarks, ["het element zelf wordt niet genoemd; dit is het eerste wat erin wordt voorgelezen"]);
});

test("speak --steps gives the first items from the top of the page or from an element, in the order they are read", async () => {
  await loep("open", ["/speech.html"]);
  const top = await loep("speak", [], { steps: "8" });
  assert.deepEqual(top.steps, ["1 document", "2 main", "3 heading, Voorlezen, level 1", "4 paragraph", "5 button, Opslaan, Bewaart het concept., not pressed", "6 end of paragraph", "7 paragraph", "8 Bewaart het concept."]);
  assert.match(top.of as string, /^1-8 van \d+$/);
  // The reader does not go into an embedded frame, and says so.
  assert.deepEqual(top.remarks, [
    "1 ingesloten venster: de lezer noemt de titel en gaat er niet in; wijs een element in het venster aan om daar te lezen",
    "de pagina heeft 2 eigen elementen (webcomponenten): een rol of naam die een component buiten de code om zet (ElementInternals), ziet de lezer niet; vergelijk daar met ax",
  ]);
  assert.equal(record(top.id).probe, "walk");
  const from = await loep("speak", [await ref("css:#newsletter")], { steps: "3" });
  assert.deepEqual(from.steps, ["1 form", "2 E-mailadres", "3 textbox, E-mailadres, required"]);
  // What a closed details holds is not read; a walk neither acts nor adds a step to the recipe.
  const all = record((await loep("speak", [], { steps: "60" })).id).methods[0]!.result;
  assert.ok(all.spoken.includes("Meer uitleg") && !all.spoken.includes("Deze tekst is dichtgeklapt."), JSON.stringify(all.spoken));
  assert.equal((await loep("state", ["save", "alleen-gelezen"])).steps, 0);
  assert.match((await raw("speak", [], { steps: "0" })).print.error as string, /--steps moet een heel getal van 1 of meer zijn/);
});

test("speak --click says what is spoken by itself after the action: an error on the field that gets focus", async () => {
  await loep("open", ["/speech.html"]);
  const sent = await loep("speak", [await ref("css:#subscribe")], { click: true });
  // The error is in no live region: nothing is said by itself, and it is heard because focus goes to the field.
  assert.deepEqual(sent.spoken, []);
  assert.equal(sent.focusSpoken, "textbox, E-mailadres, Vul een geldig e-mailadres in., invalid, required");
  assert.deepEqual(sent.appeared, ["Vul een geldig e-mailadres in."]);
  assert.equal(sent.readerNote, SIMULATED_NOTE);
  assert.equal(record(sent.id).probe, "after-action");
  assert.equal((await loep("speak", [await ref("css:#mail")])).spoken, "textbox, E-mailadres, Vul een geldig e-mailadres in., invalid, required");
  // Filling the field and sending with Enter: focus stays in the field, so nothing at all is said.
  await loep("open", ["/speech.html"]);
  const typed = await loep("speak", [await ref("css:#mail")], { type: "invalid-email", submit: true });
  assert.equal(typed.entered, "geen-emailadres");
  assert.deepEqual(typed.spoken, []);
  assert.equal(typed.silent, "er werd niets uit zichzelf uitgesproken");
  // The action is a step of the recipe, like click and type are.
  assert.equal((await loep("state", ["save", "na-invullen"])).steps, 1);
  assert.match((await raw("speak", [], { click: true })).print.error as string, /verwachten het nummer van een element/);
  assert.match((await raw("speak", [await ref("css:#mail")], { type: "iets" })).print.error as string, /--type verwacht een vaste testwaarde/);
});

test("an action that was done stays a step of the recipe when the reader gives no answer", async () => {
  await loep("open", ["/speech.html"]);
  INJECTED_FAULTS.add("virtual-screen-reader");
  try {
    const acted = await loep("speak", [await ref("css:#send-shown")], { click: true });
    assert.deepEqual(acted.appeared, ["Bedankt voor uw bericht."]);
    assert.equal(acted.readerFailed, "de nagebootste schermlezer gaf geen antwoord: opzettelijke fout in een test");
    assert.equal(acted.spoken, undefined);
    assert.equal((await loep("state", ["save", "zonder-lezer"])).steps, 1);
    // Reading changed nothing: there the missing answer is an error.
    assert.equal((await raw("speak", [await ref("css:#save")])).print.error, "de nagebootste schermlezer gaf geen antwoord: opzettelijke fout in een test");
  } finally {
    INJECTED_FAULTS.clear();
  }
});

test("a thank-you message in a status region is spoken when the region was already there, and kept apart when it was hidden first", async () => {
  // The region stands in the page, shown and empty, and gets its text: said, by the standard.
  await loep("open", ["/speech.html"]);
  const shown = await loep("speak", [await ref("css:#send-shown")], { click: true });
  assert.deepEqual(shown.spoken, ["polite: Bedankt voor uw bericht."]);
  assert.equal(shown.revealed, undefined);
  // The region was hidden and is shown with its text: not in what was said, and the answer says that this is not settled.
  await loep("open", ["/speech.html"]);
  const hidden = await loep("speak", [await ref("css:#send-hidden")], { click: true });
  assert.deepEqual(hidden.spoken, []);
  assert.deepEqual(hidden.revealed, ["polite: Bedankt voor uw bericht."]);
  assert.equal(hidden.revealedNote, REVEALED_NOTE);
  assert.equal(hidden.silent, undefined);
  const answer = record(hidden.id).methods[0]!.result;
  assert.deepEqual([answer.spoken, answer.revealed, answer.suppressed], [[], ["polite: Bedankt voor uw bericht."], []]);
  // The region stays hidden: nothing is said, and the text that nobody hears is named.
  await loep("open", ["/speech.html"]);
  const unseen = await loep("speak", [await ref("css:#send-unseen")], { click: true });
  assert.deepEqual(unseen.spoken, []);
  assert.deepEqual(unseen.notSpoken, ["Bedankt voor uw bericht."]);
  assert.equal(unseen.silent, "er werd niets uit zichzelf uitgesproken");
});

test("speak works inside a shadow root and inside an embedded frame", async () => {
  await loep("open", ["/speech.html"]);
  // A label and a description that live in the same shadow root as the field.
  assert.equal((await loep("speak", [await ref("css:#card-name")])).spoken, "textbox, Naam op de kaart, Zoals op uw pas.");
  const card = await loep("speak", [await ref("css:#card-save")], { click: true });
  assert.deepEqual(card.spoken, ["polite: De kaart is bewaard."]);
  // A walk goes through the shadow root in the order of the page.
  const walk = record((await loep("speak", [], { steps: "60" })).id).methods[0]!.result;
  const at = (phrase: string): number => walk.spoken.indexOf(phrase);
  assert.ok(at("heading, In een schaduwboom, level 2") < at("textbox, Naam op de kaart, Zoals op uw pas.") && at("button, Bewaar de kaart") < at("heading, In een ingesloten venster, level 2"), JSON.stringify(walk.spoken));
  assert.equal(walk.read!.coverage.shadowRootsRead, 1);
  assert.equal(walk.read!.coverage.framesNotEntered, 1);
  // The frame itself is named by its title; what is in it is read when an element in it is pointed at.
  assert.ok(at("Ingesloten melding") > 0 && at("button, Laad de kaart") < 0);
  const inFrame = await loep("speak", [await ref("css:#frame-load")]);
  assert.equal(inFrame.spoken, "button, Laad de kaart");
  const loaded = await loep("speak", [await ref("css:#frame-load")], { click: true });
  assert.deepEqual(loaded.spoken, [`polite: De kaart is geladen. [in venster: "Ingesloten melding" ${site.origin}]`]);
  // A component that sets its role and name outside the code: the reader reads the code, and the answer says what the browser gives instead.
  const internals = await loep("speak", [await ref("css:speech-switch")]);
  assert.equal(internals.spoken, "Donker");
  assert.deepEqual((internals.remarks as string[]).slice(1), ['de browser geeft hulpsoftware hier switch "Donkere weergave". De lezer leest de code en ziet niet wat een component daarbuiten zet (ElementInternals): houd hier de browser aan (ax)']);
  const within = await loep("speak", [await ref("css:#frame-status")], { steps: "3" });
  assert.deepEqual(within.steps, ["1 status", "2 De kaart is geladen.", "3 end of status"]);
});

test("the simulated reader leaves the page as it found it", async () => {
  const page = await browser.newPage();
  await page.goto(`${site.origin}/speech.html`);
  const held = await page.evaluateHandle(() => ({ clipboard: navigator.clipboard, focus: HTMLElement.prototype.focus, globals: Object.getOwnPropertyNames(window) }));
  assert.deepEqual((await readAloud(page, "html > body > main > p:nth-of-type(1) > #save", 1)).spoken, ["button, Opslaan, Bewaart het concept., not pressed"]);
  await startListening(page);
  await page.click("#send-shown");
  await page.focus("#mail");
  assert.deepEqual((await stopListening(page))?.spoken, ["polite: Bedankt voor uw bericht."]);
  // The package would replace the clipboard and the focus function of the page; the toolbox takes that part out.
  const same = await page.evaluate((before) => {
    const card = document.querySelector("speech-card")!;
    const own = [card, document.querySelector("details > p")!, document.querySelector("#mail")!, document.body].flatMap((node) => Object.getOwnPropertyNames(node));
    return { clipboard: navigator.clipboard === before.clipboard, focus: HTMLElement.prototype.focus === before.focus, globals: Object.getOwnPropertyNames(window).filter((name) => !before.globals.includes(name)), own, lightChildren: card.childNodes.length };
  }, held);
  // The only global that stays is the read-only helper every second-opinion method installs.
  assert.deepEqual(same, { clipboard: true, focus: true, globals: ["__loepm"], own: [], lightChildren: 0 });
  // Listening twice in a row, and stopping where nothing listens, both work.
  assert.equal(await stopListening(page), null);
  await page.close();
  assert.match(speechSource(), /=null;/);
});

test("the simulated reader knows what the standard keeps from assistive technology, and which changes in a live region count", async () => {
  const page = await browser.newPage();
  const all = async (): Promise<string[]> => (await readAloud(page, null, 200)).spoken;
  // Outside a modal dialog nothing is read; inert content and a closed details neither.
  await page.setContent('<h1>Kop</h1><div inert><button>Inert</button></div><details><summary>Meer</summary><p>Dicht</p></details><dialog aria-labelledby="t"><h2 id="t">Cookies</h2><button>Akkoord</button></dialog><p>Na</p>');
  assert.deepEqual(await all(), ["document", "heading, Kop, level 1", "group", "Meer", "end of group", "paragraph", "Na", "end of paragraph", "end of document"]);
  await page.evaluate(() => document.querySelector("dialog")!.showModal());
  const modal = await readAloud(page, null, 200);
  assert.deepEqual(modal.spoken, ["document", "dialog, Cookies", "heading, Cookies, level 2", "button, Akkoord", "end of dialog, Cookies", "end of document"]);
  assert.equal(modal.coverage.modalOpen, true);
  // Content that a slot shows gives the button its name.
  await page.setContent('<x-button><span>Licht kind</span></x-button><script>document.querySelector("x-button").attachShadow({ mode: "open" }).innerHTML = "<button><slot></slot></button>";</script>');
  assert.ok((await all()).includes("button, Licht kind"));

  const after = async (html: string, change: string): Promise<{ spoken: string[]; revealed: string[]; suppressed: string[]; attributeChanges: number }> => {
    await page.setContent(html);
    await startListening(page);
    await page.evaluate(change);
    await page.waitForTimeout(50);
    return (await stopListening(page))!;
  };
  const nothing = { spoken: [], revealed: [], suppressed: [], attributeChanges: 0 };
  assert.deepEqual(await after('<div id="s" role="alert"></div>', 'document.getElementById("s").innerHTML = "<p>Fout: vul uw naam in</p>"'), { ...nothing, spoken: ["assertive: Fout: vul uw naam in"] });
  // A part of a region that was already there and is shown now is an addition to it.
  assert.deepEqual(await after('<div role="alert"><p id="p" hidden>Fout: vul uw naam in</p></div>', 'document.getElementById("p").hidden = false'), { ...nothing, spoken: ["assertive: Fout: vul uw naam in"] });
  assert.deepEqual(await after('<div id="s" aria-live="polite"><p>Eerste</p></div>', 'document.getElementById("s").insertAdjacentHTML("beforeend", "<p>Tweede</p>")'), { ...nothing, spoken: ["polite: Tweede"] });
  assert.deepEqual(await after("<output></output>", 'document.querySelector("output").textContent = "12 resultaten"'), { ...nothing, spoken: ["polite: 12 resultaten"] });
  // Hidden by a class and shown with its text: kept apart, like a region with the hidden attribute.
  assert.deepEqual(await after('<style>.off{display:none}</style><div id="s" role="status" class="off"></div>', 'const s = document.getElementById("s"); s.textContent = "Bedankt"; s.classList.remove("off")'), { ...nothing, revealed: ["polite: Bedankt"] });
  // So is a region inside a panel that was hidden and is shown.
  assert.deepEqual(await after('<div id="panel" hidden><h2>Verstuurd</h2><p role="status">Bedankt</p></div>', 'document.getElementById("panel").hidden = false'), { ...nothing, revealed: ["polite: Bedankt"] });
  // A class that changes says nothing; a region that is put into the page with its text is no change in a region; no region, nothing said.
  assert.deepEqual(await after('<div id="s" role="status">Oud</div>', 'document.getElementById("s").className = "x"'), { ...nothing, attributeChanges: 1 });
  assert.deepEqual(await after("<main></main>", 'document.querySelector("main").innerHTML = "<div role=status>Bedankt</div>"'), nothing);
  assert.deepEqual(await after('<div id="s"></div>', 'document.getElementById("s").textContent = "Bedankt"'), nothing);
  assert.deepEqual(await after('<div id="s" aria-live="off"></div>', 'document.getElementById("s").textContent = "Bedankt"'), nothing);
  await page.close();
});

test("one reader is a valid answer, and a second one of the same shape is compared item by item", () => {
  const simulated = { implementation: "@guidepup/virtual-screen-reader", result: { spoken: ["button, Opslaan, not pressed", "polite: Bedankt voor uw bericht."], simulated: true } };
  assert.deepEqual(speechDifferences([]), []);
  assert.deepEqual(speechDifferences([simulated]), []);
  // A real screen reader words and orders a role differently: the same words are the same item.
  const real = { implementation: "voiceover", result: { spoken: ["Opslaan, button, not pressed"], simulated: false } };
  assert.deepEqual(speechDifferences([simulated, real]), ['stap 2: @guidepup/virtual-screen-reader "polite: Bedankt voor uw bericht.", voiceover zegt niets']);
  assert.deepEqual(speechDifferences([simulated, { ...real, result: { spoken: ["Bewaren, button", "polite: Bedankt voor uw bericht."], simulated: false } }]), ['stap 1: @guidepup/virtual-screen-reader "button, Opslaan, not pressed", voiceover "Bewaren, button"']);
});
