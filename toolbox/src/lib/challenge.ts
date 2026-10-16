/**
 * Cloudflare's check whether a visitor is a robot. Cloudflare answers these requests itself, at
 * its edge in front of a site it serves: they never reach the site, so a POST there changes
 * nothing on the site. A browser that holds them back is not what a visitor has, and Cloudflare
 * then asks again with a heavier check, until a player or a page stays on its loading screen.
 * Only the check passes: a form or a token that a page sends to the site afterwards is held back
 * as before.
 */
export const CHALLENGE_HOST = "challenges.cloudflare.com";
const CHALLENGE_PATH = "/cdn-cgi/challenge-platform/";

/** The header Cloudflare adds to every response it serves. A host without it is not behind Cloudflare, and its paths reach the site. */
export const CLOUDFLARE_HEADER = "cf-ray";

/**
 * Whether a request is part of Cloudflare's check: anything to Cloudflare's own host for it, or
 * a path under `/cdn-cgi/challenge-platform/` on a host that answered through Cloudflare in this
 * browser context.
 */
export function isChallenge(url: string, viaCloudflare: (host: string) => boolean): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    if (parsed.hostname === CHALLENGE_HOST) return true;
    return parsed.pathname.startsWith(CHALLENGE_PATH) && viaCloudflare(parsed.hostname);
  } catch {
    return false;
  }
}
