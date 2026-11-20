/**
 * Disruptions of the fixture site: what a real site does now and then and the fixture does not by
 * itself. Off unless the server is started with them (`--disruptions`, or `disruptions` in
 * `startFixture`); without them every page is served as before.
 *
 * Each case is on a fixed page of both variants, so a run knows which page it is about and what the
 * outcome should be. A case that happens once does so once per variant after `arm()`. Only the regression check
 * of the sweep arms them, right before collect of that variant, so that the inventory and check-site do not use
 * them up. `--disruptions` on the command line never arms them: whatever asks first would get them, the
 * inventory of a run or a session of some agent on a frozen sweep, and never the step the threshold is about.
 *
 * Nothing here is served as a file, and the texts below name nothing that gives a case away.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export type DisruptionSite = "defect" | "clean" | "thirdParty";

export interface Disruption {
  id: string;
  /** The path of the page the case is on; for a stylesheet the page that asks for it. */
  page: string;
  /** Which origin: both variants of the site, or Kijkpunt. */
  on: "site" | "thirdParty";
  descriptionNl: string;
  /** What a measurement has to come to: the threshold a measurement on the fixture with disruptions looks at. */
  expectedNl: string;
  /** The same in a form a script can check after the sweep: `just sweep-check --disruptions` does. */
  expected: {
    /** The page is in the sample and measured: with the stylesheet, as an error page, or with what was missing noted. */
    measured: boolean;
    /** What facts.json of the page says about the stylesheet after the second collect. */
    notLoaded: "none" | "again";
    /** What the gate says about the page on these checks (see GATE_CHECKS): nothing, or one entry of one check, as a gap or a limitation. */
    gate: null | { check: (typeof GATE_CHECKS)[number]; as: "gap" | "limitation" };
    /** Entries in blockades.json because of this case, and of which kind. */
    blockade: "none" | "429-paused";
  };
}

/** The checks of the gate that say whether a page loaded as a visitor gets it. */
export const GATE_CHECKS = ["pages-loaded", "page-resource-not-loaded", "site-answered"] as const;

/** The once-only 429 asks this many seconds; below SHORT_RETRY_AFTER_SECONDS, so the sweep waits it out. */
export const RETRY_AFTER_SECONDS = 2;

export const DISRUPTIONS: Disruption[] = [
  {
    id: "stylesheet-once",
    page: "/nieuws/zomerfeest.html",
    on: "site",
    descriptionNl: "De stylesheet van de site komt voor deze pagina één keer niet binnen: de eerste keer na het inschakelen antwoordt de server met 502, daarna komt hij gewoon.",
    expectedNl: "De veegronde laadt de pagina nog een keer en meet haar met de stylesheet. In facts.json staat niets over een ontbrekend bestand, de poort geeft geen gat en geen beperking, en de oordelen op deze pagina zijn die van een gewoon nieuwsbericht.",
    expected: { measured: true, notLoaded: "none", gate: null, blockade: "none" },
  },
  {
    id: "stylesheet-always",
    page: "/nieuws/werkzaamheden-dorpsstraat.html",
    on: "site",
    descriptionNl: "De stylesheet van de site komt voor deze pagina nooit binnen: de server antwoordt elke keer met 503.",
    expectedNl: "Na de tweede collect staat notLoadedAgain in facts.json en maakt de poort het een beperking. Geen criterium wordt op deze pagina afgekeurd of goedgekeurd op grond van wat zonder stylesheet te zien is; wat ervan afhangt, staat als beperking in het rapport.",
    expected: { measured: true, notLoaded: "again", gate: { check: "page-resource-not-loaded", as: "limitation" }, blockade: "none" },
  },
  {
    id: "too-many-requests",
    page: "/sitemap.html",
    on: "site",
    descriptionNl: `De pagina antwoordt één keer met 429 en Retry-After: ${RETRY_AFTER_SECONDS}, daarna gewoon.`,
    expectedNl: "Er staat één vermelding met reden 429 en een einde in blockades.json. De veegronde wacht de pauze af, laadt de pagina opnieuw en meet haar. Het rapport noemt bij de beperkingen dat de site één keer vroeg om even te wachten; geen criterium blijft daardoor open.",
    expected: { measured: true, notLoaded: "none", gate: null, blockade: "429-paused" },
  },
  {
    id: "unavailable",
    page: "/afspraak-maken.html",
    on: "site",
    descriptionNl: "De pagina antwoordt altijd met 503 en een korte foutpagina. Geen andere pagina linkt ernaar; ze staat alleen in de vaste lijst van een meting met storingen.",
    expectedNl: "De veegronde stopt niet: er komt geen vermelding in blockades.json, want de server antwoordt, en de andere pagina's worden gewoon gemeten. De pagina wordt vastgelegd zoals ze is, een foutpagina met status 503, en de poort geeft voor haar alleen het gat pages-loaded, voor de verkenner. Zolang het sitemodel de pagina houdt, wordt dat na de rondes van de verkenner een beperking. Een agent beoordeelt de foutpagina niet als de pagina om een afspraak te maken.",
    expected: { measured: true, notLoaded: "none", gate: { check: "pages-loaded", as: "gap" }, blockade: "none" },
  },
  {
    id: "robot-check",
    page: "/controle.html",
    on: "thirdParty",
    descriptionNl: "Kijkpunt antwoordt als een site achter Cloudflare (een kop cf-ray). Het venster met het vinkje toont zonder cookie eerst een controlepagina tegen robots (403, cf-mitigated: challenge), die een script van /cdn-cgi/challenge-platform/ laadt, daar een POST doet en met de cookie die terugkomt het venster opnieuw laadt.",
    expectedNl: "De veegronde en een sessie laten de POST naar /cdn-cgi/challenge-platform/ door, en het log van de server telt die niet als iets wat naar de site is verstuurd. Het venster toont daarna het vinkje, zoals zonder storingen.",
    // The window is measured on its own as well, as an embedded page of the sample.
    expected: { measured: true, notLoaded: "none", gate: null, blockade: "none" },
  },
];

/** The cases that happen once after `arm()`. */
const ONCE = ["stylesheet-once", "too-many-requests"];

const byId = (id: string): Disruption => DISRUPTIONS.find((entry) => entry.id === id)!;

/** The pages of the site a measurement with disruptions adds to its fixed list. */
export const DISRUPTED_PAGES = DISRUPTIONS.filter((entry) => entry.on === "site").map((entry) => entry.page);

const UNAVAILABLE_HTML = `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tijdelijk niet beschikbaar</title>
</head>
<body>
<main>
<h1>Tijdelijk niet beschikbaar</h1>
<p>Afspraken maken kan op dit moment niet. Probeer het later nog eens.</p>
</main>
</body>
</html>
`;

const CHECK_SCRIPT = "/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1";
const CHECK_FLOW = "/cdn-cgi/challenge-platform/h/b/flow/ov1/";
const CLEARANCE = "cf_clearance";

const CHALLENGE_HTML = `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Een ogenblik geduld...</title>
</head>
<body>
<main>
<h1>Even controleren of u een mens bent</h1>
<p>Dit duurt een paar seconden.</p>
</main>
<script src="${CHECK_SCRIPT}"></script>
</body>
</html>
`;

const CHECK_JS = `fetch(${JSON.stringify(CHECK_FLOW)} + Date.now().toString(16), { method: "POST", body: "r=1" }).then((response) => { if (response.ok) location.reload(); });\n`;

/** The state of the disruptions of one server: which once-only cases are still to come. */
export interface Disruptions {
  /** Arm the cases that happen once, on one variant or on both: the next request of that variant that meets one gets it. */
  arm(variant?: "defect" | "clean"): void;
  /**
   * Answer a request when a case is about it; false when the server answers as usual. `log` notes a
   * POST of the robot check, which Cloudflare answers itself and which never reaches a site.
   */
  answer(site: DisruptionSite, request: IncomingMessage, response: ServerResponse, log: (path: string) => void): boolean;
}

const pathOf = (address: string | undefined): string | null => {
  if (!address) return null;
  try {
    return new URL(address, "http://127.0.0.1").pathname;
  } catch {
    return null;
  }
};

export function createDisruptions(options: { armed: boolean }): Disruptions {
  // Per variant, so that both get each once-only case.
  const pending = new Set<string>();
  // One variant at a time, so that arming the second does not arm the first again, and arming the first leaves the inventory of the second alone.
  const arm = (variant?: "defect" | "clean"): void => {
    for (const site of variant ? [variant] : ["defect", "clean"]) for (const id of ONCE) pending.add(`${site} ${id}`);
  };
  if (options.armed) arm();
  const send = (response: ServerResponse, status: number, headers: Record<string, string | number>, body = ""): true => {
    response.writeHead(status, { "cache-control": "no-store", ...headers });
    response.end(body);
    return true;
  };
  return {
    arm,
    answer(site, request, response, log) {
      const take = (id: string): boolean => pending.delete(`${site} ${id}`);
      const path = pathOf(request.url);
      if (path === null) return false;
      if (site === "thirdParty") {
        // A site behind Cloudflare: every answer carries its header.
        response.setHeader("cf-ray", "8f1c2d3e4a5b6c7d-AMS");
        if (path.startsWith(CHECK_FLOW) && request.method === "POST") {
          request.resume();
          log(path);
          return send(response, 200, { "content-type": "text/plain; charset=utf-8", "set-cookie": `${CLEARANCE}=${Date.now().toString(16)}; Path=${byId("robot-check").page}; HttpOnly; SameSite=Lax` }, "ok");
        }
        if (path === CHECK_SCRIPT) return send(response, 200, { "content-type": "text/javascript; charset=utf-8" }, CHECK_JS);
        if (path === byId("robot-check").page && !new RegExp(`(?:^|;\\s*)${CLEARANCE}=`).test(request.headers.cookie ?? "")) {
          return send(response, 403, { "content-type": "text/html; charset=utf-8", "cf-mitigated": "challenge" }, request.method === "HEAD" ? "" : CHALLENGE_HTML);
        }
        return false;
      }
      if (path === byId("unavailable").page) return send(response, 503, { "content-type": "text/html; charset=utf-8" }, request.method === "HEAD" ? "" : UNAVAILABLE_HTML);
      if (path === byId("too-many-requests").page && take("too-many-requests")) return send(response, 429, { "content-type": "text/plain; charset=utf-8", "retry-after": RETRY_AFTER_SECONDS }, "Te veel verzoeken\n");
      if (path === "/stijl.css") {
        const from = pathOf(request.headers.referer);
        if (from === byId("stylesheet-always").page) return send(response, 503, { "content-type": "text/plain; charset=utf-8" }, "Tijdelijk niet beschikbaar\n");
        // A gateway that has a bad moment. Not a broken connection: a browser asks again by itself when a reused connection breaks off before an answer.
        if (from === byId("stylesheet-once").page && take("stylesheet-once")) return send(response, 502, { "content-type": "text/plain; charset=utf-8" }, "Bad Gateway\n");
      }
      return false;
    },
  };
}
