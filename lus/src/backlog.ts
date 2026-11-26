import { existsSync, readFileSync } from "node:fs";
import { parse, stringify } from "yaml";
import { writeAtomic } from "./atomic.ts";

/*
 * The backlog: one hand-edited YAML file with the sites that have to be looked at. It says what the
 * person wants, not how far a run got; that is state.json. `add` appends a block and leaves the rest of
 * the file alone, so comments and order survive an edit by hand. Reading is forgiving: a missing field
 * gets a default and a warning, because a hand-edited file with one wrong key should not stop a run.
 */

const PURPOSES = ["verbeteren", "verantwoorden"] as const;
export type Purpose = (typeof PURPOSES)[number];
export const PURPOSES_NL: Record<Purpose, string> = {
  verbeteren: "de site beter maken",
  verantwoorden: "verantwoorden hoe de site ervoor staat",
};

/**
 * How much an agent may send to the site. A site that is not a test environment allows nothing. Without
 * a max loep sets its own budget: 5 for a declared test environment, 50 on this machine. A message that
 * is sent reaches a real person, and a service that gets too many blocks the machine.
 */
export interface Sending {
  allow: boolean;
  max: number | null;
}

/** The login of a test account: a person logs in, so the file needs the page and the role, never a password. */
export interface Login {
  page: string;
  role: string;
}

export interface Site {
  url: string;
  /** The folder under the home of lus: the host without www, or what the person chose. */
  slug: string;
  name: string;
  organisation: string;
  purpose: Purpose;
  sending: Sending;
  /** Origins that belong to the site: a subdomain, the documentation, the portal of the vendor. */
  alsoOrigins: string[];
  /** Hosts no agent may open, for example a set that is held back for a final test. */
  neverOpen: string[];
  /** Where the test account logs in and in which role; the password never comes near this file. */
  login: Login | null;
  /** Agents at the same time in the phases with agents; the session process of a run allows one more. */
  atOnce: number;
  /** Seconds between two navigations to the site, or null for whatever loep does by itself. */
  navigationDelay: number | null;
  /** A mailbox the site sends personal links to, as `imap://host:993`; a person runs the command that uses it. */
  mailbox: string | null;
  /** The prefixes of the scripts and the CSS of the vendors of the site, for the rule engines. */
  vendorTags: string[];
  note: string;
}

export interface Problem {
  where: string;
  textNl: string;
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const words = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter((entry) => entry !== "") : [];

/** The folder name of a site: its host without www, so the runs of a site sit together. */
export function slugFor(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    throw new Error(`geen geldige url: ${url}`);
  }
  if (host === "") throw new Error(`geen host in de url: ${url}`);
  return host.replace(/^www\./, "");
}

/** Folders under the home of lus that are no site: a site with that slug would put its runs among them. */
const RESERVED_SLUGS = ["rapporten", "meting", "secrets"];

/** What is wrong with a slug as the name of a folder, or null. */
export function slugProblemNl(slug: string): string | null {
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(slug) || slug.includes("..")) return `de slug "${slug}" mag alleen kleine letters, cijfers, punten en streepjes hebben`;
  if (RESERVED_SLUGS.includes(slug)) return `de slug "${slug}" is de naam van een map van lus zelf; kies een andere met --slug`;
  return null;
}

const parseUrl = (url: string): URL => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`geen geldige url: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`een site begint met http of https, niet met ${parsed.protocol}: ${url}`);
  return parsed;
};

/** One entry of the file as a site, with what the file left out filled in. */
function toSite(raw: unknown, index: number, problems: Problem[]): Site {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`regel ${index + 1} van de backlog is geen site`);
  const entry = raw as Record<string, unknown>;
  const url = text(entry["url"]);
  if (url === "") throw new Error(`regel ${index + 1} van de backlog heeft geen url`);
  const parsed = parseUrl(url);
  const slug = text(entry["slug"]) || slugFor(url);
  // The slug is a folder name: one with a slash or a reserved name would put the run somewhere else.
  const refused = slugProblemNl(slug);
  if (refused !== null) throw new Error(`regel ${index + 1} van de backlog: ${refused}`);
  const where = `site ${slug}`;
  const purposeText = text(entry["purpose"]) || "verbeteren";
  if (!(PURPOSES as readonly string[]).includes(purposeText)) {
    problems.push({ where, textNl: `purpose is "${purposeText}", dat ken ik niet; ik neem "verbeteren". Kies uit ${PURPOSES.join(", ")}` });
  }
  const purpose: Purpose = (PURPOSES as readonly string[]).includes(purposeText) ? (purposeText as Purpose) : "verbeteren";
  const rawSending = entry["sending"];
  const sending = rawSending !== null && typeof rawSending === "object" && !Array.isArray(rawSending) ? (rawSending as Record<string, unknown>) : {};
  const max = sending["max"] === undefined || sending["max"] === null ? null : Number(sending["max"]);
  if (max !== null && (!Number.isInteger(max) || max < 0)) problems.push({ where, textNl: `sending.max is "${String(sending["max"])}"; dat moet een heel getal van 0 of meer zijn, of null voor het budget van loep zelf` });
  const organisation = text(entry["organisation"]);
  if (organisation === "") problems.push({ where, textNl: "organisation ontbreekt; het rapport en de verklaring noemen de eigenaar van de site" });
  for (const origin of words(entry["also-origins"])) {
    if (!/^https?:\/\//i.test(origin)) problems.push({ where, textNl: `also-origins: "${origin}" begint niet met http of https` });
  }
  for (const host of words(entry["never-open"])) {
    if (host.includes("/")) problems.push({ where, textNl: `never-open: "${host}" is een adres; zet er de host neer, zonder pad` });
  }
  const rawLogin = entry["login"];
  let login: Login | null = null;
  if (rawLogin !== null && typeof rawLogin === "object" && !Array.isArray(rawLogin)) {
    const page = text((rawLogin as Record<string, unknown>)["page"]);
    const role = text((rawLogin as Record<string, unknown>)["role"]);
    if (page === "") problems.push({ where, textNl: "login.page ontbreekt: zonder de inlogpagina kan niemand inloggen" });
    else login = { page, role };
    if (role === "") problems.push({ where, textNl: "login.role ontbreekt: de rol komt in het manifest en in het rapport, dus geen naam" });
  } else if (text(rawLogin) !== "") {
    problems.push({ where, textNl: "login staat er als pad; dat is nu een blok met page en role, want het harnas drukt het inlogcommando voor een mens af" });
  }
  const rawDelay = entry["navigation-delay"];
  const navigationDelay = rawDelay === undefined || rawDelay === null ? null : Number(rawDelay);
  if (navigationDelay !== null && (!Number.isInteger(navigationDelay) || navigationDelay < 0)) problems.push({ where, textNl: `navigation-delay is "${String(rawDelay)}"; dat moet een heel getal van 0 of meer zijn, in seconden` });
  const atOnce = Number(entry["at-once"] ?? 2);
  if (!Number.isInteger(atOnce) || atOnce < 1) problems.push({ where, textNl: `at-once is "${String(entry["at-once"])}"; dat moet een heel getal van 1 of meer zijn, standaard 2` });
  return {
    url,
    slug,
    name: text(entry["name"]) || slug,
    organisation,
    purpose,
    sending: { allow: sending["allow"] === true, max: max !== null && Number.isInteger(max) && max >= 0 ? max : null },
    alsoOrigins: words(entry["also-origins"]),
    neverOpen: words(entry["never-open"]),
    login,
    atOnce: Number.isInteger(atOnce) && atOnce >= 1 ? atOnce : 2,
    navigationDelay: navigationDelay !== null && Number.isInteger(navigationDelay) && navigationDelay >= 0 ? navigationDelay : null,
    mailbox: text(entry["mailbox"]) || null,
    vendorTags: words(entry["vendor-tags"]),
    note: text(entry["note"]),
  };
}

export interface Backlog {
  sites: Site[];
  problems: Problem[];
}

/** The backlog as it is, with a warning per field that needs a person. A file that is not a list is an error. */
export function readBacklog(path: string): Backlog {
  if (!existsSync(path)) return { sites: [], problems: [] };
  let parsed: unknown;
  try {
    parsed = parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`de backlog op ${path} is geen geldige yaml: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed === null || parsed === undefined) return { sites: [], problems: [] };
  if (!Array.isArray(parsed)) throw new Error(`de backlog op ${path} is geen lijst van sites; elke site begint met "- url:"`);
  const problems: Problem[] = [];
  const sites = parsed.map((entry, index) => toSite(entry, index, problems));
  const seen = new Map<string, number>();
  for (const site of sites) seen.set(site.slug, (seen.get(site.slug) ?? 0) + 1);
  for (const [slug, count] of seen) if (count > 1) throw new Error(`de slug ${slug} staat ${count} keer in de backlog; elke site heeft een eigen map nodig, dus geef er een eigen slug bij`);
  return { sites, problems };
}

export interface AddInput {
  url: string;
  slug?: string | undefined;
  name?: string | undefined;
  organisation?: string | undefined;
  purpose?: string | undefined;
  sending?: Sending | undefined;
  alsoOrigins?: string[] | undefined;
  neverOpen?: string[] | undefined;
  login?: Login | null | undefined;
  atOnce?: number | undefined;
  navigationDelay?: number | null | undefined;
  mailbox?: string | null | undefined;
  vendorTags?: string[] | undefined;
  note?: string | undefined;
}

const HEADER_NL = `# Sites die onder de loep gaan. Voeg er een toe met \`lus add\`, of met de hand:
# één blok per site, met dezelfde sleutels als hieronder. Wat er met een site gebeurde
# staat niet hier maar in .lus/state.json.
`;

/**
 * Add a site to the file. The rest of the file is left as it is: comments survive, and so does the
 * order the person chose. Refuses a second site with the same slug, because their runs would share a
 * folder, and returns the site it wrote.
 */
export function addSite(path: string, input: AddInput): Site {
  parseUrl(input.url);
  const slug = input.slug?.trim() || slugFor(input.url);
  const refused = slugProblemNl(slug);
  if (refused !== null) throw new Error(refused);
  const existing = readBacklog(path);
  if (existing.sites.some((site) => site.slug === slug)) throw new Error(`er staat al een site met de slug ${slug} in de backlog; geef met --slug een eigen naam als het een andere site is`);
  const purpose = input.purpose ?? "verbeteren";
  if (!(PURPOSES as readonly string[]).includes(purpose)) throw new Error(`purpose is "${purpose}"; kies uit ${PURPOSES.join(", ")}`);
  const max = input.sending?.max ?? null;
  if (max !== null && (!Number.isInteger(max) || max < 0)) throw new Error(`--max-sends moet een heel getal van 0 of meer zijn`);
  const atOnce = input.atOnce ?? 2;
  if (!Number.isInteger(atOnce) || atOnce < 1) throw new Error(`--at-once moet een heel getal van 1 of meer zijn`);
  const delay = input.navigationDelay ?? null;
  if (delay !== null && (!Number.isInteger(delay) || delay < 0)) throw new Error(`--navigation-delay moet een heel getal van 0 of meer zijn, in seconden`);
  if (input.login && input.login.page === "") throw new Error("een inlog heeft de pagina nodig waar de gebruiker inlogt (--login-page)");
  const site: Site = {
    url: input.url.trim(),
    slug,
    name: input.name?.trim() || slug,
    organisation: input.organisation?.trim() ?? "",
    purpose: purpose as Purpose,
    sending: { allow: input.sending?.allow === true, max },
    alsoOrigins: input.alsoOrigins ?? [],
    neverOpen: input.neverOpen ?? [],
    login: input.login ?? null,
    atOnce,
    navigationDelay: input.navigationDelay ?? null,
    mailbox: input.mailbox ?? null,
    vendorTags: input.vendorTags ?? [],
    note: input.note ?? "",
  };
  const current = existsSync(path) ? readFileSync(path, "utf8") : HEADER_NL;
  const separator = current === "" || current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
  writeAtomic(path, `${current}${separator}${stringify([toFileShape(site)])}`);
  return site;
}

/** The keys of the file, in the order a person reads them, with what the file should show even when it is empty. */
function toFileShape(site: Site): Record<string, unknown> {
  return {
    url: site.url,
    slug: site.slug,
    name: site.name,
    organisation: site.organisation,
    purpose: site.purpose,
    sending: { allow: site.sending.allow, max: site.sending.max },
    "also-origins": site.alsoOrigins,
    "never-open": site.neverOpen,
    login: site.login,
    "at-once": site.atOnce,
    "navigation-delay": site.navigationDelay,
    mailbox: site.mailbox,
    "vendor-tags": site.vendorTags,
    note: site.note,
  };
}

