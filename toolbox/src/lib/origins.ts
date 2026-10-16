/**
 * The origins a site is made of. Most sites have one: the origin of the address the inventory
 * started from. A site can also be spread over more, such as a landing page on example.nl and
 * its documentation on docs.example.nl; then the inventory is given each further origin with
 * `--also-origin`, and every place that asks "is this the site?" asks it of the whole list.
 * An origin that was not given, such as another subdomain, is not part of the site.
 */

/** Where the origins of a site can be read: an inventory, the site of an evaluation or a dossier. */
export interface OriginSource {
  /** All origins of the site, the one of the start address first. Absent in runs from before `--also-origin`. */
  origins?: readonly string[] | undefined;
  /** The origin of the start address, in an inventory. */
  origin?: string | undefined;
  /** The start address, in an evaluation or a dossier. */
  baseUrl?: string | undefined;
}

/** The origins of the site, the one of the start address first. An older run without `origins` has the one origin it always had. */
export function siteOrigins(source: OriginSource): string[] {
  if (source.origins && source.origins.length > 0) return [...source.origins];
  if (source.origin) return [source.origin];
  if (source.baseUrl) {
    try {
      return [new URL(source.baseUrl).origin];
    } catch {
      return [];
    }
  }
  return [];
}

/** The hosts of the site, with the port where the address has one ("127.0.0.1:4710"), as `URL.host` gives them. */
export function siteHosts(source: OriginSource): string[] {
  return [...new Set(siteOrigins(source).map((origin) => new URL(origin).host))];
}

/** Whether an address lies on one of the origins of the site. */
export function isOwnAddress(url: string, origins: readonly string[]): boolean {
  try {
    return origins.includes(new URL(url).origin);
  } catch {
    return false;
  }
}

/** The origins of the site as one phrase for a reader: "https://example.nl en https://docs.example.nl". */
export function originsNl(origins: readonly string[]): string {
  return origins.length <= 1 ? origins.join("") : `${origins.slice(0, -1).join(", ")} en ${origins.at(-1)}`;
}

/** The name of the site in a task for an agent: its host, or its hosts when it has more than one ("example.nl en docs.example.nl"). */
export function siteLabel(source: OriginSource): string {
  const names = [...new Set(siteOrigins(source).map((origin) => new URL(origin).hostname))];
  return originsNl(names);
}

/**
 * The origin given on the command line as one of the site: scheme, host and port. A path is
 * allowed and dropped, so `https://docs.example.nl/start` gives `https://docs.example.nl`.
 * Throws a message for the reader when it is not an address with http or https.
 */
export function parseOrigin(text: string): string {
  let parsed: URL;
  try {
    parsed = new URL(text.trim());
  } catch {
    throw new Error(`--also-origin "${text}" is geen adres; geef het schema, de host en eventueel de poort, zoals https://docs.example.nl`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`--also-origin "${text}" is geen adres met http:// of https://`);
  return parsed.origin;
}

/** The addresses asked for at inventory to see the page for a missing address: one per origin of the site. An older run has the one it always had. */
export function notFoundProbes(inventory: { notFoundProbe: string; notFoundProbes?: readonly string[] | undefined }): string[] {
  return inventory.notFoundProbes && inventory.notFoundProbes.length > 0 ? [...inventory.notFoundProbes] : [inventory.notFoundProbe];
}

/** The first line of the scope of an evaluation: every page on every origin of the site. */
export function pagesInScopeNl(origins: readonly string[]): string {
  return `Alle pagina's op ${originsNl(origins)}`;
}

/** The origins of a new inventory: the one of the start address first, then each further one once, in the order given. */
export function originsOfRun(baseUrl: string, also: readonly string[] = []): string[] {
  const main = new URL(baseUrl).origin;
  return [...new Set([main, ...also.map(parseOrigin)])];
}
