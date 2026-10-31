import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize } from "node:path";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";

const SITE = fileURLToPath(new URL("./site", import.meta.url));
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".vtt": "text/vtt; charset=utf-8", ".png": "image/png", ".js": "text/javascript; charset=utf-8" };
const VARIANTS = [
  { text: "De eerste versie van deze tekst.", colour: "#1a1a1a" },
  { text: "De tweede versie van deze tekst, in een lichtere kleur.", colour: "#aaaaaa" },
];

export interface ReceivedRequest {
  method: string;
  host: string;
  path: string;
  /** When the request arrived, in milliseconds since the epoch. */
  at: number;
  userAgent: string;
  /** The page the browser named as where the request came from; empty when it named none. */
  referer: string;
}

export interface FixtureServer {
  /** The site under test, on 127.0.0.1. */
  origin: string;
  /** The same server reached as "localhost": another host, so out of scope for a run on `origin`. */
  otherOrigin: string;
  /** Everything that reached the server, in order. */
  requests: ReceivedRequest[];
  /** Every WebSocket message a page managed to send; a binary one as "binary:" and its bytes in hex. */
  socketMessages: string[];
  /** Which version of /changing.html is served. */
  setVariant(index: number): void;
  close(): Promise<void>;
}

/** Read the text and binary frames a client sends; enough of RFC 6455 for a test server. */
function readFrames(socket: Duplex, onText: (text: string) => void): void {
  let buffer = Buffer.alloc(0);
  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 2) return;
      const opcode = buffer[0]! & 0x0f;
      const masked = (buffer[1]! & 0x80) !== 0;
      let length = buffer[1]! & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      }
      const maskLength = masked ? 4 : 0;
      if (buffer.length < offset + maskLength + length) return;
      const mask = buffer.subarray(offset, offset + maskLength);
      const payload = Buffer.from(buffer.subarray(offset + maskLength, offset + maskLength + length));
      if (masked) for (let index = 0; index < payload.length; index++) payload[index] = payload[index]! ^ mask[index % 4]!;
      buffer = buffer.subarray(offset + maskLength + length);
      if (opcode === 1) onText(payload.toString("utf8"));
      if (opcode === 2) onText(`binary:${payload.toString("hex")}`);
      if (opcode === 8) socket.end();
    }
  });
}

/** A text frame from the server to the page: never masked. */
function textFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const head = payload.length < 126 ? Buffer.from([0x81, payload.length]) : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
  return Buffer.concat([head, payload]);
}

/** Serve the fixture site. Port 0 picks a free port; a fixed port keeps URLs equal between two sweeps. */
export async function startServer(port = 0): Promise<FixtureServer> {
  const requests: ReceivedRequest[] = [];
  const socketMessages: string[] = [];
  let variant = 0;
  let otherOrigin = "";
  const note = (request: IncomingMessage): string => {
    const path = new URL(request.url ?? "/", "http://fixture").pathname;
    requests.push({ method: request.method ?? "GET", host: (request.headers.host ?? "").split(":")[0]!, path, at: Date.now(), userAgent: String(request.headers["user-agent"] ?? ""), referer: String(request.headers.referer ?? "") });
    return path;
  };
  const server: Server = createServer(async (request, response) => {
    const path = note(request);
    if (request.method !== "GET" && request.method !== "HEAD") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      // A search service on another host: a question is a POST, and a browser asks first whether it may send one.
      if (request.method === "OPTIONS") {
        response.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "POST", "access-control-allow-headers": "content-type" }).end();
        return;
      }
      if (path.endsWith("/queries")) {
        response.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" }).end(JSON.stringify({ results: [{ hits: [{ title: "Afvalkalender" }, { title: "Afval scheiden" }, { title: "Grofvuil" }] }] }));
        return;
      }
      // A write that the server passes on to another host, keeping the method.
      if (path === "/submit-redirect") {
        response.writeHead(307, { location: `${otherOrigin}/submit` }).end();
        return;
      }
      // The usual answer to a form: go and fetch the page that says how it went.
      if (path === "/submit-see-other") {
        response.writeHead(303, { location: "/elsewhere.html" }).end();
        return;
      }
      // A form whose answer hands the page a token to send with the next form: a replay would hand over the token of another visit.
      if (path === "/submit-token") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Stap 2 - Testsite sessie</title></head><body><main><h1>Stap 2</h1><form method="post" action="/submit-see-other"><input type="hidden" name="_token" value="${Date.now().toString(36)}"><button>Verder</button></form></main></body></html>`);
        return;
      }
      // A form whose next page shows what the session holds, as a message kept for one page: without the cookie of the visitor that page is another.
      if (path === "/submit-flash") {
        response.writeHead(303, { location: "/flash.html" }).end();
        return;
      }
      // A form that only the server checks: the error message exists nowhere before submitting.
      if (path === "/callback") {
        const phone = new URLSearchParams(Buffer.concat(chunks).toString("utf8")).get("phone") ?? "";
        const problem = phone.trim() === "" ? "Vul een telefoonnummer in." : /^[0-9 +-]{8,}$/.test(phone) ? null : "Het telefoonnummer is niet geldig.";
        const message = problem ? `<p id="server-error" role="alert">${problem}</p><p><a href="/callback.html">Terug naar het formulier</a></p>` : '<p id="server-ok" role="status">Bedankt, wij bellen u terug.</p>';
        response.writeHead(problem ? 422 : 200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(`<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>${problem ? "Fout" : "Verstuurd"} - Testsite sessie</title></head><body><main><h1>Terugbellen</h1>${message}</main></body></html>`);
        return;
      }
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("ontvangen");
      return;
    }
    // An address of the site itself that sends the visitor to another host.
    if (path === "/redirect-out") {
      response.writeHead(302, { location: `${otherOrigin}/elsewhere.html` }).end();
      return;
    }
    // An address of the site itself that goes to the one above: the step out of the site comes second.
    if (path === "/redirect-twice") {
      response.writeHead(302, { location: "/redirect-out" }).end();
      return;
    }
    // An address that sends the visitor on to a host that is neither the site nor the other origin.
    if (path === "/redirect-third") {
      response.writeHead(302, { location: `${otherOrigin.replace("localhost", "[::1]")}/elsewhere.html` }).end();
      return;
    }
    // Five seconds of a soft tone, made here so that no sound file has to be kept: 8000 samples a second, one byte each.
    if (path === "/tone.wav") {
      const samples = 40_000;
      const wav = Buffer.alloc(44 + samples);
      wav.write("RIFF", 0);
      wav.writeUInt32LE(36 + samples, 4);
      wav.write("WAVEfmt ", 8);
      wav.writeUInt32LE(16, 16);
      wav.writeUInt16LE(1, 20);
      wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(8000, 24);
      wav.writeUInt32LE(8000, 28);
      wav.writeUInt16LE(1, 32);
      wav.writeUInt16LE(8, 34);
      wav.write("data", 36);
      wav.writeUInt32LE(samples, 40);
      for (let index = 0; index < samples; index++) wav[44 + index] = 128 + Math.round(20 * Math.sin((index * 2 * Math.PI * 440) / 8000));
      response.writeHead(200, { "content-type": "audio/wav", "content-length": wav.length, "accept-ranges": "none" }).end(wav);
      return;
    }
    // The page after /submit-flash: what it says depends on the cookie of the visitor.
    if (path === "/flash.html") {
      const kept = /(?:^|;\s*)bericht=1/.test(request.headers.cookie ?? "");
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(`<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Melding - Testsite sessie</title></head><body><main><h1>Melding</h1>${kept ? '<p role="status">Uw bericht is ontvangen.</p>' : ""}</main></body></html>`);
      return;
    }
    // A page that never answers.
    if (path === "/slow") return;
    // A site that says the visitor asked too much, with ?retry=<seconds> as the time to wait.
    if (path === "/too-many") {
      const retry = new URL(request.url ?? "/", "http://fixture").searchParams.get("retry");
      response.writeHead(429, { "content-type": "text/html; charset=utf-8", ...(retry ? { "retry-after": retry } : {}) }).end('<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Te veel verzoeken - Testsite sessie</title></head><body><main><h1>Te veel verzoeken</h1></main></body></html>');
      return;
    }
    // A site that drops the connection without an answer, as a firewall that blocks a visitor does.
    if (path === "/drop") {
      request.socket.destroy();
      return;
    }
    // A search that takes its time: the page that sent the form is still there when a short pause is over.
    if (path === "/slow-result") {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const query = new URL(request.url ?? "/", "http://fixture").searchParams.get("q") ?? "";
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(`<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Zoekresultaten - Testsite sessie</title></head><body><main><h1>Resultaten voor ${query.replace(/[<>&"]/g, "")}</h1><p><a href="/choose.html">Terug</a></p></main></body></html>`);
      return;
    }
    const file = join(SITE, normalize(path === "/" ? "/index.html" : path));
    try {
      if (!file.startsWith(SITE)) throw new Error("outside the site");
      let body: Buffer | string = await readFile(file);
      if (extname(file) === ".html") {
        body = body.toString("utf8").replaceAll("__OTHER_ORIGIN__", otherOrigin).replaceAll("__VARIANT_TEXT__", VARIANTS[variant]!.text).replaceAll("__VARIANT_COLOUR__", VARIANTS[variant]!.colour);
      }
      // A page asked for with ?cloudflare comes back as Cloudflare serves a page, with the header it adds to each response.
      const viaCloudflare = new URL(request.url ?? "/", "http://fixture").searchParams.has("cloudflare") ? { "cf-ray": "8f0000000000abcd-AMS" } : {};
      response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store", ...viaCloudflare }).end(body);
    } catch {
      response.writeHead(404, { "content-type": "text/html; charset=utf-8" }).end('<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Niet gevonden - Testsite sessie</title></head><body><main><h1>Pagina niet gevonden</h1><p><a href="/">Naar de startpagina</a></p></main></body></html>');
    }
  });
  server.on("upgrade", (request, socket) => {
    note(request);
    const accept = createHash("sha1").update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    readFrames(socket, (text) => {
      socketMessages.push(text);
      // A chat message gets an answer in two parts, as a chat answers: a receipt at once and the answer a moment later.
      if (text.startsWith('{"type":"chat"')) {
        setTimeout(() => socket.writable && socket.write(textFrame('{"type":"reply","text":"Ontvangen"}')), 50);
        setTimeout(() => socket.writable && socket.write(textFrame('{"type":"reply","text":"Waarmee kan ik helpen?"}')), 200);
      }
    });
    socket.on("error", () => undefined);
  });
  // No host: the server answers on 127.0.0.1 and on localhost alike.
  await new Promise<void>((resolve) => server.listen(port, resolve));
  const actual = (server.address() as AddressInfo).port;
  otherOrigin = `http://localhost:${actual}`;
  return {
    origin: `http://127.0.0.1:${actual}`,
    otherOrigin,
    requests,
    socketMessages,
    setVariant: (index) => void (variant = index),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fixture = await startServer(Number(process.argv[2] ?? 0));
  process.stdout.write(`${fixture.origin}\n`);
}
