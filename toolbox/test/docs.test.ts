import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { EXPLORE_MAX_COMMANDS, EXPLORE_MAX_MINUTES } from "../src/commands/explore.ts";
import { MAX_RETURNS_TO_EXPLORER, SHEETS_PER_TASK } from "../src/commands/gate.ts";
import { BUDGETS } from "../src/commands/instrument-tasks.ts";
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

interface WorkflowState {
  phase: string;
  walks?: { pageType: string; task: string }[];
  judges?: { criterion: string; task: string }[];
  verifiers?: { criterion: string; task: string }[];
  finishers?: { criterion: string; task: string }[];
}

/**
 * Run the workflow script as its host does: as the body of an async function that is given `args`,
 * `agent`, `parallel` and `log`. `states` is what the toolbox answers round after round; `seconds`
 * says how long the agent of a task works and `fails` which tasks end in an error.
 */
async function runWorkflow(atOnce: number | undefined, states: WorkflowState[], seconds: (task: string) => number = () => 0.002, fails: string[] = []) {
  const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (...names: string[]) => (...values: unknown[]) => Promise<{ history: { round: number; phase: string; tasks?: number }[]; skipped: string[]; last: string | null }>;
  const script = new AsyncFunction("args", "agent", "parallel", "log", read("skills/nldd-a11y-audit/onderzoek.workflow.js").replace(/^export const meta/m, "const meta"));
  const events: { task: string; what: "start" | "end" }[] = [];
  const stands: string[] = [];
  let running = 0;
  let most = 0;
  let round = 0;
  const agent = async (prompt: string, options: { phase: string }): Promise<unknown> => {
    if (options.phase === "Stand") {
      stands.push(prompt);
      const state = states[round++] ?? { phase: "done" };
      return { walks: [], judges: [], verifiers: [], finishers: [], ...state };
    }
    const task = /Lees het bestand (\S+)/.exec(prompt)![1]!;
    events.push({ task, what: "start" });
    most = Math.max(most, ++running);
    await new Promise((done) => setTimeout(done, seconds(task) * 1000));
    running--;
    events.push({ task, what: "end" });
    if (fails.includes(task)) throw new Error(`geen resultaat voor ${task}`);
    return "klaar";
  };
  const parallel = (thunks: (() => Promise<unknown>)[]): Promise<unknown[]> => Promise.all(thunks.map((thunk) => thunk()));
  const result = await script({ cli: "CLI", run: "RUN", atOnce }, agent, parallel, () => undefined);
  const position = (task: string, what: "start" | "end"): number => events.findIndex((event) => event.task === task && event.what === what);
  return { result, events, stands, most, started: (task: string): number => events.filter((event) => event.task === task && event.what === "start").length, position };
}

test("the workflow keeps atOnce agents running: a new one starts as soon as one is done, never more at a time, and every task gets its turn", async () => {
  const walks = Array.from({ length: 7 }, (_, index) => ({ pageType: `t${index}`, task: `walk-${index}` }));
  const judges = Array.from({ length: 10 }, (_, index) => ({ criterion: `1.1.${index}`, task: `judge-${index}` }));
  const verifiers = Array.from({ length: 5 }, (_, index) => ({ criterion: `1.1.${index}`, task: `verify-${index}` }));
  // The first agent of each phase is slow, and one judge ends in an error.
  const slow = (task: string): number => (task.endsWith("-0") ? 0.15 : 0.002);
  const flow = await runWorkflow(3, [{ phase: "walks", walks }, { phase: "judges", judges }, { phase: "verifiers", verifiers }, { phase: "done" }], slow, ["judge-4"]);
  assert.equal(flow.most, 3, "there are three agents at a time, and never more");
  for (const item of [...walks, ...judges, ...verifiers]) assert.equal(flow.started(item.task), 1, `${item.task} is done once`);
  assert.deepEqual(flow.result.history.map((entry) => [entry.phase, entry.tasks ?? null]), [["walks", 7], ["judges", 10], ["verifiers", 5], ["done", null]]);
  // In groups the last task would wait for the slow agent of the first group. In a pool it starts while that one still runs.
  for (const [first, last] of [["walk-0", "walk-6"], ["judge-0", "judge-9"], ["verify-0", "verify-4"]] as const) {
    assert.ok(flow.position(last, "end") < flow.position(first, "end"), `${last} is klaar terwijl de trage ${first} nog loopt`);
  }
  // The phases stay apart: no judge starts before the last walk is done.
  assert.ok(flow.position("walk-0", "end") < flow.position("judge-0", "start"));
  // An agent that failed did not stop the others, and nothing was skipped after one attempt.
  assert.equal(flow.started("judge-9"), 1);
  assert.deepEqual(flow.result.skipped, []);

  // Fewer tasks than places: no more agents than tasks. Without atOnce the default of the script holds.
  const small = await runWorkflow(8, [{ phase: "walks", walks: walks.slice(0, 2) }], () => 0.01);
  assert.equal(small.most, 2);
  const standard = await runWorkflow(undefined, [{ phase: "judges", judges }], () => 0.01);
  assert.equal(standard.most, DEFAULT_DAEMON_LIMITS.maxSessions - 1);
});

test("the workflow runs the finishing round as a fourth phase, and goes straight to done when the toolbox names none", async () => {
  const verifiers = [{ criterion: "1.3.4", task: "verify-134" }, { criterion: "1.4.4", task: "verify-144" }];
  const finishers = [{ criterion: "1.3.4", task: "finish-134" }, { criterion: "1.4.13", task: "finish-1413" }, { criterion: "2.5.2", task: "finish-252" }];
  const flow = await runWorkflow(2, [{ phase: "verifiers", verifiers }, { phase: "finishers", finishers }, { phase: "done" }]);
  assert.deepEqual(flow.result.history.map((entry) => [entry.phase, entry.tasks ?? null]), [["verifiers", 2], ["finishers", 3], ["done", null]]);
  for (const item of finishers) assert.equal(flow.started(item.task), 1, `${item.task} is done once`);
  assert.equal(flow.most, 2, "the finishing round runs in the same pool");
  assert.ok(flow.position("verify-144", "end") < flow.position("finish-134", "start"), "no finisher starts before the last verifier is done");
  assert.equal(flow.result.last, "done");
  // A finisher that gives no valid verdict twice is skipped like any other task, with its own round.
  const stuck = await runWorkflow(2, [{ phase: "finishers", finishers: finishers.slice(0, 1) }, { phase: "finishers", finishers: finishers.slice(0, 1) }, { phase: "finishers", finishers: finishers.slice(0, 1) }, { phase: "done" }]);
  assert.equal(stuck.started("finish-134"), 2);
  assert.deepEqual(stuck.result.skipped, ["finishers:1.3.4"]);
  assert.match(stuck.stands[3]!, /1\. node CLI skip --run RUN --criterion 1\.3\.4 --round finish --reason /);
  // No criterion was left open by the evaluation itself: the toolbox says done after the verifiers, and no agent of the round starts.
  const without = await runWorkflow(2, [{ phase: "verifiers", verifiers }, { phase: "done" }]);
  assert.deepEqual(without.result.history.map((entry) => entry.phase), ["verifiers", "done"]);
  assert.equal(without.events.filter((event) => event.task.startsWith("finish-")).length, 0);
  // Every phase the toolbox can name is one the workflow knows.
  const workflow = read("skills/nldd-a11y-audit/onderzoek.workflow.js");
  for (const phase of ["walks", "judges", "verifiers", "finishers"]) assert.match(workflow, new RegExp(`^  ${phase}: \\{ title: `, "m"), `de werkstroom kent de fase ${phase} niet`);
});

test("the workflow tries a task twice and then has it skipped, as before the pool", async () => {
  const stuck = { pageType: "zoek", task: "walk-zoek" };
  const other = { pageType: "start", task: "walk-start" };
  const flow = await runWorkflow(3, [{ phase: "walks", walks: [stuck, other] }, { phase: "walks", walks: [stuck] }, { phase: "walks", walks: [stuck] }, { phase: "done" }]);
  assert.equal(flow.started("walk-zoek"), 2, "two attempts, not a third");
  assert.equal(flow.started("walk-start"), 1);
  assert.deepEqual(flow.result.skipped, ["walks:zoek"]);
  assert.ok(!flow.stands[2]!.includes(" skip "), "the round that finds it open for the third time does not skip yet");
  assert.match(flow.stands[3]!, /1\. node CLI skip --run RUN --page-type zoek --reason /, "the next round begins with the skip");
  assert.equal(flow.result.last, "done");
});
