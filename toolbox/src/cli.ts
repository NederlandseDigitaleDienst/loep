#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { AUDIT_COMMANDS, DEV_COMMANDS, NAMESPACES } from "./lib/commands.ts";

const USAGE = `loep <command> [options]

  audit <stap> [opties]                  The investigation of one site: the site mapped, measured, judged and sealed.
                                         loep audit --help names every step, from inventory to verify
  quick <url> --out <run> [--urls <file>] [--max-pages <n>] [--baseline <summary.json>] [--strict] [--dismiss <selector>]...
                                         A measurement of minutes without a language model, for a pipeline: the rule
                                         engines in light and dark and reflow and zoom, on the pages of --urls or on a
                                         sample of at most 15 pages it finds, with what they point at per criterion
                                         (quick/samenvatting.md). With --baseline it holds the outcome against the
                                         summary.json of an earlier measurement and exits 1 when a page got worse or was
                                         not measured; 2 means the measurement itself failed. It judges nothing
  statement --run <run> [--concept]      The accessibility statement and the answer sheet for the register, from an
                                         investigation that was signed
  contribute --run <run> | --under <folder> [--out <dir>] [--json] [--key <file>]
                                         The sheet of a finished run: what it says about loep and nothing about the site.
                                         It reads a run of any version, writes nothing in it and sends nothing
  session <commando>                     What an agent does in a browser window during the investigation:
                                         open, look, click, speak. loep session --help
  dev <verb>                             The tool for whoever works on loep itself: procedures, compare, diff,
                                         calibrate, variant, usage. loep dev --help

Every step of audit takes its own options; loep audit <stap> --help says which.
`;

const AUDIT_USAGE = `loep audit <stap> [options]

  login --run <run> [--url <login page>] [--role <role>] [--out <file>]
                                         For a site behind a login: open a browser window in which a person logs in with a
                                         test account, and keep the session for the run. The password never reaches loep
  login --run <run> --from <file>        Take a session file that was made on another machine (login --url <page> --out <file>)
  login --run <run> --idle               A second login, with the same test account if you like, for the watch on the session
                                         (2.2.1): kept in idle-session.json, used by that watch alone
  watch-session --run <run> [--gaps 5,10,20,40,80] [--max-hours 8]
                                         The watch on the session of a run with a login. collect starts it in the background
                                         and evaluate stops it; a second start on the same run leaves the running one alone
  inventory <url> --out <run> [--also-origin <url>]... [--exclude-path <path>]... [--navigation-delay <s>] [--allow-writes] [--test-environment <origin>... --declared-by "<name>, <role>"] [--max-writes <n>] [--mailbox <mailbox> [--mail-link-origin <origin>]...]
                                         Find every page and count what is on it. In a run with a login the pages are found
                                         by following links from the page the person pointed at; a link that logs out is never followed
  explore --run <run> [--explore-minutes <n>]
                                         Write the task for the agent that maps the site before it is measured. All rounds
                                         share one total of wall minutes, from explore to the verdict of the gate (default
                                         240); a new round starts only while a sweep still fits in what is left, and once
                                         none does the gate goes on with limitations
  check-site --run <run>                 Validate site.json, replay every recipe in it and open every component on each of its
                                         page types as the sweep does; non-zero exit on problems
  sample --run <run> [--seed <text>]     Choose the pages to evaluate (all of them on a small site). Without --seed the random
                                         part follows the seed inventory made for the run
  sweep --run <run> [--fresh] [--at-once <n>]
                                         The whole sweep as one command: collect, contrast, states and documents, in that order,
                                         with the same options. It stops at the first one that fails and names it. Each of the
                                         four can still be run alone
  collect --run <run> [--fresh] [--at-once <n>]
                                         Gather facts, engine results and probe evidence per page. The sweep (collect, contrast,
                                         states, gate) needs the site model of explore. A second run of collect, contrast or
                                         states keeps what is still valid: a page with the same content and blockers, a state
                                         with the same recipe. --fresh measures everything again. --at-once measures n pages
                                         (contrast: passes, states: groups of probes) at the same time, never more than the
                                         session process of the run allows sessions, with the same time between navigations;
                                         what is written is the same as with one at a time (default 1)
  contrast --run <run> [--fresh] [--at-once <n>]
                                         Measure text contrast on screenshots, in light and dark
  states --run <run> [--fresh] [--at-once <n>]
                                         Probe what only shows after interaction: dialogs, form errors, keys, hover
  documents --run <run>                  Fetch and measure the documents of the sample (pdf, office and plain text files): tags, title,
                                         language, headings, text alternatives, tables, links, PDF/UA-1 with veraPDF
  gate --run <run> [--out <dir>]         Decide whether the evidence is fit to judge on; exit 1 when it is not, 2 when
                                         the agent's look at the pictures is due, 3 when a new sweep can close the gaps (a
                                         measurement failed or is missing). --out leaves the run untouched
  check-gate --run <run>                 Validate the agent's answers for the gate; non-zero exit on problems
  tasks --run <run> [--only <ids>] [--page-types <ids>] [--again <ids>] [--reopen] [--attempted <phase>:<id>,...]
                                         Write the task files of the phase the run is in (walks, judges, verifiers, and a
                                         finishing round for what the evaluation itself left open), with a dossier per
                                         criterion; run it again after each phase. Needs the site model of explore.
                                         --again 2.4.3,3.3.1 writes a new finishing round for those criteria, also when the
                                         run is done, but only for one whose final verdict is open with a point "niet
                                         bereikbaar" or "proef werkte niet", or that another finishing round passed
                                         something on to that no round of it ruled on. Each attempt gets its own session; the earlier
                                         verdict is kept, the new one counts in evaluate. A finished run does not go back by
                                         itself: when walks, judges or verifiers would be open again, tasks refuses, changes
                                         nothing and says what would change; --reopen lets it. --attempted walks:start,judges:1.4.3
                                         counts one attempt for each task whose agent came back (the workflow names them;
                                         an agent that stopped with an error is no attempt)
  check-walk --run <run> --page-type <id>
                                         Validate the candidates of a walk-through; non-zero exit on problems
  skip --run <run> (--page-type <id> | --criterion <id> [--round judge|final|finish]) --reason <text>
       [--kind "geen geldig resultaat"|storing]
                                         Record that a walk or verdict will not come, so the next phase can start. --kind
                                         storing: the model was not there (a limit, a failure of the service); the report
                                         says so instead of "budget op", and feedback drafts no issue for it
  unskip --run <run> (--page-type <id> | --criterion <id> [--round judge|final|finish])
                                         Take back a skip: the task is open again, with its attempts counted from zero
  check-verdict --run <run> --criterion <id> --round judge|final|finish
                                         Validate the verdict of the judge, the final verdict of the verifier, or the verdict
                                         of the finishing round; non-zero exit on problems
  pending --run <run> [--brief]          The phase the run is in and the tasks that are still open, as JSON, each with
                                         its attempts. --brief gives only the ids and attempts, for the workflow
  estimate --run <run> [--at-once <n>] [--groups] [--json]
                                         The expected time per part and in total, computed from the inventory (sharper after
                                         sample, explore and the sweep), next to what the run measured so far. --at-once is the
                                         number of agents at the same time, and of pages in the sweep. Writes nothing
  gaps --run <run> [<run> ...] [--json]  Every open point of one or more runs, per kind (veegronde mist, budget op, proef
                                         werkte niet, niet bereikbaar, versturen niet toegestaan, buiten de afbakening, mens
                                         nodig, keuze nodig) and per criterion, equal points taken together and counted: the
                                         work list for whoever improves the sweep. Writes nothing
  feedback --run <run> [--out <dir>] [--json]
                                         Draft issues for the makers of loep: one per criterion and kind that stayed open
                                         because of loep itself, without the address or name of the site. Criteria open
                                         because the run could not send, or because a part of the site did not load, get no
                                         draft and are named apart. Sends nothing
  evaluate --run <run> --name <site> [--organisation <name>] [--model <id>] [--previous <evaluation.json>]
                                         Combine the verdicts into evaluation.json; --model is the model the operator names,
                                         next to what each agent gave itself with session start --model
  merge --run <run> [--previous <evaluation.json>]
                                         Group findings about the same place into defects, and write the task for
                                         the optional step that proposes what else belongs together
  check-merge --run <run>                Validate the proposal of that step; non-zero exit on problems
  weigh --run <run>                      Write the task for the step that records, per finding, which groups of visitors it
                                         hinders, what happens to them and for which core task; apply a weighing that
                                         passed check-weigh, so the severity of each finding follows from those facts
  check-weigh --run <run>                Validate the weighing of that step; non-zero exit on problems
  summarize --run <run>                  Write the task for the summary for the leadership: one agent reads the report as text
                                         (tasks/samenvatting/rapport.md) and writes a few paragraphs that open the report. Once
                                         that passed check-summary, summarize writes the task of a second reader
                                         (tasks/samenvatting/lees.md). Only a summary that passed check-summary and that the
                                         second reader found carried by the report, sentence by sentence, is put into the
                                         evaluation; without one the report opens as loep writes it. Run it after weigh,
                                         again after the reader, and before render
  check-summary --run <run>              Hold that summary to the report: length, status, numbers, words that soften; non-zero
                                         exit on problems
  check-reading --run <run>              Hold the reading of the second reader (tasks/samenvatting/lees.md) to the summary and
                                         the report: a verdict for every sentence as it stands now, each quote literally in the
                                         report, of at most 300 characters, one place for at most two sentences; lists the
                                         sentences the report does not carry. Whether a sentence follows from its quote is
                                         the reader's judgment, not this check. Non-zero exit on a fault in the reading
  answer --run <run> --criterion <id> [--point <n> --did <text> --outcome passed|failed|inapplicable --name <who> --role <function>]
                                         For an open point that asks a person or a choice of the owner: record what a person
                                         did or decided and what follows for the criterion. Without --point: list the open
                                         points. The name stays in antwoorden/<criterion>.json of the run; the evaluation and
                                         the report name only the function. Counts at the next evaluate, and is sealed with the run.
                                         Confirmed at an interactive terminal, or --recorded-via gesprek (see below)
  render --run <run>                     Write the report (Markdown and PDF) from evaluation.json; after signing with the
                                         decisions about each defect
  render --run <run> --embedded         Write only the HTML report as a fragment to stdout, for a page of a site with its
                                         own bar and footer that loads @nldd/design-system itself;
                                         nothing in the run changes, so a sealed run stays sealed
  publish --run <run> --out <dir> [--site <name>]
                                         Put the report in a directory to publish: <dir>/<site>/<date>/ with the report as
                                         one HTML page, the PDFs that render made and publicatie.json, and <dir>/<site>/index.html
                                         with every round published there. Only what the report shows; nothing in the run changes.
                                         <site> is the host and path of the site unless --site names it
          [--toon <group/site> [--toon-host <admin>] [--toon-url <url>] [--live] [--preview <ref>] [--replace-unseen]]
                                         Then put <dir>/<site> on a Toon site of its own, with the session of toon login:
                                         a preview, or live with --live. Rounds already online are fetched first and stay;
                                         a site with other content is never replaced
  render --run <run> --rechecks          Write only the working file with the rechecks (rechecks/nametingen.md), outside
                                         the seal; the report is not touched. A signed report has them in appendix C
  recheck --run <run> (--finding <id> | --criterion <id>)
                                         After the evaluation, also when it is sealed and signed: write the task for one agent
                                         that measures a finding (or every finding of a criterion) again on the site as it is
                                         now, as the verifier did. Everything goes in rechecks/<id>/<moment>/, outside the seal,
                                         and its session runs there with a session process of its own; the evaluation does not
                                         change. The outcome per finding: nog aanwezig, opgelost or niet na te gaan
  check-recheck --run <run> (--finding <id> | --criterion <id>) [--at <moment>]
                                         Validate the outcome of a recheck (the latest, or the one at that moment); non-zero
                                         exit on problems
  handout --run <run> --out <dir> [--name <site>]
                                         Copy the report to a folder outside the run under a name that says which site and
                                         which day: rapport-<site>-<date>.pdf, rapport-kort-..., rapport-....html, with -concept
                                         while it is not signed. The names in the run stay as they are. --name says the site
                                         instead of the host of its url
  export --run <run> --format csv|issues [--out <file or dir>]
                                         The work list as CSV (one row per defect, with its criteria), or as one Markdown block
                                         per defect with a title and a body for an issue tracker. Without --out to standard
                                         output; with issues --out is a directory with a file per defect. Creates no issues
  sign --run <run> --name <who> --role <function> --organisation <name> [--checked <text>]
                                         Record that a named person stands for the evaluation. Only at an interactive terminal:
                                         the signer types the first 8 characters of the seal. An agent never signs
  decide --run <run> [--defect <id> [--decision opgelost|gepland|zienswijze|onevenredig|onbesloten --what <text>
         [--date <yyyy-mm-dd>] [--alternative <text>] --name <who> --role <function>]]
                                         After signing: what the organisation decides about a defect. Without --defect: every
                                         defect, heaviest first, with its decision; with --defect only: that defect and what the
                                         report proposes. Kept in besluiten/<defect>.json, outside the seal, as a layer with a
                                         hash of its own; a changed decision keeps the earlier one. The report names the function.
                                         Confirmed at an interactive terminal, or --recorded-via gesprek (see below)
  purpose --run <run> [verbeteren|verantwoorden]
  writes --run <run> --max-writes <n> [--origin <origin>]
                                         Raise the budget for sending. Confirmed at an interactive terminal, or --recorded-via gesprek (see below).
                                         In a run with a budget per origin, --origin says which one
                                         What the investigation is for. Verbeteren (the default): a team wants to know what
                                         to fix, and the report is not signed. Verantwoorden: the report backs a statement,
                                         says what is still missing for status B, and is signed. Choose or change it at the
                                         end of a run, then run evaluate, render and seal again. Without a value: say it
  mail wait|links|register|cleanup|status --run <run>   The fixed flow around a mailbox; loep audit mail --help
  secrets --run <run>                    What a run knows about its secrets, per source, and what happened around them: never a value
  seal --run <run>                       Record the hash of every file in the run; what is signed afterwards is this seal
  seal --run <run> --open                Open the seal on purpose, to measure in the run itself again (tasks --again): the seal
                                         and a signature lapse; seal again afterwards, and read and sign again
  verify --run <run>                     Recompute every hash in the run
  voiceover start|status|read|stop|setup Optional, outside an evaluation: a real screen reader (VoiceOver in a virtual Mac) as a
                                         second source next to session speak; loep audit voiceover --help

Options:
  --max-pages <n>   Upper bound on pages to visit (default 200)
  --vendor-tags <p> With inventory: prefixes of element names that belong to a vendor, comma-separated ("nldd-").
                    The report lists per such element the findings that touch it; the owner of a finding stays as judged
  --vendor-name <n> With --vendor-tags: what the report calls the vendor, such as "designsysteem" (default "leverancier")
  --urls <file>     With inventory: evaluate exactly the URLs in this file, one per line
  --navigation-delay <s>  With inventory: seconds between two navigations to the same host for the whole run, for a
                    site that refuses connections after a number of page loads in a short time. Kept in
                    manifest.json; holds for the inventory, check-site, collect, contrast, states and the
                    sessions of the agents, also with one page at a time. Without it the default pace stays (1 s)
  --also-origin <u> With inventory, repeatable: a further origin of the same site, such as its documentation on
                    https://docs.example.nl. Its sitemap, start page, links, page for a missing address and documents
                    count as the site's own; one report covers all origins. An origin not given stays outside
  --exclude-path <p> With inventory, repeatable: a part of the site that is not part of the evaluation, such as the
                    pages visitors make on a platform: /gebruikers, or with its origin https://docs.example.nl/archief.
                    A * stands for one segment of the path (/*/* is every page two segments deep). No step of the run
                    opens a page below it; the inventory counts the addresses it found there and the report names it
  --allow-writes    With inventory, for a site on this machine or a .test or .localhost name only: let the run
                    submit forms and send other requests that change something. On any other site, name the test
                    environment and who declares it to be one: --test-environment <origin> --declared-by "<name>, <role>"
                    The name is kept in the manifest of the run; the report shows only the role. The declaration
                    is confirmed at an interactive terminal by typing the origin; an agent never records it.
                    On a site on this machine both may go together, for a chat on an address that is not local:
                    each keeps its own rules and its own budget. A local address is never declared. A window on
                    another address on this machine takes --allow-writes --test-environment <origin>, without
                    --declared-by: it gets local rules and a budget of its own
  --max-writes <n>  With --allow-writes or --test-environment: the most requests that change something the whole run
                    may send to that origin, over every session and the sweep together: default 5, at least 120 s
                    apart; on a local address default 50, without a pause. With both flags it is the budget of the
                    declared origins; the local one keeps 50. With a local --test-environment it is the budget of
                    each of the two local grants. Past it every write is held back as in a run without permission.
                    Kept in the manifest
  --mailbox <m>     With inventory, for a run that may send: imap://<host>:993 (any real mailbox) or mailpit://localhost:8025 (a site
                    on this machine). The user name and password never go here: they come from the environment
                    (LOEP_IMAP_USER, LOEP_IMAP_PASSWORD) or the keychain. A mailbox on another machine is confirmed at an
                    interactive terminal by typing its host; an agent never records it. Opening a link from a mail counts
                    as sending. See loep audit mail --help
  --mail-link-origin <origin>   With --mailbox, repeatable: another party that links in a mail may lead through, such as a
                    mailing service. Only a GET goes there, and only a redirect that ends on an origin of the run is followed
  --other-toolbox   Go on with a run that was made with another version of loep. Without it every command that
                    measures or writes tasks refuses: another version writes other tasks and procedures, and the walks
                    and verdicts of the run are then done again. Measure again with --fresh after changing. Commands
                    that measure nothing (render, statement, compare, decide, sign, seal and the readers) go on, and so
                    does recheck: it measures the site as it is now, in a folder of its own, and records its own version.
                    In a copy made with variant (it holds variant.json) the agent phases (tasks, skip, unskip,
                    check-walk, check-verdict, evaluate, answer, merge, check-merge) go on under another version
                    and say which version the sweep is of; the sweep itself is held to the version it was made with
  --recorded-via gesprek --confirmation <text> --summary <text>
                    With answer and decide only: the agent records what the person said in the conversation,
                    after an express confirmation. --confirmation is what the person said, word for word;
                    --summary the summary they confirmed. Both are kept with the record. Without the flag a person
                    confirms at an interactive terminal (--recorded-via terminal); without one the command refuses

Comparing per finding has its own steps: loep dev compare --findings --help
Measuring a variant of the code on a frozen sweep: loep dev variant --help (variant, compare-variants)
Tokens per agent from the transcripts of a workflow, for compare-variants --usage: loep dev usage --help
`;

const DEV_USAGE = `loep dev <verb> [options]

  procedures                             Validate the procedure catalogue
  compare --run <run> --reference <file> --out <dir>
                                         Compare the evaluation with an existing audit of the same site
  compare --findings                     Compare two runs per finding; its own steps and options: loep dev compare --findings --help
  diff --previous <evaluation.json> --current <evaluation.json> --out <dir>
                                         Write verschil.md: solved, stayed and new between two evaluations of one site
  calibrate                              Outside an evaluation: measure the instruments against the ACT test cases
  variant, compare-variants              Outside an evaluation: measure a variant of the code on a frozen sweep;
                                         loep dev variant --help
  usage                                  Outside an evaluation: tokens per agent from the transcripts of a workflow,
                                         for compare-variants --usage; loep dev usage --help
`;

/** The number after `--at-once`: a whole number of 1 or more, of what the command does at the same time. */
function parseAtOnce(text: string | undefined, what: string): number | undefined {
  if (text === undefined) return undefined;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1) throw new Error(`--at-once is een geheel aantal ${what}, 1 of meer`);
  return value;
}

/**
 * Say again, after `sample` and `explore`, that pages read content from an origin outside the run:
 * the choice is made at the inventory, and a note said only there is easy to pass by.
 */
async function repeatReadsOutsideRun(runDir: string): Promise<void> {
  const path = join(runDir, "inventory.json");
  if (!existsSync(path)) return;
  const { readJson } = await import("./lib/canonical.ts");
  const { readsOutsideRunOfRunNl } = await import("./commands/inventory.ts");
  const said = readsOutsideRunOfRunNl(await readJson<import("./commands/inventory.ts").Inventory>(path));
  if (said) process.stdout.write(`${said}\n`);
}

const NOT_EXPLORED_NL ="deze run heeft geen sitemodel (site.json): verken de site eerst met explore en check-site, en draai daarna sweep en gate";
/** The commands that measure or judge a site that was mapped first. */
const NEEDS_SITE_MODEL = ["sweep", "collect", "contrast", "states", "gate", "tasks"];
/** The commands of the sweep that load pages of the site in a browser. */
const SWEEP_COMMANDS = ["sweep", "collect", "contrast", "states"];

/**
 * `loep audit <stap>` and `loep dev <verb>` are how the commands are written now. A command without its
 * namespace still runs for one release: the task files of a run that is already on disk name it that way,
 * and an agent halfway through an investigation should not stop on a rename.
 */
function withNamespace(argv: string[]): string[] {
  const top = argv[2];
  if (top !== "audit" && top !== "dev") return argv;
  const inner = argv[3];
  if (inner === undefined || inner === "--help" || inner === "-h") return [...argv.slice(0, 2), `help:${top}`];
  if (!(NAMESPACES[top] as readonly string[]).includes(inner)) {
    const said = inner.startsWith("-") ? `de optie "${inner}"` : `"${inner}"`;
    // A command of the other layer is not a typo: say where it does live.
    const elsewhere = (Object.keys(NAMESPACES) as (keyof typeof NAMESPACES)[]).find((floor) => floor !== top && (NAMESPACES[floor] as readonly string[]).includes(inner));
    if (elsewhere) throw new Error(`loep ${top} kent ${said} niet: dat staat onder loep ${elsewhere} (loep ${elsewhere} ${inner})\n\n${top === "audit" ? AUDIT_USAGE : DEV_USAGE}`);
    throw new Error(`loep ${top} kent ${said} niet\n\n${top === "audit" ? AUDIT_USAGE : DEV_USAGE}`);
  }
  return [...argv.slice(0, 2), inner, ...argv.slice(4)];
}

async function main(): Promise<void> {
  const argv = withNamespace(process.argv);
  const named = /^help:(audit|dev)$/.exec(argv[2] ?? "")?.[1];
  if (named === "audit") {
    process.stdout.write(AUDIT_USAGE);
    return;
  }
  if (named === "dev") {
    process.stdout.write(DEV_USAGE);
    return;
  }
  // Comparing per finding has its own steps and options; it parses them itself.
  if (argv[2] === "compare" && argv.includes("--findings")) return (await import("./commands/compare-findings.ts")).cli(argv.slice(3));
  if (argv[2] === "calibrate") return (await import("./commands/calibrate.ts")).cli(argv.slice(3)); // outside an evaluation: measures the instruments against the ACT test cases
  if (argv[2] === "variant" || argv[2] === "compare-variants") return (await import("./commands/variants.ts")).cli(argv.slice(2)); // outside an evaluation: measures a variant of the code on a frozen sweep
  if (argv[2] === "usage") return (await import("./commands/usage.ts")).cli(argv.slice(3)); // outside an evaluation: tokens per agent from the transcripts, for compare-variants --usage
  // A session takes its commands and options as they come; it parses them itself.
  if (argv[2] === "session") {
    const { sessionCli, SESSION_USAGE } = await import("./session/client.ts");
    if (argv.length === 3 || argv.includes("--help")) process.stdout.write(SESSION_USAGE);
    else process.exitCode = await sessionCli(argv.slice(2));
    return;
  }
  const { positionals, values } = parseArgs({
    args: argv.slice(2),
    allowPositionals: true,
    options: {
      out: { type: "string" },
      run: { type: "string" },
      force: { type: "boolean" },
      baseline: { type: "string" },
      key: { type: "string" },
      under: { type: "string" },
      dismiss: { type: "string", multiple: true },
      strict: { type: "boolean", default: false },
      "max-pages": { type: "string", default: "200" },
      idle: { type: "boolean", default: false },
      gaps: { type: "string" },
      "max-hours": { type: "string" },
      "vendor-tags": { type: "string" },
      "vendor-name": { type: "string" },
      only: { type: "string" },
      urls: { type: "string" },
      "also-origin": { type: "string", multiple: true },
      "exclude-path": { type: "string", multiple: true },
      "navigation-delay": { type: "string" },
      seed: { type: "string" },
      criterion: { type: "string" },
      name: { type: "string" },
      organisation: { type: "string" },
      model: { type: "string", default: "niet opgegeven" },
      role: { type: "string" },
      reference: { type: "string" },
      previous: { type: "string" },
      current: { type: "string" },
      checked: { type: "string" },
      round: { type: "string" },
      "page-type": { type: "string" },
      "page-types": { type: "string" },
      again: { type: "string" },
      reopen: { type: "boolean", default: false },
      point: { type: "string" },
      did: { type: "string" },
      outcome: { type: "string" },
      reason: { type: "string" },
      defect: { type: "string" },
      decision: { type: "string" },
      what: { type: "string" },
      date: { type: "string" },
      alternative: { type: "string" },
      "recorded-via": { type: "string" },
      confirmation: { type: "string" },
      summary: { type: "string" },
      kind: { type: "string" },
      attempted: { type: "string" },
      brief: { type: "boolean", default: false },
      concept: { type: "boolean", default: false },
      fresh: { type: "boolean", default: false },
      open: { type: "boolean", default: false },
      "other-toolbox": { type: "boolean", default: false },
      "allow-writes": { type: "boolean", default: false },
      "test-environment": { type: "string", multiple: true },
      "declared-by": { type: "string" },
      "max-writes": { type: "string" },
      origin: { type: "string" },
      mailbox: { type: "string" },
      "mail-link-origin": { type: "string", multiple: true },
      session: { type: "string" },
      timeout: { type: "string" },
      url: { type: "string" },
      from: { type: "string" },
      steps: { type: "string" },
      press: { type: "string" },
      "at-once": { type: "string" },
      "explore-minutes": { type: "string" },
      groups: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      finding: { type: "string" },
      at: { type: "string" },
      rechecks: { type: "boolean", default: false },
      embedded: { type: "boolean" },
      site: { type: "string" },
      toon: { type: "string" },
      "toon-host": { type: "string" },
      "toon-url": { type: "string" },
      live: { type: "boolean", default: false },
      preview: { type: "string" },
      "replace-unseen": { type: "boolean", default: false },
      format: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, target] = positionals;
  if (command === "voiceover" && (values.help || !target)) {
    process.stdout.write((await import("./commands/voiceover.ts")).VOICEOVER_USAGE);
    return;
  }
  if (command === "mail" && (values.help || !target)) {
    process.stdout.write((await import("./commands/mail.ts")).MAIL_USAGE);
    return;
  }
  if (values.help || !command) {
    // The help of the layer a command sits in: `loep audit gate --help` lists the steps of the investigation.
    const layer = command === undefined ? null : (AUDIT_COMMANDS as readonly string[]).includes(command) ? AUDIT_USAGE : (DEV_COMMANDS as readonly string[]).includes(command) ? DEV_USAGE : null;
    process.stdout.write(layer ?? USAGE);
    return;
  }
  // A run that was given a test environment at inventory may write there; every other run holds all writes back.
  const { confirmDeclaration, decideWrites, DEFAULT_WRITE_SPACING_SECONDS, grantOriginsOf, grantsOf, LOCAL_TEST_ENVIRONMENT_NL, recordWrites, setRunWrites, raiseWrites, spacingNl, writeAccess, writesForRun } = await import("./lib/writes.ts");
  if (command !== "inventory" && (values["allow-writes"] || values["test-environment"] !== undefined || values["declared-by"] !== undefined || (values["max-writes"] !== undefined && command !== "writes"))) {
    throw new Error("--allow-writes, --test-environment, --declared-by en --max-writes horen bij inventory: daar wordt voor de hele run vastgelegd of er verstuurd mag worden, en hoe vaak");
  }
  if (command !== "writes" && values.origin !== undefined) throw new Error("--origin hoort bij writes: het zegt welk budget omhoog gaat in een run met een budget per origin");
  // How a statement of a person came about is recorded with it. An answer and a decision may be recorded by the agent in the
  // conversation; a signature and the declaration for sending only by a person at an interactive terminal.
  const { HUMAN_AT_TERMINAL_NL, parseRecordedVia } = await import("./lib/recorded.ts");
  const recordedVia = parseRecordedVia(values["recorded-via"]);
  const recording = { recordedVia: values["recorded-via"], confirmation: values.confirmation, summary: values.summary };
  if (recordedVia === "gesprek" && (command === "sign" || command === "inventory")) throw new Error(`${command === "sign" ? "tekenen" : "de verklaring dat er verstuurd mag worden"} legt de assistent nooit vast, ook niet na een bevestiging in het gesprek. ${HUMAN_AT_TERMINAL_NL}`);
  if ((recordedVia !== undefined || values.confirmation !== undefined || values.summary !== undefined) && command !== "answer" && command !== "decide" && command !== "writes") throw new Error("--recorded-via, --confirmation en --summary horen bij answer en decide");
  if (command !== "inventory" && values.mailbox !== undefined) throw new Error("--mailbox hoort bij inventory: daar wordt voor de hele run vastgelegd welke mailbox er is");
  if (values["mail-link-origin"] !== undefined && (command !== "inventory" || values.mailbox === undefined)) throw new Error("--mail-link-origin hoort bij inventory, samen met --mailbox: daar wordt voor de hele run vastgelegd via welke partij links mogen lopen");
  if (command !== "inventory" && values["navigation-delay"] !== undefined) throw new Error("--navigation-delay hoort bij inventory: daar wordt voor de hele run vastgelegd hoeveel tijd er tussen twee navigaties naar de site zit");
  if (command !== "inventory" && values["exclude-path"] !== undefined) throw new Error("--exclude-path hoort bij inventory: daar wordt voor de hele run vastgelegd welke delen van de site er niet bij horen");
  if (command !== "inventory" && values["also-origin"] !== undefined) throw new Error("--also-origin hoort bij inventory: daar wordt vastgelegd welke origins samen de site zijn");
  // A run goes on with the version of loep it was made with; another version would quietly write other tasks over it.
  if (values.run) {
    const { frozenSweepNl, otherToolboxNl } = await import("./lib/manifest.ts");
    const refusal = otherToolboxNl(values.run, command, values["other-toolbox"]);
    if (refusal) throw new Error(refusal);
    const frozen = frozenSweepNl(values.run, command);
    if (frozen) process.stderr.write(`loep: ${frozen}\n`);
    // Extra fixed read rules the run carries for a test server on this machine (sweep-check writes them). A session has returned above: its process loads them in `serve`.
    (await import("./lib/reads.ts")).useRunFixedReads(values.run);
  }
  // `gaps` and `feedback` read the verdicts and the evaluation of finished runs and nothing else of them: they need no permission to write and no login.
  // A recheck only reads the run and writes in a folder of its own; its session runs in that folder, not here.
  const readsOnly = command === "gaps" || command === "feedback" || command === "contribute" || command === "handout" || command === "recheck" || command === "check-recheck";
  if (command !== "inventory" && !readsOnly && values.run) {
    const permission = writesForRun(values.run);
    if (permission) setRunWrites(writeAccess(values.run, permission, command));
    // A read request of the site model, such as a question to a search service, passes once check-site passed the model as it is now.
    const { fixedReadsLog, refusedReadsLog, setRunReads } = await import("./lib/reads.ts");
    const { approvedReads } = await import("./lib/sitemodel.ts");
    setRunReads(approvedReads(values.run), refusedReadsLog(values.run, command), fixedReadsLog(values.run, command));
  }
  // A run for which a person logged in starts every browser with that session; any other run is left as it was.
  const { runLoginMark, setRunLogin } = await import("./lib/login.ts");
  if (command !== "inventory" && command !== "login" && !readsOnly && values.run) setRunLogin(values.run);
  // A site that refused the evaluation (blockades.json in the run) is asked nothing by the sweep either, and a 429 it gives the sweep ends the asking for the sessions too.
  if (command !== "inventory" && !readsOnly && values.run) (await import("./session/blockade.ts")).setRunBlockade(values.run);
  // The commands of the sweep know the scope of the run, to tell a stylesheet or script of the site that did not arrive.
  if (SWEEP_COMMANDS.includes(command) && values.run) (await import("./session/safety.ts")).setRunScope(values.run);
  if (NEEDS_SITE_MODEL.includes(command) && values.run && !existsSync(join(values.run, "site.json"))) throw new Error(NOT_EXPLORED_NL);
  switch (command) {
    case "login": {
      const { login } = await import("./commands/login.ts");
      await login({ run: values.run, url: values.url, role: values.role, out: values.out, from: values.from, idle: values.idle });
      return;
    }
    case "watch-session": {
      if (!values.run) throw new Error("watch-session needs --run <run>");
      const { watchSession } = await import("./commands/watch-session.ts");
      const gapsMinutes = values.gaps ? values.gaps.split(",").map(Number) : undefined;
      if (gapsMinutes && gapsMinutes.some((gap) => !(gap > 0))) throw new Error("--gaps is een lijst minuten, zoals 5,10,20,40,80");
      const result = await watchSession(values.run, { ...(gapsMinutes ? { gapsMinutes } : {}), ...(values["max-hours"] ? { maxHours: Number(values["max-hours"]) } : {}) });
      process.stdout.write(`${result.status}${result.reasonNl ? `: ${result.reasonNl}` : ""}\n`);
      return;
    }
    case "inventory": {
      if (!target || !values.out) throw new Error("inventory needs a URL and --out <run>");
      const permission = decideWrites(target, { allowWrites: values["allow-writes"], testEnvironment: values["test-environment"], declaredBy: values["declared-by"], maxWrites: values["max-writes"] });
      // A declared test environment is confirmed by a person at a terminal before anything starts.
      if (permission && grantsOf(permission).some((grant) => grant.declaredBy)) Object.assign(permission, await confirmDeclaration(permission));
      const { confirmMailbox, decideMailbox, recordMailbox, runAddress } = await import("./lib/mailbox.ts");
      const mailbox = values.mailbox === undefined ? null : decideMailbox(values.mailbox, permission, undefined, values["mail-link-origin"]);
      // A mailbox on another machine holds real mail: a person confirms it before anything starts.
      if (mailbox) mailbox.mark = await confirmMailbox(mailbox, permission!);
      if (mailbox) permission!.keepShare = true;
      // Asked here, so a missing login does not cost a whole inventory.
      const mailAddress = mailbox ? runAddress(mailbox.server) : null;
      if (permission) setRunWrites(writeAccess(values.out, permission, "inventory"));
      // What this command was given decides whether a session may be used: the manifest only holds it afterwards.
      setRunLogin(values.out, { writes: permission });
      const { formPagesNl, inventory, pageLimitNl, passwordPagesNl, readsOutsideRunNl, refusedPagesNl } = await import("./commands/inventory.ts");
      const { excludedPathsOfRun, originsNl, originsOfRun, siteOrigins } = await import("./lib/origins.ts");
      // Checked before the browser starts: a mistyped origin should not cost a whole inventory.
      const origins = originsOfRun(target, values["also-origin"]);
      if ((values["also-origin"]?.length ?? 0) > 0 && origins.length === 1) throw new Error(`--also-origin noemt alleen de origin van het startadres (${origins[0]}); een tweede origin is bijvoorbeeld https://docs.example.nl`);
      excludedPathsOfRun(origins, values["exclude-path"]);
      const fixedUrls = values.urls ? (await import("node:fs")).readFileSync(values.urls, "utf8").split("\n").map((line) => line.trim()).filter(Boolean) : undefined;
      const tagPrefixes = (values["vendor-tags"] ?? "").split(",").map((prefix) => prefix.trim().toLowerCase()).filter(Boolean);
      if (tagPrefixes.some((prefix) => !/^[a-z][a-z0-9]*-[a-z0-9-]*$/.test(prefix))) throw new Error('--vendor-tags: elke prefix is het begin van een elementnaam met een streepje, zoals "nldd-"');
      if (values["vendor-name"] !== undefined && tagPrefixes.length === 0) throw new Error("--vendor-name hoort bij --vendor-tags");
      const vendor = tagPrefixes.length > 0 ? { tagPrefixes, nameNl: values["vendor-name"]?.trim() || "leverancier" } : undefined;
      const { parseNavigationDelay, recordNavigationDelay } = await import("./lib/pace.ts");
      const navigationDelayMs = values["navigation-delay"] === undefined ? null : parseNavigationDelay(values["navigation-delay"]);
      const { spaceNavigations } = await import("./browser/session.ts");
      const { Politeness } = await import("./session/safety.ts");
      // The inventory itself keeps the pace the run was given, as everything after it does.
      if (navigationDelayMs !== null) spaceNavigations(new Politeness(navigationDelayMs));
      const result = await inventory({ baseUrl: target, out: values.out, maxPages: Number(values["max-pages"]), fixedUrls, vendor, alsoOrigins: values["also-origin"], excludePaths: values["exclude-path"] }).finally(() => spaceNavigations(null));
      await recordWrites(values.out, permission);
      await recordNavigationDelay(values.out, navigationDelayMs);
      if (navigationDelayMs !== null) process.stdout.write(`tempo: ${navigationDelayMs / 1000} s tussen twee navigaties naar dezelfde site, voor de hele run: check-site, de veegronde en de sessies van de agents\n`);
      // inventory.json is already written, so the refusals can be read there; no mailbox and no agent follow.
      const refused = refusedPagesNl(result);
      if (refused) throw new Error(refused);
      if (mailbox) {
        const { startMailbox } = await import("./commands/mail.ts");
        await startMailbox(values.out, mailbox.server, mailAddress!, mailbox.mark, permission!);
        await recordMailbox(values.out, mailbox.mark);
        process.stdout.write(`mailbox aangesloten (${mailbox.mark.kind}): de testwaarde email in een formulier gaat naar het adres van deze run, en mail wait neemt de links uit de mail. Adres en codes staan alleen in secrets.json, buiten het zegel en het rapport.\n`);
      }
      // One block per grant: a site on this machine and a chat declared next to it each have their own budget.
      for (const grant of permission ? grantsOf(permission) : []) {
        const origins = grantOriginsOf(grant);
        process.stdout.write(`versturen toegestaan naar ${origins.join(" en ")}${grant.declaredBy ? `, verklaard door ${grant.declaredBy.name} (${grant.declaredBy.role})` : ""}\n`);
        process.stdout.write(`budget voor versturen: ten hoogste ${grant.maxWrites} verzendingen naar ${origins.length > 1 ? "die origins samen" : "die origin"} voor de hele run, alle agents en de veegronde samen${spacingNl(grant.spacingSeconds ?? DEFAULT_WRITE_SPACING_SECONDS)}. Zoveel berichten of formulieren krijgt de ontvanger ten hoogste.\n`);
        // Say where the declaration ends up, so nobody finds their name somewhere they did not expect.
        if (grant.declaredBy) process.stdout.write(`let op: de naam staat in manifest.json van deze run; het rapport en de verklaring noemen alleen de functie (${grant.declaredBy.role}). Wie de map van de run deelt of publiceert, deelt ook de naam.\n`);
      }
      if (origins.length > 1) process.stdout.write(`één site op ${origins.length} origins: ${originsNl(origins)}\n`);
      process.stdout.write(`${result.pages.length} pages, ${result.skipped.length} skipped, ${result.sitemapUrls} in sitemap\n`);
      // Right below the totals: a limit that goes unnoticed changes which site is evaluated.
      const limited = pageLimitNl(result, Number(values["max-pages"]));
      if (limited) process.stdout.write(`${limited}\n`);
      const totals = result.documentTotals;
      if (totals && totals.onSite + totals.elsewhere > 0) process.stdout.write(`${totals.onSite} documents on the site, ${totals.elsewhere} on other origins (counted only)\n`);
      const behindLogin = passwordPagesNl(result.pages, runLoginMark() !== null);
      if (behindLogin) process.stdout.write(`${behindLogin}\n`);
      const notSent = formPagesNl(result.pages, siteOrigins(result), permission !== null);
      if (notSent) process.stdout.write(`${notSent}\n`);
      const readsElsewhere = readsOutsideRunNl(result.readsOutsideRun);
      if (readsElsewhere) process.stdout.write(`${readsElsewhere}\n`);
      return;
    }
    case "sample": {
      if (!values.run) throw new Error("sample needs --run <run>");
      const { sample } = await import("./commands/sample.ts");
      const result = await sample(values.run, values.seed);
      process.stdout.write(`${result.items.length} of ${result.populationSize} unique pages (${result.method})\n`);
      if (result.documents) process.stdout.write(`${result.documents.length} of ${result.documentPopulation!.onSite} documents\n`);
      if (result.method === "fixed-list" && result.note.includes(" In de lijst staan ")) process.stdout.write(`LET OP:${result.note.slice(result.note.indexOf(" In de lijst staan "))}\n`);
      await repeatReadsOutsideRun(values.run);
      return;
    }
    case "contribute": {
      const { contribute, contributeAll, contributionNl, contributorKey, manyContributionsNl } = await import("./commands/contribute.ts");
      if (values.under) {
        // Every finished run under a folder: the runs made before there was a collection.
        // The key file is made when a sheet is written, not when someone only looks.
        const many = contributeAll(values.under, { outDir: values.out, key: contributorKey(values.key, values.out !== undefined) });
        if (many.refused.length > 0) {
          // A sheet with something of the site on it is a fault of loep, and it must not pass unseen: also not behind --json.
          process.stderr.write(`loep: ${many.refused.length} meetbladen geweigerd omdat er iets van de site op staat (${many.refused.map((entry) => entry.id).join(", ")})\n`);
          process.exitCode = 1;
        }
        process.stdout.write(values.json ? `${JSON.stringify(many.sheets, null, 2)}\n` : manyContributionsNl(many, values.out));
        return;
      }
      if (!values.run) throw new Error("contribute vraagt --run <run>, of --under <map> voor elk afgerond onderzoek daaronder");
      const result = contribute(values.run, { outDir: values.out, key: contributorKey(values.key, values.out !== undefined) });
      if (result.leaks.length > 0) {
        process.stderr.write(`loep: het meetblad is geweigerd: ${result.leaks.join("; ")}\n`);
        process.exitCode = 1;
        // Not printed as JSON: what is refused is not given out in another form.
        if (values.json) return;
      }
      process.stdout.write(values.json ? `${JSON.stringify(result.sheet, null, 2)}\n` : contributionNl(result));
      return;
    }
    case "quick": {
      // A measurement of minutes without a language model, in a run of its own. With a URL it finds the pages itself; with --run it measures a sample that is there.
      const quickRun = target ? values.out : values.run;
      if (!quickRun) throw new Error("quick needs a URL and --out <run>, or --run <run> with an inventory and a sample");
      const { quick, quickDoneNl } = await import("./commands/quick.ts");
      const { QUICK_DEFAULT_PAGES } = await import("./lib/quick.ts");
      // --max-pages has the default of inventory; a quick measurement has a smaller one of its own.
      const given = argv.includes("--max-pages") || argv.some((token) => token.startsWith("--max-pages="));
      // For a pipeline the exit code says which of two things went wrong: 1 is the site (worse than the baseline, or a page of it not measured), 2 is the measurement itself.
      try {
        const { summary, comparison } = await quick({ url: target, run: quickRun, maxPages: given ? Number(values["max-pages"]) : QUICK_DEFAULT_PAGES, urlsFile: values.urls, baseline: values.baseline, dismiss: values.dismiss, strict: values.strict });
        process.stdout.write(quickDoneNl(quickRun, summary, comparison));
        if (comparison && !comparison.ok) process.exitCode = 1;
      } catch (error) {
        process.stderr.write(`loep: ${(error as Error).message}\n`);
        process.exitCode = 2;
      }
      return;
    }
    case "explore": {
      if (!values.run) throw new Error("explore needs --run <run>");
      if (existsSync(join(values.run, "quick.json"))) throw new Error((await import("./lib/quick.ts")).QUICK_EXPLORE_REFUSAL_NL);
      const { explore } = await import("./commands/explore.ts");
      const { parseExploreMinutes } = await import("./lib/explore-budget.ts");
      const result = await explore(values.run, { totalMinutes: parseExploreMinutes(values["explore-minutes"]) });
      const timeNl = result.totalMinutes === null ? "" : `; deze ronde ${result.minutes} minuten voor de verkenner, van de ${result.totalMinutes} minuten voor alle rondes samen, van explore tot de uitspraak van de poort, zijn er ${Math.round(result.usedMinutes)} gebruikt`;
      process.stdout.write(`${result.task}\nronde ${result.round}: ${result.pages} pagina's, ${result.frames} ingesloten vensters${timeNl}\n`);
      await repeatReadsOutsideRun(values.run);
      return;
    }
    case "check-site": {
      if (!values.run) throw new Error("check-site needs --run <run>");
      const { checkSite } = await import("./commands/explore.ts");
      const check = await checkSite(values.run, { progress: (line) => process.stderr.write(`${line}\n`) });
      for (const replay of check.replays) process.stdout.write(`${replay.ok ? "ok  " : "FOUT"} ${replay.kind} ${replay.id} (recept ${replay.recipe})\n`);
      for (const problem of check.problems) process.stdout.write(`- ${problem}\n`);
      for (const hint of check.hintsNl ?? []) process.stdout.write(`tip: ${hint}\n`);
      if ((check.unusedRecipes ?? []).length > 0) process.stdout.write(`niet gebruikt door het model en opzijgezet in recipes/unused: ${check.unusedRecipes!.join(", ")}\n`);
      process.stdout.write(check.ok ? "OK: het sitemodel klopt en elk recept doet wat het zegt\n" : `${check.problems.length} problemen\n`);
      process.exitCode = check.ok ? 0 : 1;
      return;
    }
    case "gate": {
      if (!values.run) throw new Error("gate needs --run <run>");
      const { gate, MAX_RETURNS_TO_EXPLORER } = await import("./commands/gate.ts");
      const result = await gate(values.run, values.out ?? values.run);
      for (const check of result.checks) process.stdout.write(`${check.ok ? "ok  " : "GAT "} ${check.name}: ${check.noteNl}\n`);
      for (const gap of result.gaps) process.stdout.write(`- ${gap.fixedBy === "sweep" ? "(opnieuw meten) " : ""}${gap.check}${gap.page ? ` ${gap.page}` : ""}${gap.state !== "default" ? ` [${gap.state}]` : ""}: ${gap.missingNl}\n`);
      for (const gap of result.limitations) process.stdout.write(`  (beperking) ${gap.check}${gap.page ? ` ${gap.page}` : ""}${gap.state !== "default" ? ` [${gap.state}]` : ""}: ${gap.missingNl}\n`);
      for (const gap of result.accepted) process.stdout.write(`  (aanvaard door ${gap.decidedBy}) ${gap.check}${gap.page ? ` ${gap.page}` : ""}: ${gap.reasonNl}\n`);
      const counted = (count: number): string => `${count} ${count === 1 ? "gat" : "gaten"}`;
      const tasksNl = `${result.review.tasks.map((part) => part.task).join(", ")}${result.review.tasks.length > 1 ? " (één agent per opdracht)" : ""}`;
      const forSweep = result.gaps.filter((gap) => gap.fixedBy === "sweep").length;
      const verdict = {
        proceed: "bewijs voldoende",
        review: result.gaps.length === 0 ? `vaste controles voldoende; de beelden zijn nog niet bekeken: ${tasksNl}` : `${counted(result.gaps.length)} in de vaste controles voor de verkenner; eerst de beelden bekijken, zodat de verkenner alle gaten in één keer krijgt: ${tasksNl}`,
        sweep: `bewijs onvoldoende: een nieuwe veegronde kan ${forSweep} van de ${counted(result.gaps.length)} sluiten, want daar mislukte of ontbreekt een meting. Draai sweep opnieuw (collect, contrast, states en documents) en daarna gate; dat kost geen terugkeer naar de verkenner (nog ${result.resweepsLeft} keer opnieuw meten na deze verkenning)`,
        explore: `bewijs onvoldoende: ${counted(result.gaps.length)}${result.stage === "deterministic" ? " in de vaste controles" : ""}; nog ${result.returnsLeft} keer terug naar de verkenner`,
        stop: `bewijs onvoldoende: ${counted(result.gaps.length)}${result.stage === "deterministic" ? " in de vaste controles" : ""}; ${result.exploreTime?.spent ? "de tijd voor de verkenning is op" : `de run is ${MAX_RETURNS_TO_EXPLORER} keer terug geweest naar de verkenner`}, en er valt niets te beoordelen: de site weigert de run, of meer dan de helft van de steekproef laadde niet. Er komt geen beoordeling`,
      }[result.next!];
      // After every return the gaps left are limitations, and the run goes on (#318).
      const afterNl = result.exploreTime?.spent ? `open toen de tijd voor de verkenning op was (${Math.round(result.exploreTime.usedMinutes)} van ${result.exploreTime.totalMinutes} minuten)` : `na ${MAX_RETURNS_TO_EXPLORER} keer terug naar de verkenner open`;
      const degradedNl = result.degraded ? ` ${result.degraded === 1 ? "Eén gat bleef" : `${result.degraded} gaten bleven`} ${afterNl} en ${result.degraded === 1 ? "is een beperking" : "zijn beperkingen"} geworden: de beoordelaars bekijken die plekken zelf, en het rapport noemt ze.` : "";
      process.stdout.write(`${result.degraded ? "bewijs niet volledig, verder met beperkingen." : verdict}${degradedNl}\n${result.warnings.length} waarschuwingen\n`);
      process.exitCode = { proceed: 0, review: 2, sweep: 3, explore: 1, stop: 4 }[result.next!];
      return;
    }
    case "check-gate": {
      if (!values.run) throw new Error("check-gate needs --run <run>");
      const { checkGate } = await import("./commands/gate.ts");
      const problems = await checkGate(values.run);
      for (const problem of problems) process.stdout.write(`- ${problem}\n`);
      process.stdout.write(problems.length === 0 ? "OK: de antwoorden voldoen aan de vorm\n" : `${problems.length} problemen\n`);
      process.exitCode = problems.length === 0 ? 0 : 1;
      return;
    }
    case "sweep": {
      if (!values.run) throw new Error("sweep needs --run <run>");
      const { sweep } = await import("./commands/sweep.ts");
      await sweep({ run: values.run, only: values.only, fresh: values.fresh, atOnce: parseAtOnce(values["at-once"], "pagina's, rondes of groepen proeven") }, (line) => process.stdout.write(`${line}\n`));
      return;
    }
    case "collect":
    case "contrast":
    case "states":
    case "documents": {
      if (!values.run) throw new Error(`${command} needs --run <run>`);
      const { sweepStep } = await import("./commands/sweep.ts");
      const what = { collect: "pagina's", contrast: "rondes", states: "groepen proeven", documents: "documenten" }[command];
      for (const line of await sweepStep(command, { run: values.run, only: command === "collect" ? values.only : undefined, fresh: values.fresh, atOnce: parseAtOnce(values["at-once"], what) })) process.stdout.write(`${line}\n`);
      return;
    }
    case "tasks": {
      if (!values.run) throw new Error("tasks needs --run <run>");
      const { instrumentTasks, recordAttempts } = await import("./commands/instrument-tasks.ts");
      const list = (text: string | undefined): string[] | undefined => text?.split(",").map((part) => part.trim()).filter(Boolean);
      if (values.attempted !== undefined) await recordAttempts(values.run, list(values.attempted) ?? []);
      const written = await instrumentTasks(values.run, { only: list(values.only), pageTypes: list(values["page-types"]), again: list(values.again), reopen: values.reopen });
      process.stdout.write(`${written.walks} walks, ${written.judges} judge tasks, ${written.verifiers} verifier tasks, ${written.finishers} finishing tasks written\n`);
      return;
    }
    case "check-walk": {
      if (!values.run || !values["page-type"]) throw new Error("check-walk needs --run and --page-type <id>");
      const { checkWalk } = await import("./commands/instrument-tasks.ts");
      const problems = await checkWalk(values.run, values["page-type"]);
      for (const problem of problems) process.stdout.write(`- ${problem}\n`);
      process.stdout.write(problems.length === 0 ? "OK: de kandidatenlijst voldoet aan de vorm\n" : `${problems.length} ${problems.length === 1 ? "probleem" : "problemen"}; herstel ze allemaal in één keer en draai de controle daarna één keer opnieuw\n`);
      process.exitCode = problems.length === 0 ? 0 : 1;
      return;
    }
    case "skip": {
      if (!values.run) throw new Error("skip needs --run <run>");
      const { skip } = await import("./commands/instrument-tasks.ts");
      process.stdout.write(`${await skip(values.run, { pageType: values["page-type"], criterion: values.criterion, round: values.round }, values.reason ?? "", values.kind)}\n`);
      return;
    }
    case "unskip": {
      if (!values.run) throw new Error("unskip needs --run <run>");
      const { unskip } = await import("./commands/instrument-tasks.ts");
      process.stdout.write(`${await unskip(values.run, { pageType: values["page-type"], criterion: values.criterion, round: values.round })} verwijderd: de opdracht staat weer open\n`);
      return;
    }
    case "check-verdict": {
      const round = values.round;
      if (!values.run || !values.criterion || (round !== "judge" && round !== "final" && round !== "finish")) throw new Error("check-verdict needs --run <run>, --criterion <id> and --round judge|final|finish");
      const { isInstrumentRun, checkInstrumentVerdict, NO_TASKS_NL } = await import("./commands/instrument-tasks.ts");
      if (!isInstrumentRun(values.run)) throw new Error(NO_TASKS_NL);
      const problems = await checkInstrumentVerdict(values.run, values.criterion, round);
      for (const problem of problems) process.stdout.write(`- ${problem}\n`);
      process.stdout.write(problems.length === 0 ? "OK: het oordeel voldoet aan de vorm en wijst naar bestaande waarnemingen\n" : `${problems.length} problemen\n`);
      process.exitCode = problems.length === 0 ? 0 : 1;
      return;
    }
    case "writes": {
      if (!values.run || !values["max-writes"]) throw new Error("writes needs --run <run> and --max-writes <n>");
      const { refuseUnderSeal } = await import("./lib/seal.ts");
      refuseUnderSeal(`${values.run}/manifest.json`);
      const raised = await raiseWrites(values.run, values["max-writes"], recording, undefined, values.origin);
      const grant = grantsOf(raised).find((candidate) => values.origin === undefined || grantOriginsOf(candidate).includes(new URL(values.origin).origin))!;
      process.stdout.write(`budget voor versturen${raised.alsoGrants ? ` naar ${grantOriginsOf(grant).join(" en ")}` : ""}: ten hoogste ${grant.maxWrites} verzendingen voor de hele run. Open punten over een budget dat op was, meet een nieuwe afmaakronde: tasks --again <criteria>\n`);
      return;
    }
    case "mail": {
      if (!values.run) throw new Error("mail vraagt --run <run>");
      const { cleanupLinesNl, mailCleanup, mailLinks, mailRegister, mailWait } = await import("./commands/mail.ts");
      const session = values.session === undefined ? {} : { session: values.session };
      if (target === "wait") {
        const timeoutSeconds = values.timeout === undefined ? undefined : Number(values.timeout);
        if (timeoutSeconds !== undefined && !(timeoutSeconds >= 0)) throw new Error("--timeout is een aantal seconden");
        process.stdout.write(`${JSON.stringify(await mailWait(values.run, { ...session, ...(timeoutSeconds !== undefined ? { timeoutSeconds } : {}) }))}\n`);
      } else if (target === "cleanup") {
        const cleanup = await mailCleanup(values.run);
        process.stdout.write(`${cleanupLinesNl(cleanup).join("\n")}\n`);
        process.exitCode = cleanup.complete ? 0 : 1;
      } else if (target === "links") {
        process.stdout.write(`${JSON.stringify(mailLinks(values.run, values.session))}\n`);
      } else if (target === "register") {
        if (!values.session) throw new Error("mail register vraagt --session <sessie>: een eigen aanmelding hoort bij één sessie");
        process.stdout.write(`${JSON.stringify(await mailRegister(values.run, values.session, { fresh: values.fresh }))}\n`);
      } else if (target === "status") {
        const { readMailboxState } = await import("./lib/mailbox.ts");
        process.stdout.write(`${JSON.stringify(readMailboxState(values.run))}\n`);
      } else throw new Error(`mail kent wait, cleanup, links, register en status, niet "${target}"`);
      return;
    }
    case "secrets": {
      if (!values.run) throw new Error("secrets vraagt --run <run>");
      const { secretsLinesNl } = await import("./lib/secrets.ts");
      process.stdout.write(`${secretsLinesNl(values.run).join("\n")}\n`);
      return;
    }
    case "pending": {
      if (!values.run) throw new Error("pending needs --run <run>");
      const { isInstrumentRun, instrumentPending, briefPending, NO_TASKS_NL } = await import("./commands/instrument-tasks.ts");
      if (!isInstrumentRun(values.run)) throw new Error(NO_TASKS_NL);
      const pending = await instrumentPending(values.run);
      // A run that comes back after a long pause, as on a weekly limit, counts again as a user of the virtual Mac (#665).
      if (pending.phase !== "done") (await import("./lib/voiceover-users.ts")).renewUser(values.run);
      // In a phase with agents: whether VoiceOver can read, when the virtual Mac is set up. Asked of lume, not read from the run.
      // Running but not warmed up costs a minute to mend and a phase of agents without VoiceOver to leave: it is warmed up from here, in the background (#596).
      const { voiceoverStatus, voiceoverWarningNl, warmUpDue } = await import("./lib/voiceover.ts");
      const status = pending.phase === "done" ? null : await voiceoverStatus();
      const warming = status !== null && warmUpDue(status);
      if (warming) (await import("./commands/voiceover.ts")).startInBackground(values.run);
      const voiceover = status === null ? null : voiceoverWarningNl(status, warming);
      process.stdout.write(`${JSON.stringify({ ...(values.brief ? briefPending(pending) : pending), ...(voiceover ? { voiceover } : {}) })}\n`);
      return;
    }
    case "estimate": {
      if (!values.run) throw new Error("estimate needs --run <run>");
      const atOnce = parseAtOnce(values["at-once"], "agents");
      const { estimateOutput } = await import("./commands/estimate.ts");
      // Whether the virtual Mac for VoiceOver is there: then the estimate says when to start it.
      const { voiceoverStatus } = await import("./lib/voiceover.ts");
      process.stdout.write(estimateOutput(values.run, { atOnce, groups: values.groups, json: values.json, voiceover: await voiceoverStatus() }));
      return;
    }
    case "gaps": {
      // More runs than one come after the first as plain words.
      const runs = [...(values.run ? [values.run] : []), ...positionals.slice(1)];
      if (runs.length === 0) throw new Error("gaps needs --run <run> [<run> ...]");
      const { gapsOutput } = await import("./commands/gaps.ts");
      process.stdout.write(gapsOutput(runs, { json: values.json }));
      return;
    }
    case "feedback": {
      if (!values.run) throw new Error("feedback needs --run <run>");
      const { feedbackOutput } = await import("./commands/feedback.ts");
      process.stdout.write(feedbackOutput(values.run, { out: values.out, json: values.json }));
      return;
    }
    case "procedures": {
      const { loadAllProcedures } = await import("./lib/procedures.ts");
      const { procedures, missing, invalid } = loadAllProcedures();
      for (const problem of invalid) process.stdout.write(`- ${problem}\n`);
      process.stdout.write(`${procedures.length} valid, ${missing.length} missing (${missing.join(" ")}), ${invalid.length} invalid\n`);
      process.exitCode = invalid.length === 0 ? 0 : 1;
      return;
    }
    case "evaluate": {
      if (!values.run || !values.name) throw new Error("evaluate needs --run <run> and --name <site>");
      const { evaluate } = await import("./commands/evaluate.ts");
      const result = await evaluate({ run: values.run, name: values.name, organisation: values.organisation ?? null, model: values.model, previous: values.previous });
      process.stdout.write(`${JSON.stringify(result.summary["2.2"])}\n`);
      return;
    }
    case "answer": {
      if (!values.run || !values.criterion) throw new Error("answer needs --run <run> and --criterion <id>");
      const { answer, ANSWER_PRIVACY_NL } = await import("./commands/answer.ts");
      const result = await answer({ run: values.run, criterion: values.criterion, point: values.point === undefined ? undefined : Number(values.point), did: values.did, outcome: values.outcome, name: values.name, role: values.role, ...recording });
      for (const point of result.points) process.stdout.write(`${point.number}. [${point.kindNl}] ${point.textNl}${point.answered ? ` (beantwoord: ${point.answered})` : ""}\n`);
      const { NOT_SENT } = await import("./lib/verdict.ts");
      if (result.written === null && result.points.some((point) => point.kindNl === NOT_SENT && point.answered === null)) process.stdout.write(`Een punt [${NOT_SENT}] heeft geen persoon nodig: een nieuw onderzoek met een testomgeving, verklaard bij inventory (--test-environment <origin> --declared-by "<naam>, <functie>"), meet het met een instrument. Die origin mag die van alleen het ingesloten venster zijn. ${LOCAL_TEST_ENVIRONMENT_NL} Legt een persoon het toch vast, dan zegt --did wat er is verstuurd en waar.\n`);
      if (result.written === null) process.stdout.write(`${result.left} van de ${result.points.length} open punten zonder antwoord. Een antwoord vastleggen: --point <nummer> --did "<wat is gedaan of besloten>" --outcome passed|failed|inapplicable --name "<naam>" --role "<functie>". Let op: ${ANSWER_PRIVACY_NL}.\n`);
      else process.stdout.write(`antwoord vastgelegd in ${result.written}; nog ${result.left} open ${result.left === 1 ? "punt" : "punten"} bij dit criterium. Draai evaluate, render en seal opnieuw: dan telt het antwoord mee. Let op: ${ANSWER_PRIVACY_NL}.\n`);
      return;
    }
    case "merge": {
      if (!values.run) throw new Error("merge needs --run <run>");
      const { merge } = await import("./commands/merge.ts");
      const result = await merge(values.run, values.previous);
      process.stdout.write(`${result.defects} gebreken, ${result.findings} bevindingen onder ${result.criteria} criteria (vaste regels: ${result.byRules}; voorstel: ${result.proposal === "applied" ? "toegepast" : "niet uitgevoerd"})\n${result.task}\n`);
      // Grouping the findings again can leave a weighing behind that was made for other defects: say so here.
      if (result.weighed && result.weighed.findings > 0) {
        const { weighingLineNl } = await import("./commands/weigh.ts");
        process.stdout.write(`${weighingLineNl(result.weighed)}\n`);
      }
      return;
    }
    case "check-merge": {
      if (!values.run) throw new Error("check-merge needs --run <run>");
      const { checkMerge } = await import("./commands/merge.ts");
      const problems = await checkMerge(values.run);
      for (const problem of problems) process.stdout.write(`- ${problem}\n`);
      process.stdout.write(problems.length === 0 ? "OK: het voorstel voldoet aan de regels\n" : `${problems.length} problemen\n`);
      process.exitCode = problems.length === 0 ? 0 : 1;
      return;
    }
    case "weigh": {
      if (!values.run) throw new Error("weigh needs --run <run>");
      const { weigh } = await import("./commands/weigh.ts");
      const result = await weigh(values.run);
      const { weighingLineNl } = await import("./commands/weigh.ts");
      process.stdout.write(`${result.findings} bevindingen; ${weighingLineNl(result)}\n${result.weighing === "applied" ? `${result.task}\n` : ""}`);
      return;
    }
    case "check-weigh": {
      if (!values.run) throw new Error("check-weigh needs --run <run>");
      const { checkWeigh } = await import("./commands/weigh.ts");
      const problems = await checkWeigh(values.run);
      for (const problem of problems) process.stdout.write(`- ${problem}\n`);
      process.stdout.write(problems.length === 0 ? "OK: de weging voldoet aan de regels\n" : `${problems.length} problemen\n`);
      process.exitCode = problems.length === 0 ? 0 : 1;
      return;
    }
    case "summarize": {
      if (!values.run) throw new Error("summarize vraagt --run <run>");
      const { summarize, summaryLineNl } = await import("./commands/summarize.ts");
      const result = await summarize(values.run);
      process.stdout.write(`${summaryLineNl(result)}\n${result.summary === "applied" ? "" : `${result.reason === "unread" ? result.readTask : result.task}\n`}`);
      return;
    }
    case "check-summary": {
      if (!values.run) throw new Error("check-summary vraagt --run <run>");
      const { checkSummary } = await import("./commands/summarize.ts");
      const problems = await checkSummary(values.run);
      for (const problem of problems) process.stdout.write(`- ${problem}\n`);
      process.stdout.write(problems.length === 0 ? "OK: de samenvatting houdt zich aan het rapport\n" : `${problems.length} ${problems.length === 1 ? "probleem" : "problemen"}\n`);
      process.exitCode = problems.length === 0 ? 0 : 1;
      return;
    }
    case "check-reading": {
      if (!values.run) throw new Error("check-reading vraagt --run <run>");
      const { checkReading } = await import("./commands/summarize.ts");
      const { problems, refuted } = await checkReading(values.run);
      for (const problem of problems) process.stdout.write(`- ${problem}\n`);
      for (const sentence of refuted) process.stdout.write(`niet gedragen, zin ${sentence.n}: ${sentence.sentence}\n  ${sentence.noteNl}\n`);
      process.stdout.write(problems.length > 0 ? `${problems.length} ${problems.length === 1 ? "probleem" : "problemen"}\n` : refuted.length > 0 ? `OK: het oordeel is volledig. ${refuted.length === 1 ? "1 zin is" : `${refuted.length} zinnen zijn`} niet gedragen; de samenvatting komt zo niet in het rapport\n` : "OK: het rapport draagt elke zin van de samenvatting\n");
      process.exitCode = problems.length === 0 ? 0 : 1;
      return;
    }
    case "publish": {
      if (!values.run || !values.out) throw new Error("publish needs --run <run> --out <dir>");
      if (values.toon === undefined && (values.live || values.preview !== undefined || values["replace-unseen"] || values["toon-host"] !== undefined || values["toon-url"] !== undefined)) throw new Error("--live, --preview, --replace-unseen, --toon-host en --toon-url horen bij --toon <groep/site>");
      const { publish } = await import("./commands/publish.ts");
      const result = await publish(values.run, values.out, values.site ? { site: values.site } : {});
      process.stdout.write(`${result.round}\n${result.index}\n`);
      for (const note of result.notesNl) process.stdout.write(`- ${note}\n`);
      if (values.toon === undefined) return;
      const { publishToToon } = await import("./commands/publish-toon.ts");
      const { dirname } = await import("node:path");
      const online = await publishToToon(dirname(result.index), { name: result.publication.site, baseUrl: result.publication.baseUrl }, {
        site: values.toon,
        ...(values["toon-host"] !== undefined ? { host: values["toon-host"] } : {}),
        ...(values["toon-url"] !== undefined ? { siteUrl: values["toon-url"] } : {}),
        live: values.live,
        ...(values.preview !== undefined ? { preview: values.preview } : {}),
        replaceUnseen: values["replace-unseen"],
      });
      if (online.fetched.length > 0) process.stdout.write(`- opgehaald van de site, zodat ze blijven: ${online.fetched.join(", ")}\n`);
      process.stdout.write(`${online.url}\n`);
      for (const note of online.notesNl) process.stdout.write(`- ${note}\n`);
      return;
    }
    case "render": {
      if (!values.run) throw new Error("render needs --run <run>");
      if (values.rechecks) {
        const { renderRechecks } = await import("./commands/recheck.ts");
        const written = await renderRechecks(values.run);
        process.stdout.write(`${written.path}\n${written.checked} ${written.checked === 1 ? "nameting" : "nametingen"} van een bevinding${written.unchecked > 0 ? `; ${written.unchecked} niet getoond, omdat de controle (check-recheck) niet slaagde of het resultaat daarna veranderde` : ""}. Het rapport en het zegel zijn niet aangeraakt.\n`);
        return;
      }
      if (values.embedded) {
        const { renderEmbedded } = await import("./commands/render.ts");
        process.stdout.write(await renderEmbedded(values.run));
        return;
      }
      const { render } = await import("./commands/render.ts");
      const result = await render(values.run);
      process.stdout.write(`${result.markdown}\n${result.html}\n${result.pdf ?? "(geen pdf)"}\n${result.shortPdf ? `${result.shortPdf}\n` : ""}`);
      for (const problem of result.pdfChecks) process.stdout.write(`- ${problem}\n`);
      // Whoever leads the run sees here whether the summary is in the report that was just written.
      const summary = (await (await import("./commands/sign.ts")).readEvaluation(join(values.run, "evaluation.json"))).executiveSummary;
      process.stdout.write(summary?.status === "applied" ? "met de samenvatting voor de leiding\n" : `zonder samenvatting voor de leiding: het rapport opent met de zin van loep${summary ? "; draai summarize om te zien waarom" : ""}\n`);
      for (const note of result.cutoutNotes) process.stdout.write(`- ${note}\n`);
      for (const warning of result.pdfWarnings) process.stdout.write(`LET OP: ${warning}\n`);
      // A report whose PDF fails its own accessibility check is not fit to hand over.
      if (result.pdfChecks.length > 0) process.exitCode = 1;
      return;
    }
    case "recheck": {
      if (!values.run) throw new Error("recheck needs --run <run>");
      const { recheck } = await import("./commands/recheck.ts");
      const written = await recheck(values.run, { finding: values.finding, criterion: values.criterion });
      process.stdout.write(`${join(values.run, written.task)}\nnameting van ${written.findings.join(", ")}: start één agent met deze opdracht, in sessie ${written.session}. Alles komt in ${join(values.run, written.dir)}; de evaluatie, het rapport en het zegel blijven zoals ze zijn. De agent start zijn sessie in die map, met een eigen sessieproces: een nameting telt niet mee bij het maximum van de run, en een sessie op de run zelf is niet nodig (op een verzegelde run weigert die).\n`);
      return;
    }
    case "check-recheck": {
      const target = values.finding ?? values.criterion;
      if (!values.run || !target || (values.finding !== undefined && values.criterion !== undefined)) throw new Error("check-recheck needs --run <run> and --finding <id> or --criterion <id>");
      const { checkRecheck } = await import("./commands/recheck.ts");
      const { problems } = await checkRecheck(values.run, target, values.at);
      for (const problem of problems) process.stdout.write(`- ${problem}\n`);
      process.stdout.write(problems.length === 0 ? "OK: de nameting wijst naar eigen, nieuwe waarnemingen en is vastgelegd\n" : `${problems.length} problemen\n`);
      process.exitCode = problems.length === 0 ? 0 : 1;
      return;
    }
    case "handout": {
      if (!values.run || !values.out) throw new Error("handout vraagt --run <run> en --out <map buiten de run>");
      const { handout } = await import("./commands/handout.ts");
      // De naam komt in een bestandsnaam: een schuine streep of een punt vooraan zou het rapport buiten --out zetten.
      if (values.name !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(values.name)) throw new Error(`handout --name "${values.name}": alleen letters, cijfers, punten, streepjes en lage streepjes, zonder schuine streep`);
      const result = await handout(values.run, values.out, values.name);
      for (const file of result.written) process.stdout.write(`${file}\n`);
      if (!result.signed) process.stdout.write("Het rapport is niet afgetekend: de naam zegt concept.\n");
      if (result.missing.length > 0) process.stdout.write(`Niet in de run: ${result.missing.join(", ")}.\n`);
      return;
    }
    case "export": {
      if (!values.run) throw new Error("export needs --run <run>");
      const { exportWorkList } = await import("./commands/export.ts");
      const result = await exportWorkList({ run: values.run, format: values.format, out: values.out });
      if (result.text !== null) process.stdout.write(result.text);
      else if (result.format === "csv") process.stdout.write(`${result.lines} regels van de werklijst in ${result.written[0]}\n`);
      else {
        process.stdout.write(`${result.lines} issues klaar in ${values.out}, een bestand per gebrek; de eerste regel is de titel. Er is niets aangemaakt.\n`);
        process.stdout.write(`Aanmaken, na het lezen: for f in ${values.out}/*.md; do gh issue create --title "$(head -n 1 "$f" | sed 's/^# //')" --body "$(tail -n +3 "$f")"; done\n`);
      }
      return;
    }
    case "sign": {
      if (!values.run || !values.name || !values.role || !values.organisation) throw new Error("sign needs --run, --name, --role and --organisation");
      const { sign } = await import("./commands/sign.ts");
      const signature = await sign({ run: values.run, name: values.name, role: values.role, organisation: values.organisation, checkedNl: values.checked ?? null });
      process.stdout.write(`getekend voor evaluatie ${signature.evaluationSha256.slice(0, 12)}, verzegeld als ${signature.sealSha256.slice(0, 12)}; render maakt nu het afgetekende rapport in signed/\n`);
      return;
    }
    case "decide": {
      if (!values.run) throw new Error("decide needs --run <run>");
      const { decide, defectLineNl } = await import("./commands/decide.ts");
      const { decisionLabelNl, DECISION_PRIVACY_NL, measureDate, NO_DATED_MEASURE_NL } = await import("./lib/decisions.ts");
      const result = await decide({ run: values.run, defect: values.defect, decision: values.decision, what: values.what, date: values.date, alternative: values.alternative, name: values.name, role: values.role, ...recording });
      if (values.defect === undefined) {
        for (const view of result.defects) process.stdout.write(`${defectLineNl(view)}\n`);
        process.stdout.write(`${result.left} van de ${result.defects.length} gebreken zonder besluit. Eén gebrek bekijken: --defect <nummer>.\n`);
        return;
      }
      const view = result.defects[0]!;
      process.stdout.write(`${defectLineNl(view)}\nPagina's: ${view.pages.join(", ") || "geen plek"}\n${view.proposalsNl.length === 1 ? "Voorstel uit het rapport" : "Voorstellen uit het rapport"}:\n${view.proposalsNl.map((text) => `- ${text}`).join("\n")}\n`);
      for (const earlier of view.current?.previous ?? []) process.stdout.write(`eerder: ${decisionLabelNl(earlier.decision, earlier.date)}, vastgelegd op ${earlier.decidedAt.slice(0, 10)}\n`);
      if (result.written === null) process.stdout.write(`Een besluit vastleggen: --decision opgelost|gepland|zienswijze|onevenredig|onbesloten --what "<wat>" [--date jjjj-mm-dd] [--alternative "<alternatief>"] --name "<naam>" --role "<functie>". Let op: ${DECISION_PRIVACY_NL}.\n`);
      else process.stdout.write(`besluit vastgelegd in ${result.written}; nog ${result.left} ${result.left === 1 ? "gebrek" : "gebreken"} zonder besluit. render zet het in het afgetekende rapport, statement in de verklaring.${view.current && measureDate(view.current) === null ? ` Een verklaring met status B vraagt bij een afwijking een maatregel met een datum. ${NO_DATED_MEASURE_NL}` : ""} Let op: ${DECISION_PRIVACY_NL}.\n`);
      return;
    }
    case "statement": {
      if (!values.run) throw new Error("statement needs --run <run>");
      const { statement } = await import("./commands/statement.ts");
      const result = await statement(values.run, values.concept);
      process.stdout.write(`status ${result.status}; ${result.openItems.length} punten nog in te vullen\n${result.files.join("\n")}\n`);
      if (result.missingMeasuresNl) process.stdout.write(`LET OP: ${result.missingMeasuresNl}\n`);
      const { registerCaveatNl } = await import("./lib/statement.ts");
      const caveat = registerCaveatNl(result.status);
      if (caveat) process.stdout.write(`LET OP: ${caveat}\n`);
      for (const problem of result.pdfChecks) process.stdout.write(`- ${problem}\n`);
      for (const warning of result.pdfWarnings) process.stdout.write(`LET OP: ${warning}\n`);
      if (result.pdfChecks.length > 0) process.exitCode = 1;
      return;
    }
    case "compare": {
      if (!values.run || !values.reference || !values.out) throw new Error("compare needs --run, --reference and --out");
      const { compareRun } = await import("./commands/compare.ts");
      const result = await compareRun(values.run, values.reference, values.out);
      process.stdout.write(`beide afgekeurd ${result.bothFailed.length}, gemist ${result.missed.length}, alleen wij ${result.onlyOurs.length}; recall ${result.recall}, onterecht goedgekeurd ${result.falsePassRate}\n`);
      return;
    }
    case "diff": {
      if (!values.previous || !values.current || !values.out) throw new Error("diff needs --previous <evaluation.json>, --current <evaluation.json> and --out <dir>");
      const { diff } = await import("./commands/diff.ts");
      const { difference, markdown } = await diff(values.previous, values.current, values.out);
      process.stdout.write(`opgelost ${difference.resolved.length}, gebleven ${difference.remained.length}, nieuw ${difference.fresh.length}; ${difference.outcomes.length} criteria met een andere uitkomst\n${markdown}\n`);
      return;
    }
    case "purpose": {
      if (!values.run) throw new Error("purpose needs --run <run>");
      const { parsePurpose, PURPOSE_NL, purposeForRun, recordPurpose } = await import("./lib/purpose.ts");
      if (target !== undefined) await recordPurpose(values.run, parsePurpose(target));
      process.stdout.write(`doel van het onderzoek: ${PURPOSE_NL[purposeForRun(values.run)]}${target !== undefined ? "\nhet rapport zegt het pas na evaluate, render en seal" : ""}\n`);
      return;
    }
    case "seal": {
      if (!values.run) throw new Error("seal needs --run <run>");
      const { openSeal, seal } = await import("./commands/verify.ts");
      if (values.open) {
        const opened = await openSeal(values.run);
        process.stdout.write(`zegel ${opened.sha256.slice(0, 12)} geopend: de run is niet meer verzegeld, en sessies en opdrachten mogen weer in de run schrijven\n`);
        if (opened.signatureVoided) process.stdout.write("de handtekening hoorde bij dit zegel en is vervallen; het afgetekende rapport in signed/ is verwijderd\n");
        process.stdout.write(`verzegel opnieuw als het meten klaar is: evaluate, render en seal --run ${values.run}${opened.signatureVoided ? ". Laat daarna opnieuw lezen en tekenen" : ""}\n`);
        return;
      }
      const sealed = await seal(values.run);
      process.stdout.write(`verzegeld: ${sealed.sha256.slice(0, 12)} (${sealed.files} bestanden)\n`);
      if (sealed.signatureVoided) process.stdout.write("de handtekening hoorde bij het vorige zegel en is vervallen: lees het rapport en teken opnieuw\n");
      return;
    }
    case "verify": {
      if (!values.run) throw new Error("verify needs --run <run>");
      const { verify } = await import("./commands/verify.ts");
      process.exitCode = (await verify(values.run)) ? 0 : 1;
      return;
    }
    case "voiceover": {
      // Outside a run: a virtual Mac with VoiceOver that stays up for as long as the person keeps it.
      const { voiceoverRead, voiceoverSetup, voiceoverStart, voiceoverStatusCommand, voiceoverStop } = await import("./commands/voiceover.ts");
      if (target === "start") process.exitCode = await voiceoverStart({ run: values.run });
      else if (target === "read") process.exitCode = await voiceoverRead({ url: values.url, steps: values.steps, press: values.press, out: values.out });
      else if (target === "status") process.exitCode = await voiceoverStatusCommand();
      else if (target === "stop") process.exitCode = await voiceoverStop({ force: values.force, run: values.run });
      else if (target === "setup") process.exitCode = await voiceoverSetup();
      else throw new Error(`voiceover kent start, status, read, stop en setup, niet "${target}"`);
      break;
    }
    default:
      throw new Error(`unknown command "${command}"\n\n${USAGE}`);
  }
}

main().catch((error: Error) => {
  process.stderr.write(`loep: ${error.message}\n`);
  process.exitCode = 1;
});
