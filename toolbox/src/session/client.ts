import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { connect, createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { sha256 } from "../lib/canonical.ts";
// Only the types: a `session` command is a small process that talks to the one that holds the browser.
// It must not load the code of the commands itself, or an edit to that code while a session
// runs would break every command of that session.
import type { Request, Response } from "./daemon.ts";
import { setRunLogin } from "../lib/login.ts";
import { scopeForRun, TEST_VALUES } from "./safety.ts";

export const SESSION_USAGE = `  session start --run <run> [--session <name>] [--scope <url>] [--max-commands <n>] [--max-minutes <n>] [--single-browser]
                [--model "<name and version>"]
                                         Start a browser session for an agent (and the process that holds the browser);
                                         --model is the model the agent itself says it runs on, kept in the session file;
                                         --single-browser keeps WebKit and Firefox out of it
  session stop --run <run> [--session <name>]
                                         Stop one session, or all of them and the process
  session list --run <run>               Show the running sessions and what is left of their budget
  session extend --run <run> --session <name> --reason "<text>"
                                         Add half of what the session started with to its budget, in commands and in minutes;
                                         at most twice, from 80 percent used, and the reason says what is still to be measured
  session <command> ... --run <run> [--session <name>]
                                         One command in a session; prints compact JSON with the id of the observation
      act:     open <url|label> [--width n] [--scheme light|dark] [--state <name>] [--with-blockers], click <ref>, key <key>,
               tab [n] [--shift], type <ref> <${Object.keys(TEST_VALUES).join("|")}>,
               select <ref> <option text | #n>, paste <ref> <same kinds as type>, press <ref> [--hold | --abort],
               hover <ref>, scroll <ref|top|bottom|down|up|+n|-n>, back
      a <ref> is a number from look or find, or css:<selector> when that matches exactly one element
      look:    look [--full] [--max n] [--plain] [--vision deuteranopia|protanopia|tritanopia|achromatopsia|blurredVision|reducedContrast],
               crop <ref> [--margin n], ax <ref>, style <ref> [a,b,c], html <ref> [--max n],
               find <text | role:x | tag:x | css:selector>
      dossier [<part> [<chunk>]] [--criterion x.y.z]   the dossier of the task of this session, in a compact form: without a
               part an overview with sizes and what is read; a part (controls, keyboard.walk, legend.P03, rows.4) in
               chunks of at most 20.000 characters, printed as text under the line of JSON. Read from the run: needs no
               started session and costs nothing of the budget; what was shown is kept for check-verdict
      document <label> [--page n] [--tags]   a document of the sample (D01): its facts; one page with a picture (pdf), the
               text in reading order and the tags on it; or the tag tree. Needs no open page
      measure: distinct <ref> [--against <ref>] (how far a link is from the text around it in colour, or one element from another:
               the contrast ratio as everybody sees it and with protanopia, deuteranopia, tritanopia and achromatopsia),
               forced [<ref>] [--more-contrast] [--max n] (the page again with forced colours or with more contrast: which boundary,
               focus indicator or drawing disappears; no requirement of WCAG, a lead),
               reflow, spacing [--keep] (--keep leaves the wider spacing in force until the next open), zoom, order, media [<ref>] (every audio and video, or one: plays, muted, duration, tracks, controls),
               media <ref> --listen (fetches the file: what is said next to the subtitles and the text around it, sound that is
               not speech, still pictures of a video with the text in them, flashes per second; needs ffmpeg and whisper.cpp)
      measure with every method that answers the question, side by side:
               name <ref>, rules [<ref>] [--criterion x.y.z] (was: engines), contrast <ref> [--at x,y,width,height], focus <ref>, target <ref>,
               taborder [--from <ref>|focus] [--max n] (was: tabwalk), lang [<ref>], source, ocr <ref>, motion [--seconds n],
               timers (every timer of a second or more since the load, also one an action just started: the waiting ones
               are set off and what each did is judged by the rule of 2.2.1; this changes the page)
               reflow, zoom and spacing are measured in WebKit too; slow methods (a second browser, Java, text recognition) run in the background: --wait waits for them,
               wait [--timeout s] picks them up later, tools lists every method with its version
      speak:   what a screen reader says, by a reader simulated in the page that follows the standard (not a real one):
               speak <ref> (at the element), speak [<ref>] --steps n (the first n items from the top or from the element),
               speak <ref> --click | --type <kind> [--submit] [--seconds n] (act, then what is said by itself: status, error, focus)
      voiceover [<url|label>] [--state <name>] [--steps n] [--press "<name> <role>"] [--no-popup] [--no-mailto]
               what a real screen reader says: VoiceOver with Safari in the virtual Mac reads the state the session is in
               (or a saved state, or a page) from the top; with --press it presses that control and keeps what it says by
               itself. The page is fetched once with GET and the steps are played in Safari; nothing is sent. One virtual Mac:
               readings wait for each other, the answer says how long. About 45 seconds each. Free when the virtual Mac is not running
               sheet <observation-id>... puts the pictures of a taborder (or of several observations) on one image
      record:  state save <name>, state list, replay <observation-id>, status
      status, find, state, tools and wait cost nothing of the budget; neither does a command that was given wrongly
`;

/**
 * The socket lives in the temporary directory, because the path of a Unix socket is limited
 * to about a hundred bytes and a run directory can be deeper than that. The run directory
 * holds a small file that says where it is.
 */
const pointerPath = (runDir: string): string => join(runDir, "session-daemon.json");
const socketPath = (runDir: string): string => join(tmpdir(), `loep-${sha256(realpathSync(runDir)).slice(0, 16)}.sock`);
const logPath = (runDir: string): string => join(tmpdir(), `loep-${sha256(realpathSync(runDir)).slice(0, 16)}.log`);

function send(socket: string, request: Request): Promise<Response> {
  return new Promise((resolve, reject) => {
    const connection = connect(socket);
    let received = "";
    connection.on("connect", () => connection.write(`${JSON.stringify(request)}\n`));
    connection.on("data", (chunk) => (received += chunk.toString("utf8")));
    connection.on("end", () => {
      try {
        resolve(JSON.parse(received) as Response);
      } catch {
        reject(new Error("de sessie gaf geen leesbaar antwoord"));
      }
    });
    connection.on("error", reject);
  });
}

function runningSocket(runDir: string): string | null {
  if (!existsSync(pointerPath(runDir))) return null;
  try {
    return (JSON.parse(readFileSync(pointerPath(runDir), "utf8")) as { socket: string }).socket;
  } catch {
    return null;
  }
}

const alive = (socket: string): Promise<boolean> => send(socket, { op: "list" }).then(() => true, () => false);

interface ServeOptions {
  scopeUrl?: string | undefined;
  allowHosts?: string[];
  strict?: boolean;
  maxSessions?: number | undefined;
  navigationDelayMs?: number | undefined;
  commandTimeoutMs?: number | undefined;
  idleTimeoutMs?: number | undefined;
  secondBrowsers?: boolean | undefined;
}

/** The long-running process: holds the browser and answers one request per connection until it is stopped or left idle. */
export async function serve(runDir: string, options: ServeOptions): Promise<void> {
  mkdirSync(runDir, { recursive: true });
  const socket = socketPath(runDir);
  if (existsSync(socket)) {
    if (await alive(socket)) return;
    rmSync(socket, { force: true });
  }
  // A run for which a person logged in: every session starts with it, and a new login is picked up without a restart.
  setRunLogin(runDir);
  const scope = await scopeForRun(runDir, options);
  const limits = Object.fromEntries(Object.entries({ maxSessions: options.maxSessions, navigationDelayMs: options.navigationDelayMs, commandTimeoutMs: options.commandTimeoutMs, idleTimeoutMs: options.idleTimeoutMs, secondBrowsers: options.secondBrowsers }).filter(([, value]) => value !== undefined));
  // Everything a session can do is loaded here, once, when the process starts.
  const { Daemon } = await import("./daemon.ts");
  const daemon = await Daemon.create(runDir, scope, limits);
  let closing = false;
  let server: Server;
  const shutdown = async (): Promise<void> => {
    if (closing) return;
    closing = true;
    clearInterval(idle);
    server.close();
    await daemon.close();
    rmSync(socket, { force: true });
    // The log is for a process that died; one that stops in an orderly way leaves nothing behind.
    rmSync(logPath(runDir), { force: true });
    rmSync(pointerPath(runDir), { force: true });
    process.exit(0);
  };
  server = createServer((connection) => {
    let received = "";
    connection.on("error", () => undefined);
    connection.on("data", (chunk) => {
      received += chunk.toString("utf8");
      if (!received.includes("\n")) return;
      const line = received.slice(0, received.indexOf("\n"));
      received = "";
      void (async () => {
        let response: Response;
        try {
          response = await daemon.handle(JSON.parse(line) as Request);
        } catch (error) {
          response = { ok: false, print: { error: (error as Error).message.split("\n")[0] } };
        }
        connection.end(`${JSON.stringify(response)}\n`, () => {
          // The last session is gone: nothing left to hold a browser for.
          if (daemon.sessionCount === 0 && (JSON.parse(line) as Request).op === "stop") void shutdown();
        });
      })();
    });
  });
  const idle = setInterval(() => {
    if (Date.now() - daemon.lastCommandAt > daemon.limits.idleTimeoutMs) void shutdown();
  }, 30_000);
  // Work that was cut off by a time limit may still fail later; that must not take the other sessions down.
  process.on("unhandledRejection", (reason) => process.stderr.write(`${new Date().toISOString()} ${String(reason).split("\n")[0]}\n`));
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(socket, resolve));
  writeFileSync(pointerPath(runDir), `${JSON.stringify({ pid: process.pid, socket, log: logPath(runDir), startedAt: new Date().toISOString() }, null, 2)}\n`);
}

/** Make sure the process for this run is up, starting it in the background when it is not. */
async function ensureDaemon(runDir: string, forwarded: string[]): Promise<string> {
  mkdirSync(runDir, { recursive: true });
  const known = runningSocket(runDir);
  if (known && (await alive(known))) return known;
  const log = logPath(runDir);
  const output = openSync(log, "w");
  const child = spawn(process.execPath, [fileURLToPath(new URL("../cli.ts", import.meta.url)), "session", "serve", "--run", runDir, ...forwarded], { detached: true, stdio: ["ignore", output, output] });
  let exited: number | null = null;
  child.on("exit", (code) => (exited = code ?? 1));
  child.unref();
  const socket = socketPath(runDir);
  for (let attempt = 0; attempt < 150; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (existsSync(socket) && (await alive(socket))) return socket;
    if (exited !== null && exited !== 0) break;
  }
  const reason = readFileSync(log, "utf8").trim().split("\n").at(-1) ?? "";
  throw new Error(`de sessie kon niet starten${reason ? `: ${reason.replace(/^loep: /, "")}` : ""} (log: ${log})`);
}

const DAEMON_OPTIONS = ["scope", "allow-host", "strict", "max-sessions", "nav-delay", "command-timeout", "idle-minutes", "single-browser"];
const CLIENT_ONLY = new Set(["run", "session", "max-commands", "max-minutes", "model", "reason", ...DAEMON_OPTIONS]);

/**
 * The words after `session` that manage a session instead of being a command in one. No command
 * in a session may carry one of these names, or `session <word>` would mean two things.
 */
export const SESSION_MANAGEMENT = ["start", "stop", "list", "extend", "serve"] as const;

/** Entry point for `session ...`: managing a session, or one command in it. Returns the exit code. */
export async function sessionCli(argv: string[]): Promise<number> {
  // A scroll distance such as -400 is an argument, not a set of flags.
  const SIGNED = "\u0000";
  const { positionals, values } = parseArgs({
    args: argv.map((token) => (/^-\d+$/.test(token) ? `${SIGNED}${token}` : token)),
    allowPositionals: true,
    options: {
      run: { type: "string" },
      session: { type: "string" },
      scope: { type: "string" },
      "allow-host": { type: "string", multiple: true },
      strict: { type: "boolean" },
      "max-commands": { type: "string" },
      "max-minutes": { type: "string" },
      model: { type: "string" },
      reason: { type: "string" },
      "max-sessions": { type: "string" },
      "nav-delay": { type: "string" },
      "command-timeout": { type: "string" },
      "idle-minutes": { type: "string" },
      "single-browser": { type: "boolean" },
      width: { type: "string" },
      height: { type: "string" },
      scheme: { type: "string" },
      state: { type: "string" },
      "with-blockers": { type: "boolean" },
      from: { type: "string" },
      max: { type: "string" },
      margin: { type: "string" },
      at: { type: "string" },
      full: { type: "boolean" },
      shift: { type: "boolean" },
      criterion: { type: "string" },
      seconds: { type: "string" },
      timeout: { type: "string" },
      wait: { type: "boolean" },
      listen: { type: "boolean" },
      plain: { type: "boolean" },
      hold: { type: "boolean" },
      keep: { type: "boolean" },
      abort: { type: "boolean" },
      vision: { type: "string" },
      "more-contrast": { type: "boolean" },
      against: { type: "string" },
      page: { type: "string" },
      tags: { type: "boolean" },
      // speak: --steps n, --click, --type <kind> [--submit]
      steps: { type: "string" },
      // voiceover: --press "<name> <role>", --no-popup, --no-mailto
      press: { type: "string" },
      "no-popup": { type: "boolean" },
      "no-mailto": { type: "boolean" },
      click: { type: "boolean" },
      type: { type: "string" },
      submit: { type: "boolean" },
    },
  });
  const [group, command, ...rest] = positionals.map((token) => (token.startsWith(SIGNED) ? token.slice(1) : token));
  const run = values.run ?? process.env.LOEP_RUN;
  const session = values.session ?? process.env.LOEP_SESSION ?? "main";
  const print = (response: Response): number => {
    process.stdout.write(`${JSON.stringify(response.print)}\n`);
    return response.ok ? 0 : 1;
  };
  const fail = (message: string): number => print({ ok: false, print: { error: message } });
  if (!run) return fail("geef de run op met --run <map> of de omgevingsvariabele LOEP_RUN");
  const number = (name: string): number | undefined => (values[name as "max"] === undefined ? undefined : Number(values[name as "max"]));

  try {
    if (group === "session" && command === "serve") {
      await serve(run, {
        scopeUrl: values.scope,
        allowHosts: values["allow-host"] ?? [],
        strict: values.strict ?? false,
        maxSessions: number("max-sessions"),
        navigationDelayMs: number("nav-delay"),
        commandTimeoutMs: number("command-timeout") === undefined ? undefined : number("command-timeout")! * 1000,
        idleTimeoutMs: number("idle-minutes") === undefined ? undefined : number("idle-minutes")! * 60_000,
        secondBrowsers: values["single-browser"] ? false : undefined,
      });
      return 0;
    }
    if (group === "session" && command === "start") {
      const forwarded = DAEMON_OPTIONS.flatMap((name) => {
        const value = values[name as "scope"] as string | string[] | boolean | undefined;
        if (value === undefined || value === false) return [];
        if (value === true) return [`--${name}`];
        return (Array.isArray(value) ? value : [value]).flatMap((entry) => [`--${name}`, entry]);
      });
      const socket = await ensureDaemon(run, forwarded);
      return print(await send(socket, { op: "start", session, ...(values.model !== undefined ? { model: values.model } : {}), ...(number("max-sessions") !== undefined ? { maxSessions: number("max-sessions")! } : {}), limits: { ...(number("max-commands") !== undefined ? { maxCommands: number("max-commands")! } : {}), ...(number("max-minutes") !== undefined ? { maxMinutes: number("max-minutes")! } : {}) } }));
    }
    if (group === "session" && command === "dossier") {
      // The dossier is a file of the run: reading it needs no browser and is no measurement.
      if (!/^[a-z0-9][a-z0-9_-]{0,30}$/.test(session)) return fail(`"${session}" is geen geldige sessienaam (kleine letters, cijfers, - en _)`);
      if (values.criterion !== undefined && !/^\d\.\d\.\d{1,2}$/.test(values.criterion)) return fail(`--criterion verwacht het nummer van een succescriterium, zoals 1.1.1, niet "${values.criterion}"`);
      const { dossierAnswer, recordDossierRead } = await import("./dossier-command.ts");
      const answer = await dossierAnswer(run, session, rest, values.criterion);
      recordDossierRead(run, session, answer.result);
      process.stdout.write(`${JSON.stringify(answer.print)}\n${answer.text}\n`);
      return 0;
    }
    const socket = runningSocket(run);
    if (!socket || !(await alive(socket))) return fail(`er loopt geen sessie voor deze run; start er een met: session start --run ${run}`);
    if (group === "session" && command === "stop") return print(await send(socket, { op: "stop", ...(values.session ? { session: values.session } : {}) }));
    if (group === "session" && command === "list") return print(await send(socket, { op: "list" }));
    if (group === "session" && command === "extend") return print(await send(socket, { op: "extend", session, ...(values.reason !== undefined ? { reason: values.reason } : {}) }));
    if (group !== "session" || !command) return fail("gebruik: session start|stop|list|extend, of session <commando>");
    const options = Object.fromEntries(Object.entries(values).filter(([name, value]) => !CLIENT_ONLY.has(name) && value !== undefined)) as Record<string, string | boolean>;
    return print(await send(socket, { op: "command", session, command, args: rest, options }));
  } catch (error) {
    return fail((error as Error).message.split("\n")[0]!);
  }
}
