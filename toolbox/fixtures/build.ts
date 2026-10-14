#!/usr/bin/env node
/**
 * Generates the two fixture sites and the third-party origin from the sources in src/.
 * The sources carry both versions of every planted spot between markers; this script
 * writes one static tree per variant, plus the answer key and the reference files.
 * The output is committed. The server never runs this script.
 *
 *   node fixtures/build.ts          write the trees, key.json and the reference files
 *   node fixtures/build.ts --check  fail when the committed output differs from the sources
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { CRITERIA_EXPECTED, DEFECTS, TRAPS, type Defect } from "./defects.ts";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, "src");

export const SITES = {
  defect: { dir: "lindewaard", name: "Lindewaard", port: 4710 },
  clean: { dir: "berkenveen", name: "Berkenveen", port: 4711 },
  thirdParty: { dir: "kijkpunt", name: "Kijkpunt", port: 4712 },
} as const;

type Variant = "defect" | "clean";

interface PageSource {
  /** Path of the generated file below the site root. */
  file: string;
  /** Path a visitor uses. */
  path: string;
  title: string;
  section: string;
  kind?: "article" | "notFound" | "response" | "account";
}

export const PAGES: PageSource[] = [
  { file: "index.html", path: "/", title: "Startpagina", section: "/" },
  { file: "nieuws/index.html", path: "/nieuws/", title: "Nieuws", section: "/nieuws/" },
  { file: "nieuws/nieuwe-fietsenstalling.html", path: "/nieuws/nieuwe-fietsenstalling.html", title: "Nieuwe fietsenstalling bij het station", section: "/nieuws/", kind: "article" },
  { file: "nieuws/zomerfeest.html", path: "/nieuws/zomerfeest.html", title: "Zomerfeest op het Marktplein", section: "/nieuws/", kind: "article" },
  { file: "nieuws/werkzaamheden-dorpsstraat.html", path: "/nieuws/werkzaamheden-dorpsstraat.html", title: "Werkzaamheden aan de Dorpsstraat", section: "/nieuws/", kind: "article" },
  { file: "producten.html", path: "/producten.html", title: "Producten en diensten", section: "/producten.html" },
  { file: "vergunning.html", path: "/vergunning.html", title: "Parkeervergunning aanvragen", section: "/producten.html" },
  { file: "afval.html", path: "/afval.html", title: "Afval en grondstoffen", section: "/afval.html" },
  { file: "openingstijden.html", path: "/openingstijden.html", title: "Openingstijden", section: "/openingstijden.html" },
  { file: "raadsvergadering.html", path: "/raadsvergadering.html", title: "Raadsvergadering terugkijken", section: "/raadsvergadering.html" },
  { file: "veelgestelde-vragen.html", path: "/veelgestelde-vragen.html", title: "Veelgestelde vragen", section: "/veelgestelde-vragen.html" },
  { file: "zoeken.html", path: "/zoeken.html", title: "Zoeken", section: "" },
  { file: "contact.html", path: "/contact.html", title: "Contact", section: "/contact.html" },
  { file: "inloggen.html", path: "/inloggen.html", title: "Inloggen", section: "" },
  { file: "sitemap.html", path: "/sitemap.html", title: "Sitemap", section: "" },
  { file: "bedankt.html", path: "/bedankt.html", title: "Bedankt", section: "", kind: "response" },
  { file: "404.html", path: "/404.html", title: "Pagina niet gevonden", section: "", kind: "notFound" },
];

/** The pages behind the login. The server only gives them to a visitor with a session; no sitemap names them. */
export const ACCOUNT_PAGES: PageSource[] = [
  { file: "mijn/index.html", path: "/mijn/", title: "Overzicht", section: "", kind: "account" },
  { file: "mijn/aanvragen.html", path: "/mijn/aanvragen.html", title: "Uw aanvragen", section: "", kind: "account" },
  { file: "mijn/berichten.html", path: "/mijn/berichten.html", title: "Uw berichten", section: "", kind: "account" },
  { file: "mijn/gegevens.html", path: "/mijn/gegevens.html", title: "Uw gegevens", section: "", kind: "account" },
];

const MENU = [
  { href: "/", label: "Home" },
  { href: "/nieuws/", label: "Nieuws" },
  { href: "/producten.html", label: "Producten" },
  { href: "/afval.html", label: "Afval" },
  { href: "/openingstijden.html", label: "Openingstijden" },
  { href: "/raadsvergadering.html", label: "Gemeenteraad" },
  { href: "/veelgestelde-vragen.html", label: "Veelgestelde vragen" },
  { href: "/contact.html", label: "Contact" },
];

const MARKER = /(?:<!--|\/\*)@bad ([\w.-]+)(?:-->|\*\/)([\s\S]*?)(?:<!--|\/\*)@good(?:-->|\*\/)([\s\S]*?)(?:<!--|\/\*)@end(?:-->|\*\/)/g;

/** Every switch that was used while building, so the key can be checked against the sources. */
const usedSwitches = new Set<string>();

function resolveMarkers(text: string, variant: Variant, origin: string): string {
  const resolved = text.replace(MARKER, (_match, id: string, bad: string, good: string) => {
    usedSwitches.add(id);
    return variant === "defect" ? bad : good;
  });
  if (/@(bad|good|end)\b/.test(resolved)) throw new Error(`unbalanced marker left in ${origin}`);
  return resolved;
}

function layout(page: PageSource, body: string, variant: Variant): string {
  const bad = variant === "defect";
  const site = SITES[variant];
  const third = `http://127.0.0.1:${SITES.thirdParty.port}`;
  const pick = <T,>(id: string, defect: T, clean: T): T => {
    usedSwitches.add(id);
    return bad ? defect : clean;
  };
  const municipality = `Gemeente ${site.name}`;

  let title = `${page.title} - ${municipality}`;
  if (page.path === "/") title = pick("2.4.2-sjabloonrest", `Home - ${municipality} - ${municipality} % % %`, `${municipality}: startpagina`);
  if (page.path === "/veelgestelde-vragen.html" || page.path === "/afval.html") title = pick("2.4.2-zelfde-titel", municipality, title);

  const withoutLang = page.kind === "article" || page.kind === "notFound";
  const htmlTag = withoutLang ? pick("3.1.1-taal", "<html>", '<html lang="nl">') : '<html lang="nl">';
  const viewport = pick("1.4.4-zoom-uit", "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no", "width=device-width, initial-scale=1");

  const help = (heading: string): string =>
    `<div class="hulp">${heading} <span>Bel <a href="tel:140345">14 0345</a> of <a href="/contact.html">stuur een bericht</a>.</span></div>`;
  const helpInHeader = page.section === "/nieuws/" ? pick("3.2.6-hulp", help('<p class="hulp-titel">Hulp nodig?</p>'), "") : "";
  const helpInFooter = page.section === "/nieuws/" ? pick("3.2.6-hulp", "", help('<h2 class="hulp-titel">Hulp nodig?</h2>')) : help('<h2 class="hulp-titel">Hulp nodig?</h2>');

  const menu = page.path === "/contact.html" ? pick("3.2.3-menuvolgorde", [MENU.at(-1)!, ...MENU.slice(0, -1)], MENU) : MENU;
  const menuItems = (items: typeof MENU): string =>
    items.map((item) => `<li><a href="${item.href}"${item.href === page.section ? ' aria-current="page"' : ""}>${item.label}</a></li>`).join("\n        ");
  const mobilePanel = `<div class="mobiel-menu" id="mobiel-menu" hidden>
      <ul>
        ${menuItems(menu)}
        <li><a href="/inloggen.html">Inloggen bij Mijn ${site.name}</a></li>
        <li><a href="/sitemap.html">Sitemap</a></li>
      </ul>
    </div>`;

  const noticeBody = `<img class="melding-logo" src="/beeld/logo.svg" width="56" height="56" alt="${pick("1.1.1-logo-melding", "logo", "")}">
    <div class="melding-tekst">
      ${pick("2.4.11-melding", '<p class="melding-titel">Cookies op deze website</p>', '<h2 class="melding-titel" id="melding-titel">Cookies op deze website</h2>')}
      <p>Wij gebruiken cookies om de website te laten werken en om bezoeken te tellen. U kiest zelf welke cookies u toestaat.</p>
    </div>
    <div class="melding-knoppen">
      <button type="button" data-keuze="alles">Alles toestaan</button>
      <button type="button" class="knop-rustig" data-keuze="aanpassen">Aanpassen</button>
      <button type="button" class="knop-rustig" data-keuze="weigeren">Weigeren</button>
    </div>
    <div class="melding-voorkeuren" hidden>
      <label class="keuze"><input type="checkbox" name="statistiek"> Cookies om bezoeken te tellen</label>
      <label class="keuze"><input type="checkbox" name="media"> Cookies van onze videodienst</label>
      <button type="button" data-keuze="eigen">Keuze opslaan</button>
    </div>`;
  const noticeBad = `<div class="melding" id="cookiemelding" hidden>
    ${noticeBody}
  </div>`;
  const noticeGood = `<div class="melding-achtergrond" hidden></div>
  <div class="melding" id="cookiemelding" role="dialog" aria-modal="true" aria-labelledby="melding-titel" hidden>
    ${noticeBody}
  </div>`;

  const social = (label: string, anchor: string, path: string): string =>
    `<a href="/contact.html#${anchor}"${pick("2.4.4-sociaal", "", ` aria-label="${label}"`)}><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"/></svg></a>`;

  return `<!doctype html>
${htmlTag}
<head>
<meta charset="utf-8">
<meta name="viewport" content="${viewport}">
<title>${title}</title>
<link rel="stylesheet" href="/stijl.css">
<link rel="icon" href="/beeld/logo.svg">
</head>
<body id="top">
  ${pick("2.4.11-melding", "", noticeGood)}
  <div class="pagina">
  <a class="skiplink" href="#inhoud">Direct naar de inhoud</a>
  <header class="kop">
    <a class="logo" href="/"><img src="/beeld/wapen.svg" width="180" height="48" alt="${municipality}, naar de startpagina"></a>
    ${helpInHeader}
    <form class="zoekbalk" role="search" action="/zoeken.html" method="get">
      <input type="search" name="q" aria-label="Zoek op de site">
      <button type="submit"${pick("2.5.3-zoekknop", ' aria-label="Opdracht versturen"', "")}>Zoeken</button>
    </form>
    ${pick("4.1.2-menuknop", '<button type="button" class="menuknop"><span class="streepjes"></span></button>', '<button type="button" class="menuknop" aria-expanded="false" aria-controls="mobiel-menu"><span class="streepjes"></span>Menu</button>')}
    <nav class="hoofdmenu" aria-label="Hoofdmenu">
      <ul>
        ${menuItems(menu)}
      </ul>
    </nav>
    ${pick("2.4.3-mobiel-menu", "", mobilePanel)}
  </header>
  <main id="${pick("2.4.1-skiplink", "hoofddeel", "inhoud")}" tabindex="-1">
${page.kind === "account" ? accountBar(page, site.name) : ""}${body.trimEnd()}
  </main>
  <footer class="voet">
    <div class="voet-kolommen">
      <div>
        ${pick("1.3.1-voetkop", '<span class="voet-titel">Bezoekadres</span>', "<h2>Bezoekadres</h2>")}
        <p>Raadhuisplein 1<br>4100 AB ${site.name}</p>
        <p><a href="/openingstijden.html"${pick("3.2.1-voetlink", ' onfocus="this.blur()"', "")}>Openingstijden</a></p>
      </div>
      <div>
        ${helpInFooter}
      </div>
      <div>
        ${pick("1.3.1-voetkop", '<span class="voet-titel">Over deze website</span>', "<h2>Over deze website</h2>")}
        <ul>
          <li><a href="/sitemap.html">Sitemap</a></li>
          <li><a href="/veelgestelde-vragen.html">Veelgestelde vragen</a></li>
        </ul>
      </div>
      <div>
        ${pick("1.3.1-voetkop", '<span class="voet-titel">Volg ons</span>', "<h2>Volg ons</h2>")}
        <div class="sociaal">
          ${social(`${municipality} op Mastodon`, "mastodon", "M4 4h16v12H9l-5 4z")}
          ${social(`${municipality} op LinkedIn`, "linkedin", "M4 9h4v11H4zM6 3a2 2 0 110 4 2 2 0 010-4zM10 9h4v2c2-3 6-2 6 2v7h-4v-6c0-2-2-2-2 0v6h-4z")}
        </div>
      </div>
    </div>
    <div class="voet-onder">
      <img src="/beeld/wapen-donker.svg" width="120" height="32" alt="${municipality}"${pick("4.1.2-rol-logo", ' role="logo"', "")}>
      ${pick("2.1.1-naar-boven", '<a class="naar-boven">Naar boven</a>', '<a class="naar-boven" href="#top">Naar boven</a>')}
    </div>
  </footer>
  <div class="chat">
    <div class="chat-venster" id="chatvenster" hidden>
      <h2>Chat met de gemeente</h2>
      ${pick("2.1.1-chat-sluit", '<div class="chat-sluit">×</div>', '<button type="button" class="chat-sluit knop-rustig" aria-label="Chat sluiten">×</button>')}
      <div class="chat-berichten"${pick("4.1.3-chat", "", ' role="log" aria-live="polite" aria-label="Berichten in de chat" tabindex="0"')}></div>
      <form class="chat-formulier">
        <label for="chat-invoer">Uw bericht</label>
        <input type="text" id="chat-invoer" autocomplete="off">
        <button type="submit">Verstuur</button>
      </form>
    </div>
    <button type="button" class="chat-knop" aria-expanded="false" aria-controls="chatvenster">Chat met ons</button>
  </div>
  </div>
  ${pick("2.4.3-mobiel-menu", mobilePanel, "")}
  ${pick("2.4.11-melding", noticeBad, "")}
  <iframe class="stil-kader" src="${third}/leeg.html" title="Blank" tabindex="-1" aria-hidden="true"></iframe>
  <script src="/site.js"></script>
</body>
</html>
`;
}

/** What every page behind the login starts with: where the visitor is in the account, and the way out. */
function accountBar(page: PageSource, name: string): string {
  const items = ACCOUNT_PAGES.map((entry) => `<li><a href="${entry.path}"${entry.path === page.path ? ' aria-current="page"' : ""}>${entry.title}</a></li>`).join("\n        ");
  return `<nav class="account-balk" aria-label="Mijn ${name}">
      <ul>
        ${items}
      </ul>
      <p>Ingelogd als inwoner 4100-27. <a href="/uitloggen">Uitloggen</a></p>
    </nav>
`;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** All files of one site as a map from relative path to content. */
function buildSite(variant: Variant): Map<string, string | Buffer> {
  const site = SITES[variant];
  const origin = `http://127.0.0.1:${site.port}`;
  const third = `http://127.0.0.1:${SITES.thirdParty.port}`;
  const files = new Map<string, string | Buffer>();
  const fill = (text: string): string => text.replaceAll("{{naam}}", site.name).replaceAll("{{derde}}", third);

  for (const page of [...PAGES, ...ACCOUNT_PAGES]) {
    const source = readFileSync(join(SRC, "pages", page.file), "utf8");
    files.set(page.file, layout(page, fill(resolveMarkers(source, variant, page.file)), variant));
  }
  for (const name of ["stijl.css", "site.js"]) files.set(name, resolveMarkers(readFileSync(join(SRC, name), "utf8"), variant, name));
  for (const name of readdirSync(join(SRC, "beeld"))) files.set(`beeld/${name}`, fill(readFileSync(join(SRC, "beeld", name), "utf8")));

  // The summary video differs between the variants: only the clean one says aloud what the slide shows.
  usedSwitches.add("1.2.3-beschrijving").add("1.2.5-audiodescriptie");
  files.set("media/raadsvergadering.webm", readFileSync(join(SRC, "media", variant === "defect" ? "raadsvergadering.a.webm" : "raadsvergadering.b.webm")));
  files.set("media/gesprek.ogg", readFileSync(join(SRC, "media", "gesprek.ogg")));
  if (variant === "defect") files.set("media/melodie.ogg", readFileSync(join(SRC, "media", "melodie.ogg")));
  else files.set("media/raadsvergadering.vtt", readFileSync(join(SRC, "media", "raadsvergadering.vtt"), "utf8"));

  const listed = PAGES.filter((page) => !page.kind || page.kind === "article").map((page) => `  <url><loc>${origin}${page.path}</loc></url>`);
  files.set("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${listed.join("\n")}\n</urlset>\n`);
  files.set("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
  return files;
}

function buildThirdParty(): Map<string, string | Buffer> {
  const files = new Map<string, string | Buffer>();
  for (const path of walk(join(SRC, "kijkpunt"))) files.set(relative(join(SRC, "kijkpunt"), path), readFileSync(path, "utf8"));
  return files;
}

function keyDocument(): unknown {
  const count = (value: Defect["class"]): number => DEFECTS.filter((defect) => defect.class === value).length;
  return {
    schema: "toegankelijk/fixture-key/1",
    noteNl: "Antwoordsleutel van de testsite. Dit bestand wordt niet geserveerd. Lindewaard bevat de gebreken, Berkenveen is de tweeling waarin dezelfde plekken goed zijn gedaan.",
    sites: {
      defect: { name: SITES.defect.name, root: `sites/${SITES.defect.dir}`, defaultPort: SITES.defect.port },
      clean: { name: SITES.clean.name, root: `sites/${SITES.clean.dir}`, defaultPort: SITES.clean.port },
      thirdParty: { name: SITES.thirdParty.name, root: `sites/${SITES.thirdParty.dir}`, defaultPort: SITES.thirdParty.port },
    },
    pages: [...PAGES, ...ACCOUNT_PAGES].map((page) => ({ path: page.path, file: page.file, kind: page.kind ?? "page" })),
    totals: { defects: DEFECTS.length, measurable: count("measurable"), interaction: count("interaction"), looking: count("looking") },
    defects: DEFECTS,
    criteria: CRITERIA_EXPECTED,
    traps: TRAPS,
  };
}

function referenceDocument(variant: Variant): unknown {
  const site = SITES[variant];
  const failed = CRITERIA_EXPECTED.filter((entry) => entry[variant] === "failed").map((entry) => entry.id);
  const findings = variant === "clean" ? [] : DEFECTS.map((defect) => ({
    id: defect.id,
    criterion: defect.criterion,
    page: defect.pages.length > 3 || defect.pages[0] === "*" ? "alle" : defect.pages.join(", "),
    descriptionNl: defect.wrongNl,
    where: `${defect.selector} (${defect.whereNl})`,
    state: defect.stateNl,
    medium: "web",
    ...(defect.alsoCriteria ? { alsoCriteria: defect.alsoCriteria } : {}),
  }));
  return {
    kind: "answer-key",
    wcagVersion: "2.2",
    sampleNote: `De testsite ${site.name} heeft ${PAGES.length} paginatypen. De sleutel noemt per gebrek de pagina's waarop het zit.`,
    outcomeNote: variant === "defect"
      ? `De sleutel bevat ${DEFECTS.length} ingebouwde gebreken onder ${failed.length} criteria. Wat de sleutel niet noemt, is niet met opzet fout gemaakt.`
      : "In deze tweeling zijn dezelfde plekken goed gedaan. Geen enkel criterium hoort te worden afgekeurd.",
    failed,
    failedOnlyInDocuments: [],
    problemCount: findings.length,
    findings,
  };
}

function checkKey(): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const defect of DEFECTS) {
    if (ids.has(defect.id)) problems.push(`duplicate defect id ${defect.id}`);
    ids.add(defect.id);
    const planted = defect.plantedWith ?? defect.id;
    if (!usedSwitches.has(planted)) problems.push(`defect ${defect.id} has no switch "${planted}" in the sources`);
    const expected = CRITERIA_EXPECTED.find((entry) => entry.id === defect.criterion);
    if (expected?.defect !== "failed") problems.push(`defect ${defect.id}: criterion ${defect.criterion} is not expected to fail`);
  }
  for (const id of usedSwitches) if (!ids.has(id)) problems.push(`switch "${id}" in the sources has no entry in the key`);
  for (const entry of CRITERIA_EXPECTED) {
    if (entry.defect === "failed" && !DEFECTS.some((defect) => defect.criterion === entry.id)) problems.push(`criterion ${entry.id} is expected to fail but has no defect`);
  }
  return problems;
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** Everything the build produces, as a map from path below fixtures/ to content. */
export function buildAll(): Map<string, string | Buffer> {
  usedSwitches.clear();
  const output = new Map<string, string | Buffer>();
  for (const variant of ["defect", "clean"] as const) {
    for (const [path, content] of buildSite(variant)) output.set(`sites/${SITES[variant].dir}/${path}`, content);
  }
  for (const [path, content] of buildThirdParty()) output.set(`sites/${SITES.thirdParty.dir}/${path}`, content);
  const problems = checkKey();
  if (problems.length > 0) throw new Error(`the key and the sources disagree:\n${problems.join("\n")}`);
  output.set("key.json", json(keyDocument()));
  output.set(`reference-${SITES.defect.dir}.json`, json(referenceDocument("defect")));
  output.set(`reference-${SITES.clean.dir}.json`, json(referenceDocument("clean")));
  return output;
}

/** Paths whose committed content differs from what the sources produce now. */
export function staleOutput(): string[] {
  const output = buildAll();
  const stale = [...output].filter(([path, content]) => {
    const target = join(ROOT, path);
    return !existsSync(target) || Buffer.compare(readFileSync(target), Buffer.from(content)) !== 0;
  }).map(([path]) => path);
  const expected = new Set(output.keys());
  const extra = existsSync(join(ROOT, "sites")) ? walk(join(ROOT, "sites")).map((path) => relative(ROOT, path)).filter((path) => !expected.has(path)) : [];
  return [...stale, ...extra.map((path) => `${path} (not produced by the build)`)];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const stale = staleOutput();
    for (const path of stale) process.stdout.write(`- ${path}\n`);
    process.stdout.write(stale.length === 0 ? "OK: the generated sites match the sources\n" : `${stale.length} files differ; run node fixtures/build.ts\n`);
    process.exitCode = stale.length === 0 ? 0 : 1;
  } else {
    const output = buildAll();
    rmSync(join(ROOT, "sites"), { recursive: true, force: true });
    for (const [path, content] of output) {
      mkdirSync(dirname(join(ROOT, path)), { recursive: true });
      writeFileSync(join(ROOT, path), content);
    }
    process.stdout.write(`${output.size} files written, ${DEFECTS.length} defects in the key\n`);
  }
}
