import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { complianceStatus, knownCommit, openCriteria, type CriterionResult, type Evaluation } from "../lib/evaluation.ts";
import { toolboxVersion } from "../lib/manifest.ts";
import { costOf, PRICES, PRICES_SOURCE, totalTokens, type Price } from "../lib/prices.ts";
import { HUMAN_AT_TERMINAL_NL, parseRecordedVia, processTerminal, type Terminal } from "../lib/recorded.ts";
import { STATUS_LABEL } from "../lib/report-markdown.ts";
import { agentPhaseTimings } from "../lib/timing.ts";
import { OPEN_POINT_KINDS, openPoint } from "../lib/verdict.ts";
import { readEvaluation, signatureIsCurrent } from "./sign.ts";
import { readUsage, type UsageFile } from "./variants.ts";
import { checkSeal, SIGNATURE_FILE, SIGNED_DIR } from "./verify.ts";

/*
 * A fixed message about a finished run, for a channel where people follow the work: everything
 * in it comes from the run (and from a usage file, when given), nothing from a language model,
 * so the same run gives the same message. With `--mattermost` the message and the report go to
 * one channel. Posting speaks for a person, under the name of whoever owns the token, so it
 * waits for that person's confirmation. The token is read from the secret store of the OS only
 * to fill one request header: it is never an argument of a process, never printed, never in an
 * error and never written to the run.
 */

const TOOLBOX_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const VERSION = "2.2" as const;

export const ATTACH = ["full", "short", "none"] as const;
export type Attach = (typeof ATTACH)[number];

export interface ShareOptions {
  run: string;
  /** A usage file of `loep usage` (schema loep/verbruik/1) for this run. */
  usage?: string | undefined;
  /** Share a run that is not finished, with a warning at the top. */
  force?: boolean | undefined;
  /** The newest version of loep the message names: the version that makes the message. A test sets it. */
  newest?: string | undefined;
  /** The commit of the tag `v<version>` in the repository of this toolbox, or null when there is none. A test sets it. */
  tagCommit?: ((version: string) => string | null) | undefined;
}

export interface ShareMessage {
  markdown: string;
  unfinished: boolean;
  /** The report that is attached in full and in short, as the run has them. */
  reports: { full: string; short: string | null };
}

const dateNl = (iso: string): string => new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" }).format(new Date(iso));
const dayNl = (iso: string, year: boolean): string => new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", ...(year ? { year: "numeric" } : {}), timeZone: "Europe/Amsterdam" }).format(new Date(iso));
/** The calendar day in Amsterdam as year, month and day. */
const calendarDay = (iso: string): [number, number, number] => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Amsterdam" }).format(new Date(iso)).split("-").map(Number) as [number, number, number];
/** "op 12 oktober", "op 12 en 13 oktober" (two days after each other) or "van 12 oktober tot 2 november 2026". */
function periodNl(first: string, last: string): string {
  const [y1, m1, d1] = calendarDay(first);
  const [y2, m2, d2] = calendarDay(last);
  if (y1 === y2 && m1 === m2 && d1 === d2) return `op ${dayNl(first, false)}`;
  if (y1 === y2 && m1 === m2 && d2 === d1 + 1) return `op ${d1} en ${dayNl(last, false)}`;
  return `van ${dayNl(first, y1 !== y2)} tot ${dayNl(last, true)}`;
}
const decimalNl = (value: number, digits: number): string => value.toFixed(digits).replace(".", ",");
const counted = (count: number, one: string, more: string): string => `${count} ${count === 1 ? one : more}`;

function gitTagCommit(version: string): string | null {
  try {
    return execFileSync("git", ["-C", TOOLBOX_ROOT, "rev-parse", "--verify", "--quiet", `v${version}^{commit}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * The version of loep a run was made with, and whether that was a released version. A version
 * with build metadata ("0.10.0+unreleased") is not. A toolbox without a commit ran outside a git
 * repository, as the plugin does, and the plugin is always a released version. With a commit it
 * is released when it is the commit of the tag `v<version>` and had no uncommitted changes.
 */
export function versionNl(toolbox: Evaluation["toolchain"]["toolbox"], tagCommit: (version: string) => string | null = gitTagCommit): { base: string; textNl: string } {
  const [base = toolbox.version, build] = toolbox.version.split("+");
  const commit = knownCommit(toolbox);
  const short = commit?.slice(0, 12);
  if (commit === null) return { base, textNl: build ? `loep ${base} met wijzigingen die toen nog niet waren uitgebracht (zonder commit)` : `loep ${base}, een uitgebrachte versie (zonder commit, zoals de plugin)` };
  if (toolbox.dirty) return { base, textNl: `loep ${base}, commit \`${short}\` met wijzigingen die niet waren vastgelegd: geen uitgebrachte versie` };
  if (build) return { base, textNl: `loep ${base} met wijzigingen die toen nog niet waren uitgebracht (commit \`${short}\`)` };
  const tagged = tagCommit(base);
  if (tagged === null) return { base, textNl: `loep ${base}, commit \`${short}\`; of dat de uitgebrachte versie is, is hier niet na te gaan (de tag v${base} ontbreekt)` };
  return { base, textNl: tagged === commit ? `loep ${base}, de uitgebrachte versie (commit \`${short}\`)` : `loep ${base} met wijzigingen die toen nog niet waren uitgebracht (commit \`${short}\`)` };
}

/** -1, 0 or 1: how version a compares to version b, on the numbers before any build metadata. */
function compareVersions(a: string, b: string): number {
  const parts = (version: string): number[] => version.split("+")[0]!.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let index = 0; index < Math.max(x.length, y.length); index++) if ((x[index] ?? 0) !== (y[index] ?? 0)) return (x[index] ?? 0) < (y[index] ?? 0) ? -1 : 1;
  return 0;
}

/** Why each open criterion of WCAG 2.2 is open, counted per kind of open point: a criterion with points of two kinds counts under both. */
function openKindsNl(criteria: CriterionResult[]): string | null {
  const open = criteria.filter((criterion) => criterion.outcome === "cantTell" || criterion.outcome === "untested");
  if (open.length === 0) return null;
  const counts = new Map<string, number>();
  const add = (kind: string): void => void counts.set(kind, (counts.get(kind) ?? 0) + 1);
  for (const criterion of open) {
    if (criterion.outcome === "untested") {
      add("niet beoordeeld");
      continue;
    }
    const kinds = new Set(criterion.missingNl.map((point) => openPoint(point).kind?.prefix ?? "zonder soort"));
    if (kinds.size === 0) kinds.add("zonder soort");
    for (const kind of kinds) add(kind);
  }
  const order: string[] = [...OPEN_POINT_KINDS.map((kind) => kind.prefix), "zonder soort", "niet beoordeeld"];
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]));
  return `${sorted.map(([kind, count]) => `${count} "${kind}"`).join(", ")} (criteria per soort; een criterium kan meer soorten hebben)`;
}

function statusNl(evaluation: Evaluation, signed: boolean): string {
  const as: Evaluation = signed ? evaluation : { ...evaluation, signature: { name: "", role: "", organisation: "", signedAt: evaluation.evaluatedAt, statementNl: "", evaluationSha256: "", sealSha256: "" } };
  const label = (version: "2.1" | "2.2"): string => STATUS_LABEL[complianceStatus(as, version).status].replace(/^status /, "");
  const [latest, legal] = [label("2.2"), label("2.1")];
  const value = latest === legal ? latest : `${latest} voor WCAG 2.2, ${legal} voor WCAG 2.1`;
  return signed ? value : `voorlopig ${value}; de status telt pas als iemand het rapport tekent`;
}

function usageLinesNl(run: string, usage: UsageFile): string[] {
  if (usage.run !== basename(resolve(run))) throw new Error(`het verbruiksbestand hoort bij run ${usage.run}, niet bij ${basename(resolve(run))}`);
  // A row is one agent and one model; without the name of the agent each row is an agent of its own.
  const agents = new Set(usage.agents.map((row, position) => row.agent ?? `#${position}`)).size;
  const totals = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  let cost = 0;
  const unpriced = new Set<string>();
  for (const row of usage.agents) {
    for (const kind of ["input", "cacheWrite", "cacheRead", "output"] as const) totals[kind] += row[kind];
    const model = row.model ?? usage.model;
    const price: Price | undefined = model ? (usage.prices?.[model] ?? PRICES[model]) : undefined;
    if (price) cost += costOf(row, price);
    else unpriced.add(model ?? "onbekend model");
  }
  const tokens = totalTokens(totals);
  const tokensNl = tokens >= 1_000_000 ? `ongeveer ${Math.round(tokens / 1_000_000)} miljoen tokens` : `${tokens} tokens`;
  const cachedNl = tokens > 0 ? `, ${Math.round((totals.cacheRead / tokens) * 100)}% uit de cache` : "";
  const phases = agentPhaseTimings(run);
  const hours = phases.length > 0 ? (Math.max(...phases.map((phase) => Date.parse(phase.endedAt))) - Math.min(...phases.map((phase) => Date.parse(phase.startedAt)))) / 3_600_000 : null;
  const durationNl = hours === null ? "" : `, ${decimalNl(hours, 1)} uur van de eerste rondgang tot het laatste oordeel`;
  const amountNl = cost >= 10 ? `${Math.floor(cost)} dollar` : `${decimalNl(Math.floor(cost * 100) / 100, 2)} dollar`;
  const withoutNl = unpriced.size > 0 ? `, zonder ${[...unpriced].join(", ")} (geen prijs)` : "";
  return [
    `- **Werkstroom:** ${counted(agents, "agent", "agents")}${durationNl}; ${tokensNl}${cachedNl}`,
    `- **Kosten tegen prijzen van de API:** minstens ${amountNl} voor de agents in het verbruiksbestand${withoutNl}, met de prijzen van ${dateNl(PRICES_SOURCE.date)}. De uitvoer is in de transcripts te laag geteld, dus het bedrag is een ondergrens.`,
  ];
}

interface VariantSource {
  from?: { toolbox?: Evaluation["toolchain"]["toolbox"] | null; variant?: string | null };
}

/** The variant.json of a copy made with `variant`, or null for a run that is no copy (or a file that cannot be read). */
function readVariant(run: string): VariantSource | null {
  try {
    return JSON.parse(readFileSync(join(run, "variant.json"), "utf8")) as VariantSource;
  } catch {
    return null;
  }
}

/**
 * Date and version of a copy made with `variant`, which keeps the sweep of another run while the agent
 * phases ran later, perhaps on another version. The sweep is dated by the `collect` step that
 * `evaluate` takes as the date of the evaluation; the version is the one variant.json records for the
 * source. The agent phases are dated by their session files, and run with the version of the evaluation.
 */
function variantLineNl(run: string, variant: VariantSource, evaluation: Evaluation, judging: { textNl: string }, tagCommit: ShareOptions["tagCommit"]): { lineNl: string; sweepNl: string | null } {
  const source = variant.from?.toolbox;
  const sweep = source?.version ? versionNl(source, tagCommit) : null;
  const copyOfCopy = variant.from?.variant ? ` (de bron was zelf een kopie, "${variant.from.variant}": de veegronde kan met een oudere versie zijn gemaakt)` : "";
  const sweepTextNl = sweep ? `${sweep.textNl}${copyOfCopy}` : "een onbekende versie van loep (variant.json heeft die niet)";
  const phases = agentPhaseTimings(run);
  const period = phases.length > 0 ? ` ${periodNl(phases.map((phase) => phase.startedAt).sort()[0]!, phases.map((phase) => phase.endedAt).sort().at(-1)!)}` : "";
  const sweepVersionNl = !sweep || !source ? null : `${sweep.base}${source.version!.includes("+") || source.dirty ? ", met wijzigingen die toen nog niet waren uitgebracht" : ""}`;
  return {
    lineNl: `veegronde op ${dateNl(evaluation.evaluatedAt)}: ${sweepTextNl}; rondgangen, oordelen en de afmaakronde${period}: ${judging.textNl}`,
    sweepNl: sweepVersionNl,
  };
}

/**
 * The message about a run, in Markdown. Refuses a run without a report, and a run that is not
 * finished unless `force` is given; then the message starts with a warning. A run is not finished
 * as long as a criterion is open by the evaluation itself, as `evaluate` and the report count it.
 */
export async function shareMessage(options: ShareOptions): Promise<ShareMessage> {
  const run = options.run;
  if (!existsSync(join(run, "evaluation.json"))) throw new Error(`${run} heeft geen evaluation.json: draai eerst evaluate, render en seal`);
  const full = join(run, "report", "rapport.pdf");
  if (!existsSync(full)) throw new Error(`${run} heeft geen rapport (report/rapport.pdf): draai eerst render en seal. Een bericht zonder rapport voegt weinig toe`);
  const evaluation = await readEvaluation(join(run, "evaluation.json"));
  const open = openCriteria(evaluation.criteria);
  const unfinished = open.evaluation.length > 0;
  const latest = evaluation.criteria.filter((criterion) => criterion.versions.includes(VERSION));
  const ownOpen = openCriteria(latest).evaluation.length;
  if (unfinished && !options.force) throw new Error(`het onderzoek is niet af: bij ${counted(open.evaluation.length, "criterium", "criteria")} heeft het onderzoek zelf niet vastgesteld of eraan is voldaan (${open.evaluation.join(", ")}). Maak het eerst af (tasks en pending, de afmaakronde), of deel het toch met --force: dan zegt het bericht bovenaan dat het niet af is`);
  const usage = options.usage ? readUsage(options.usage) : null;

  const seal = await checkSeal(run);
  const sealChanges = seal ? seal.problems.filter((problem) => !problem.startsWith(SIGNATURE_FILE)) : [];
  const signature = evaluation.signature;
  const signed = signature !== null && signatureIsCurrent(evaluation) && seal !== null && seal.problems.length === 0;
  const sealNl = seal === null ? "niet verzegeld" : sealChanges.length > 0 ? `verzegeld, maar daarna veranderd (${counted(sealChanges.length, "afwijking", "afwijkingen")}; zie verify)` : "verzegeld";
  const signedNl = signed ? `getekend op ${dateNl(signature!.signedAt)} door ${signature!.role}, ${signature!.organisation}` : "niet getekend";

  const tally = evaluation.summary[VERSION];
  const openCount = tally.cantTell + tally.untested;
  const defects = evaluation.defects?.length;
  const defectsNl = defects === undefined ? counted(evaluation.criteria.reduce((sum, criterion) => sum + criterion.findings.length, 0), "bevinding", "bevindingen") : counted(defects, "gebrek", "gebreken");
  const version = versionNl(evaluation.toolchain.toolbox, options.tagCommit);
  const newest = options.newest ?? toolboxVersion();
  const order = compareVersions(version.base, newest);
  const variant = readVariant(run);
  const dated = variant ? variantLineNl(run, variant, evaluation, version, options.tagCommit) : null;
  const sweepSentenceNl = dated ? (dated.sweepNl ? ` De veegronde is gemaakt met loep ${dated.sweepNl}.` : " De versie van loep van de veegronde is niet bekend.") : "";
  const madeNl = dated ? "beoordeeld" : "gemaakt";
  const versionsNl = order === 0 ? `Dit onderzoek is ${madeNl} met loep ${version.base}, de nieuwste versie.${sweepSentenceNl} Een oordeel kan fout zijn.` : order < 0 ? `Dit onderzoek is ${madeNl} met loep ${version.base}; loep is inmiddels ${newest}. Wat er sindsdien is veranderd, staat in de CHANGELOG van loep.${sweepSentenceNl} Een oordeel kan dus fout zijn.` : `Dit onderzoek is ${madeNl} met loep ${version.base}; dit bericht met loep ${newest}, een oudere versie.${sweepSentenceNl} Een oordeel kan fout zijn.`;
  const standingNl = signed ? `Het rapport is getekend door ${signature!.role}, ${signature!.organisation}: die staat in voor de inhoud.` : `Het rapport is een concept: ${sealNl}, niet getekend. Niemand staat er nog voor in. Gebruik het als werklijst, niet als onderbouwing voor een toegankelijkheidsverklaring.`;

  const lines: string[] = [`#### ${evaluation.site.name}${unfinished ? " (niet af)" : ""}`, ""];
  if (unfinished) {
    const ownNl = ownOpen > 0 ? `bij ${ownOpen} daarvan heeft dit onderzoek zelf niet vastgesteld of eraan is voldaan` : `bij ${open.evaluation.join(", ")} heeft dit onderzoek zelf niet vastgesteld of eraan is voldaan`;
    lines.push(`> **Let op, dit onderzoek is niet af.** ${openCount} van de ${tally.total} criteria staan open, en ${ownNl}. Neem de afkeuringen en gebreken hieronder als werklijst, en zeg op grond van dit rapport niets over de status van de site.`, "");
  }
  lines.push(`> **Let op:** loep is in ontwikkeling. ${versionsNl} ${standingNl}`, "");
  const why = openKindsNl(latest);
  lines.push(
    `- **Site:** ${evaluation.site.baseUrl}`,
    `- **Datum en versie:** ${dated ? dated.lineNl : `${dateNl(evaluation.evaluatedAt)}, ${version.textNl}`}`,
    `- **Uitkomst (${tally.total} criteria, WCAG ${VERSION}):** ${tally.failed} ${tally.failed === 1 ? "voldoet" : "voldoen"} niet, ${tally.passed} ${tally.passed === 1 ? "voldoet" : "voldoen"}, ${tally.inapplicable} niet van toepassing, ${openCount} open; ${defectsNl}`,
    `- **Status:** ${unfinished ? "geen status: het onderzoek is niet af" : statusNl(evaluation, signed)}`,
    ...(why ? [`- **Waarom open:** ${why}`] : []),
    `- **Zegel en handtekening:** ${sealNl}, ${signedNl}`,
    ...(usage ? usageLinesNl(run, usage) : []),
  );
  const signedDir = signed && existsSync(join(run, SIGNED_DIR, "rapport.pdf")) ? join(run, SIGNED_DIR) : join(run, "report");
  const short = join(signedDir, "rapport-kort.pdf");
  return { markdown: `${lines.join("\n")}\n`, unfinished, reports: { full: join(signedDir, "rapport.pdf"), short: existsSync(short) ? short : null } };
}

/* ------------------------------------------------------------------------------------------ */

export interface MattermostTarget {
  /** Where Mattermost runs, with the path it may run under: https://example.org/chat. */
  server: string;
  team: string;
  channel: string;
}

const NAME = /^[a-z0-9][a-z0-9_-]*$/;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * `<server>/<team>/<channel>`: the last two parts of the path are the team and the channel, as
 * they stand in the address of the channel in Mattermost; everything before them is the server,
 * also when Mattermost runs under a path (https://example.org/chat/team/channel). Only https,
 * except on this machine.
 */
export function parseMattermost(text: string): MattermostTarget {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    throw new Error(`--mattermost is <server>/<team>/<kanaal>, zoals https://chat.example.nl/team/kanaal, niet "${text}"`);
  }
  if (url.username || url.password || url.search || url.hash) throw new Error("--mattermost is alleen <server>/<team>/<kanaal>: zonder gebruiker, wachtwoord, vraag of anker in het adres");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname))) throw new Error("--mattermost gaat alleen over https: de token mag niet onversleuteld over het netwerk");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error(`--mattermost noemt na de server het team en het kanaal: ${url.origin}/<team>/<kanaal>`);
  const [team, channel] = parts.slice(-2).map((part) => decodeURIComponent(part)) as [string, string];
  if (!NAME.test(team) || !NAME.test(channel)) throw new Error(`team "${team}" en kanaal "${channel}" zijn de namen uit het adres van het kanaal in Mattermost (kleine letters, cijfers, - en _), niet de namen die je in de lijst ziet`);
  return { server: `${url.origin}${parts.length > 2 ? `/${parts.slice(0, -2).join("/")}` : ""}`, team, channel };
}

/** Reads a secret from the secret store of the OS by its service name; null when the store has no such item. */
export type SecretReader = (service: string) => Promise<string | null>;

/** The command that reads the secret of `service` on this platform. Only the service name is an argument: the secret comes back on standard output. */
export function secretStoreCommand(service: string, os: NodeJS.Platform = process.platform): { command: string; args: string[] } {
  if (os === "darwin") return { command: "security", args: ["find-generic-password", "-s", service, "-w"] };
  if (os === "linux") return { command: "secret-tool", args: ["lookup", "service", service] };
  throw new Error(`een token uit de sleutelhanger lezen kan op macOS (security) en Linux (secret-tool), niet op ${os}`);
}

/** How to put the token in the secret store, for the message that says it is not there. */
export function addSecretNl(service: string, os: NodeJS.Platform = process.platform): string {
  if (os === "linux") return `secret-tool store --label "loep Mattermost" service ${service} (het vraagt de token)`;
  return `security add-generic-password -s ${service} -a "$USER" -w (de laatste -w vraagt de token, zodat hij niet in je shellgeschiedenis komt)`;
}

/** The real reader: spawns the command of the platform and keeps only its standard output, which is never shown. */
export const readSecretStore: SecretReader = (service) =>
  new Promise((done, fail) => {
    const { command, args } = secretStoreCommand(service);
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", () => fail(new Error(`${command} is niet te starten: zonder kan loep de token niet uit de sleutelhanger lezen`)));
    child.on("close", (code) => {
      const secret = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
      // security says 44 for an item that is not there; secret-tool says 1 and prints nothing.
      done(code === 0 && secret !== "" ? secret : null);
    });
  });

async function tokenFrom(service: string, read: SecretReader): Promise<string> {
  const token = await read(service);
  if (token === null) throw new Error(`er staat geen token voor Mattermost in de sleutelhanger onder dienst "${service}". Zet hem erin met: ${addSecretNl(service)}. Er is niets geplaatst`);
  if (!/^[\x21-\x7e]+$/.test(token)) throw new Error(`de token onder dienst "${service}" bevat tekens die niet in een header passen (een spatie, een regeleinde of een teken buiten ASCII). Er is niets geplaatst`);
  return token;
}

export interface Attachment {
  path: string;
  /** The name the file gets in the channel. */
  name: string;
}

/**
 * Post the message with the attachment in the channel: look up the channel, upload the file, and
 * post with the id of the file. Any text that comes back from the server is cleaned of the token
 * before it is shown. Redirects are refused, so the header goes nowhere else.
 */
export async function postToMattermost(target: MattermostTarget, token: string, message: string, attachment: Attachment | null, fetchImpl: typeof fetch = fetch): Promise<{ postId: string; permalink: string }> {
  const clean = (text: string): string => text.split(token).join("<token>");
  const call = async <T>(what: string, path: string, init: RequestInit): Promise<T> => {
    let response: Response;
    try {
      response = await fetchImpl(`${target.server}${path}`, { ...init, redirect: "error", headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` } });
    } catch (error) {
      throw new Error(clean(`${what}: ${target.server} is niet bereikbaar of stuurt door (${(error as Error).cause instanceof Error ? ((error as Error).cause as Error).message : (error as Error).message}). Er is niets geplaatst`));
    }
    const text = await response.text();
    if (!response.ok) {
      let reason = "";
      try {
        reason = String((JSON.parse(text) as { message?: unknown }).message ?? "");
      } catch {
        // No JSON: the status says enough.
      }
      const hint = response.status === 401 ? "; de token wordt niet aangenomen" : response.status === 403 ? "; de token mag dit niet" : response.status === 404 ? "; bestaat het, en mag de eigenaar van de token erin?" : "";
      throw new Error(clean(`${what}: Mattermost antwoordde ${response.status}${reason ? ` (${reason})` : ""}${hint}`));
    }
    return JSON.parse(text) as T;
  };
  const channel = await call<{ id: string }>(`kanaal ${target.team}/${target.channel}`, `/api/v4/teams/name/${encodeURIComponent(target.team)}/channels/name/${encodeURIComponent(target.channel)}`, { method: "GET" });
  const fileIds: string[] = [];
  if (attachment) {
    const form = new FormData();
    form.append("channel_id", channel.id);
    form.append("files", new Blob([readFileSync(attachment.path)], { type: "application/pdf" }), attachment.name);
    const uploaded = await call<{ file_infos: { id: string }[] }>(`bijlage ${attachment.name}, nog geen bericht geplaatst`, "/api/v4/files", { method: "POST", body: form });
    fileIds.push(...uploaded.file_infos.map((info) => info.id));
  }
  const post = await call<{ id: string }>("bericht", "/api/v4/posts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ channel_id: channel.id, message, file_ids: fileIds }) });
  return { postId: post.id, permalink: `${target.server}/${target.team}/pl/${post.id}` };
}

/** Said when posting has no confirmation, in whatever way it is missing. */
const NO_CONFIRMATION_NL = 'share --send plaatst een bericht onder de naam van wie de token heeft, en vraagt daarom een bevestiging: in een interactieve terminal, waar je de naam van het kanaal intypt, of in het gesprek met --recorded-via gesprek --confirmation "<letterlijke bevestiging>"';

/**
 * Whether the person agreed to post. In the conversation it needs what the person said, word for
 * word; otherwise the person types the name of the channel at an interactive terminal, and
 * without one it is refused. There is no way around it with piped input.
 */
export async function confirmPost(flags: { recordedVia?: string | undefined; confirmation?: string | undefined }, shownNl: string, channel: string, terminal: Terminal): Promise<string> {
  const via = parseRecordedVia(flags.recordedVia);
  const confirmation = (flags.confirmation ?? "").replace(/\s+/g, " ").trim();
  if (via === "gesprek") {
    if (!confirmation) throw new Error(`share --send met --recorded-via gesprek vraagt wat de gebruiker letterlijk zei (--confirmation "<letterlijke tekst>"); zonder wordt niets geplaatst`);
    return `bevestigd in het gesprek: "${confirmation}"`;
  }
  if (flags.confirmation !== undefined) throw new Error("--confirmation hoort bij --recorded-via gesprek");
  if (!terminal.interactive) throw new Error(`${NO_CONFIRMATION_NL}. Er is hier geen interactieve terminal. ${HUMAN_AT_TERMINAL_NL}. Er is niets geplaatst`);
  const typed = await terminal.ask(`${shownNl}\nTyp ter bevestiging de naam van het kanaal (${channel}): `);
  if (typed.trim() !== channel) throw new Error("niet bevestigd: dat is niet de naam van het kanaal. Er is niets geplaatst");
  return "bevestigd in een terminal";
}


/* ------------------------------------------------------------------------------------------ */

/** Where a person keeps the destination of `share`, outside every repository and run: `$XDG_CONFIG_HOME/loep/share.json`, by default `~/.config/loep/share.json`. */
export function settingsPath(env: NodeJS.ProcessEnv = process.env): string {
  const own = env.XDG_CONFIG_HOME;
  return join(own && isAbsolute(own) ? own : join(homedir(), ".config"), "loep", "share.json");
}

/** A path as a person reads it: under the home folder with ~. */
const shownPath = (path: string): string => (path.startsWith(`${homedir()}${sep}`) ? `~${path.slice(homedir().length)}` : path);

/** What the settings file may hold. Never the token: that stays in the secret store. */
export interface ShareSettings {
  mattermost?: string;
  keychainService?: string;
}
const SETTING_KEYS = ["mattermost", "keychainService"] as const;
const SERVICE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const checkService = (service: string, from: string): string => {
  if (!SERVICE.test(service)) throw new Error(`${from} is een naam van letters, cijfers, punten, - en _, niet "${service}"`);
  return service;
};

/** The settings in `path`, checked; nothing when the file is not there. */
export function readSettings(path: string): ShareSettings {
  if (!existsSync(path)) return {};
  let content: unknown;
  try {
    content = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${shownPath(path)} is niet te lezen als JSON; zet de instellingen opnieuw met loep share --set-mattermost <server>/<team>/<kanaal>`);
  }
  if (typeof content !== "object" || content === null || Array.isArray(content)) throw new Error(`${shownPath(path)} is geen object met instellingen`);
  const unknown = Object.keys(content).filter((key) => !(SETTING_KEYS as readonly string[]).includes(key));
  if (unknown.length > 0) throw new Error(`${shownPath(path)} heeft onbekende instellingen (${unknown.join(", ")}); alleen mattermost en keychainService. Een token hoort daar nooit in: die staat in de sleutelhanger`);
  const settings = content as Record<string, unknown>;
  for (const key of SETTING_KEYS) if (settings[key] !== undefined && typeof settings[key] !== "string") throw new Error(`${shownPath(path)}: ${key} is een tekst`);
  return settings as ShareSettings;
}

/**
 * Write the destination of `share` for this user, checked with the same rules as on the command
 * line, so nobody edits the file by hand. An empty value takes the setting away.
 */
export function writeSettings(path: string, change: ShareSettings): string {
  const settings = readSettings(path);
  if (change.mattermost !== undefined) {
    if (change.mattermost.trim() === "") delete settings.mattermost;
    else {
      const target = parseMattermost(change.mattermost);
      settings.mattermost = `${target.server}/${target.team}/${target.channel}`;
    }
  }
  if (change.keychainService !== undefined) {
    if (change.keychainService.trim() === "") delete settings.keychainService;
    else settings.keychainService = checkService(change.keychainService.trim(), "--set-keychain-service");
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  const shown = SETTING_KEYS.filter((key) => settings[key] !== undefined).map((key) => `${key} ${settings[key]}`);
  return `opgeslagen in ${shownPath(path)}: ${shown.length > 0 ? shown.join(", ") : "geen instellingen"}. De token staat daar niet in; die blijft in de sleutelhanger.\n`;
}

export interface ShareCommand extends ShareOptions {
  mattermost?: string | undefined;
  send?: boolean | undefined;
  attach?: string | undefined;
  keychainService?: string | undefined;
  recordedVia?: string | undefined;
  confirmation?: string | undefined;
  /** The settings file; a test gives its own. */
  settingsFile?: string | undefined;
  /** Where a person confirms; a test plays the person here. */
  terminal?: Terminal | undefined;
  /** Where the message goes, and nothing else: standard output by default. */
  out?: ((text: string) => void) | undefined;
  /** Where everything else goes (channel, attachment, what was posted): standard error by default. */
  say?: ((text: string) => void) | undefined;
  /** Where the token comes from; a test gives its own, so no test reads the real secret store. */
  readSecret?: SecretReader | undefined;
  fetch?: typeof fetch | undefined;
}

export const DEFAULT_KEYCHAIN_SERVICE = "loep-mattermost";

/**
 * What `loep share` does: the message goes to `out` and nothing else does, so it can be redirected
 * to a file as it is. With a destination (`--mattermost`, or the setting) the channel and the
 * attachment go to `say`. With `--send` it posts after the confirmation of `confirmPost`.
 * Without it, at an interactive terminal, it asks whether to post, and typing the name of the
 * channel is the confirmation; without an interactive terminal it only shows and asks nothing.
 */
export async function share(options: ShareCommand): Promise<void> {
  const out = options.out ?? ((text: string) => void process.stdout.write(text));
  const say = options.say ?? ((text: string) => void process.stderr.write(text));
  const settingsFile = options.settingsFile ?? settingsPath();
  const settings = readSettings(settingsFile);
  const fromFile = `uit ${shownPath(settingsFile)}`;
  const destination = options.mattermost !== undefined ? { text: options.mattermost, fromNl: "uit --mattermost" } : settings.mattermost ? { text: settings.mattermost, fromNl: fromFile } : null;
  const viaMattermost = ["send", "attach", "keychainService"] as const;
  if (!destination && viaMattermost.some((key) => options[key] !== undefined && options[key] !== false)) throw new Error("--send, --attach en --keychain-service horen bij een bestemming: --mattermost <server>/<team>/<kanaal>, of een instelling die je zet met loep share --set-mattermost");
  if (!options.send && (options.recordedVia !== undefined || options.confirmation !== undefined)) throw new Error("--recorded-via en --confirmation horen bij --send");
  const attach = (options.attach ?? "full") as Attach;
  if (!ATTACH.includes(attach)) throw new Error(`--attach is full, short of none, niet "${options.attach}"`);
  // The target is checked before anything is read, so a mistyped address costs nothing.
  let target: MattermostTarget | null = null;
  try {
    target = destination ? parseMattermost(destination.text) : null;
  } catch (error) {
    throw new Error(destination!.fromNl === fromFile ? `de bestemming in ${shownPath(settingsFile)}: ${(error as Error).message}; zet haar opnieuw met loep share --set-mattermost` : (error as Error).message);
  }
  const service = options.keychainService !== undefined ? { name: checkService(options.keychainService, "--keychain-service"), fromNl: "uit --keychain-service" } : settings.keychainService ? { name: checkService(settings.keychainService, `keychainService in ${shownPath(settingsFile)}`), fromNl: fromFile } : { name: DEFAULT_KEYCHAIN_SERVICE, fromNl: "de standaard" };
  const message = await shareMessage(options);
  if (!target) return out(message.markdown);

  const runName = basename(resolve(options.run));
  const source = attach === "full" ? message.reports.full : attach === "short" ? message.reports.short : null;
  if (attach === "short" && source === null) throw new Error(`${options.run} heeft geen korte versie van het rapport (rapport-kort.pdf): kies --attach full of none, of draai render opnieuw`);
  const attachment = source ? { path: source, name: `${attach === "short" ? "rapport-kort" : "rapport"}-${runName}.pdf` } : null;
  const shownNl = [
    `Kanaal: ${target.team}/${target.channel} op ${target.server} (${destination!.fromNl})`,
    `Bijlage: ${attachment ? `${attachment.path}, als ${attachment.name}` : "geen"}`,
    `Token: uit de sleutelhanger, dienst ${service.name} (${service.fromNl}); pas gelezen na een bevestiging`,
    "Het bericht verschijnt onder de naam van wie de token heeft. Wie het rapport deelt, deelt ook de schermafbeeldingen erin.",
  ].join("\n");
  const terminal = options.terminal ?? processTerminal();

  const asking = !options.send && terminal.interactive;
  say(`${shownNl}\n${options.send || asking ? "" : "Er is niets geplaatst: plaatsen gaat met --send, of in een interactieve terminal. "}Het bericht:\n\n`);
  out(message.markdown);
  if (!options.send && !asking) return;

  let confirmed: string;
  if (options.send) confirmed = await confirmPost(options, "", target.channel, terminal);
  else {
    const typed = (await terminal.ask(`\nPlaatsen in ${target.team}/${target.channel}? Typ de naam van het kanaal om te plaatsen, of Enter om niets te doen: `)).trim();
    if (typed === "") return say("Er is niets geplaatst.\n");
    if (typed !== target.channel) throw new Error("niet bevestigd: dat is niet de naam van het kanaal. Er is niets geplaatst");
    confirmed = "bevestigd in een terminal";
  }
  const token = await tokenFrom(service.name, options.readSecret ?? readSecretStore);
  const posted = await postToMattermost(target, token, message.markdown, attachment, options.fetch);
  say(`geplaatst in ${target.team}/${target.channel}${attachment ? `, met ${attachment.name}` : ""}; ${confirmed}\n${posted.permalink}\n`);
}

export const SHARE_USAGE = `loep share --run <run> [--usage <file>] [--force]
loep share --run <run> [--mattermost <server>/<team>/<channel>] [--attach full|short|none] [--keychain-service <name>]
           [--send [--recorded-via gesprek --confirmation <text>]]
loep share --set-mattermost <server>/<team>/<channel> [--set-keychain-service <name>]

A fixed message about a finished run, in Markdown, from the run alone: date and version of loep, the
outcome over the criteria of WCAG 2.2, defects, status, why criteria are open, seal and signature, and a
disclaimer. No language model. Writes nothing in the run. Standard output carries the message and nothing
else; the channel, the attachment, the question and what was posted go to standard error.

  --usage <file>        The usage file of loep usage for this run: agents, duration, tokens and cost at
                        API prices, a lower bound because the output is under-counted in the transcripts
  --force               Also for a run that is not finished; the message then starts with a warning
  --mattermost <url>    The channel to post in: the last two parts of the path are the team and the
                        channel as in its address; what comes before is the server, also with a path
                        (https://example.org/chat/team/channel). Overrides the setting. With a
                        destination and without --send it shows the message, the channel and the
                        attachment; at an interactive terminal it then asks whether to post, and typing
                        the name of the channel posts. Without an interactive terminal it asks nothing
  --attach <which>      full (report/rapport.pdf), short (rapport-kort.pdf) or none; default full.
                        A signed run attaches the signed report
  --keychain-service    The service under which the token is in the secret store (default
                        ${DEFAULT_KEYCHAIN_SERVICE}); macOS: security, Linux: secret-tool. Overrides the setting
  --send                Post it. Confirmed at an interactive terminal by typing the channel, or with
                        --recorded-via gesprek --confirmation "<what the person said, word for word>"
  --set-mattermost <url>, --set-keychain-service <name>
                        Keep the destination and the service for this user in
                        $XDG_CONFIG_HOME/loep/share.json (default ~/.config/loep/share.json), checked
                        as on the command line; an empty value removes it. Never the token
`;

export async function cli(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      run: { type: "string" },
      usage: { type: "string" },
      force: { type: "boolean" },
      mattermost: { type: "string" },
      send: { type: "boolean" },
      attach: { type: "string" },
      "keychain-service": { type: "string" },
      "recorded-via": { type: "string" },
      confirmation: { type: "string" },
      "set-mattermost": { type: "string" },
      "set-keychain-service": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    process.stdout.write(SHARE_USAGE);
    return;
  }
  const setting = { mattermost: values["set-mattermost"], keychainService: values["set-keychain-service"] };
  if (setting.mattermost !== undefined || setting.keychainService !== undefined) {
    const others = Object.entries(values).filter(([key, value]) => !key.startsWith("set-") && value !== undefined);
    if (others.length > 0) throw new Error(`--set-mattermost en --set-keychain-service zetten alleen de instelling; zonder ${others.map(([key]) => `--${key}`).join(", ")}`);
    process.stderr.write(writeSettings(settingsPath(), setting));
    return;
  }
  if (!values.run) throw new Error(`share needs --run <run>\n\n${SHARE_USAGE}`);
  await share({ run: values.run, usage: values.usage, force: values.force, mattermost: values.mattermost, send: values.send, attach: values.attach, keychainService: values["keychain-service"], recordedVia: values["recorded-via"], confirmation: values.confirmation });
}
