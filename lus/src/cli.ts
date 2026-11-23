#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { addSite, readBacklog, type Site } from "./backlog.ts";
import { doctor, doctorTextNl } from "./doctor.ts";
import { backlogPath, homeDir, siteDir, stateDir } from "./paths.ts";
import { PHASES_NL, readState, siteState, updateSite, type SiteState } from "./state.ts";
import { versionNl } from "./version.ts";

const USAGE = `lus: loep over een backlog van sites, met een mens erbij waar dat nodig is

  lus add <url> [--slug <naam>] [--name <naam>] [--organisation <naam>] [--purpose verbeteren|verantwoorden]
                [--allow-sending] [--max-sends <n>] [--also-origin <url>]... [--never-open <host>]...
                [--login <sessiebestand>] [--vendor-tag <prefix>]... [--note <tekst>]
                                         Zet een site in de backlog. Wat je weglaat vraagt lus als er een
                                         terminal is, en anders vult het de standaard in
  lus list [--json]                      De backlog met de stand van elke site
  lus status [<site>] [--json]           Wat er met een site gebeurde, en wat er nu moet
  lus pause <site>                       Zet een site stil; de run blijft staan
  lus doctor [--routes]                  Controleer wat een run nodig heeft, en met --routes ook VLAM

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
  login: { type: "string" },
  "vendor-tag": { type: "string", multiple: true },
  note: { type: "string" },
  json: { type: "boolean" },
  routes: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

const statePath = (): string => `${stateDir()}/state.json`;

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
    return [site.slug, PHASES_NL[site_.phase], site_.step ?? "", agoNl(site_.updatedAt)];
  });
  const header = ["site", "stand", "stap", "bijgewerkt"];
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column]!.length)));
  const line = (row: string[]): string => row.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]!) : ` ${cell}`)).join("  ").trimEnd();
  return `${[line(header), ...rows.map(line)].join("\n")}\n`;
}

/** Everything about one site: the file, the run, the question, and what to do next. */
function statusTextNl(site: Site, site_: SiteState): string {
  const lines: string[] = [`${site.slug}  ${PHASES_NL[site_.phase]}`];
  const field = (label: string, value: string | null): void => {
    if (value !== null && value !== "") lines.push(`  ${label.padEnd(10)} ${value}`);
  };
  field("url", site.url);
  field("naam", site.name);
  field("eigenaar", site.organisation);
  field("doel", site.purpose === "verantwoorden" ? "verantwoorden hoe de site ervoor staat" : "de site beter maken");
  field("run", site_.run);
  field("stap", site_.step);
  field("sinds", site_.startedAt === null ? null : `${site_.startedAt.slice(0, 16).replace("T", " ")} (${agoNl(site_.startedAt)})`);
  field("versie", site_.version === null ? null : versionNl(site_.version));
  if (site.sending.allow) field("versturen", `ja, hooguit ${site.sending.max}`);
  if (site_.question) {
    lines.push("", `  Vraag: ${site_.question.textNl}`);
    if (site_.question.command) lines.push(`  Daarna: ${site_.question.command}`);
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
async function completeAdd(given: { name: string | undefined; organisation: string | undefined; purpose: string | undefined }): Promise<{ name: string | undefined; organisation: string | undefined; purpose: string | undefined }> {
  if (!process.stdin.isTTY || (given.name !== undefined && given.organisation !== undefined && given.purpose !== undefined)) return given;
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const name = given.name ?? ((await terminal.question(`Naam van de site (leeg: de host): `)).trim() || undefined);
    const organisation = given.organisation ?? (await terminal.question("Wie is de eigenaar van de site? ")).trim();
    const purpose = given.purpose ?? ((await terminal.question("Waarvoor is het onderzoek: verbeteren of verantwoorden? (leeg: verbeteren) ")).trim() || "verbeteren");
    return { name, organisation, purpose };
  } finally {
    terminal.close();
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: OPTIONS });
  const command = positionals[0];
  const target = positionals[1];
  if (values.help || command === undefined || command === "help") {
    process.stdout.write(USAGE);
    return;
  }

  switch (command) {
    case "add": {
      if (target === undefined) throw new Error("lus add heeft een url nodig: lus add https://www.voorbeeld.nl/");
      const filled = await completeAdd({ name: values.name, organisation: values.organisation, purpose: values.purpose });
      const site = addSite(backlogPath(), {
        url: target,
        slug: values.slug,
        name: filled.name,
        organisation: filled.organisation,
        purpose: filled.purpose,
        sending: { allow: values["allow-sending"] === true, max: values["max-sends"] === undefined ? 20 : Number(values["max-sends"]) },
        alsoOrigins: values["also-origin"] ?? [],
        neverOpen: values["never-open"] ?? [],
        login: values.login ?? null,
        vendorTags: values["vendor-tag"] ?? [],
        note: values.note ?? "",
      });
      process.stdout.write(`${site.slug} staat in de backlog.\nStart hem met: lus run\n`);
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
      process.stdout.write(statusTextNl(site, site_));
      return;
    }
    case "pause": {
      if (target === undefined) throw new Error("lus pause heeft een site nodig");
      const backlog = readBacklog(backlogPath());
      const site = findSite(backlog.sites, target);
      updateSite(statePath(), site.slug, { phase: "gepauzeerd" });
      process.stdout.write(`${site.slug} staat stil. Ga verder met: lus resume ${site.slug}\n`);
      return;
    }
    case "doctor": {
      const checks = doctor({ routes: values.routes === true });
      process.stdout.write(doctorTextNl(checks));
      process.exitCode = checks.every((check) => check.ok) ? 0 : 1;
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
