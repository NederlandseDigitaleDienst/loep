/*
 * The surface of the command line. A caller reads this table, not the switch in cli.ts: the docs test,
 * the task files that an agent runs, and the help. A step of an investigation sits under `audit`, the
 * tool for whoever works on loep under `dev`; the few that stand on their own keep their own name.
 */
export const AUDIT_COMMANDS = [
  "inventory",
  "explore",
  "check-site",
  "sample",
  "sweep",
  "collect",
  "contrast",
  "states",
  "documents",
  "gate",
  "check-gate",
  "tasks",
  "check-walk",
  "skip",
  "unskip",
  "check-verdict",
  "pending",
  "estimate",
  "gaps",
  "feedback",
  "evaluate",
  "merge",
  "check-merge",
  "weigh",
  "check-weigh",
  "summarize",
  "check-summary",
  "check-reading",
  "answer",
  "render",
  "publish",
  "recheck",
  "check-recheck",
  "handout",
  "export",
  "sign",
  "decide",
  "purpose",
  "login",
  "watch-session",
  "mail",
  "secrets",
  "seal",
  "verify",
  "voiceover",
  "writes",
] as const;

/** The tool for whoever works on loep itself: no run to measure, or a run measured twice to compare. */
export const DEV_COMMANDS = ["procedures", "compare", "calibrate", "diff", "variant", "compare-variants", "usage", "meting"] as const;

/** The verbs of the harness: loep over a list of sites, a regie per site. They take their own options. */
export const HARNESS_COMMANDS = ["add", "run", "status", "pause", "resume", "log", "doctor"] as const;

/** The commands that keep their own name, because they are one thing and not a step of a chain. */
export const STANDALONE_COMMANDS = ["quick", "statement", "contribute", "session"] as const;

/**
 * The steps whose first word after them is no site of the backlog: `inventory` takes the address of a new
 * run, `mail` and `voiceover` their own subject, `purpose` the purpose, `gaps` a list of runs. The rest of
 * `audit` takes the site where it takes `--run`: `loep audit tasks voorbeeld.nl`.
 */
export const STEPS_WITHOUT_A_SITE = ["inventory", "mail", "voiceover", "gaps", "purpose"] as const;

/**
 * The steps a person does, from the backlog: `loep audit login <site>` opens the window of the test
 * account, and the harness knows the login of that site and what to resume afterwards.
 */
export const HANDED_OVER_COMMANDS = ["login", "answer", "sign", "decide", "statement"] as const;

export const NAMESPACES = { audit: AUDIT_COMMANDS, dev: DEV_COMMANDS } as const;
export type Namespace = keyof typeof NAMESPACES;

/** How a command is written from outside: `audit tasks`, `dev compare`, `quick`, `session`. */
export function callName(command: string): string {
  for (const namespace of Object.keys(NAMESPACES) as Namespace[]) {
    if ((NAMESPACES[namespace] as readonly string[]).includes(command)) return `${namespace} ${command}`;
  }
  return command;
}

/** The arguments of a command line, for a caller that spawns the toolbox itself: `<cli> audit check-gate --run <run>`. */
export function cliArgs(cli: string, command: string, ...args: string[]): string[] {
  return [cli, ...callName(command).split(" "), ...args];
}

/** A command line as the task files write it: `node <cli> audit check-gate --run <run>`. */
export function cliCall(cli: string, command: string, ...args: string[]): string {
  return ["node", ...cliArgs(cli, command, ...args)].join(" ");
}
