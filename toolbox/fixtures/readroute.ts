/**
 * The requests on the fixture site that only read although they are no GET, answered by the server:
 *
 * - on the third party, the start of the survey (`POST /vragenlijst/start`, a question for its questions), which a
 *   fixed read rule for the test server lets through (fixtures/fixed-reads.json), with the preflight a browser sends
 *   before it;
 * - on both sites, the search of the waste guide (`POST /zoekdienst/multi_search`, a question in the form of
 *   Typesense), which only a read rule of the site model lets through.
 *
 * They are logged with kind "read", apart from what changes something. Every other POST, such as the visit the survey
 * reports to its service, is still answered and logged by serve.ts as a write. Every answer of the third party may be
 * read by a page of another origin (CORS), as the answer of a real service is. Nothing in this file is served.
 */
import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";

type Site = "defect" | "clean" | "thirdParty";
type Log = (entry: { site: Site; kind: "read"; method: string; path: string; body?: string }) => void;

/** What the waste guide knows: a kind of waste and where it goes. `bak` names the picture of the bin. */
const WASTE = [
  { naam: "Batterijen", bak: "chemisch", waar: "Klein chemisch afval, in de inzamelbox of bij de milieustraat" },
  { naam: "Verfresten", bak: "chemisch", waar: "Klein chemisch afval, bij de milieustraat" },
  { naam: "Glazen potten", bak: "glas", waar: "Glasbak" },
  { naam: "Kleding", bak: "textiel", waar: "Textielcontainer" },
  { naam: "Pizzadoos", bak: "grijs", waar: "Grijze container voor restafval" },
  { naam: "Snoeiafval", bak: "groen", waar: "Groene container" },
];

const json = (response: ServerResponse, status: number, value: unknown): void => {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": body.length, "cache-control": "no-store" }).end(body);
};

const parse = (text: string): Record<string, unknown> | null => {
  try {
    const value = JSON.parse(text) as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** Answer a read, or return false for serve.ts to answer the request. `root` is the directory the site is served from. */
export function answerRead(site: Site, request: IncomingMessage, response: ServerResponse, root: string, log: Log): boolean {
  const method = request.method ?? "GET";
  const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (site === "thirdParty") {
    response.setHeader("access-control-allow-origin", "*");
    if (method === "OPTIONS") {
      log({ site, kind: "read", method, path });
      response.writeHead(204, { "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type", "access-control-max-age": "600" }).end();
      return true;
    }
  }
  const survey = site === "thirdParty" && method === "POST" && path === "/vragenlijst/start";
  const search = site !== "thirdParty" && method === "POST" && path === "/zoekdienst/multi_search";
  if (!survey && !search) return false;
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    log({ site, kind: "read", method, path, body: body.slice(0, 2000) });
    const asked = parse(body);
    if (survey) {
      // The site says which survey it shows; the service answers with its questions.
      const id = typeof asked?.vragenlijst === "string" && /^[a-z0-9]+$/.test(asked.vragenlijst) ? asked.vragenlijst : "";
      const file = join(root, "vragenlijst", `${id}.json`);
      if (!id || !existsSync(file)) return json(response, 404, { fout: "onbekende vragenlijst" });
      return json(response, 200, JSON.parse(readFileSync(file, "utf8")) as unknown);
    }
    const searches = Array.isArray(asked?.searches) ? (asked.searches as { q?: unknown }[]) : [];
    const term = typeof searches[0]?.q === "string" ? searches[0].q.trim().toLowerCase() : "";
    if (!term) return json(response, 400, { message: "searches[0].q ontbreekt" });
    const hits = WASTE.filter((entry) => entry.naam.toLowerCase().includes(term));
    // Without a match the guide shows what is searched for most, as many search services do.
    json(response, 200, { results: [{ found: hits.length, hits: (hits.length > 0 ? hits : WASTE).map((document) => ({ document })) }] });
  });
  return true;
}
