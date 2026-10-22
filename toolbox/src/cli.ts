#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const USAGE = `loep <command> [options]

  login --run <run> [--url <login page>] [--role <role>] [--out <file>]
                                         For a site behind a login: open a browser window in which a person logs in with a
                                         test account, and keep the session for the run. The password never reaches loep
  login --run <run> --from <file>        Take a session file that was made on another machine (login --url <page> --out <file>)
  login --run <run> --idle               A second login, with the same test account if you like, for the watch on the session
                                         (2.2.1): kept in idle-session.json, used by that watch alone
  watch-session --run <run> [--gaps 5,10,20,40,80] [--max-hours 8]
                                         The watch on the session of a run with a login. collect starts it in the background
                                         and evaluate stops it; a second start on the same run leaves the running one alone
  inventory <url> --out <run> [--also-origin <url>]... [--allow-writes | --test-environment <origin> --declared-by "<name>, <role>"] [--max-writes <n>]
                                         Find every page and count what is on it. In a run with a login the pages are found
                                         by following links from the page the person pointed at; a link that logs out is never followed
  explore --run <run>                    Write the task for the agent that maps the site before it is measured
  check-site --run <run>                 Validate site.json, replay every recipe in it and open every component on each of its
                                         page types as the sweep does; non-zero exit on problems
  sample --run <run> [--seed <text>]     Choose the pages to evaluate (all of them on a small site). Without --seed the random
                                         part follows the seed inventory made for the run
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
                                         only the agent's look at the pictures is still missing. --out leaves the run untouched
  check-gate --run <run>                 Validate the agent's answers for the gate; non-zero exit on problems
  tasks --run <run> [--only <ids>] [--page-types <ids>] [--again <ids>] [--attempted <phase>:<id>,...]
                                         Write the task files of the phase the run is in (walks, judges, verifiers, and a
                                         finishing round for what the evaluation itself left open), with a dossier per
                                         criterion; run it again after each phase. Needs the site model of explore.
                                         --again 2.4.3,3.3.1 writes a new finishing round for those criteria, also when the
                                         run is done, but only for one whose final verdict is open with a point "niet
                                         bereikbaar" or "proef werkte niet", or that another finishing round passed
                                         something on to that no round of it ruled on. Each attempt gets its own session; the earlier
                                         verdict is kept, the new one counts in evaluate. --attempted walks:start,judges:1.4.3
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
  procedures                             Validate the procedure catalogue
  evaluate --run <run> --name <site> [--organisation <name>] [--model <id>] [--previous <evaluation.json>]
                                         Combine the verdicts into evaluation.json; --model is the model the operator names,
                                         next to what each agent gave itself with session start --model
  merge --run <run> [--previous <evaluation.json>]
                                         Group findings about the same place into defects, and write the task for
                                         the optional step that proposes what else belongs together
  check-merge --run <run>                Validate the proposal of that step; non-zero exit on problems
  answer --run <run> --criterion <id> [--point <n> --did <text> --outcome passed|failed|inapplicable --name <who> --role <function>]
                                         For an open point that asks a person or a choice of the owner: record what a person
                                         did or decided and what follows for the criterion. Without --point: list the open
                                         points. The name stays in antwoorden/<criterion>.json of the run; the evaluation and
                                         the report name only the function. Counts at the next evaluate, and is sealed with the run.
                                         Confirmed at an interactive terminal, or --recorded-via gesprek (see below)
  render --run <run>                     Write the report (Markdown and PDF) from evaluation.json; after signing with the
                                         decisions about each defect
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
  statement --run <run> [--concept]      Write the accessibility statement and the answer sheet for the register
  diff --previous <evaluation.json> --current <evaluation.json> --out <dir>
                                         Write verschil.md: solved, stayed and new between two evaluations of one site
  compare --run <run> --reference <file> --out <dir>
                                         Compare the evaluation with an existing audit of the same site
  seal --run <run>                       Record the hash of every file in the run; what is signed afterwards is this seal
  verify --run <run>                     Recompute every hash in the run
  voiceover start|read|stop|setup        Optional, outside an evaluation: a real screen reader (VoiceOver in a virtual Mac) as a
                                         second source next to session speak; loep voiceover --help

Options:
  --max-pages <n>   Upper bound on pages to visit (default 200)
  --vendor-tags <p> With inventory: prefixes of element names that belong to a vendor, comma-separated ("nldd-").
                    The report lists per such element the findings that touch it; the owner of a finding stays as judged
  --vendor-name <n> With --vendor-tags: what the report calls the vendor, such as "designsysteem" (default "leverancier")
  --urls <file>     With inventory: evaluate exactly the URLs in this file, one per line
  --also-origin <u> With inventory, repeatable: a further origin of the same site, such as its documentation on
                    https://docs.example.nl. Its sitemap, start page, links, page for a missing address and documents
                    count as the site's own; one report covers all origins. An origin not given stays outside
  --allow-writes    With inventory, for a site on this machine or a .test or .localhost name only: let the run
                    submit forms and send other requests that change something. On any other site, name the test
                    environment and who declares it to be one: --test-environment <origin> --declared-by "<name>, <role>"
                    The name is kept in the manifest of the run; the report shows only the role. The declaration
                    is confirmed at an interactive terminal by typing the origin; an agent never records it
  --max-writes <n>  With --allow-writes or --test-environment: the most requests that change something the whole run
                    may send to that origin, over every session and the sweep together: default 5, at least 120 s
                    apart; on a local address default 50, without a pause. Past it every write is held back as in
                    a run without permission. Kept in the manifest
  --other-toolbox   Go on with a run that was made with another version of loep. Without it every command that
                    measures or writes tasks refuses: another version writes other tasks and procedures, and the walks
                    and verdicts of the run are then done again. Measure again with --fresh after changing. Commands
                    that measure nothing (render, statement, compare, decide, sign, seal and the readers) go on.
                    In a copy made with variant (it holds variant.json) the agent phases (tasks, skip, unskip,
                    check-walk, check-verdict, evaluate, answer, merge, check-merge) go on under another version
                    and say which version the sweep is of; the sweep itself is held to the version it was made with
  --recorded-via gesprek --confirmation <text> --summary <text>
                    With answer and decide only: the agent records what the person said in the conversation,
                    after an express confirmation. --confirmation is what the person said, word for word;
                    --summary the summary they confirmed. Both are kept with the record. Without the flag a person
                    confirms at an interactive terminal (--recorded-via terminal); without one the command refuses

Comparing per finding has its own steps: loep compare --findings --help
Measuring a variant of the code on a frozen sweep: loep variant --help (variant, compare-variants)
Tokens per agent from the transcripts of a workflow, for compare-variants --usage: loep usage --help
A browser session for an agent has its own commands: loep session --help
`;

/** The number after `--at-once`: a whole number of 1 or more, of what the command does at the same time. */
function parseAtOnce(text: string | undefined, what: string): number | undefined {
  if (text === undefined) return undefined;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1) throw new Error(`--at-once is een geheel aantal ${what}, 1 of meer`);
  return value;
}

const NOT_EXPLORED_NL = "deze run heeft geen sitemodel (site.json): verken de site eerst met explore en check-site, en draai daarna collect, contrast, states en gate";
/** The commands that measure or judge a site that was mapped first. */
const NEEDS_SITE_MODEL = ["collect", "contrast", "states", "gate", "tasks"];

async function main(): Promise<void> {
  // Comparing per finding has its own steps and options; it parses them itself.
  if (process.argv[2] === "compare" && process.argv.includes("--findings")) return (await import("./commands/compare-findings.ts")).cli(process.argv.slice(3));
  if (process.argv[2] === "calibrate") return (await import("./commands/calibrate.ts")).cli(process.argv.slice(3)); // outside an evaluation: measures the instruments against the ACT test cases
  if (process.argv[2] === "variant" || process.argv[2] === "compare-variants") return (await import("./commands/variants.ts")).cli(process.argv.slice(2)); // outside an evaluation: measures a variant of the code on a frozen sweep
  if (process.argv[2] === "usage") return (await import("./commands/usage.ts")).cli(process.argv.slice(3)); // outside an evaluation: tokens per agent from the transcripts, for compare-variants --usage
  // A session takes its commands and options as they come; it parses them itself.
  if (process.argv[2] === "session") {
    const { sessionCli, SESSION_USAGE } = await import("./session/client.ts");
    if (process.argv.length === 3 || process.argv.includes("--help")) process.stdout.write(SESSION_USAGE);
    else process.exitCode = await sessionCli(process.argv.slice(2));
    return;
  }
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string" },
      run: { type: "string" },
      "max-pages": { type: "string", default: "200" },
      idle: { type: "boolean", default: false },
      gaps: { type: "string" },
      "max-hours": { type: "string" },
      "vendor-tags": { type: "string" },
      "vendor-name": { type: "string" },
      only: { type: "string" },
      urls: { type: "string" },
      "also-origin": { type: "string", multiple: true },
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
      "other-toolbox": { type: "boolean", default: false },
      "allow-writes": { type: "boolean", default: false },
      "test-environment": { type: "string" },
      "declared-by": { type: "string" },
      "max-writes": { type: "string" },
      url: { type: "string" },
      from: { type: "string" },
      steps: { type: "string" },
      press: { type: "string" },
      "at-once": { type: "string" },
      groups: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, target] = positionals;
  if (command === "voiceover" && (values.help || !target)) {
    process.stdout.write((await import("./commands/voiceover.ts")).VOICEOVER_USAGE);
    return;
  }
  if (values.help || !command) {
    process.stdout.write(USAGE);
    return;
  }
  // A run that was given a test environment at inventory may write there; every other run holds all writes back.
  const { confirmDeclaration, decideWrites, DEFAULT_WRITE_SPACING_SECONDS, recordWrites, setRunWrites, spacingNl, writeAccess, writesForRun } = await import("./lib/writes.ts");
  if (command !== "inventory" && (values["allow-writes"] || values["test-environment"] !== undefined || values["declared-by"] !== undefined || values["max-writes"] !== undefined)) {
    throw new Error("--allow-writes, --test-environment, --declared-by en --max-writes horen bij inventory: daar wordt voor de hele run vastgelegd of er verstuurd mag worden, en hoe vaak");
  }
  // How a statement of a person came about is recorded with it. An answer and a decision may be recorded by the agent in the
  // conversation; a signature and the declaration for sending only by a person at an interactive terminal.
  const { HUMAN_AT_TERMINAL_NL, parseRecordedVia } = await import("./lib/recorded.ts");
  const recordedVia = parseRecordedVia(values["recorded-via"]);
  const recording = { recordedVia: values["recorded-via"], confirmation: values.confirmation, summary: values.summary };
  if (recordedVia === "gesprek" && (command === "sign" || command === "inventory")) throw new Error(`${command === "sign" ? "tekenen" : "de verklaring dat er verstuurd mag worden"} legt de assistent nooit vast, ook niet na een bevestiging in het gesprek. ${HUMAN_AT_TERMINAL_NL}`);
  if ((recordedVia !== undefined || values.confirmation !== undefined || values.summary !== undefined) && command !== "answer" && command !== "decide") throw new Error("--recorded-via, --confirmation en --summary horen bij answer en decide");
  if (command !== "inventory" && values["also-origin"] !== undefined) throw new Error("--also-origin hoort bij inventory: daar wordt vastgelegd welke origins samen de site zijn");
  // A run goes on with the version of loep it was made with; another version would quietly write other tasks over it.
  if (values.run) {
    const { frozenSweepNl, otherToolboxNl } = await import("./lib/manifest.ts");
    const refusal = otherToolboxNl(values.run, command, values["other-toolbox"]);
    if (refusal) throw new Error(refusal);
    const frozen = frozenSweepNl(values.run, command);
    if (frozen) process.stderr.write(`loep: ${frozen}\n`);
  }
  // `gaps` and `feedback` read the verdicts and the evaluation of finished runs and nothing else of them: they need no permission to write and no login.
  const readsOnly = command === "gaps" || command === "feedback";
  if (command !== "inventory" && !readsOnly && values.run) {
    const permission = writesForRun(values.run);
    if (permission) setRunWrites(writeAccess(values.run, permission, command));
    // A read request of the site model, such as a question to a search service, passes once check-site passed the model as it is now.
    const { refusedReadsLog, setRunReads } = await import("./lib/reads.ts");
    const { approvedReads } = await import("./lib/sitemodel.ts");
    setRunReads(approvedReads(values.run), refusedReadsLog(values.run, command));
  }
  // A run for which a person logged in starts every browser with that session; any other run is left as it was.
  const { runLoginMark, setRunLogin } = await import("./lib/login.ts");
  if (command !== "inventory" && command !== "login" && !readsOnly && values.run) setRunLogin(values.run);
  // A site that refused the evaluation (blockades.json in the run) is asked nothing by the sweep either, and a 429 it gives the sweep ends the asking for the sessions too.
  if (command !== "inventory" && !readsOnly && values.run) (await import("./session/blockade.ts")).setRunBlockade(values.run);
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
      if (permission?.declaredBy) Object.assign(permission, await confirmDeclaration(permission));
      if (permission) setRunWrites(writeAccess(values.out, permission, "inventory"));
      // What this command was given decides whether a session may be used: the manifest only holds it afterwards.
      setRunLogin(values.out, { writes: permission });
      const { formPagesNl, inventory, pageLimitNl, passwordPagesNl, readsOutsideRunNl } = await import("./commands/inventory.ts");
      const { originsNl, originsOfRun, siteOrigins } = await import("./lib/origins.ts");
      // Checked before the browser starts: a mistyped origin should not cost a whole inventory.
      const origins = originsOfRun(target, values["also-origin"]);
      if ((values["also-origin"]?.length ?? 0) > 0 && origins.length === 1) throw new Error(`--also-origin noemt alleen de origin van het startadres (${origins[0]}); een tweede origin is bijvoorbeeld https://docs.example.nl`);
      const fixedUrls = values.urls ? (await import("node:fs")).readFileSync(values.urls, "utf8").split("\n").map((line) => line.trim()).filter(Boolean) : undefined;
      const tagPrefixes = (values["vendor-tags"] ?? "").split(",").map((prefix) => prefix.trim().toLowerCase()).filter(Boolean);
      if (tagPrefixes.some((prefix) => !/^[a-z][a-z0-9]*-[a-z0-9-]*$/.test(prefix))) throw new Error('--vendor-tags: elke prefix is het begin van een elementnaam met een streepje, zoals "nldd-"');
      if (values["vendor-name"] !== undefined && tagPrefixes.length === 0) throw new Error("--vendor-name hoort bij --vendor-tags");
      const vendor = tagPrefixes.length > 0 ? { tagPrefixes, nameNl: values["vendor-name"]?.trim() || "leverancier" } : undefined;
      const result = await inventory({ baseUrl: target, out: values.out, maxPages: Number(values["max-pages"]), fixedUrls, vendor, alsoOrigins: values["also-origin"] });
      await recordWrites(values.out, permission);
      if (permission) {
        process.stdout.write(`versturen toegestaan naar ${permission.origin}${permission.declaredBy ? `, verklaard door ${permission.declaredBy.name} (${permission.declaredBy.role})` : ""}\n`);
        process.stdout.write(`budget voor versturen: ten hoogste ${permission.maxWrites} verzendingen naar die origin voor de hele run, alle agents en de veegronde samen${spacingNl(permission.spacingSeconds ?? DEFAULT_WRITE_SPACING_SECONDS)}. Zoveel berichten of formulieren krijgt de ontvanger ten hoogste.\n`);
        // Say where the declaration ends up, so nobody finds their name somewhere they did not expect.
        if (permission.declaredBy) process.stdout.write(`let op: de naam staat in manifest.json van deze run; het rapport en de verklaring noemen alleen de functie (${permission.declaredBy.role}). Wie de map van de run deelt of publiceert, deelt ook de naam.\n`);
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
      return;
    }
    case "explore": {
      if (!values.run) throw new Error("explore needs --run <run>");
      const { explore } = await import("./commands/explore.ts");
      const result = await explore(values.run);
      process.stdout.write(`${result.task}\nronde ${result.round}: ${result.pages} pagina's, ${result.frames} ingesloten vensters\n`);
      return;
    }
    case "check-site": {
      if (!values.run) throw new Error("check-site needs --run <run>");
      const { checkSite } = await import("./commands/explore.ts");
      const check = await checkSite(values.run);
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
      const { gate } = await import("./commands/gate.ts");
      const result = await gate(values.run, values.out ?? values.run);
      for (const check of result.checks) process.stdout.write(`${check.ok ? "ok  " : "GAT "} ${check.name}: ${check.noteNl}\n`);
      for (const gap of result.gaps) process.stdout.write(`- ${gap.check}${gap.page ? ` ${gap.page}` : ""}${gap.state !== "default" ? ` [${gap.state}]` : ""}: ${gap.missingNl}\n`);
      for (const gap of result.limitations) process.stdout.write(`  (beperking) ${gap.check}${gap.page ? ` ${gap.page}` : ""}${gap.state !== "default" ? ` [${gap.state}]` : ""}: ${gap.missingNl}\n`);
      for (const gap of result.accepted) process.stdout.write(`  (aanvaard door ${gap.decidedBy}) ${gap.check}${gap.page ? ` ${gap.page}` : ""}: ${gap.reasonNl}\n`);
      const verdict = result.sufficient ? "bewijs voldoende" : result.stage === "review-pending" ? `vaste controles voldoende; de beelden zijn nog niet bekeken: ${result.review.tasks.map((part) => part.task).join(", ")}${result.review.tasks.length > 1 ? " (één agent per opdracht)" : ""}` : `bewijs onvoldoende: ${result.gaps.length} ${result.gaps.length === 1 ? "gat" : "gaten"}${result.stage === "deterministic" ? " in de vaste controles" : ""}; nog ${result.returnsLeft} keer terug naar de verkenner`;
      process.stdout.write(`${verdict}\n${result.warnings.length} waarschuwingen\n`);
      process.exitCode = result.sufficient ? 0 : result.stage === "review-pending" ? 2 : 1;
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
    case "collect": {
      if (!values.run) throw new Error("collect needs --run <run>");
      const { collect } = await import("./commands/collect.ts");
      await collect({ run: values.run, only: values.only, fresh: values.fresh, atOnce: parseAtOnce(values["at-once"], "pagina's") });
      return;
    }
    case "contrast": {
      if (!values.run) throw new Error("contrast needs --run <run>");
      const { contrast } = await import("./commands/contrast.ts");
      const atOnce = parseAtOnce(values["at-once"], "rondes");
      const pages = await contrast(values.run, { fresh: values.fresh, ...(atOnce ? { atOnce } : {}) });
      const all = pages.flatMap((page) => page.measurements);
      const count = (outcome: string): number => all.filter((entry) => entry.outcome === outcome).length;
      process.stdout.write(`${all.length} stukken tekst (standaardvenster en 320 breed, licht en donker): ${count("passed")} voldoende, ${count("failed")} onvoldoende, ${count("cantTell")} niet te meten, ${count("exempt")} uitgezonderd\n`);
      return;
    }
    case "states": {
      if (!values.run) throw new Error("states needs --run <run>");
      const { states } = await import("./commands/states.ts");
      const atOnce = parseAtOnce(values["at-once"], "groepen proeven");
      const result = await states(values.run, { fresh: values.fresh, ...(atOnce ? { atOnce } : {}) });
      process.stdout.write(`${result.examined.triggers} triggers, ${result.dialogs.filter((dialog) => dialog.opened).length} opened something, ${result.examined.forms} forms, ${result.singleKeys.reactions.length} key reactions, ${result.hover.length} hover appearances\n`);
      // A limit that cut something off is said here too, not only in the dossier.
      const press = result.downEventCoverage;
      if (press) process.stdout.write(`indrukproef: ${press.examined} van ${press.kindsFound} soorten bedieningselementen onderzocht${press.notExamined > 0 ? `, ${press.notExamined} niet (grens ${press.limit})` : ""}\n`);
      if (result.hoverCoverage?.kinds !== undefined) process.stdout.write(`aanwijzen en focus: ${result.hoverCoverage.found} bedieningselementen in ${result.hoverCoverage.kinds} soorten, ${result.hoverCoverage.examined} aangewezen${result.hoverCoverage.notExamined > 0 ? `, ${result.hoverCoverage.notExamined} soorten niet (grens ${result.hoverCoverage.limit})` : ""}\n`);
      else if ((result.hoverCoverage?.notExamined ?? 0) > 0) process.stdout.write(`aanwijzen en focus: ${result.hoverCoverage!.notExamined} van ${result.hoverCoverage!.found} bedieningselementen niet onderzocht (grens ${result.hoverCoverage!.limit})\n`);
      return;
    }
    case "documents": {
      if (!values.run) throw new Error("documents needs --run <run>");
      const { documents } = await import("./commands/documents.ts");
      const result = await documents(values.run);
      process.stdout.write(result.documents === 0 ? "geen documenten in de steekproef\n" : `${result.documents} documenten: ${result.read} ingelezen, ${result.notRead} van een soort die niet wordt ingelezen, ${result.failed} niet op te halen of te openen\n`);
      return;
    }
    case "tasks": {
      if (!values.run) throw new Error("tasks needs --run <run>");
      const { instrumentTasks, recordAttempts } = await import("./commands/instrument-tasks.ts");
      const list = (text: string | undefined): string[] | undefined => text?.split(",").map((part) => part.trim()).filter(Boolean);
      if (values.attempted !== undefined) await recordAttempts(values.run, list(values.attempted) ?? []);
      const written = await instrumentTasks(values.run, { only: list(values.only), pageTypes: list(values["page-types"]), again: list(values.again) });
      process.stdout.write(`${written.walks} walks, ${written.judges} judge tasks, ${written.verifiers} verifier tasks, ${written.finishers} finishing tasks written\n`);
      return;
    }
    case "check-walk": {
      if (!values.run || !values["page-type"]) throw new Error("check-walk needs --run and --page-type <id>");
      const { checkWalk } = await import("./commands/instrument-tasks.ts");
      const problems = await checkWalk(values.run, values["page-type"]);
      for (const problem of problems) process.stdout.write(`- ${problem}\n`);
      process.stdout.write(problems.length === 0 ? "OK: de kandidatenlijst voldoet aan de vorm\n" : `${problems.length} problemen\n`);
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
    case "pending": {
      if (!values.run) throw new Error("pending needs --run <run>");
      const { isInstrumentRun, instrumentPending, briefPending, NO_TASKS_NL } = await import("./commands/instrument-tasks.ts");
      if (!isInstrumentRun(values.run)) throw new Error(NO_TASKS_NL);
      const pending = await instrumentPending(values.run);
      process.stdout.write(`${JSON.stringify(values.brief ? briefPending(pending) : pending)}\n`);
      return;
    }
    case "estimate": {
      if (!values.run) throw new Error("estimate needs --run <run>");
      const atOnce = parseAtOnce(values["at-once"], "agents");
      const { estimateOutput } = await import("./commands/estimate.ts");
      // Whether the virtual Mac for VoiceOver is there: then the estimate says when to start it.
      const { lumeGuest } = await import("./lib/voiceover.ts");
      const guest = await lumeGuest().state();
      process.stdout.write(estimateOutput(values.run, { atOnce, groups: values.groups, json: values.json, voiceover: guest === "running" || guest === "stopped" ? guest : null }));
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
      if (result.written === null && result.points.some((point) => point.kindNl === NOT_SENT && point.answered === null)) process.stdout.write(`Een punt [${NOT_SENT}] heeft geen persoon nodig: een nieuw onderzoek met een testomgeving, verklaard bij inventory (--test-environment <origin> --declared-by "<naam>, <functie>"), meet het met een instrument. Die origin mag die van alleen het ingesloten venster zijn. Legt een persoon het toch vast, dan zegt --did wat er is verstuurd en waar.\n`);
      if (result.written === null) process.stdout.write(`${result.left} van de ${result.points.length} open punten zonder antwoord. Een antwoord vastleggen: --point <nummer> --did "<wat is gedaan of besloten>" --outcome passed|failed|inapplicable --name "<naam>" --role "<functie>". Let op: ${ANSWER_PRIVACY_NL}.\n`);
      else process.stdout.write(`antwoord vastgelegd in ${result.written}; nog ${result.left} open ${result.left === 1 ? "punt" : "punten"} bij dit criterium. Draai evaluate, render en seal opnieuw: dan telt het antwoord mee. Let op: ${ANSWER_PRIVACY_NL}.\n`);
      return;
    }
    case "merge": {
      if (!values.run) throw new Error("merge needs --run <run>");
      const { merge } = await import("./commands/merge.ts");
      const result = await merge(values.run, values.previous);
      process.stdout.write(`${result.defects} gebreken, ${result.findings} bevindingen onder ${result.criteria} criteria (vaste regels: ${result.byRules}; voorstel: ${result.proposal === "applied" ? "toegepast" : "niet uitgevoerd"})\n${result.task}\n`);
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
    case "render": {
      if (!values.run) throw new Error("render needs --run <run>");
      const { render } = await import("./commands/render.ts");
      const result = await render(values.run);
      process.stdout.write(`${result.markdown}\n${result.pdf ?? "(geen pdf)"}\n${result.shortPdf ? `${result.shortPdf}\n` : ""}`);
      for (const problem of result.pdfChecks) process.stdout.write(`- ${problem}\n`);
      // A report whose PDF fails its own accessibility check is not fit to hand over.
      if (result.pdfChecks.length > 0) process.exitCode = 1;
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
      const { DECISION_LABEL_NL, DECISION_PRIVACY_NL } = await import("./lib/decisions.ts");
      const result = await decide({ run: values.run, defect: values.defect, decision: values.decision, what: values.what, date: values.date, alternative: values.alternative, name: values.name, role: values.role, ...recording });
      if (values.defect === undefined) {
        for (const view of result.defects) process.stdout.write(`${defectLineNl(view)}\n`);
        process.stdout.write(`${result.left} van de ${result.defects.length} gebreken zonder besluit. Eén gebrek bekijken: --defect <nummer>.\n`);
        return;
      }
      const view = result.defects[0]!;
      process.stdout.write(`${defectLineNl(view)}\nPagina's: ${view.pages.join(", ") || "geen plek"}\n${view.proposalsNl.length === 1 ? "Voorstel uit het rapport" : "Voorstellen uit het rapport"}:\n${view.proposalsNl.map((text) => `- ${text}`).join("\n")}\n`);
      for (const earlier of view.current?.previous ?? []) process.stdout.write(`eerder: ${DECISION_LABEL_NL[earlier.decision]}${earlier.date ? ` (${earlier.date})` : ""}, vastgelegd op ${earlier.decidedAt.slice(0, 10)}\n`);
      if (result.written === null) process.stdout.write(`Een besluit vastleggen: --decision opgelost|gepland|zienswijze|onevenredig|onbesloten --what "<wat>" [--date jjjj-mm-dd] [--alternative "<alternatief>"] --name "<naam>" --role "<functie>". Let op: ${DECISION_PRIVACY_NL}.\n`);
      else process.stdout.write(`besluit vastgelegd in ${result.written}; nog ${result.left} ${result.left === 1 ? "gebrek" : "gebreken"} zonder besluit. render zet het in het afgetekende rapport, statement in de verklaring. Let op: ${DECISION_PRIVACY_NL}.\n`);
      return;
    }
    case "statement": {
      if (!values.run) throw new Error("statement needs --run <run>");
      const { statement } = await import("./commands/statement.ts");
      const result = await statement(values.run, values.concept);
      process.stdout.write(`status ${result.status}; ${result.openItems.length} punten nog in te vullen\n${result.files.join("\n")}\n`);
      if (result.missingMeasuresNl) process.stdout.write(`LET OP: ${result.missingMeasuresNl}\n`);
      for (const problem of result.pdfChecks) process.stdout.write(`- ${problem}\n`);
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
    case "seal": {
      if (!values.run) throw new Error("seal needs --run <run>");
      const { seal } = await import("./commands/verify.ts");
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
      const { voiceoverRead, voiceoverSetup, voiceoverStart, voiceoverStop } = await import("./commands/voiceover.ts");
      if (target === "start") process.exitCode = await voiceoverStart();
      else if (target === "read") process.exitCode = await voiceoverRead({ url: values.url, steps: values.steps, press: values.press, out: values.out });
      else if (target === "stop") process.exitCode = await voiceoverStop();
      else if (target === "setup") process.exitCode = await voiceoverSetup();
      else throw new Error(`voiceover kent start, read, stop en setup, niet "${target}"`);
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
