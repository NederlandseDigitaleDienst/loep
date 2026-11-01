import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Mailbox, RawMail } from "../src/lib/mailbox.ts";

/*
 * A hard mail route, next to the static sites of the fixture. A registration by mail, with everything
 * the route on the first site it was measured on did not have: a hidden field that changes with every
 * page load, links in the mail that go through a mailing service on another domain, and paths that say
 * nothing, also for unsubscribing, without a `List-Unsubscribe` header. Opening the link for
 * unsubscribing removes the registration, as a real one does. No link on the sites leads here, so the
 * sweep and the sitemap stay as they are; a test opens the form itself.
 */

/** The paths of the route. None of them says what it is for. */
export const MAIL_ROUTE_PATHS = { form: "/p/a3f9", sent: "/p/b7c1", confirm: "/p/x7k2", preferences: "/p/q4m8", unsubscribe: "/p/z9d1", removed: "/p/d2k5" } as const;
/** Where the mailing service answers, on the third party of the fixture. */
const CLICK_PREFIX = "/k/";
const CSRF_FIELD = "_csrf";

export interface MailRouteOptions {
  /** The links in a mail go through the mailing service, and not straight to the site. */
  viaService: boolean;
  /** The links in the HTML of a mail say what they do; without it they all say the same. */
  linkText: boolean;
  /** Where the mailing service sends every click, in place of the site. */
  serviceTarget: string | null;
}

export interface MailRegistration {
  address: string;
  token: string;
  confirmed: boolean;
}

export interface MailRoute {
  options: MailRouteOptions;
  /** The mails the site sent, those still in the box. */
  outbox: RawMail[];
  /** Who is registered now. */
  registrations: MailRegistration[];
  /** How many forms reached the site. */
  posts: () => number;
  /** How many clicks reached the mailing service. */
  clicks: () => number;
  /** The mailing service forgets its clicks: every click then gets a page of the service. */
  forgetClicks: () => void;
  /** The mail as a mailbox of a run sees it: no server in between. */
  mailbox: () => Mailbox;
  /** Answer a request on the site. False when the path is no part of the route. */
  site: (request: IncomingMessage, response: ServerResponse, origin: string, serviceOrigin: string) => boolean;
  /** Answer a request on the mailing service. False when the path is no part of the route. */
  service: (request: IncomingMessage, response: ServerResponse) => boolean;
}

const page = (title: string, content: string): string => `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>${title}</title></head><body><main><h1>${title}</h1>${content}</main></body></html>`;

const hex = (bytes: number): string => randomBytes(bytes).toString("hex");

export function createMailRoute(onPost: (path: string, body: string) => void): MailRoute {
  const options: MailRouteOptions = { viaService: true, linkText: true, serviceTarget: null };
  const outbox: RawMail[] = [];
  const registrations: MailRegistration[] = [];
  /** The hidden values handed out and not used yet: each works once, as with a real CSRF token. */
  const csrf = new Set<string>();
  /** What a click on the mailing service leads to. */
  const clicks = new Map<string, string>();
  let posts = 0;
  let clicked = 0;

  const html = (response: ServerResponse, status: number, body: string): void => void response.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(body);
  const notFound = (response: ServerResponse): void => html(response, 404, page("Niet gevonden", "<p>Deze pagina bestaat niet.</p>"));
  const freshCsrf = (): string => {
    const value = hex(16);
    csrf.add(value);
    return `<input type="hidden" name="${CSRF_FIELD}" value="${value}">`;
  };

  const send = (to: string, subject: string, text: string, htmlPart: string): void => {
    const boundary = `grens${hex(6)}`;
    const raw = [`From: nieuwsbrief@example.com`, `To: ${to}`, `Subject: ${subject}`, `Content-Type: multipart/alternative; boundary="${boundary}"`, "", `--${boundary}`, "Content-Type: text/plain; charset=utf-8", "", text, `--${boundary}`, "Content-Type: text/html; charset=utf-8", "", htmlPart, `--${boundary}--`, ""].join("\r\n");
    outbox.push({ id: hex(6), receivedAt: Date.now(), raw: Buffer.from(raw) });
  };

  /** The address in a mail: straight to the site, or through a click of its own on the mailing service. */
  const addressIn = (target: string, serviceOrigin: string): string => {
    if (!options.viaService) return target;
    const click = hex(16);
    clicks.set(click, target);
    return `${serviceOrigin}${CLICK_PREFIX}${click}`;
  };

  const welcome = (registration: MailRegistration, origin: string, serviceOrigin: string): void => {
    const linkTo = (path: string): string => addressIn(`${origin}${path}?t=${registration.token}`, serviceOrigin);
    const links = [
      { url: linkTo(MAIL_ROUTE_PATHS.confirm), name: "Bevestig je aanmelding" },
      { url: linkTo(MAIL_ROUTE_PATHS.preferences), name: "Wijzig je voorkeuren" },
      { url: linkTo(MAIL_ROUTE_PATHS.unsubscribe), name: "Afmelden" },
    ];
    const named = (name: string): string => (options.linkText ? name : "Klik hier");
    send(
      registration.address,
      "Je aanmelding",
      `Dank je wel.\n\n${links.map((link) => link.url).join("\n")}\n`,
      `<p>Dank je wel.</p>${links.map((link) => `<p><a href="${link.url.replaceAll("&", "&amp;")}">${named(link.name)}</a></p>`).join("")}`,
    );
  };

  const readBody = (request: IncomingMessage, done: (body: string) => void): void => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
  };

  const posted = (request: IncomingMessage, response: ServerResponse, path: string, then: (sent: URLSearchParams) => void): void =>
    readBody(request, (body) => {
      posts++;
      onPost(path, body);
      const sent = new URLSearchParams(body);
      const value = sent.get(CSRF_FIELD) ?? "";
      if (!csrf.delete(value)) return html(response, 403, page("Verlopen", "<p>Dit formulier is verlopen. Laad de pagina opnieuw.</p>"));
      then(sent);
    });

  const remove = (registration: MailRegistration): void => {
    registrations.splice(registrations.indexOf(registration), 1);
    send(registration.address, "Tot ziens", "Je gegevens zijn verwijderd.\n", "<p>Je gegevens zijn verwijderd.</p>");
  };

  return {
    options,
    outbox,
    registrations,
    posts: () => posts,
    clicks: () => clicked,
    forgetClicks: () => clicks.clear(),
    mailbox: () => ({
      kind: "mailpit",
      fetch: async (address) => outbox.filter((mail) => mail.raw.toString("latin1").toLowerCase().includes(`to: ${address.toLowerCase()}`)),
      remove: async (ids) => {
        const before = outbox.length;
        outbox.splice(0, outbox.length, ...outbox.filter((mail) => !ids.includes(mail.id)));
        return before - outbox.length;
      },
    }),
    site: (request, response, origin, serviceOrigin) => {
      const url = new URL(request.url ?? "/", origin);
      const method = request.method ?? "GET";
      const registration = registrations.find((known) => known.token === url.searchParams.get("t"));
      switch (url.pathname) {
        case MAIL_ROUTE_PATHS.form:
          if (method === "POST") {
            posted(request, response, url.pathname, (sent) => {
              const added = { address: sent.get("email") ?? "", token: hex(20), confirmed: false };
              registrations.push(added);
              welcome(added, origin, serviceOrigin);
              response.writeHead(303, { location: MAIL_ROUTE_PATHS.sent, "cache-control": "no-store" }).end();
            });
            return true;
          }
          html(response, 200, page("Nieuwsbrief", `<form method="post" action="${MAIL_ROUTE_PATHS.form}">${freshCsrf()}<label>E-mailadres <input type="email" name="email" autocomplete="email" required></label> <label>Naam <input type="text" name="naam" autocomplete="name"></label> <button>Aanmelden</button></form>`));
          return true;
        case MAIL_ROUTE_PATHS.sent:
          html(response, 200, page("Kijk in je mail", "<p>We hebben je een bericht gestuurd.</p>"));
          return true;
        case MAIL_ROUTE_PATHS.confirm:
          if (!registration) return notFound(response), true;
          registration.confirmed = true;
          html(response, 200, page("Bevestigd", `<p><a href="${MAIL_ROUTE_PATHS.preferences}?t=${registration.token}">Beheer je aanmelding</a></p>`));
          return true;
        case MAIL_ROUTE_PATHS.preferences:
          if (method === "POST") {
            posted(request, response, url.pathname, () => {
              if (registration) remove(registration);
              response.writeHead(303, { location: MAIL_ROUTE_PATHS.removed, "cache-control": "no-store" }).end();
            });
            return true;
          }
          if (!registration) return notFound(response), true;
          html(response, 200, page("Je voorkeuren", `<p>Je adres: <strong>${registration.address}</strong></p><form method="post" action="${MAIL_ROUTE_PATHS.preferences}?t=${registration.token}">${freshCsrf()}<button>Verwijder alles</button></form>`));
          return true;
        case MAIL_ROUTE_PATHS.unsubscribe:
          if (!registration) return notFound(response), true;
          remove(registration);
          html(response, 200, page("Afgemeld", "<p>Je ontvangt geen berichten meer.</p>"));
          return true;
        case MAIL_ROUTE_PATHS.removed:
          html(response, 200, page("Verwijderd", "<p>Je gegevens zijn verwijderd.</p>"));
          return true;
        default:
          return false;
      }
    },
    service: (request, response) => {
      const path = request.url ?? "/";
      if (!path.startsWith(CLICK_PREFIX)) return false;
      clicked++;
      const target = clicks.has(path.slice(CLICK_PREFIX.length)) ? (options.serviceTarget ?? clicks.get(path.slice(CLICK_PREFIX.length))) : undefined;
      if (target) response.writeHead(302, { location: target, "cache-control": "no-store" }).end();
      else response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Onbekende klik\n");
      return true;
    },
  };
}
