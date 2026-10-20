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

/** The schemes a run talks to a site over. Every other scheme (file:, data:, blob:, javascript: and the like) is never in the scope of a run. */
export const WEB_SCHEMES: readonly string[] = ["http:", "https:", "ws:", "wss:"];

/**
 * The host of an address as the scope of a run compares it: the host name with the port. The
 * usual ports (80 and 443) are left off, so http, https, ws and wss of one host are one host;
 * any other port is a host of its own, as it is a server of its own.
 */
export function scopeHost(url: URL): string {
  return url.port === "" || url.port === "80" || url.port === "443" ? url.hostname : `${url.hostname}:${url.port}`;
}

/** A host given on the command line (`--allow-host`), as the scope compares it: a host name, a host name with a port, or a whole address. */
export function scopeHostOf(text: string): string {
  const trimmed = text.trim();
  try {
    return scopeHost(new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`));
  } catch {
    throw new Error(`--allow-host "${text}" is geen host; geef een naam zoals cdn.example.nl, eventueel met een poort`);
  }
}

function ipv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return null;
  const numbers = parts.map(Number);
  return numbers.every((number) => number <= 255) ? numbers : null;
}

/**
 * Whether a host name, as `URL.hostname` gives it, is an address on this machine or on a local
 * network: loopback (and 0.0.0.0, which reaches this machine too), the private ranges (10/8,
 * 172.16/12, 192.168/16, fc00::/7), link-local (169.254/16, fe80::/10), and names under
 * .localhost and .local. A site on the internet that embeds such an address points into the
 * network of whoever runs loep, never at itself.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "local" || host.endsWith(".local")) return true;
  // An IPv4 address written as IPv6 (::ffff:7f00:1) is that IPv4 address.
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  const high = mapped ? parseInt(mapped[1]!, 16) : 0;
  const low = mapped ? parseInt(mapped[2]!, 16) : 0;
  const four = mapped ? [high >> 8, high & 255, low >> 8, low & 255] : ipv4(host);
  if (four) {
    const [a, b] = four as [number, number];
    return a === 0 || a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (!host.includes(":")) return false;
  if (host === "::" || host === "::1") return true;
  const first = parseInt(host.split(":")[0] || "0", 16);
  // fc00::/7 (unique local) and fe80::/10 (link-local).
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

/**
 * Whether an address found on the site (an embedded window) lies on this machine or a local
 * network while the site itself does not. Such an address is left out of the inventory and the
 * scope. A site that runs locally, such as the test site, may embed one: there it is part of the site.
 */
export function privateFromPublicSite(url: string, origins: readonly string[]): boolean {
  return isPrivateHost(new URL(url).hostname) && !origins.some((origin) => isPrivateHost(new URL(origin).hostname));
}
