#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { addSite, readBacklog, type Site } from "./backlog.ts";
import { doctor, doctorTextNl, routesCheck } from "./doctor.ts";
import { FIXTURES, metingHome, prepareBacklog, silent } from "./meting.ts";
import { backlogPath, homeDir, reportsDir, siteDir, stateDir, toolboxCli } from "./paths.ts";
import { lastWords, readTranscript } from "./run.ts";
import { handOutMissing, lockPath, pauseSite, runSite, statePath, transcriptPath } from "./runner.ts";
import { acquireLock, isGone, PHASES_NL, readState, releaseLock, siteState, type SiteState } from "./state.ts";
import { versionNl } from "./version.ts";

const USAGE = `lus: loep over een backlog van sites, met een mens erbij waar dat nodig is

  lus add <url> [--slug <naam>] [--name <naam>] [--organisation <naam>] [--purpose verbeteren|verantwoorden]
                [--allow-sending] [--max-sends <n>] [--also-origin <url>]... [--never-open <host>]...
                [--login-page <url> --login-role <rol>] [--at-once <n>] [--mailbox <url>]
                [--vendor-tag <prefix>]... [--note <tekst>]
                                         Zet een site in de backlog. Wat je weglaat vraagt lus als er een
                                         terminal is, en anders vult het de standaard in
  lus run [--sites <n>] [--only <site>] [--new]
                                         De backlog afwerken: één regie per site, in de orde van het
                                         bestand. Een site die op een mens wacht slaat lus over.
                                         --new begint naast de run die er al staat, met een nieuwe map
  lus resume <site> [--what <tekst>]     Ga verder met een site die stopte, met wat de mens deed
  lus log <site> [--follow]              Wat de regie deed, regel voor regel
  lus list [--json]                      De backlog met de stand van elke site
  lus status [<site>] [--json]           Wat er met een site gebeurde, en wat er nu moet
  lus pause <site>                       Zet een site stil; de run blijft staan
  lus login <site> [--idle]              Open het venster waarin je zelf met het testaccount inlogt;
                                         loep bewaart de sessie, niet het wachtwoord
  lus answer|sign|decide|statement <site> [-- <opties>]
                                         Geef de terminal aan loep zelf, voor wat alleen een mens
                                         kan: een antwoord, de handtekening, een besluit, de verklaring
  lus doctor [--routes]                  Controleer wat een run nodig heeft, en met --routes ook VLAM
  lus meting [--sites <n>] [--only <site>]
                                         Meet loep op zijn eigen testwebsites, met de regie en de
                                         skill, in een backlog apart van die van echte eigenaren.
                                         Vereist een draaiende testsite: just testsite

De backlog staat in ${backlogPath()} en de stand van lus in ${stateDir()}.
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
  if (sites.length === 0) return `De backlog is leeg. Zet er een site in met: lus add <url>\n`;
  const rows = sites.map((site) => {
    const site_ = siteState(state, site.slug);
    return [site.slug, isGone(site_) ? "proces weg" : PHASES_NL[site_.phase], site_.step ?? "", agoNl(site_.updatedAt)];
  });
  const header = ["site", "stand", "stap", "bijgewerkt"];
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column]!.length)));
  const line = (row: string[]): string => row.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]!) : ` ${cell}`)).join("  ").trimEnd();
  return `${[line(header), ...rows.map(line)].join("\n")}\n`;
}

/** Everything about one site: the file, the run, the question, and what to do next. */
function statusTextNl(site: Site, site_: SiteState, words: string[] = []): string {
  const lines: string[] = [`${site.slug}  ${isGone(site_) ? "proces weg" : PHASES_NL[site_.phase]}`];
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
  if (site.sending.allow) field("versturen", `ja, hooguit ${site.sending.max}`);
  for (const file of site_.handouts) field("rapport", file);
  if (site_.question) {
    lines.push("", `  Vraag: ${site_.question.textNl}`);
    if (site_.question.command) lines.push(`  Daarna: ${site_.question.command}`);
  }
  if (isGone(site_)) {
    lines.push("", `  Het proces van lus is weg terwijl de run nog liep. lus run --only ${site.slug} gaat verder in dezelfde run.`);
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
 * window for that when the run needs it, so the secret stays out of the backlog and out of lus.
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
      if (login !== null) process.stdout.write("Het wachtwoord vraagt lus nooit: loep opent aan het begin van de run een venster waarin je zelf inlogt, en bewaart alleen de sessie.\n");
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
      process.stdout.write(`\nDaarna: lus resume ${site.slug}\n`);
      return;
    case "klaar":
      process.stdout.write(`${site.slug} is verzegeld: de run staat in ${state.run}, het rapport komt in ${reportsDir()}.\n`);
      return;
    case "fout":
      process.stdout.write(`${site.slug} stopte zonder vraag en zonder verzegelde run (laatste stap: ${state.step ?? "onbekend"}).\nBekijk: lus log ${site.slug}\n`);
      return;
    default:
      process.stdout.write(`${site.slug}: ${PHASES_NL[state.phase]}\n`);
  }
}

/** One lus at a time: a second one would start a second regie in the same run. */
async function withLock<T>(slug: string | null, body: () => Promise<T>): Promise<T> {
  const taken = acquireLock(lockPath(), slug);
  if (!taken.ok) throw new Error(`lus loopt al: proces ${taken.lock.pid} op ${taken.lock.host}${taken.lock.slug ? `, met ${taken.lock.slug}` : ""}, sinds ${momentNl(taken.lock.since)}`);
  try {
    return await body();
  } finally {
    releaseLock(lockPath());
  }
}

/** Work the backlog in the order of the file, skipping a site that waits for a person. */
async function runBacklog(options: { sites?: string | undefined; only?: string | undefined; newRun?: boolean | undefined }): Promise<void> {
  // Een tunnel die 24 uur na het aanmelden dichtvalt kost een run van uren; dit kost een verzoek.
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
    const todo = backlog.sites.filter((entry) => (options.only === undefined || entry.slug === options.only) && !waiting.has(siteState(state, entry.slug).phase));
    // Een run die klaar was voordat lus rapporten uitgaf, krijgt ze alsnog: geen regie, alleen de kopie.
    for (const entry of backlog.sites) {
      if (options.only !== undefined && entry.slug !== options.only) continue;
      const known = siteState(readState(statePath()), entry.slug);
      for (const file of handOutMissing(entry.slug, known)) process.stdout.write(`rapport: ${file}\n`);
    }
    if (todo.length === 0) {
      process.stdout.write(`Niets te doen: elke site is klaar, wacht op een mens, of staat stil${options.only === undefined ? "" : ` (--only ${options.only})`}.\n`);
      return;
    }
    for (const entry of todo.slice(0, limit)) await report(entry, await runSite({ site: entry, newRun: options.newRun, onStep: progress }));
  });
}

/** Continue a site that stopped, with what the person did since. */
async function resumeSite(site: Site, what: string | undefined): Promise<void> {
  await withLock(site.slug, async () => {
    const known = siteState(readState(statePath()), site.slug);
    if (known.run === null) throw new Error(`${site.slug} is nog niet begonnen; start hem met: lus run --only ${site.slug}`);
    const text = what ?? (known.question !== null ? `De mens voerde het commando uit dat in vraag.md stond${known.question.command ? ` (${known.question.command})` : ""}.` : "De vorige regie stopte zonder een vraag achter te laten.");
    await report(site, await runSite({ site, resumeNl: text, onStep: progress }));
  });
}

/** The menu of a lus without a command: everything a person does with the backlog, one key each. */
async function menu(): Promise<void> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const options = "  1 de backlog tonen    2 een site toevoegen    3 de backlog afwerken\n  4 een site hervatten  5 de controle          q stoppen";
  try {
    for (;;) {
      process.stdout.write(`\n${listTextNl(readBacklog(backlogPath()).sites, readState(statePath()))}\n${options}\n> `);
      const choice = (await terminal.question("")).trim();
      try {
        if (choice === "" || choice === "q" || choice === "quit") return;
        if (choice === "1") continue;
        if (choice === "2") {
          const url = (await terminal.question("url van de site: ")).trim();
          if (url === "") continue;
          const name = (await terminal.question("naam (leeg: de host): ")).trim();
          const organisation = (await terminal.question("eigenaar van de site: ")).trim();
          const site = addSite(backlogPath(), { url, name: name === "" ? undefined : name, organisation });
          process.stdout.write(`${site.slug} staat in de backlog.\n`);
          continue;
        }
        if (choice === "3") {
          await runBacklog({});
          continue;
        }
        if (choice === "4") {
          const slug = (await terminal.question("welke site: ")).trim();
          if (slug === "") continue;
          const site = findSite(readBacklog(backlogPath()).sites, slug);
          const what = (await terminal.question("wat deed je? (leeg: het commando uit vraag.md)\n")).trim();
          await resumeSite(site, what === "" ? undefined : what);
          continue;
        }
        if (choice === "5") {
          process.stdout.write(doctorTextNl(doctor()));
          continue;
        }
        process.stdout.write("Dat ken ik niet; kies 1 tot en met 5, of q.\n");
      } catch (error) {
        process.stdout.write(`${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  } finally {
    terminal.close();
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: OPTIONS });
  const command = positionals[0];
  const target = positionals[1];
  if (values.help || command === "help") {
    process.stdout.write(USAGE);
    return;
  }
  if (command === undefined) {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      await menu();
      return;
    }
    const backlog = readBacklog(backlogPath());
    process.stdout.write(listTextNl(backlog.sites, readState(statePath())));
    process.stdout.write("\nZet er een site bij met: lus add <url>, en start met: lus run. lus --help toont alles.\n");
    return;
  }

  switch (command) {
    case "add": {
      if (target === undefined) throw new Error("lus add heeft een url nodig: lus add https://www.voorbeeld.nl/");
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
        sending: { allow: values["allow-sending"] === true, max: values["max-sends"] === undefined ? 20 : Number(values["max-sends"]) },
        alsoOrigins: values["also-origin"] ?? [],
        neverOpen: values["never-open"] ?? [],
        login: filled.login,
        atOnce: values["at-once"] === undefined ? 2 : Number(values["at-once"]),
        mailbox: values.mailbox ?? null,
        vendorTags: values["vendor-tag"] ?? [],
        note: values.note ?? "",
      });
      process.stdout.write(`${site.slug} staat in de backlog.\nStart hem met: lus run\n`);
      if (site.login !== null) process.stdout.write(`Deze site zit achter een inlog: aan het begin van de run stopt lus daarvoor, en lus login ${site.slug} opent het venster.\n`);
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
      if (target === undefined) throw new Error("lus pause heeft een site nodig");
      const backlog = readBacklog(backlogPath());
      const site = findSite(backlog.sites, target);
      pauseSite(site.slug);
      process.stdout.write(`${site.slug} staat stil. Ga verder met: lus resume ${site.slug}\n`);
      return;
    }
    case "run":
      await runBacklog({ sites: values.sites, only: values.only, newRun: values.new === true });
      return;
    case "resume": {
      if (target === undefined) throw new Error("lus resume heeft een site nodig");
      await resumeSite(findSite(readBacklog(backlogPath()).sites, target), values.what);
      return;
    }
    case "log": {
      if (target === undefined) throw new Error("lus log heeft een site nodig");
      const site = findSite(readBacklog(backlogPath()).sites, target);
      const path = transcriptPath(site);
      process.stdout.write(`${readTranscript(path).join("\n")}\n`);
      if (values.follow) spawnSync("tail", ["-f", path], { stdio: "inherit" });
      return;
    }
    case "login": {
      // The login is the one human step that has to happen early: loep opens a window, the person types
      // the test account in it, and only the session that is left over stays in the run.
      if (target === undefined) throw new Error("lus login heeft een site nodig; het opent het venster van loep voor het testaccount");
      const site = findSite(readBacklog(backlogPath()).sites, target);
      if (site.login === null) throw new Error(`${site.slug} heeft geen inlog in de backlog; zet --login-page en --login-role bij de site, of laat dit achterwege`);
      const known = siteState(readState(statePath()), site.slug);
      if (known.run === null) throw new Error(`${site.slug} heeft nog geen run; een inlog hoort bij een run, en die begint met: lus run --only ${site.slug}`);
      const args = [toolboxCli, "login", "--run", known.run, "--url", site.login.page, ...(site.login.role === "" ? [] : ["--role", site.login.role]), ...positionals.slice(2)];
      const result = spawnSync("node", args, { stdio: "inherit" });
      if (result.status !== 0) {
        process.exitCode = result.status ?? 1;
        return;
      }
      process.stdout.write(`\nDaarna: lus resume ${site.slug}\n`);
      return;
    }
    case "answer":
    case "sign":
    case "decide":
    case "statement": {
      if (target === undefined) throw new Error(`lus ${command} heeft een site nodig`);
      const site = findSite(readBacklog(backlogPath()).sites, target);
      const known = siteState(readState(statePath()), site.slug);
      if (known.run === null) throw new Error(`${site.slug} heeft nog geen run; er is niets om te ${command === "sign" ? "tekenen" : "beantwoorden"}`);
      const result = spawnSync("node", [toolboxCli, command, "--run", known.run, ...positionals.slice(2)], { stdio: "inherit" });
      if (result.status !== 0) {
        process.exitCode = result.status ?? 1;
        return;
      }
      process.stdout.write(`\nDaarna: lus resume ${site.slug}\n`);
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
      process.env["LUS_HOME"] = metingHome();
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

main().catch((error: Error) => {
  process.stderr.write(`lus: ${error.message}\n`);
  process.exitCode = 1;
});
