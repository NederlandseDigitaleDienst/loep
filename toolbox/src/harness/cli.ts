#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { addSite, readBacklog, type Site } from "./backlog.ts";
import { doctor, doctorTextNl, routesCheck } from "./doctor.ts";
import { FIXTURES, metingHome, prepareBacklog, silent } from "./meting.ts";
import { backlogPath, cliArgs, homeDir, reportsDir, siteDir, stateDir, toolboxCli } from "./paths.ts";
import { lastWords, readTranscript } from "./run.ts";
import { handOutMissing, lockPath, pauseSite, runSite, statePath, transcriptPath } from "./runner.ts";
import { acquireLock, isGone, PHASES_NL, readState, regieRuns, releaseLock, siteState, standNl, updateSite, type SiteState } from "./state.ts";
import { versionNl } from "./version.ts";

const USAGE = `loep add|run|status|pause|resume|log|doctor: het harnas, loep over een backlog van sites, met een mens erbij waar dat nodig is

  add <url> [--slug <naam>] [--name <naam>] [--organisation <naam>] [--purpose verbeteren|verantwoorden]
            [--allow-sending] [--max-sends <n>] [--also-origin <url>]... [--never-open <host>]...
            [--login-page <url> --login-role <rol>] [--at-once <n>] [--navigation-delay <s>] [--mailbox <url>]
            [--vendor-tag <prefix>]... [--note <tekst>]
                                         Zet een site in de backlog. Wat je weglaat vraagt loep als er een
                                         terminal is, en anders vult het de standaard in
  run [--sites <n>] [--only <site>] [--new]
                                         De backlog afwerken: een regie per site, in de orde van het
                                         bestand. Een site die op een mens wacht slaat loep over.
                                         --new begint naast de run die er al staat, met een nieuwe map,
                                         ook voor een site die klaar is of wacht
  resume <site> [--what <tekst>]         Ga verder met een site die stopte, met wat de mens deed
  log <site> [--follow]                  Wat de regie deed, regel voor regel
  status [<site>] [--json]               De backlog met de stand van elke site, of wat er met één site
                                         gebeurde en wat er nu moet
  pause <site>                           Zet een site stil; de run blijft staan
  doctor [--routes]                      Controleer wat een run nodig heeft, en met --routes ook VLAM

De menselijke stappen van een run staan onder \`audit\`: \`loep audit login <site>\` opent het venster
waarin je zelf met het testaccount inlogt, en \`loep audit answer|sign|decide|statement <site>\` geven de
terminal aan loep zelf. Waar een stap een run vraagt, mag ook de site staan.

De backlog staat in ${backlogPath()} en de stand van de backlog in ${stateDir()}.
`;

/** The help of `loep dev meting`: the one verb of the harness that lives under `dev`. */
const METING_USAGE = `loep dev meting [--sites <n>] [--only <site>] [--new]

Meet loep op zijn eigen testwebsites, met de regie en de skill, in een backlog apart van die van echte
eigenaren. Vereist een draaiende testsite: just testsite.

  --sites <n>   Hoeveel sites achter elkaar, tot het aantal testwebsites
  --only <site> Alleen deze site
  --new         Begin naast de run die er al staat
`;

const OPTIONS = {
  slug: { type: "string" },
  name: { type: "string" },
  organisation: { type: "string" },
  purpose: { type: "string" },
  "allow-sending": { type: "boolean" },
  "max-sends": { type: "string" },
  "also-origin": { type: "string", multiple: true },
  "never-open": { type: "string", multiple: true },
  "login-page": { type: "string" },
  "login-role": { type: "string" },
  "at-once": { type: "string" },
  "navigation-delay": { type: "string" },
  mailbox: { type: "string" },
  "vendor-tag": { type: "string", multiple: true },
  note: { type: "string" },
  json: { type: "boolean" },
  routes: { type: "boolean" },
  sites: { type: "string" },
  only: { type: "string" },
  what: { type: "string" },
  new: { type: "boolean" },
  follow: { type: "boolean", short: "f" },
  help: { type: "boolean", short: "h" },
} as const;

/** A moment in the time zone of the person, the way a calendar app writes it. */
function momentNl(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "3 uur geleden", for a moment in the past; the state and the log are read by a person. */
function agoNl(iso: string | null): string {
  if (iso === null) return "nooit";
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(seconds)) return "onbekend";
  if (seconds < 60) return "net";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minuut" : "minuten"} geleden`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? "uur" : "uur"} geleden`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "dag" : "dagen"} geleden`;
}

/** One row per site of the backlog, in the order of the file, with the phase from the state. */
function listTextNl(sites: Site[], state: ReturnType<typeof readState>): string {
  if (sites.length === 0) return `De backlog is leeg. Zet er een site in met: loep add <url>\n`;
  const rows = sites.map((site) => {
    const site_ = siteState(state, site.slug);
    return [site.slug, standNl(site_), site_.step ?? "", agoNl(site_.updatedAt)];
  });
  const header = ["site", "stand", "stap", "bijgewerkt"];
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column]!.length)));
  const line = (row: string[]): string => row.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]!) : ` ${cell}`)).join("  ").trimEnd();
  return `${[line(header), ...rows.map(line)].join("\n")}\n`;
}

/** Everything about one site: the file, the run, the question, and what to do next. */
function statusTextNl(site: Site, site_: SiteState, words: string[] = []): string {
  const lines: string[] = [`${site.slug}  ${standNl(site_)}`];
  const field = (label: string, value: string | null): void => {
    if (value !== null && value !== "") lines.push(`  ${label.padEnd(10)} ${value}`);
  };
  field("url", site.url);
  field("naam", site.name);
  field("eigenaar", site.organisation);
  field("doel", site.purpose === "verantwoorden" ? "verantwoorden hoe de site ervoor staat" : "de site beter maken");
  field("run", site_.run);
  field("stap", site_.step);
  field("sinds", site_.startedAt === null ? null : `${momentNl(site_.startedAt)} (${agoNl(site_.startedAt)})`);
  field("versie", site_.version === null ? null : versionNl(site_.version));
  if (site.sending.allow) field("versturen", site.sending.max === null ? "ja, met het budget van loep" : `ja, hooguit ${site.sending.max}`);
  for (const file of site_.handouts) field("rapport", file);
  if (site_.question) {
    lines.push("", `  Vraag: ${site_.question.textNl}`);
    if (site_.question.command) lines.push(`  Daarna: ${site_.question.command}`);
  }
  if (isGone(site_)) {
    lines.push(
      "",
      regieRuns(site_)
        ? `  Het proces van loep is weg, maar de regie loopt nog in proces ${String(site_.regiePid)}. Wacht tot die stopt, of stop hem met: kill ${String(site_.regiePid)}. Daarna gaat loep run --only ${site.slug} verder in dezelfde run.`
        : `  Het proces van loep is weg terwijl de run nog liep. loep run --only ${site.slug} gaat verder in dezelfde run.`,
    );
  }
  if (site_.phase === "fout" && !site_.question) {
    lines.push("", "  De regie stopte zonder vraag en zonder verzegelde run. De laatste regels:");
    for (const word of words) lines.push(`    ${word}`);
    if (words.length === 0) lines.push("    (er staat nog niets in het transcript)");
  }
  return `${lines.join("\n")}\n`;
}

function findSite(sites: Site[], wanted: string): Site {
  const site = sites.find((entry) => entry.slug === wanted);
  if (site) return site;
  const known = sites.map((entry) => entry.slug);
  throw new Error(`geen site "${wanted}" in de backlog${known.length > 0 ? `; ik ken ${known.join(", ")}` : "; de backlog is leeg"}`);
}

/** Ask what the flags left open, but only when a person is at a terminal: a script gets the defaults. */
interface Added {
  name: string | undefined;
  organisation: string | undefined;
  purpose: string | undefined;
  login: { page: string; role: string } | null;
}

/**
 * Ask what the flags left open, but only when a person is at a terminal: a script gets the defaults.
 * The login is asked here and not thirty minutes into a run, but never the password: loep opens a
 * window for that when the run needs it, so the secret stays out of the backlog and out of loep.
 */
async function completeAdd(given: Added): Promise<Added> {
  if (!process.stdin.isTTY || (given.name !== undefined && given.organisation !== undefined && given.purpose !== undefined && given.login !== null)) return given;
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const name = given.name ?? ((await terminal.question(`Naam van de site (leeg: de host): `)).trim() || undefined);
    const organisation = given.organisation ?? (await terminal.question("Wie is de eigenaar van de site? ")).trim();
    const purpose = given.purpose ?? ((await terminal.question("Waarvoor is het onderzoek: verbeteren of verantwoorden? (leeg: verbeteren) ")).trim() || "verbeteren");
    let login = given.login;
    if (login === null) {
      const page = (await terminal.question("Staat de site achter een inlog? Zo ja, het adres van de inlogpagina (leeg: nee): ")).trim();
      const role = page === "" ? "" : (await terminal.question("In welke rol test je, bijvoorbeeld aanvrager of beheerder? Geen naam van een persoon: ")).trim();
      login = page === "" ? null : { page, role };
      if (login !== null) process.stdout.write("Het wachtwoord vraagt loep nooit: loep opent aan het begin van de run een venster waarin je zelf inlogt, en bewaart alleen de sessie.\n");
    }
    return { name, organisation, purpose, login };
  } finally {
    terminal.close();
  }
}

/** The step as it comes in, on one line, while the regie runs. */
function progress(step: string): void {
  if (process.stdout.isTTY) process.stdout.write(`\r  ${step.padEnd(24)}`);
}

/** What became of a site, in the words of the next action. */
function report(site: Site, state: SiteState): void {
  if (process.stdout.isTTY) process.stdout.write(`\r${" ".repeat(28)}\r`);
  switch (state.phase) {
    case "vraagt":
      process.stdout.write(`${site.slug} stopt en wacht op jou.\n\n${state.question?.textNl ?? ""}\n`);
      if (state.question?.command) process.stdout.write(`\nCommando:\n${state.question.command}\n`);
      process.stdout.write(`\nDaarna: loep resume ${site.slug}\n`);
      return;
    case "klaar":
      process.stdout.write(`${site.slug} is verzegeld: de run staat in ${state.run}, het rapport komt in ${reportsDir()}.\n`);
      return;
    case "fout":
      process.stdout.write(`${site.slug} stopte zonder vraag en zonder verzegelde run (laatste stap: ${state.step ?? "onbekend"}).\nBekijk: loep log ${site.slug}\n`);
      return;
    default:
      process.stdout.write(`${site.slug}: ${PHASES_NL[state.phase]}\n`);
  }
}

/** Keep what a person did, so the next resume tells the regie what loep needs now. */
function afterPerson(slug: string, command: string): void {
  const known = siteState(readState(statePath()), slug);
  const said = AFTER_NL[command];
  if (said === undefined || known.humanNl?.includes(said)) return;
  updateSite(statePath(), slug, { humanNl: known.humanNl === null ? said : `${known.humanNl} ${said}` });
}

/** One loep at a time: a second one would start a second regie in the same run. */
async function withLock<T>(slug: string | null, body: () => Promise<T>): Promise<T> {
  const taken = acquireLock(lockPath(), slug);
  if (!taken.ok) throw new Error(`loep loopt al: proces ${taken.lock.pid} op ${taken.lock.host}${taken.lock.slug ? `, met ${taken.lock.slug}` : ""}, sinds ${momentNl(taken.lock.since)}`);
  try {
    return await body();
  } finally {
    releaseLock(lockPath());
  }
}

/** Work the backlog in the order of the file, skipping a site that waits for a person. */
async function runBacklog(options: { sites?: string | undefined; only?: string | undefined; newRun?: boolean | undefined }): Promise<void> {
  // A tunnel that closes 24 hours after logging in costs a run of hours; this costs one request.
  const vlam = routesCheck();
  if (!vlam.ok) {
    process.stdout.write(`${vlam.detailNl}\nEr is niets gestart.\n`);
    process.exitCode = 1;
    return;
  }
  await withLock(null, async () => {
    const backlog = readBacklog(backlogPath());
    const state = readState(statePath());
    const waiting = new Set(["klaar", "vraagt", "gepauzeerd"]);
    const limit = options.sites === undefined ? 1 : Number(options.sites);
    if (!Number.isInteger(limit) || limit < 1) throw new Error("--sites moet een heel getal van 1 of meer zijn");
    // --new starts a new run, so also for a site that is done or waits for a person: after a new
    // version that is exactly the site that needs it.
    const todo = backlog.sites.filter((entry) => (options.only === undefined || entry.slug === options.only) && (options.newRun === true || !waiting.has(siteState(state, entry.slug).phase)));
    // A run that was done before loep handed reports out still gets them: no regie, only the copy.
    for (const entry of backlog.sites) {
      if (options.only !== undefined && entry.slug !== options.only) continue;
      const known = siteState(readState(statePath()), entry.slug);
      for (const file of handOutMissing(entry.slug, known)) process.stdout.write(`rapport: ${file}\n`);
    }
    // A site whose regie still runs cannot get a second one, but that is no reason to hold up the rest:
    // every site has its own run and its own folder, and a sweep of hours would wait hours.
    const busy = todo.filter((entry) => regieRuns(siteState(state, entry.slug)));
    for (const entry of busy) {
      const known = siteState(state, entry.slug);
      process.stdout.write(`${entry.slug}: de regie loopt nog in proces ${String(known.regiePid)}, ook al is loep zelf weg. Stop hem met: kill ${String(known.regiePid)}, en ga daarna verder met: loep run --only ${entry.slug}\n`);
    }
    const runnable = todo.filter((entry) => !busy.includes(entry));
    if (runnable.length === 0) {
      process.stdout.write(`Niets te doen: elke site is klaar, wacht op een mens, of staat stil${options.only === undefined ? "" : ` (--only ${options.only})`}.\n`);
      return;
    }
    for (const entry of runnable.slice(0, limit)) {
      const result = await runSite({ site: entry, newRun: options.newRun, onStep: progress });
      report(entry, result);
      // A regie that stopped because somebody stopped loep is no reason to begin the next site.
      if (result.phase === "gepauzeerd") {
        process.exitCode = 130;
        return;
      }
    }
  });
}

/** Continue a site that stopped, with what the person did since. */
async function resumeSite(site: Site, what: string | undefined): Promise<void> {
  await withLock(site.slug, async () => {
    const known = siteState(readState(statePath()), site.slug);
    if (known.run === null) throw new Error(`${site.slug} is nog niet begonnen; start hem met: loep run --only ${site.slug}`);
    const asked = known.question !== null ? `De mens voerde het commando uit dat in vraag.md stond${known.question.command ? ` (${known.question.command})` : ""}.` : null;
    const text = what ?? ([known.humanNl, asked].filter((part) => part !== null).join(" ") || "De vorige regie stopte zonder een vraag achter te laten.");
    const result = await runSite({ site, resumeNl: text, byPerson: true, onStep: progress });
    report(site, result);
    if (result.phase === "gepauzeerd") process.exitCode = 130;
  });
}

/** What a person does through loep itself, from the backlog: the options go on as they are, without being read. */
const HANDED_OVER = new Set(["login", "answer", "sign", "decide", "statement"]);

/** What loep needs after a person did something, said to the regie at the next resume. */
const AFTER_NL: Record<string, string> = {
  login: "De mens logde in met loep audit login; loep bewaarde de sessie in de run.",
  answer: "De mens legde met answer een antwoord vast. Draai daarna stap 7 opnieuw, in deze volgorde: evaluate, render en seal, zoals de skill bij stap 9 zegt.",
  sign: "De mens tekende met sign. Draai render en verify zoals de skill bij stap 10 zegt.",
  decide: "De mens legde met decide besluiten over gebreken vast. Draai render zoals de skill zegt.",
  statement: "De mens maakte met statement de toegankelijkheidsverklaring. Ga verder met de skill.",
};

/** The command line of the backlog, called by loep with the verbs it took off the front: `add`, `run`, `status`. */
export async function harnessCli(argv: string[]): Promise<number> {
  try {
    await main(argv);
    return typeof process.exitCode === "number" ? process.exitCode : 0;
  } catch (error) {
    process.stderr.write(`loep: ${(error as Error).message}\n`);
    return 1;
  }
}

async function main(argv: string[]): Promise<void> {
  // `loep audit login <site> --idle` and `loep audit answer <site> --criterion 1.4.3` belong to loep: parsing them
  // here would refuse every option loep does not know. A `--` in front still works.
  const handedOver = argv[0] !== undefined && HANDED_OVER.has(argv[0]) && argv[1] !== undefined && !argv[1].startsWith("-");
  const parsed = parseArgs({ args: handedOver ? [] : argv, allowPositionals: true, options: OPTIONS });
  const values = parsed.values;
  const positionals = handedOver ? [argv[0]!, argv[1]!, ...argv.slice(2).filter((arg, index) => !(index === 0 && arg === "--"))] : parsed.positionals;
  const command = positionals[0];
  const target = positionals[1];
  if (values.help || command === "help") {
    process.stdout.write(command === "meting" ? METING_USAGE : USAGE);
    return;
  }
  if (command === undefined) {
    const backlog = readBacklog(backlogPath());
    process.stdout.write(listTextNl(backlog.sites, readState(statePath())));
    process.stdout.write("\nZet er een site bij met: loep add <url>, en start met: loep run. loep --help toont alles.\n");
    return;
  }

  switch (command) {
    case "add": {
      if (target === undefined) throw new Error("loep add heeft een url nodig: loep add https://www.voorbeeld.nl/");
      const filled = await completeAdd({
        name: values.name,
        organisation: values.organisation,
        purpose: values.purpose,
        login: values["login-page"] === undefined ? null : { page: values["login-page"], role: values["login-role"] ?? "" },
      });
      const site = addSite(backlogPath(), {
        url: target,
        slug: values.slug,
        name: filled.name,
        organisation: filled.organisation,
        purpose: filled.purpose,
        sending: { allow: values["allow-sending"] === true, max: values["max-sends"] === undefined ? null : Number(values["max-sends"]) },
        alsoOrigins: values["also-origin"] ?? [],
        neverOpen: values["never-open"] ?? [],
        login: filled.login,
        atOnce: values["at-once"] === undefined ? 2 : Number(values["at-once"]),
        navigationDelay: values["navigation-delay"] === undefined ? null : Number(values["navigation-delay"]),
        mailbox: values.mailbox ?? null,
        vendorTags: values["vendor-tag"] ?? [],
        note: values.note ?? "",
      });
      process.stdout.write(`${site.slug} staat in de backlog.\nStart hem met: loep run\n`);
      if (site.login !== null) process.stdout.write(`Deze site zit achter een inlog: aan het begin van de run stopt loep daarvoor, en loep audit login ${site.slug} opent het venster.\n`);
      return;
    }
    case "list": {
      const backlog = readBacklog(backlogPath());
      const state = readState(statePath());
      if (values.json) {
        process.stdout.write(`${JSON.stringify({ home: homeDir(), sites: backlog.sites.map((site) => ({ ...site, state: siteState(state, site.slug) })), problems: backlog.problems }, null, 2)}\n`);
        return;
      }
      process.stdout.write(listTextNl(backlog.sites, state));
      for (const problem of backlog.problems) process.stderr.write(`LET OP ${problem.where}: ${problem.textNl}\n`);
      return;
    }
    case "status": {
      const backlog = readBacklog(backlogPath());
      const state = readState(statePath());
      if (target === undefined) {
        if (values.json) {
          process.stdout.write(`${JSON.stringify({ sites: backlog.sites.map((site) => ({ ...siteState(state, site.slug), slug: site.slug })), problems: backlog.problems }, null, 2)}\n`);
          return;
        }
        process.stdout.write(listTextNl(backlog.sites, state));
        return;
      }
      const site = findSite(backlog.sites, target);
      const site_ = siteState(state, site.slug);
      if (values.json) {
        process.stdout.write(`${JSON.stringify({ site, state: site_, question: site_.question, dir: siteDir(site.slug) }, null, 2)}\n`);
        return;
      }
      process.stdout.write(statusTextNl(site, site_, site_.phase === "fout" ? lastWords(transcriptPath(site), 8) : []));
      return;
    }
    case "pause": {
      if (target === undefined) throw new Error("loep pause heeft een site nodig");
      const backlog = readBacklog(backlogPath());
      const site = findSite(backlog.sites, target);
      const known = siteState(readState(statePath()), site.slug);
      // A regie that still runs does not stop because the state says so; the state and the run would drift apart.
      if (known.phase === "loopt" && !isGone(known)) {
        throw new Error(`${site.slug} loopt nu, in proces ${known.pid}. Stop loep in dat venster met Ctrl-C, of met: kill ${known.pid}. De run blijft staan en gaat verder met: loep resume ${site.slug}`);
      }
      // A regie that outlived loep would go on writing in the run; the state would say it stands still.
      if (regieRuns(known)) {
        throw new Error(`de regie van ${site.slug} loopt nog in proces ${String(known.regiePid)}, ook al is loep zelf weg. Stop die eerst: kill ${String(known.regiePid)}. Daarna: loep pause ${site.slug}`);
      }
      pauseSite(site.slug);
      process.stdout.write(`${site.slug} staat stil. Ga verder met: loep resume ${site.slug}\n`);
      return;
    }
    case "run":
      await runBacklog({ sites: values.sites, only: values.only, newRun: values.new === true });
      return;
    case "resume": {
      if (target === undefined) throw new Error("loep resume heeft een site nodig");
      await resumeSite(findSite(readBacklog(backlogPath()).sites, target), values.what);
      return;
    }
    case "log": {
      if (target === undefined) throw new Error("loep log heeft een site nodig");
      const site = findSite(readBacklog(backlogPath()).sites, target);
      const path = transcriptPath(site);
      process.stdout.write(`${readTranscript(path).join("\n")}\n`);
      if (values.follow) spawnSync("tail", ["-f", path], { stdio: "inherit" });
      return;
    }
    case "login": {
      // The login is the one human step that has to happen early: loep opens a window, the person types
      // the test account in it, and only the session that is left over stays in the run.
      if (target === undefined) throw new Error("loep audit login heeft een site nodig; het opent het venster van loep voor het testaccount");
      const site = findSite(readBacklog(backlogPath()).sites, target);
      if (site.login === null) throw new Error(`${site.slug} heeft geen inlog in de backlog; zet --login-page en --login-role bij de site, of laat dit achterwege`);
      const known = siteState(readState(statePath()), site.slug);
      if (known.run === null) throw new Error(`${site.slug} heeft nog geen run; een inlog hoort bij een run, en die begint met: loep run --only ${site.slug}`);
      const args = cliArgs(toolboxCli, "login", "--run", known.run, "--url", site.login.page, ...(site.login.role === "" ? [] : ["--role", site.login.role]), ...positionals.slice(2));
      const result = spawnSync("node", args, { stdio: "inherit" });
      if (result.status !== 0) {
        process.exitCode = result.status ?? 1;
        return;
      }
      afterPerson(site.slug, command);
      process.stdout.write(`\nDaarna: loep resume ${site.slug}\n`);
      return;
    }
    case "answer":
    case "sign":
    case "decide":
    case "statement": {
      if (target === undefined) throw new Error(`loep ${command} heeft een site nodig`);
      const site = findSite(readBacklog(backlogPath()).sites, target);
      const known = siteState(readState(statePath()), site.slug);
      if (known.run === null) throw new Error(`${site.slug} heeft nog geen run; er is niets om te ${command === "sign" ? "tekenen" : "beantwoorden"}`);
      const args = positionals.slice(2);
      const result = spawnSync("node", cliArgs(toolboxCli, command, "--run", known.run, ...args), { stdio: "inherit" });
      if (result.status !== 0) {
        process.exitCode = result.status ?? 1;
        return;
      }
      // `answer --criterion x` without --point only shows the open points; the regie has nothing to do after it.
      if (command !== "answer" || args.includes("--point")) afterPerson(site.slug, command);
      process.stdout.write(`\nDaarna: loep resume ${site.slug}\n`);
      return;
    }
    case "doctor": {
      const checks = doctor({ routes: values.routes === true });
      process.stdout.write(doctorTextNl(checks));
      process.exitCode = checks.every((check) => check.ok) ? 0 : 1;
      return;
    }
    case "meting": {
      // The meting has a home of its own, so the fixtures never stand between the sites of real owners.
      process.env["LOEP_HOME"] = metingHome();
      const silence = await silent();
      if (silence.length > 0) {
        throw new Error(`de testsite antwoordt niet op ${silence.map((fixture) => fixture.url).join(" en ")}. Start hem in een ander venster met: just testsite, en probeer het daarna opnieuw`);
      }
      const prepared = prepareBacklog(backlogPath());
      for (const fixture of prepared.added) process.stdout.write(`${fixture.slug} staat vanaf nu in de backlog van de meting.\n`);
      process.stdout.write(`De meting van ${FIXTURES.map((fixture) => fixture.name).join(" en ")} staat in ${metingHome()}.\n`);
      await runBacklog({ sites: values.sites ?? String(FIXTURES.length), only: values.only, newRun: values.new === true });
      return;
    }
    default:
      throw new Error(`"${command}" ken ik niet\n\n${USAGE}`);
  }
}

// Started on its own, so a test can call it as a program and a run in flight is not the only way in.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = await harnessCli(process.argv.slice(2));
