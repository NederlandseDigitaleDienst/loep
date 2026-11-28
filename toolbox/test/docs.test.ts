import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { EXPLORE_MAX_COMMANDS, EXPLORE_MAX_MINUTES } from "../src/commands/explore.ts";
import { AUDIT_COMMANDS, callName, cliCall, DEV_COMMANDS, NAMESPACES, STANDALONE_COMMANDS } from "../src/lib/commands.ts";
import { MAX_RESWEEPS, MAX_RETURNS_TO_EXPLORER, SHEETS_PER_TASK } from "../src/commands/gate.ts";
import { briefPending, BUDGETS, INSTRUMENT_FLOW, loadInstrumentIndex, PHASES, pointsToFinish, recordAttempts, skip, skipKindOf, skipped, skippedForOutage, TASK_FILES, unskip } from "../src/commands/instrument-tasks.ts";
import { CEILINGS, EXTENSION, MEASURED_USE, REFERENCE_SITE_SIZE, WALK_STATES } from "../src/lib/budget.ts";
import { FINISH_FACTOR, LOOK_COMMANDS, MEASURE_COMMANDS, NOT_SENT, openPoint, SESSION_COMMANDS } from "../src/lib/verdict.ts";
import { voiceoverWarningNl } from "../src/lib/voiceover.ts";
import { writeBudgetsNl } from "../src/lib/writes.ts";
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

/** The commands of the toolbox, wherever they sit: a step of an investigation, the tool for whoever works on loep, or one that stands alone. */
const COMMANDS: string[] = [...AUDIT_COMMANDS, ...DEV_COMMANDS, ...STANDALONE_COMMANDS];

/** The commands cli.ts handles before it reads the rest of the line, or in a module of its own. */
const HANDLED_ELSEWHERE = ["session", "calibrate", "variant", "compare-variants", "usage"];

/** The words that can follow `session`: the three that manage a session, and every command in one. `serve` is how the process starts itself and is no command for a reader. */
const AFTER_SESSION = [...SESSION_MANAGEMENT.filter((word) => word !== "serve"), ...SESSION_COMMANDS];
/** The texts an agent works from: the tasks, the skills and the procedures. They call the toolbox too. */
const TEMPLATES = readdirSync(join(ROOT, "templates")).filter((file) => file.endsWith(".md")).map((file) => `templates/${file}`);
const PROCEDURES = readdirSync(join(ROOT, "procedures")).filter((file) => file.endsWith(".md")).map((file) => `procedures/${file}`);

/**
 * What is wrong with the calls of the toolbox in one piece of code. The toolbox is called as
 * `cli.ts`, as the variable LOEP of a skill, as `{{cli}}` in a task, or as `loep` at the start
 * of a line: the installed name, or the short form a procedure writes for `session <command>`.
 * A step is written with its layer in front: `audit tasks`, `dev compare`.
 */
function wrongCalls(code: string): string[] {
  const problems: string[] = [];
  for (const match of code.matchAll(/(?:\bLOEP|cli\.ts|\{\{cli\}\}) ([a-z][a-z-]*)(?: ([a-z][a-z-]*))?/g)) {
    const first = match[1]!;
    const second = match[2];
    if (first === "session") continue;
    if (first === "audit" || first === "dev") {
      // A layer on its own asks for its help: `loep audit --help`. Anything else needs a command under it.
      const after = code.slice(match.index + match[0].length);
      if (second === undefined && /^\s*--help\b/.test(after)) continue;
      if (second === undefined || !(NAMESPACES[first] as readonly string[]).includes(second)) problems.push(`"${match[0]}" is geen commando onder loep ${first}`);
      continue;
    }
    if ((AUDIT_COMMANDS as readonly string[]).includes(first) || (DEV_COMMANDS as readonly string[]).includes(first)) problems.push(`"${match[0]}" heet nu loep ${callName(first)}: schrijf de laag ervoor`);
    else if (!(STANDALONE_COMMANDS as readonly string[]).includes(first)) problems.push(`"${match[0]}" is geen commando van de toolbox`);
  }
  // A command in a session is `session <command>`; the word after `session` has to be one that exists.
  for (const match of code.matchAll(/(?:\bLOEP|cli\.ts|\{\{cli\}\}|^\s*loep) session ([a-z][a-z-]*)/gm)) if (!AFTER_SESSION.includes(match[1]!)) problems.push(`"${match[0].trim()}" is geen commando in een sessie en niet start, stop of list`);
  // Written small and at the start of a line it is a command in a session, or one of the few that stand alone; elsewhere "loep" is the name of the toolbox in a sentence.
  for (const match of code.matchAll(/^\s*loep ([a-z][a-z-]*)/gm)) {
    const word = match[1]!;
    if (word === "audit" || word === "dev") {
      // A layer on a line of its own names a command under it, or asks for its help.
      const next = /^\s+([a-z][a-z-]*)/.exec(code.slice(match.index + match[0].length))?.[1];
      if (next !== undefined && !(NAMESPACES[word] as readonly string[]).includes(next)) problems.push(`"${match[0].trim()} ${next}" is geen commando onder loep ${word}`);
      continue;
    }
    const stands = word === "session" || (STANDALONE_COMMANDS as readonly string[]).includes(word);
    if (!stands && !SESSION_COMMANDS.includes(word)) problems.push(`"${match[0].trim()}" is geen commando in een sessie`);
  }
  return problems;
}

/** A call the code itself makes to the toolbox, outside a description: `cli.ts <command>`, `${cli} <command}`, `{{cli}} <command>`. It needs the layer too. */
function unlayeredCalls(code: string): string[] {
  const problems: string[] = [];
  for (const match of code.matchAll(/(?:cli\.ts|\$\{cli\}|\{\{cli\}\})["'` ]+([a-z][a-z-]*)/g)) {
    const word = match[1]!;
    if ((AUDIT_COMMANDS as readonly string[]).includes(word) || (DEV_COMMANDS as readonly string[]).includes(word)) problems.push(`"${match[0].replace(/\s+/g, " ")}" mist de laag: ${callName(word)}`);
  }
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

const TASKS = justTasks(read("justfile"));

test("the code that calls the toolbox itself carries the layer, like the task files do", () => {
  // The descriptions were the visible half. lus, the workflow of a run and the recipes write their own command lines, and those went stale unseen.
  const callers = ["skills/nldd-a11y-audit/onderzoek.workflow.js", ...readdirSync(join(ROOT, "lus/src")).filter((file) => file.endsWith(".ts")).map((file) => `lus/src/${file}`), "justfile"];
  for (const file of callers) assert.deepEqual(unlayeredCalls(read(file)), [], file);
});

test("the table says where every command sits, and the switch of cli.ts handles exactly those and no others", () => {
  const cases = [...read("toolbox/src/cli.ts").matchAll(/^\s+case "([a-z-]+)":/gm)].map((match) => match[1]!);
  assert.deepEqual([...new Set(cases)].sort(), [...COMMANDS].filter((command) => !HANDLED_ELSEWHERE.includes(command)).sort(), "de tabel in lib/commands.ts en de switch in cli.ts noemen niet dezelfde commando's");
  for (const command of HANDLED_ELSEWHERE) assert.ok(COMMANDS.includes(command), `${command} wordt vóór de switch afgehandeld en staat niet in de tabel`);
  for (const command of ["inventory", "check-site", "documents", "diff", "verify", "session"]) assert.ok(COMMANDS.includes(command), `commando ${command} niet gevonden in de tabel`);
  assert.equal(callName("inventory"), "audit inventory");
  assert.equal(callName("diff"), "dev diff");
  assert.equal(callName("quick"), "quick");
  assert.equal(cliCall("/x/cli.ts", "check-gate", "--run", "/r"), "node /x/cli.ts audit check-gate --run /r");
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
  // A step is written with its layer in front; without one it is an old name the description still has to change.
  for (const flat of ["LOEP inventory <url>", "node {{cli}} gate --run x", "cli.ts procedures"]) assert.equal(wrongCalls(flat).length, 1, flat);
  for (const wrong of ["LOEP session klik 1", "loep session serve", "node {{cli}} session begin", "LOEP audit klik", "LOEP audit quick", "LOEP dev inventory", "loep inventory", "  loep klik 3"]) assert.equal(wrongCalls(wrong).length, 1, wrong);
  for (const right of ["LOEP audit inventory <url>", "LOEP dev procedures", "node {{cli}} audit gate --run x", "LOEP quick <url>", "loep audit tasks", "LOEP session open P01", "loep session look", "loep session contrast 3", "node {{cli}} session start --run x", "LOEP session list --run RUN", "loep contrast 3", 'loep() { node {{cli}} session "$@" --run x; }']) assert.deepEqual(wrongCalls(right), [], right);
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
  // Every agent is told the command in full, and that `loep <command>` in a procedure is short for it (#652).
  for (const file of ["templates/gereedschap.md", "templates/verken.md"]) assert.match(read(file), /`node \{\{cli\}\} session <commando> /, file);
  assert.match(read("templates/gereedschap.md"), /`loep <commando>` schrijft, is dat de korte schrijfwijze van dat volledige commando/);
});

test("the task of the explorer ends a recipe while the part is there, and makes what removes it a part of its own (#395)", () => {
  const task = read("templates/verken.md");
  assert.match(task, /Een recept eindigt op het moment waarop het onderdeel zichtbaar is/);
  assert.match(task, /leg haar dan vast als een eigen onderdeel met een eigen recept/);
});

test("where the README and the method list the steps, every name written as code is a command", () => {
  // In these two sections a lowercase word between backticks stands for a command. Anything else there
  // (a file name, a flag, a label) has a dot, a dash in front, a capital or a space, and is left alone.
  const problems: string[] = [];
  for (const [file, heading] of [["README.md", "Hoe het werkt"], ["docs/methode.md", "De keten"], ["docs/architectuur.md", "2. De keten"]] as const) {
    for (const code of codeOf(section(read(file), heading))) {
      const trimmed = code.trim();
      const alone = /^([a-z][a-z-]*)(?: --[a-z-]+)*$/.exec(trimmed);
      const layered = /^(audit|dev) ([a-z][a-z-]*)(?: --[a-z-]+)*$/.exec(trimmed);
      const wrong = alone !== null ? !COMMANDS.includes(alone[1]!) : layered !== null && !(NAMESPACES[layered[1] as keyof typeof NAMESPACES] as readonly string[]).includes(layered[2]!);
      if (wrong) problems.push(`${file}, sectie "${heading}": \`${code}\` is geen commando van de toolbox; bestaat het niet meer, haal het weg, en is het iets anders, schrijf het dan zonder code-opmaak`);
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
  /** What pending says while the site has an outage. */
  siteOutage?: string;
  /** At done: criteria that can get a new finishing round now that the site answers again. */
  again?: string[];
  /** What pending says when the budget for sending is about to run out, or what a stand made up in its place. */
  sendingLow?: string;
  /** What pending says when the virtual Mac is set up but VoiceOver does not read. */
  voiceover?: string;
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
  voiceover: string | null;
  models: Record<string, string | null>;
}

/**
 * Run the workflow script as its host does: as the body of an async function that is given `args`,
 * `agent`, `parallel` and `log`. `states` is what the toolbox answers round after round; `seconds`
 * says how long the agent of a task works and `fails` which tasks come back without a valid result
 * (still open next round). `trouble` says which calls end in an error of the model: "throw" for an
 * exception, "null" for what the host gives when an agent died on such an error; the stand is "stand".
 * "site" is an agent that heard from its session that the site has an outage, and says so; "fine" is an agent
 * that did its task and says in its report that the site had no outage.
 */
async function runWorkflow(atOnce: number | undefined, states: WorkflowState[], seconds: (task: string) => number = () => 0.002, models?: unknown, extra: { toolbox?: FakeToolbox; trouble?: (what: string, call: number) => "throw" | "null" | "site" | "fine" | undefined } = {}) {
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
      for (const match of prompt.matchAll(/ audit skip --run RUN (--page-type (\S+)|--criterion (\S+)(?: --round (final|finish))?) --kind "geen geldig resultaat"/g)) {
        toolbox.skips.push(match[2] ? `walks:${match[2]}` : `${match[4] === "final" ? "verifiers" : match[4] === "finish" ? "finishers" : "judges"}:${match[3]}`);
      }
      for (const key of /audit tasks --run RUN --attempted (\S+)/.exec(prompt)?.[1]?.split(",") ?? []) toolbox.attempts[key] = (toolbox.attempts[key] ?? 0) + 1;
      const state = states[round++] ?? { phase: "done" };
      const open = (phase: WorkflowPhase) => (state[phase] ?? []).filter((id) => !toolbox.skips.includes(`${phase}:${id}`)).map((id) => ({ id, attempts: toolbox.attempts[`${phase}:${id}`] ?? 0 }));
      return { phase: state.phase, walks: open("walks"), judges: open("judges"), verifiers: open("verifiers"), finishers: open("finishers"), ...(state.siteOutage ? { siteOutage: state.siteOutage } : {}), ...(state.again ? { again: state.again } : {}), ...(state.sendingLow ? { sendingLow: state.sendingLow } : {}), ...(state.voiceover ? { voiceover: state.voiceover } : {}) };
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
    if (trouble === "site") return "Storing van de site.";
    if (trouble === "fine") return "Oordeel opgeschreven, de controle is geslaagd.\nEr werd geen commando geweigerd en er was geen storing van de site.";
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
  assert.match(flow.stands[0]!, /audit pending --run RUN --brief/);
  assert.match(flow.stands[1]!, /audit tasks --run RUN --attempted walks:t\d/);
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
  assert.match(stuck.stands[3]!, /1\. node CLI audit skip --run RUN --criterion 1\.3\.4 --round finish --kind "geen geldig resultaat" --reason /);
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
  assert.match(flow.stands[3]!, /1\. node CLI audit skip --run RUN --page-type zoek --kind "geen geldig resultaat" --reason /, "the next round begins with the skip");
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

test("the workflow pauses only on what pending itself says: a field the stand fills in on its own does not pause (#710)", async () => {
  const judges = ["1.1.1", "1.4.3"];
  // What pending prints, from the toolbox itself: the budget for sending about to run out, an outage, a VoiceOver that does not read.
  const low = writeBudgetsNl([{ origin: "https://www.example.nl", max: 30, sent: 28, left: 2, reserved: 0, spacingSeconds: 0, waitSeconds: 0 }]);
  const paused = await runWorkflow(3, [{ phase: "judges", judges, sendingLow: low }]);
  assert.equal(paused.events.length, 0, "no agent starts on a budget that is about to run out");
  assert.match(paused.result.paused!, /^budget voor versturen bijna op, run gepauzeerd; /);
  assert.ok(paused.result.paused!.endsWith(`(stand 1: ${low})`));
  assert.match(read("toolbox/src/session/blockade.ts"), /return `storing van de site: \$\{/, "the outage of pending starts as the workflow expects");
  const mute = voiceoverWarningNl({ state: "stopped" });
  assert.ok(mute);
  const heard = await runWorkflow(3, [{ phase: "judges", judges, voiceover: mute }, { phase: "done" }]);
  assert.equal(heard.result.voiceover, mute);
  const warming = voiceoverWarningNl({ state: "running" }, true);
  assert.ok(warming);
  assert.equal((await runWorkflow(3, [{ phase: "judges", judges, voiceover: warming }, { phase: "done" }])).result.voiceover, warming);
  // Every variant of the budget: one that ran out, one origin among several, and the warning as a stand may hand it back, quoted or with a capital.
  const out = writeBudgetsNl([{ origin: "https://www.example.nl", max: 30, sent: 30, left: 0, reserved: 0, spacingSeconds: 0, waitSeconds: 0 }]);
  const two = writeBudgetsNl([
    { origin: "https://www.example.nl", max: 30, sent: 28, left: 2, reserved: 2, spacingSeconds: 5, waitSeconds: 3 },
    { origin: "https://chat.example.nl", max: 10, sent: 9, left: 1, reserved: 0, spacingSeconds: 0, waitSeconds: 0 },
  ]);
  for (const said of [out, two, `"${low}"`, low[0]!.toUpperCase() + low.slice(1)]) {
    const flow = await runWorkflow(3, [{ phase: "judges", judges, sendingLow: said }]);
    assert.equal(flow.events.length, 0, `${JSON.stringify(said)} pauses the run`);
    assert.match(flow.result.paused!, /^budget voor versturen bijna op, run gepauzeerd; /);
  }

  // A stand that fills in the fields with words of its own: the run goes on, and nothing is said about it.
  for (const filler of ["niet van toepassing", "geen", "n.v.t.", "", " "]) {
    const flow = await runWorkflow(3, [{ phase: "judges", judges, sendingLow: filler, siteOutage: filler, voiceover: filler }, { phase: "done", again: [filler, "geen"] }]);
    assert.equal(flow.result.paused, null, `${JSON.stringify(filler)} pauses nothing`);
    assert.equal(flow.result.voiceover, null, `${JSON.stringify(filler)} is no warning about VoiceOver`);
    for (const id of judges) assert.equal(flow.started(taskOf("judges", id)), 1);
    assert.equal(flow.stands.length, 2, "no new finishing round for criteria that are not there");
    assert.equal(flow.result.last, "done");
  }
});

test("an outage of the site pauses the workflow like one of the model: no agent starts while pending says so, and an agent that stopped for it is no attempt", async () => {
  // Pending says the site is down: no agent starts, nothing is skipped.
  const said = "storing van de site: https://www.example.nl antwoordt sinds 2026-10-23 07:41 niet";
  const down = await runWorkflow(3, [{ phase: "judges", judges: ["1.1.1", "1.4.3"], siteOutage: said }]);
  assert.equal(down.events.length, 0, "no agent starts");
  assert.equal(down.result.paused, `storing van de site, run gepauzeerd; start de werkstroom opnieuw als de site weer antwoordt (pending zegt het) (stand 1: ${said})`);
  assert.equal(down.result.last, "storing");
  assert.deepEqual(down.result.skipped, []);
  assert.match(down.stands[0]!, /en soms siteOutage/);

  // An agent hears it from its session halfway through a round: no new agent starts after it, and it counts no attempt.
  const judges = Array.from({ length: 6 }, (_, index) => `1.1.${index}`);
  const halfway = await runWorkflow(1, [{ phase: "judges", judges }, { phase: "judges", judges }], undefined, undefined, { trouble: (what) => (what === taskOf("judges", "1.1.1") ? "site" : undefined) });
  assert.deepEqual(halfway.events.filter((event) => event.what === "start").map((event) => event.task), [taskOf("judges", "1.1.0"), taskOf("judges", "1.1.1")]);
  assert.match(halfway.result.paused!, /^storing van de site, run gepauzeerd; .* \(1 van 6 agents van ronde 1 stopten door een storing van de site\)$/);
  assert.equal(halfway.stands.length, 1, "no new round after the pause");
  assert.deepEqual(halfway.toolbox.attempts, {});
  // Every agent of a round heard it: that is the site, not the model.
  const all = await runWorkflow(2, [{ phase: "walks", walks: ["zoek", "start"] }], undefined, undefined, { trouble: (what) => (what === "stand" ? undefined : "site") });
  assert.match(all.result.paused!, /^storing van de site, run gepauzeerd/);
  // Only the answer itself counts: a report that says there was no outage is a task done, and the run goes on.
  const fine = await runWorkflow(2, [{ phase: "walks", walks: ["zoek", "start"] }, { phase: "done" }], undefined, undefined, { trouble: (what) => (what === "stand" ? undefined : "fine") });
  assert.equal(fine.result.paused, null);
  assert.equal(fine.result.last, "done");
  assert.deepEqual(fine.toolbox.attempts, { "walks:zoek": 1, "walks:start": 1 });
  assert.ok(!fine.logs.some((line) => line.startsWith("agent gestopt door een storing van de site")));
  // The answer in any dress still pauses, and so does the message of loep that starts with it.
  const workflow = read("skills/nldd-a11y-audit/onderzoek.workflow.js");
  const siteDown = new RegExp(/^const SITE_DOWN = \/(.+)\/i$/m.exec(workflow)![1]!, "i");
  for (const answer of ["storing van de site", "Storing van de site.", ' "storing van de site"\n', "**Storing van de site**", said]) assert.ok(siteDown.test(answer), `${JSON.stringify(answer)} telt als storing`);
  for (const report of ["Er was geen storing van de site.", "Geen storing van de site, oordeel opgeschreven.", "Storing van de site was er niet; de controle is geslaagd."]) assert.ok(!siteDown.test(report), `${JSON.stringify(report)} telt niet als storing`);
  // The agent is told when to stop, and what to answer.
  assert.match(read("skills/nldd-a11y-audit/onderzoek.workflow.js"), /stop je sessie en antwoord alleen met: storing van de site\./);

  // Started again once the site answers: what got "niet bereikbaar" before gets a new finishing round, once per start.
  const back = await runWorkflow(2, [{ phase: "done", again: ["2.4.3", "3.3.1"] }, { phase: "finishers", finishers: ["2.4.3", "3.3.1"] }, { phase: "done", again: ["2.4.3"] }]);
  assert.match(back.stands[1]!, /audit tasks --run RUN --again 2\.4\.3,3\.3\.1\n/);
  assert.ok(!back.stands[0]!.includes("--again") && !back.stands[2]!.includes("--again"));
  for (const id of ["2.4.3", "3.3.1"]) assert.equal(back.started(taskOf("finishers", id)), 1);
  assert.deepEqual(back.result.history.map((entry) => entry.phase), ["done", "finishers", "done"]);
  assert.equal(back.result.last, "done");
  assert.equal(back.result.paused, null);
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
    assert.match(pointsToFinish({ round: null, verdict: null })!.join(), /^geen geldig resultaat: /, "a task without a valid result says so, and is no budget that ran out (#318)");

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

test("the example verdict in the tasks of judge, verifier and finisher is valid JSON, and each attempt points at a point that takes one (#361, #371)", () => {
  for (const name of ["beoordeel", "verifieer", "afmaak"]) {
    const text = readFileSync(fileURLToPath(new URL(`../../templates/${name}.md`, import.meta.url)), "utf8");
    const example = [...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => match[1]!).find((block) => block.includes('"missingNl"'));
    assert.ok(example, `${name}: an example verdict`);
    const verdict = JSON.parse(example) as { missingNl?: string[]; attempts?: { missing: number }[]; finish?: { attempts?: { missing: number }[] } };
    for (const attempt of verdict.attempts ?? verdict.finish?.attempts ?? []) {
      const kind = openPoint(verdict.missingNl?.[attempt.missing - 1] ?? "").kind?.prefix;
      assert.ok(kind === "proef werkte niet" || kind === "niet bereikbaar" || kind === NOT_SENT, `${name}: attempt ${attempt.missing} points at "${kind}"`);
    }
  }
});

/** A person in general: the reader, the visitor, the user, the owner, and "wie" or "iemand" for any of them. */
const GENERIC_PERSON = /\b(bezoekers?|lezers?|gebruikers?|eigenaars?|onderzoekers?|iemand|wie)\b/i;
/** The pronouns that give such a person a gender. "zijn" is also a verb, so only its possessive forms count. */
const GENDERED = /\b(hij|hem)\b|\bzijn (eigen|handen)\b|\bwie zijn\b/i;
/** Sentences where the pronoun is about a thing, not a person: they may stay. */
const ABOUT_A_THING = [
  { file: "templates/bevinding.md", sentence: "bekijk hem in de pagina waar hij staat" },
  { file: "toolbox/src/lib/extractors.ts", sentence: "wanneer hij afging" },
  { file: "toolbox/src/lib/extractors.ts", sentence: "verzoek hem wel had bereikt" },
  { file: "toolbox/src/session/daemon.ts", sentence: "wil je hem voortzetten" },
];

/** The sentences of a text that call a person in general "hij", "hem" or "zijn": within one line, a pronoun after a person in the same or an earlier sentence. */
function genderedPersons(file: string, text: string): string[] {
  const found: string[] = [];
  text.split("\n").forEach((line, index) => {
    const sentences = line.split(/(?<=[.!?])\s+/);
    sentences.forEach((sentence, at) => {
      if (!GENDERED.test(sentence) || !sentences.slice(0, at + 1).some((before) => GENERIC_PERSON.test(before))) return;
      if (ABOUT_A_THING.some((thing) => thing.file === file && sentence.includes(thing.sentence))) return;
      found.push(`${file}:${index + 1}: ${sentence.trim().slice(0, 160)}`);
    });
  });
  return found;
}

test("no fixed text and no task calls a reader, visitor, user or owner hij, hem or zijn (#727)", () => {
  const files = (dir: string, extension: RegExp): string[] =>
    readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile() && extension.test(entry.name)).map((entry) => join(entry.parentPath, entry.name).slice(ROOT.length));
  const texts = [...files("templates", /\.(md|typ)$/), ...files("toolbox/src", /\.ts$/), ...files("toolbox/data", /\.json$/)];
  for (const thing of ABOUT_A_THING) assert.ok(read(thing.file).includes(thing.sentence), `${thing.file} still has "${thing.sentence}"; drop it from ABOUT_A_THING`);
  assert.ok(texts.includes("templates/weeg.md") && texts.includes("toolbox/src/lib/report-markdown.ts"), "the check reads the tasks and the code");
  assert.deepEqual(texts.flatMap((file) => genderedPersons(file, read(file))), []);
  // Every task whose text lands in the report says so to the agent, since an agent writes like its task.
  for (const name of ["weeg", "samenvat", "beoordeel", "verifieer", "afmaak", "natoets"]) assert.match(read(`templates/${name}.md`), /nooit een voornaamwoord dat een geslacht kiest/, `templates/${name}.md names the rule`);
  // The check itself: it finds the pronoun for a visitor, also a sentence later, and leaves one for a thing alone.
  assert.equal(genderedPersons("x.md", "Wie niet ziet `detour`. Hij moet de knop proberen.").length, 1);
  assert.equal(genderedPersons("x.md", "de bezoeker verliest wat hij deed").length, 1);
  assert.equal(genderedPersons("x.md", "wie zijn handen moeilijk gebruikt").length, 1);
  assert.equal(genderedPersons("x.md", "Een knop die hij niet kan bereiken.").length, 0);
});
