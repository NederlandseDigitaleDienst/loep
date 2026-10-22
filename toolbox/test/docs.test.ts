import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { EXPLORE_MAX_COMMANDS, EXPLORE_MAX_MINUTES } from "../src/commands/explore.ts";
import { MAX_RESWEEPS, MAX_RETURNS_TO_EXPLORER, SHEETS_PER_TASK } from "../src/commands/gate.ts";
import { briefPending, BUDGETS, INSTRUMENT_FLOW, loadInstrumentIndex, PHASES, pointsToFinish, recordAttempts, skip, skipKindOf, skipped, skippedForOutage, TASK_FILES, unskip } from "../src/commands/instrument-tasks.ts";
import { CEILINGS, EXTENSION, MEASURED_USE, REFERENCE_SITE_SIZE, WALK_STATES } from "../src/lib/budget.ts";
import { FINISH_FACTOR, LOOK_COMMANDS, MEASURE_COMMANDS, SESSION_COMMANDS } from "../src/lib/verdict.ts";
import { SESSION_MANAGEMENT } from "../src/session/client.ts";
import { DEFAULT_DAEMON_LIMITS } from "../src/session/safety.ts";

// The descriptions drifted away from the code once. This test guards the part a script can
// see: the commands and tasks a description names exist, every command is described, every
// link and path leads somewhere, and every document under docs/ says what kind it is. It
// reads names and paths only, so rewording a sentence does not break it.
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

const DOCS = readdirSync(join(ROOT, "docs")).filter((file) => file.endsWith(".md")).map((file) => `docs/${file}`);
const SENT_BY_A_PERSON: string[] = [];
const SKILLS =readdirSync(join(ROOT, "skills")).map((name) => `skills/${name}/SKILL.md`);
/** The texts that describe what the code does now. */
const DESCRIPTIONS = ["README.md", "CONTRIBUTING.md", "PLAN.md", ...DOCS, "procedures/README.md", "validatie/README.md", "toolbox/fixtures/README.md", "voorbeelden/LEESMIJ.md", ...SKILLS];
/** The logs of the measurements: dated, so a path in them may be one that has gone since. Their links still have to work. */
const LOGS = ["validatie/iteraties.md", "validatie/lessen.md"];
/** The two texts that together have to name every command. */
const COMMAND_REFERENCE = ["README.md", "docs/methode.md"];

/** The commands of the toolbox: every case of the switch in cli.ts, and the one that is handled before it. */
function cliCommands(source: string): string[] {
  const cases = [...source.matchAll(/^\s+case "([a-z-]+)":/gm)].map((match) => match[1]!);
  return [...new Set([...cases, "session"])];
}

/** The words that can follow `session`: the three that manage a session, and every command in one. `serve` is how the process starts itself and is no command for a reader. */
const AFTER_SESSION = [...SESSION_MANAGEMENT.filter((word) => word !== "serve"), ...SESSION_COMMANDS];
/** The texts an agent works from: the tasks, the skills and the procedures. They call the toolbox too. */
const TEMPLATES = readdirSync(join(ROOT, "templates")).filter((file) => file.endsWith(".md")).map((file) => `templates/${file}`);
const PROCEDURES = readdirSync(join(ROOT, "procedures")).filter((file) => file.endsWith(".md")).map((file) => `procedures/${file}`);

/**
 * What is wrong with the calls of the toolbox in one piece of code. The toolbox is called as
 * `cli.ts`, as the variable LOEP of a skill, as `{{cli}}` in a task, or as `loep` at the start
 * of a line: the installed name, or the shell function of an agent that stands for `session`.
 */
function wrongCalls(code: string): string[] {
  const problems: string[] = [];
  for (const match of code.matchAll(/(?:\bLOEP|cli\.ts|\{\{cli\}\}) ([a-z][a-z-]*)/g)) if (!COMMANDS.includes(match[1]!)) problems.push(`"${match[0]}" is geen commando van de toolbox`);
  // A command in a session is `session <command>`; the word after `session` has to be one that exists.
  for (const match of code.matchAll(/(?:\bLOEP|cli\.ts|\{\{cli\}\}|^\s*loep) session ([a-z][a-z-]*)/gm)) if (!AFTER_SESSION.includes(match[1]!)) problems.push(`"${match[0].trim()}" is geen commando in een sessie en niet start, stop of list`);
  // Written small and at the start of a line it is a command in a session; elsewhere "loep" is the name of the toolbox in a sentence.
  for (const match of code.matchAll(/^\s*loep ([a-z][a-z-]*)/gm)) if (match[1] !== "session" && !SESSION_COMMANDS.includes(match[1]!)) problems.push(`"${match[0].trim()}" is geen commando in een sessie`);
  return problems;
}

/** The tasks of the justfile: every line that starts a recipe. */
function justTasks(source: string): string[] {
  return [...source.matchAll(/^([a-z][a-z-]*)(?: [^:\n]*)?:(?!=)/gm)].map((match) => match[1]!);
}

/** Everything written as code: fenced blocks and spans between backticks. */
function codeOf(text: string): string[] {
  const blocks = [...text.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].map((match) => match[1]!);
  const spans = [...text.replace(/^```[^\n]*\n[\s\S]*?^```/gm, "").matchAll(/`([^`\n]+)`/g)].map((match) => match[1]!);
  return [...blocks, ...spans];
}

/** The part of a text under one heading of the second level. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`## ${heading}\n`);
  assert.notEqual(start, -1, `de sectie "${heading}" ontbreekt`);
  const rest = text.slice(start + heading.length + 4);
  const end = rest.search(/^## /m);
  return end === -1 ? rest : rest.slice(0, end);
}

const COMMANDS = cliCommands(read("toolbox/src/cli.ts"));
const TASKS = justTasks(read("justfile"));

test("the reading of cli.ts and the justfile finds the commands and the tasks", () => {
  for (const command of ["inventory", "check-site", "documents", "diff", "verify", "session"]) assert.ok(COMMANDS.includes(command), `commando ${command} niet gevonden in cli.ts`);
  for (const task of ["install", "sweep", "report", "testsite-build"]) assert.ok(TASKS.includes(task), `taak ${task} niet gevonden in de justfile`);
  assert.ok(!TASKS.includes("toolbox"), "een variabele van de justfile is als taak gelezen");
  assert.deepEqual(justTasks("a := 1\nrun x *flags:\n    echo\n\nb-c:\n"), ["run", "b-c"]);
  assert.deepEqual(codeOf("tekst `een` en\n```\njust twee\n```\n`drie`"), ["just twee\n", "een", "drie"]);
});

test("a command in a session is session <command>, and no such command is called like the words that manage a session", () => {
  // `session start` starts a session; a command `start` in a session would make that mean two things.
  assert.deepEqual(SESSION_COMMANDS.filter((command) => (SESSION_MANAGEMENT as readonly string[]).includes(command)), []);
  assert.ok(!COMMANDS.includes("loep"), "loep is de naam van de toolbox en geen commando ervan");
  // The old form is gone, and the reading of calls sees it, in each way the toolbox is called.
  for (const old of ["node toolbox/src/cli.ts loep look", "LOEP loep open P01", "node {{cli}} loep <commando>", "loep loep look"]) assert.equal(wrongCalls(old).length, 1, old);
  for (const wrong of ["LOEP session klik 1", "loep session serve", "node {{cli}} session begin", "loep inventory", "  loep klik 3"]) assert.equal(wrongCalls(wrong).length, 1, wrong);
  for (const right of ["LOEP session open P01", "loep session look", "loep session contrast 3", "node {{cli}} session start --run x", "LOEP session list --run RUN", "loep contrast 3", 'loep() { node {{cli}} session "$@" --run x; }', "LOEP inventory <url>"]) assert.deepEqual(wrongCalls(right), [], right);
});

test("every task and every command a description calls exists", () => {
  const problems: string[] = [];
  for (const file of DESCRIPTIONS) {
    for (const code of codeOf(read(file))) {
      for (const match of code.matchAll(/\bjust ([a-z][a-z-]*)/g)) if (!TASKS.includes(match[1]!)) problems.push(`${file}: "just ${match[1]}" is geen taak van de justfile`);
      for (const problem of wrongCalls(code)) problems.push(`${file}: ${problem}`);
    }
  }
  assert.deepEqual(problems, []);
});

test("the tasks and the procedures an agent works from call the toolbox by commands that exist", () => {
  const problems: string[] = [];
  for (const file of [...TEMPLATES, ...PROCEDURES]) for (const code of codeOf(read(file))) for (const problem of wrongCalls(code)) problems.push(`${file}: ${problem}`);
  assert.deepEqual(problems, []);
  // The shell function an agent types its commands with stands for `session`, and the explorer is told the same form.
  assert.match(read("templates/gereedschap.md"), /^loep\(\) \{ node \{\{cli\}\} session "\$@" /m);
  assert.match(read("templates/verken.md"), /`node \{\{cli\}\} session <commando> /);
});

test("where the README and the method list the steps, every name written as code is a command", () => {
  // In these two sections a lowercase word between backticks stands for a command. Anything else there
  // (a file name, a flag, a label) has a dot, a dash in front, a capital or a space, and is left alone.
  const problems: string[] = [];
  for (const [file, heading] of [["README.md", "Hoe het werkt"], ["docs/methode.md", "De keten"], ["docs/architectuur.md", "2. De keten"]] as const) {
    for (const code of codeOf(section(read(file), heading))) {
      const word = /^([a-z][a-z-]*)(?: --[a-z-]+)*$/.exec(code.trim())?.[1];
      if (word && !COMMANDS.includes(word)) problems.push(`${file}, sectie "${heading}": \`${code}\` is geen commando van de toolbox; bestaat het niet meer, haal het weg, en is het iets anders, schrijf het dan zonder code-opmaak`);
    }
  }
  assert.deepEqual(problems, []);
});

test("every command of the toolbox is named in the README or in the method", () => {
  const named = new Set(COMMAND_REFERENCE.flatMap((file) => codeOf(read(file))).flatMap((code) => code.split(/[\s,]+/)));
  const missing = COMMANDS.filter((command) => !named.has(command));
  assert.deepEqual(missing, [], `deze commando's staan in cli.ts en in geen van ${COMMAND_REFERENCE.join(" en ")}`);
});

test("every link to a file leads to a file that is there", () => {
  const problems: string[] = [];
  for (const file of [...DESCRIPTIONS, ...LOGS, "toolbox/THIRD-PARTY.md"]) {
    for (const match of read(file).matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1]!.split("#")[0]!;
      if (target === "" || /^[a-z]+:/.test(target)) continue;
      if (!existsSync(join(ROOT, dirname(file), target))) problems.push(`${file}: de link naar ${match[1]} komt nergens uit`);
    }
  }
  assert.deepEqual(problems, []);
});

test("every path of the repository a description names exists", () => {
  // A path written as code that starts in a directory of the repository. One with a placeholder or a pattern in it is not a path.
  const top = ["docs", "procedures", "skills", "templates", "toolbox", "validatie", "voorbeelden", ".github"];
  const problems: string[] = [];
  for (const file of DESCRIPTIONS) {
    for (const code of codeOf(read(file))) {
      for (const word of code.split(/\s+/)) {
        const path = word.replace(/[.,;:)]+$/, "").replace(/^\(/, "");
        if (!top.some((dir) => path.startsWith(`${dir}/`)) || /[<>*{}$]/.test(path)) continue;
        if (!existsSync(join(ROOT, normalize(path)))) problems.push(`${file}: ${path} bestaat niet`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("every document under docs says what kind it is and stands in the index", () => {
  const index = read("docs/README.md");
  for (const file of DOCS) {
    const lines = read(file).split("\n");
    assert.match(lines[0]!, /^# /, `${file} begint niet met een titel`);
    // A draft a person sends is theirs to word: the index says what it is.
    if (!SENT_BY_A_PERSON.includes(file)) assert.match(lines[2] ?? "", /^Soort: /, `${file} zegt onder de titel niet wat het is (een regel die begint met "Soort: ")`);
    if (file !== "docs/README.md") assert.ok(index.includes(`](${file.slice("docs/".length)})`), `${file} staat niet in docs/README.md`);
  }
});

test("the architecture names every directory of the code and every step of the chain, and its budgets are those of the code", () => {
  const text = read("docs/architectuur.md");
  // A new layer of the code gets a place in the description.
  for (const entry of readdirSync(join(ROOT, "toolbox/src"), { withFileTypes: true })) if (entry.isDirectory()) assert.ok(text.includes(`toolbox/src/${entry.name}/`), `docs/architectuur.md noemt de map toolbox/src/${entry.name}/ niet`);
  // The chain is drawn and described with the commands that carry it.
  const chain = section(text, "2. De keten");
  const inChain = new Set(codeOf(chain).flatMap((code) => code.split(/[^a-z-]+/)));
  for (const command of ["inventory", "sample", "explore", "check-site", "collect", "contrast", "states", "documents", "gate", "check-gate", "tasks", "pending", "check-walk", "check-verdict", "answer", "evaluate", "render", "diff", "statement", "sign", "seal", "verify"]) {
    assert.ok(COMMANDS.includes(command), `${command} is geen commando meer; haal het uit deze test en uit de keten`);
    assert.ok(inChain.has(command), `docs/architectuur.md, sectie "2. De keten": het commando ${command} ontbreekt`);
  }
  // Every diagram is one GitHub draws: a fenced block that starts with a kind of diagram it knows.
  const diagrams = [...text.matchAll(/^```mermaid\n(\S+)/gm)].map((match) => match[1]!);
  assert.deepEqual(diagrams, ["flowchart", "flowchart", "sequenceDiagram"]);
  // The table of roles gives the budgets as the code hands them out.
  const row = (role: string): string => {
    const found = section(text, "3. Wie wat mag").split("\n").find((line) => line.startsWith(`| ${role} |`));
    assert.ok(found, `docs/architectuur.md: de tabel van rollen heeft geen rij "${role}"`);
    return found;
  };
  const budget = (commands: number, minutes: number): RegExp => new RegExp(`\\b${commands} commando's.*\\b${minutes} minuten`);
  assert.match(row("Verkenner"), budget(EXPLORE_MAX_COMMANDS, EXPLORE_MAX_MINUTES));
  assert.match(row("Rondgang"), budget(BUDGETS.walk.commands, BUDGETS.walk.minutes));
  assert.match(row("Beoordelaar"), budget(BUDGETS.judge.commands, BUDGETS.judge.minutes));
  const verify = BUDGETS.verify;
  assert.match(row("Verifieerder"), new RegExp(`\\b${verify.base} commando's, plus ${verify.perFinding} per bevinding, ${verify.perDismissedCandidate} per weggezette kandidaat en ${verify.afterPass} als.*\\b${verify.minutes} minuten`));
  // The finishing round: the budget of a judge times one factor, named the same in the architecture, the method and the skill.
  assert.match(row("Afmaakagent"), budget(BUDGETS.finish.commands, BUDGETS.finish.minutes));
  const factor = String(FINISH_FACTOR).replace(".", ",");
  assert.ok(row("Afmaakagent").includes(`maal ${factor}`), `docs/architectuur.md: de afmaakagent krijgt het budget van een beoordelaar maal ${factor}`);
  for (const file of ["docs/methode.md", "skills/nldd-a11y-audit/SKILL.md"]) assert.ok(read(file).includes(`${BUDGETS.finish.commands} commando's en ${BUDGETS.finish.minutes} minuten`), `${file} noemt het budget van de afmaakronde niet zoals de code het geeft`);
  assert.ok(read("docs/methode.md").includes(`maal ${factor}`), `docs/methode.md noemt de factor ${factor} van de afmaakronde niet`);
  // The fixed budget is the floor of a computed one: the ceilings and the numbers of the formula are those of the code.
  for (const [role, heading] of [["walk", "Rondgang"], ["judge", "Beoordelaar"], ["verify", "Verifieerder"], ["finish", "Afmaakagent"]] as const) {
    assert.ok(row(heading).includes(`hooguit ${CEILINGS[role].commands} en ${CEILINGS[role].minutes}`), `docs/architectuur.md: de bovengrens van de rij "${heading}" is niet die van de code`);
    assert.ok(read("docs/methode.md").includes(`| ${CEILINGS[role].commands} commando's, ${CEILINGS[role].minutes} minuten |`), `docs/methode.md noemt de bovengrens van ${heading} niet zoals de code hem geeft`);
  }
  const method = read("docs/methode.md");
  assert.ok(method.includes(`${WALK_STATES.perState} commando's voor elke toestand boven de vier`) && WALK_STATES.included === 4);
  assert.ok(method.includes(`gedeeld door ${REFERENCE_SITE_SIZE}`));
  assert.deepEqual([EXTENSION.share, EXTENSION.max, EXTENSION.warnAt], [0.5, 2, 0.8], "de methode, de sjablonen en de skill zeggen: de helft erbij, hooguit twee keer, vanaf 80 procent");
  // The judges that were at their limit in every measured run, as the method names them.
  const always = Object.entries(MEASURED_USE).filter(([, use]) => use.judge[0] === use.judge[1]).map(([id]) => id);
  assert.ok(method.includes(`bij ${always.slice(0, -1).join(", ")} en ${always.at(-1)}.`), `docs/methode.md noemt niet deze criteria als altijd tegen de grens: ${always.join(", ")}`);
  assert.equal(SHEETS_PER_TASK, 8, "docs/architectuur.md zegt: hooguit acht bladen per opdracht");
  assert.equal(MAX_RETURNS_TO_EXPLORER, 2, "docs/architectuur.md zegt: dat mag twee keer");
  assert.equal(MAX_RESWEEPS, 2, "docs/methode.md, docs/architectuur.md en de skill zeggen: na de verkenning hooguit twee keer opnieuw vegen");
});

test("the list of look and measure commands in procedures/README.md is the list of the code", () => {
  const line = read("procedures/README.md").split("\n").find((entry) => entry.startsWith("- `pass_observations`"));
  assert.ok(line, "procedures/README.md beschrijft pass_observations niet");
  const named = [...line.matchAll(/`([a-z]+)`/g)].map((match) => match[1]!).filter((name) => name !== "pass_observations");
  assert.deepEqual([...named].sort(), [...LOOK_COMMANDS, ...MEASURE_COMMANDS].sort());
});

test("the workflow starts no more agents at a time than the session process has room for, and the skill gives the same numbers", () => {
  // Every agent holds a session; one place is the session of whoever leads the audit and keeps the process up.
  const max = DEFAULT_DAEMON_LIMITS.maxSessions;
  const workflow = read("skills/nldd-a11y-audit/onderzoek.workflow.js");
  const atOnce = /^const AT_ONCE = atOnce \|\| (\d+)$/m.exec(workflow);
  assert.ok(atOnce, "onderzoek.workflow.js: de standaard van atOnce staat niet meer op de regel waar deze test hem leest");
  assert.equal(Number(atOnce[1]), max - 1, `de werkstroom start standaard ${atOnce[1]} agents tegelijk, het sessieproces laat standaard ${max} sessies toe: dat moet het maximum min één zijn`);
  const skill = read("skills/nldd-a11y-audit/SKILL.md");
  assert.ok(skill.includes(`session start --run RUN --session regie --max-sessions ${max}`), `de skill start het sessieproces niet met --max-sessions ${max}`);
  assert.ok(skill.includes(`\`atOnce: ${max - 1}\` bij \`--max-sessions ${max}\``), `de skill geeft de werkstroom niet atOnce ${max - 1} bij --max-sessions ${max}`);
});

type WorkflowPhase = (typeof PHASES)[number];
/** What the toolbox answers in one round: the phase and the ids that are open in it. A task that was skipped drops out by itself. */
interface WorkflowState {
  phase: string;
  walks?: string[];
  judges?: string[];
  verifiers?: string[];
  finishers?: string[];
}

/** The part of a run the workflow writes through the toolbox: the attempts it records with `tasks --attempted`, and what it skips. It outlives one run of the workflow. */
interface FakeToolbox {
  attempts: Record<string, number>;
  skips: string[];
}

/** The path the toolbox writes the task file of a phase to, in the run "RUN" the tests give the workflow. */
const taskOf = (phase: WorkflowPhase, id: string): string => `RUN/${TASK_FILES[phase](id)}`;
const QUOTA = "Rate limit reached: you have used your weekly limit";

interface WorkflowResult {
  history: { round: number; phase: string; tasks?: number; note?: string }[];
  skipped: string[];
  last: string | null;
  paused: string | null;
  models: Record<string, string | null>;
}

/**
 * Run the workflow script as its host does: as the body of an async function that is given `args`,
 * `agent`, `parallel` and `log`. `states` is what the toolbox answers round after round; `seconds`
 * says how long the agent of a task works and `fails` which tasks come back without a valid result
 * (still open next round). `trouble` says which calls end in an error of the model: "throw" for an
 * exception, "null" for what the host gives when an agent died on such an error; the stand is "stand".
 */
async function runWorkflow(atOnce: number | undefined, states: WorkflowState[], seconds: (task: string) => number = () => 0.002, models?: unknown, extra: { toolbox?: FakeToolbox; trouble?: (what: string, call: number) => "throw" | "null" | undefined } = {}) {
  const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (...names: string[]) => (...values: unknown[]) => Promise<WorkflowResult>;
  const script = new AsyncFunction("args", "agent", "parallel", "log", read("skills/nldd-a11y-audit/onderzoek.workflow.js").replace(/^export const meta/m, "const meta"));
  const toolbox = extra.toolbox ?? { attempts: {}, skips: [] };
  const events: { task: string; what: "start" | "end" }[] = [];
  const stands: string[] = [];
  const logs: string[] = [];
  let running = 0;
  let most = 0;
  let round = 0;
  let calls = 0;
  const asked: { phase: string; model?: string }[] = [];
  const agent = async (prompt: string, options: { phase: string; model?: string }): Promise<unknown> => {
    asked.push(options);
    calls++;
    if (options.phase === "Stand") {
      stands.push(prompt);
      const trouble = extra.trouble?.("stand", calls);
      if (trouble === "throw") throw new Error(QUOTA);
      if (trouble === "null") return null;
      // The toolbox as the commands of the stand change it: a skip, and the attempts of the agents that came back.
      for (const match of prompt.matchAll(/ skip --run RUN (--page-type (\S+)|--criterion (\S+)(?: --round (final|finish))?) --kind "geen geldig resultaat"/g)) {
        toolbox.skips.push(match[2] ? `walks:${match[2]}` : `${match[4] === "final" ? "verifiers" : match[4] === "finish" ? "finishers" : "judges"}:${match[3]}`);
      }
      for (const key of /tasks --run RUN --attempted (\S+)/.exec(prompt)?.[1]?.split(",") ?? []) toolbox.attempts[key] = (toolbox.attempts[key] ?? 0) + 1;
      const state = states[round++] ?? { phase: "done" };
      const open = (phase: WorkflowPhase) => (state[phase] ?? []).filter((id) => !toolbox.skips.includes(`${phase}:${id}`)).map((id) => ({ id, attempts: toolbox.attempts[`${phase}:${id}`] ?? 0 }));
      return { phase: state.phase, walks: open("walks"), judges: open("judges"), verifiers: open("verifiers"), finishers: open("finishers") };
    }
    const task = /Lees het bestand (\S+)/.exec(prompt)![1]!;
    events.push({ task, what: "start" });
    most = Math.max(most, ++running);
    await new Promise((done) => setTimeout(done, seconds(task) * 1000));
    running--;
    events.push({ task, what: "end" });
    const trouble = extra.trouble?.(task, calls);
    if (trouble === "throw") throw new Error(QUOTA);
    if (trouble === "null") return null;
    return "klaar";
  };
  const parallel = (thunks: (() => Promise<unknown>)[]): Promise<unknown[]> => Promise.all(thunks.map((thunk) => thunk()));
  const result = await script({ cli: "CLI", run: "RUN", atOnce, models }, agent, parallel, (message: string) => logs.push(message));
  const position = (task: string, what: "start" | "end"): number => events.findIndex((event) => event.task === task && event.what === what);
  return { result, events, stands, logs, asked, most, toolbox, started: (task: string): number => events.filter((event) => event.task === task && event.what === "start").length, position };
}

test("the workflow keeps atOnce agents running: a new one starts as soon as one is done, never more at a time, and every task gets its turn", async () => {
  const walks = Array.from({ length: 7 }, (_, index) => `t${index}`);
  const judges = Array.from({ length: 10 }, (_, index) => `1.1.${index}`);
  const verifiers = judges.slice(0, 5);
  // The first agent of each phase is slow.
  const slow = (task: string): number => ([taskOf("walks", "t0"), taskOf("judges", "1.1.0"), taskOf("verifiers", "1.1.0")].includes(task) ? 0.15 : 0.002);
  const flow = await runWorkflow(3, [{ phase: "walks", walks }, { phase: "judges", judges }, { phase: "verifiers", verifiers }, { phase: "done" }], slow);
  assert.equal(flow.most, 3, "there are three agents at a time, and never more");
  for (const id of walks) assert.equal(flow.started(taskOf("walks", id)), 1, `walk ${id} is done once, from the task file the toolbox wrote`);
  for (const id of judges) assert.equal(flow.started(taskOf("judges", id)), 1, `judge ${id} is done once`);
  for (const id of verifiers) assert.equal(flow.started(taskOf("verifiers", id)), 1, `verifier ${id} is done once`);
  assert.deepEqual(flow.result.history.map((entry) => [entry.phase, entry.tasks ?? null]), [["walks", 7], ["judges", 10], ["verifiers", 5], ["done", null]]);
  // In groups the last task would wait for the slow agent of the first group. In a pool it starts while that one still runs.
  for (const [phase, first, last] of [["walks", "t0", "t6"], ["judges", "1.1.0", "1.1.9"], ["verifiers", "1.1.0", "1.1.4"]] as const) {
    assert.ok(flow.position(taskOf(phase, last), "end") < flow.position(taskOf(phase, first), "end"), `${phase} ${last} is klaar terwijl de trage ${first} nog loopt`);
  }
  // The phases stay apart: no judge starts before the last walk is done.
  assert.ok(flow.position(taskOf("walks", "t0"), "end") < flow.position(taskOf("judges", "1.1.0"), "start"));
  // The stand reads out ids only, and records the attempts of the agents that came back: the toolbox counts them.
  assert.match(flow.stands[0]!, /pending --run RUN --brief/);
  assert.match(flow.stands[1]!, /tasks --run RUN --attempted walks:t\d/);
  for (const id of walks) assert.equal(flow.toolbox.attempts[`walks:${id}`], 1);
  assert.deepEqual(flow.result.skipped, []);
  assert.equal(flow.result.paused, null);

  // Fewer tasks than places: no more agents than tasks. Without atOnce the default of the script holds.
  const small = await runWorkflow(8, [{ phase: "walks", walks: walks.slice(0, 2) }], () => 0.01);
  assert.equal(small.most, 2);
  const standard = await runWorkflow(undefined, [{ phase: "judges", judges }], () => 0.01);
  assert.equal(standard.most, DEFAULT_DAEMON_LIMITS.maxSessions - 1);
});

test("the workflow derives the path of every task file as the toolbox writes it", () => {
  const workflow = read("skills/nldd-a11y-audit/onderzoek.workflow.js");
  for (const phase of PHASES) {
    const line = new RegExp(`^  ${phase}: \\{ title: '[^']+', task: \\(id\\) => \`\\$\\{run\\}/([^\`]+)\``, "m").exec(workflow);
    assert.ok(line, `de werkstroom leidt het pad van de fase ${phase} niet af op de regel waar deze test het leest`);
    assert.equal(line[1]!.replace("${id}", "1.4.3"), TASK_FILES[phase]("1.4.3"), `de werkstroom en de toolbox noemen een ander pad voor de opdracht van ${phase}`);
  }
});

test("the workflow runs the finishing round as a fourth phase, and goes straight to done when the toolbox names none", async () => {
  const finishers = ["1.3.4", "1.4.13", "2.5.2"];
  const flow = await runWorkflow(2, [{ phase: "verifiers", verifiers: ["1.3.4", "1.4.4"] }, { phase: "finishers", finishers }, { phase: "done" }]);
  assert.deepEqual(flow.result.history.map((entry) => [entry.phase, entry.tasks ?? null]), [["verifiers", 2], ["finishers", 3], ["done", null]]);
  for (const id of finishers) assert.equal(flow.started(taskOf("finishers", id)), 1, `finisher ${id} is done once`);
  assert.equal(flow.most, 2, "the finishing round runs in the same pool");
  assert.ok(flow.position(taskOf("verifiers", "1.4.4"), "end") < flow.position(taskOf("finishers", "1.3.4"), "start"), "no finisher starts before the last verifier is done");
  assert.equal(flow.result.last, "done");
  // A finisher that gives no valid verdict twice is skipped like any other task, with its own round.
  const stuck = await runWorkflow(2, [{ phase: "finishers", finishers: ["1.3.4"] }, { phase: "finishers", finishers: ["1.3.4"] }, { phase: "finishers", finishers: ["1.3.4"] }, { phase: "done" }]);
  assert.equal(stuck.started(taskOf("finishers", "1.3.4")), 2);
  assert.deepEqual(stuck.result.skipped, ["finishers:1.3.4"]);
  assert.match(stuck.stands[3]!, /1\. node CLI skip --run RUN --criterion 1\.3\.4 --round finish --kind "geen geldig resultaat" --reason /);
  // No criterion was left open by the evaluation itself: the toolbox says done after the verifiers, and no agent of the round starts.
  const without = await runWorkflow(2, [{ phase: "verifiers", verifiers: ["1.3.4", "1.4.4"] }, { phase: "done" }]);
  assert.deepEqual(without.result.history.map((entry) => entry.phase), ["verifiers", "done"]);
  assert.equal(without.events.filter((event) => event.task.endsWith("/afmaak.md")).length, 0);
  // Every phase the toolbox can name is one the workflow knows.
  const workflow = read("skills/nldd-a11y-audit/onderzoek.workflow.js");
  for (const phase of PHASES) assert.match(workflow, new RegExp(`^  ${phase}: \\{ title: `, "m"), `de werkstroom kent de fase ${phase} niet`);
});

test("the workflow tries a task twice and then has it skipped, as before the pool", async () => {
  const flow = await runWorkflow(3, [{ phase: "walks", walks: ["zoek", "start"] }, { phase: "walks", walks: ["zoek"] }, { phase: "walks", walks: ["zoek"] }, { phase: "done" }]);
  assert.equal(flow.started(taskOf("walks", "zoek")), 2, "two attempts, not a third");
  assert.equal(flow.started(taskOf("walks", "start")), 1);
  assert.deepEqual(flow.result.skipped, ["walks:zoek"]);
  assert.deepEqual(flow.toolbox.attempts, { "walks:zoek": 2, "walks:start": 1 }, "the run holds the attempts");
  assert.ok(!flow.stands[2]!.includes(" skip "), "the round that finds it open for the third time does not skip yet");
  assert.match(flow.stands[3]!, /1\. node CLI skip --run RUN --page-type zoek --kind "geen geldig resultaat" --reason /, "the next round begins with the skip");
  assert.equal(flow.result.last, "done");
});

test("a limit or a failure of the model pauses the workflow: it skips nothing and counts no attempt", async () => {
  // Every call fails with a quota error, the stand included: the workflow stops at once, and nothing is skipped.
  const quota = await runWorkflow(3, [{ phase: "walks", walks: ["zoek"] }], undefined, undefined, { trouble: () => "throw" });
  assert.equal(quota.asked.length, 1, "after the stand fails, no agent starts");
  assert.match(quota.result.paused!, /^storing van het model, run gepauzeerd; start de werkstroom opnieuw om verder te gaan/);
  assert.ok(quota.logs.some((line) => line.startsWith("storing van het model, run gepauzeerd")), "the workflow says so");
  assert.equal(quota.result.last, "storing");
  assert.deepEqual(quota.result.skipped, []);
  assert.deepEqual(quota.toolbox.skips, []);

  // The stand answers, and every agent of a phase fails with a quota error: three in a row stop the round, round after round nothing is skipped.
  const walks = Array.from({ length: 7 }, (_, index) => `t${index}`);
  const states = Array.from({ length: 6 }, (): WorkflowState => ({ phase: "walks", walks }));
  const agents = await runWorkflow(1, states, undefined, undefined, { trouble: (what) => (what === "stand" ? undefined : "throw") });
  assert.equal(agents.events.filter((event) => event.what === "start").length, 3, "after three errors in a row no new agent starts");
  assert.match(agents.result.paused!, /run gepauzeerd/);
  assert.equal(agents.stands.length, 1, "no new round after the pause");
  assert.deepEqual(agents.toolbox.attempts, {}, "an agent that stopped with an error is no attempt");
  assert.deepEqual(agents.toolbox.skips, []);

  // The host gives null for an agent that died on an error of the model after its retries: the same as an exception.
  const dead = await runWorkflow(1, states, undefined, undefined, { trouble: (what) => (what === "stand" ? undefined : "null") });
  assert.match(dead.result.paused!, /run gepauzeerd/);
  assert.deepEqual(dead.toolbox.attempts, {});

  // One agent that fails among others that come back is no storing: it gets its task again next round, without an attempt for the error.
  let failedOnce = false;
  const once = await runWorkflow(2, [{ phase: "judges", judges: ["1.1.1", "1.1.2", "1.1.3"] }, { phase: "judges", judges: ["1.1.2"] }, { phase: "done" }], undefined, undefined, {
    trouble: (what) => (what === taskOf("judges", "1.1.2") && !failedOnce ? ((failedOnce = true), "throw") : undefined),
  });
  assert.equal(once.result.paused, null);
  assert.equal(once.started(taskOf("judges", "1.1.2")), 2);
  assert.deepEqual(once.toolbox.attempts, { "judges:1.1.1": 1, "judges:1.1.3": 1, "judges:1.1.2": 1 });
  assert.equal(once.result.last, "done");
});

test("a workflow started again after a pause goes on with the attempts the run holds", async () => {
  const toolbox: FakeToolbox = { attempts: {}, skips: [] };
  // First start: the walk comes back without a valid result, then the model stops answering.
  const first = await runWorkflow(1, [{ phase: "walks", walks: ["zoek"] }, { phase: "walks", walks: ["zoek"] }], undefined, undefined, { toolbox, trouble: (what, call) => (what !== "stand" && call > 2 ? "throw" : undefined) });
  assert.match(first.result.paused!, /run gepauzeerd/);
  assert.deepEqual(toolbox.attempts, { "walks:zoek": 1 }, "one attempt: the one that came back, not the one that stopped with an error");
  assert.deepEqual(toolbox.skips, []);
  // Second start: one attempt is left, and then the walk is skipped.
  const second = await runWorkflow(1, [{ phase: "walks", walks: ["zoek"] }, { phase: "walks", walks: ["zoek"] }, { phase: "walks", walks: ["zoek"] }, { phase: "done" }], undefined, undefined, { toolbox });
  assert.equal(second.started(taskOf("walks", "zoek")), 1, "the second start gives it its second attempt, not two more");
  assert.deepEqual(second.result.skipped, ["walks:zoek"]);
  assert.deepEqual(toolbox.skips, ["walks:zoek"]);
  assert.equal(second.result.last, "done");
});

test("skip records its kind, a storing is no budget that ran out, and unskip puts the task back with its attempts from zero", async () => {
  const dir = mkdtempSync(join(tmpdir(), "loep-unskip-"));
  try {
    const part = (name: string) => ({ prompt: `${name}.md`, output: `${name}.json`, candidates: `${name}-kandidaten.json`, session: name, maxCommands: 1, maxMinutes: 1 });
    const index = { flow: INSTRUMENT_FLOW, templates: {}, withoutProcedure: [], only: [], walks: [{ pageType: "zoek", page: "P1", prompt: "rondgang/zoek.md", output: "rondgang/zoek.json", session: "r-zoek", maxCommands: 1, maxMinutes: 1 }], tasks: [{ criterion: "1.4.3", judge: part("verdicts/1.4.3/oordeel"), verify: part("verdicts/1.4.3/final"), finish: null }] };
    mkdirSync(join(dir, "tasks"), { recursive: true });
    writeFileSync(join(dir, "tasks", "index.json"), JSON.stringify(index));
    const loaded = await loadInstrumentIndex(dir);
    const task = loaded.tasks[0]!;

    assert.deepEqual(await recordAttempts(dir, ["walks:zoek", "judges:1.4.3", "judges:1.4.3"]), { "walks:zoek": 1, "judges:1.4.3": 2 });
    await assert.rejects(recordAttempts(dir, ["finishers:1.4.3"]), /--attempted: "finishers:1\.4\.3" is no task of this run/);
    await assert.rejects(recordAttempts(dir, ["rondgang:zoek"]), /is no task of this run/);

    // Without a kind it is what it always was; a storing is said as one.
    await skip(dir, { pageType: "zoek" }, "De agent leverde twee keer geen geldige lijst.");
    assert.equal(skipKindOf(dir, "rondgang/zoek.json"), "geen geldig resultaat");
    await skip(dir, { criterion: "1.4.3" }, "De weeklimiet van het abonnement was bereikt.", "storing");
    assert.equal(skipKindOf(dir, task.judge.output), "storing");
    assert.equal(skippedForOutage(dir, task), true);
    await assert.rejects(skip(dir, { criterion: "1.4.3" }, "De weeklimiet van het abonnement was bereikt.", "quota"), /skip --kind is "geen geldig resultaat" or "storing", not "quota"/);
    await assert.rejects(skip(dir, { criterion: "1.4.3", round: "finish" }, "Er is geen afmaakronde in deze run."), /skip needs --page-type <id> or --criterion <id>/);

    // The finishing round of a criterion whose judge was skipped for a storing is not told that a budget ran out.
    const outage = pointsToFinish({ round: null, verdict: null }, "storing")!;
    assert.deepEqual(outage, ["De beoordeling is door een storing van het model niet gedaan. Het criterium is daardoor niet beoordeeld."]);
    assert.ok(!outage.join().includes("budget op"));
    assert.match(pointsToFinish({ round: "judge", verdict: null }, "storing")!.join(), /^De verificatie is door een storing van het model niet gedaan/);
    assert.match(pointsToFinish({ round: null, verdict: null })!.join(), /^budget op: /, "a task without a valid result stays what it was");

    // unskip: the task is open again, and the workflow gives it its two attempts anew.
    assert.equal(await unskip(dir, { criterion: "1.4.3" }), "verdicts/1.4.3/oordeel.overgeslagen.json");
    assert.equal(skipped(dir, task.judge.output), false);
    assert.equal(skippedForOutage(dir, task), false);
    assert.deepEqual((await loadInstrumentIndex(dir)).attempts, { "walks:zoek": 1 });
    await assert.rejects(unskip(dir, { criterion: "1.4.3" }), /unskip: judges:1\.4\.3 is niet overgeslagen/);
    await assert.rejects(unskip(dir, { criterion: "9.9.9" }), /unskip needs --page-type <id> or --criterion <id>/);
    await unskip(dir, { pageType: "zoek" });
    assert.equal((await loadInstrumentIndex(dir)).attempts, undefined, "no attempts left, no field");

    // What the workflow reads: ids and attempts, no paths.
    const brief = briefPending({ flow: INSTRUMENT_FLOW, phase: "judges", walks: [], judges: [{ criterion: "1.4.3", task: "/x/tasks/1.4.3/beoordeel.md", session: "b-143", attempts: 1 }], verifiers: [], finishers: [], skipped: [], noteNl: "" });
    assert.deepEqual(brief, { phase: "judges", walks: [], judges: [{ id: "1.4.3", attempts: 1 }], verifiers: [], finishers: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the workflow sets a model only for the roles that are given one, the stand on Haiku unless told otherwise, and refuses a role or model it does not know", async () => {
  const states = (): WorkflowState[] => [{ phase: "walks", walks: ["start"] }, { phase: "judges", judges: ["1.1.1"] }, { phase: "done" }];
  const plain = await runWorkflow(2, states());
  assert.deepEqual(plain.asked.map((options) => [options.phase, options.model ?? null]), [["Stand", "haiku"], ["Rondgangen", null], ["Stand", "haiku"], ["Beoordelen", null], ["Stand", "haiku"]], "without models only the stand gets a model");
  assert.deepEqual(plain.result.models, { stand: "haiku", walks: null, judges: null, verifiers: null, finishers: null });
  const none = await runWorkflow(2, states(), undefined, {});
  assert.deepEqual(none.result.models, plain.result.models);
  const opus = await runWorkflow(2, states(), undefined, { stand: "opus" });
  assert.ok(opus.asked.filter((options) => options.phase === "Stand").every((options) => options.model === "opus"), "models can set the stand back");

  const some = await runWorkflow(2, states(), undefined, { stand: "haiku", walks: "sonnet" });
  assert.deepEqual(some.asked.map((options) => [options.phase, options.model ?? null]), [["Stand", "haiku"], ["Rondgangen", "sonnet"], ["Stand", "haiku"], ["Beoordelen", null], ["Stand", "haiku"]]);
  assert.deepEqual(some.result.models, { stand: "haiku", walks: "sonnet", judges: null, verifiers: null, finishers: null });

  await assert.rejects(runWorkflow(2, states(), undefined, { rondgangen: "sonnet" }), /onbekende rol "rondgangen"; kies uit stand, walks, judges, verifiers, finishers/);
  await assert.rejects(runWorkflow(2, states(), undefined, { walks: "gpt" }), /onbekend model "gpt" voor "walks"; kies uit opus, sonnet, haiku/);
  await assert.rejects(runWorkflow(2, states(), undefined, ["sonnet"]), /models moet een object zijn/);
});
