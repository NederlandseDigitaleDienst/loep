import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { frameStanding, type AcceptedGapDecider } from "../lib/sitemodel.ts";
import { readJson, sha256File } from "../lib/canonical.ts";
import { aiGeneratedMark, allCriteriaSorted, carryFindingIds, ESTABLISHED_BY_NL, evaluationHash, idsAcrossVersionsNl, knownCommit, OUTCOME_LABEL, markVendor, openCriteria, resolveCriterion, summarise, versionAccuracyProblems, type BrowserUse, type CriterionResult, type Evaluation, type PointAnswer, type RoundVerdicts, type VersionAccuracy } from "../lib/evaluation.ts";
import { matchFindings, sideOf } from "../lib/difference.ts";
import { documentScopeNl, evaluationDocuments, siteDocuments } from "../lib/documents.ts";
import { pagesInScopeNl, siteOrigins } from "../lib/origins.ts";
import { type Manifest, stepStart, writeManifest } from "../lib/manifest.ts";
import { agentPhaseTimings } from "../lib/timing.ts";
import { sessionWatchAnswers } from "../lib/timelimits.ts";
import { stopSessionWatch } from "./watch-session.ts";
import { extensionUse } from "../lib/budget.ts";
import { loadAllProcedures, REPO_ROOT, runLimitsNl } from "../lib/procedures.ts";
import { reportedModels } from "../lib/models.ts";
import { loadRun } from "../lib/rundata.ts";
import { openPoint, sessionOfObservation, UNREACHABLE, waitsOnlyOnSending, type Verdict } from "../lib/verdict.ts";
import { loginNl, NOT_LOGGED_IN_NL } from "../lib/login.ts";
import { readsAllowedNl } from "../lib/reads.ts";
import { WRITES_BLOCKED_NL, writesAllowedNl } from "../lib/writes.ts";
import { blockadesNl } from "../session/blockade.ts";
import { METHODS } from "../instruments/methods/registry.ts";
import type { Gate } from "./gate.ts";
import { readEvaluation, signatureIsCurrent, writeEvaluation } from "./sign.ts";
import { mergeInto } from "./merge.ts";
import { countingVerdict, loadAnswers } from "./answer.ts";
import { instrumentVerdictIsCurrent, isInstrumentRun, loadInstrumentIndex, loadObservations, NO_TASKS_NL, skippedForOutage, unruledCrossPoints, type InstrumentTask } from "./instrument-tasks.ts";

export interface EvaluateOptions {
  run: string;
  name: string;
  organisation: string | null;
  model: string;
  /** Evaluation of an earlier round of the same site: findings that recur keep their identifier. */
  previous?: string | undefined;
}

/** Where the measurement of each version of loep as a whole is kept, one file per version. */
export const VERSIONS_DIR = join(REPO_ROOT, "validatie", "versies");

/**
 * When this version of loep was last measured as a whole, from `validatie/versies/<version>.json`;
 * null when there is no such file. A file that is there but wrong stops the evaluation: the report
 * would otherwise say less, or more, than was measured.
 */
export function readVersionAccuracy(version: string, dir = VERSIONS_DIR): VersionAccuracy | null {
  const path = join(dir, `${version}.json`);
  if (!existsSync(path)) return null;
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  const problems = versionAccuracyProblems(value, version);
  if (problems.length > 0) throw new Error(`${path}: ${problems.join("; ")}`);
  const { measuredAt, againstNl, resultNl } = value as VersionAccuracy;
  return { version, measuredAt, againstNl, resultNl };
}

/** Short uppercase prefix for finding identifiers, derived from the site name. */
export function sitePrefix(name: string): string {
  const letters = name.replace(/[^a-zA-Z]/g, "").toUpperCase();
  return (letters.slice(0, 4) || "SITE").padEnd(3, "X");
}

export interface GatheredVerdicts {
  verdicts: RoundVerdicts;
  /** Hash of each verdict file that counts. Slot "b" belonged to the second judge of the older chain; it stays so the shape of the file does not change. */
  hashes: Record<string, string | null>;
  /** What a person recorded about open points of the verdict that counts. */
  answers: PointAnswer[];
  /** Verdicts and answers that are there but do not count, each with the reason. */
  rejected: string[];
}

/**
 * Everything that decides the outcome of one criterion, read from the run: the verdict of the
 * judge (slot "a"), the final verdict of the verifier, that of the finishing round when the
 * criterion had one, and the answers of a person to what was still open after that. A verdict
 * counts only with a stamp that matches the current dossier, procedure and prompt: one that was
 * never validated, or was reached with other evidence, is treated as absent.
 */
/**
 * Sessions that measured with other code than the run was made with, so the report does not name one version for all of it.
 * Only known commits are compared: a toolbox outside a git repository has none, and then nothing can be said to differ.
 */
export function otherCodeNl(runDir: string, runCommit: string | null): string[] {
  const commit = knownCommit({ commit: runCommit });
  if (commit === null) return [];
  const root = join(runDir, "observations");
  const byCommit = new Map<string, string[]>();
  for (const name of existsSync(root) ? readdirSync(root).sort() : []) {
    const file = join(root, name, "session.json");
    if (!existsSync(file)) continue;
    const used = knownCommit((JSON.parse(readFileSync(file, "utf8")) as { toolbox?: { commit: string | null } }).toolbox);
    if (used && used !== commit) byCommit.set(used, [...(byCommit.get(used) ?? []), name]);
  }
  return [...byCommit].map(([used, sessions]) => `${sessions.length === 1 ? "De sessie" : "De sessies"} ${sessions.join(", ")} ${sessions.length === 1 ? "is" : "zijn"} gedaan met loep commit ${used.slice(0, 12)}, de rest van het onderzoek met commit ${commit.slice(0, 12)}.`);
}

export async function gatherVerdicts(runDir: string, task: InstrumentTask, observations = loadObservations(runDir)): Promise<GatheredVerdicts> {
  const verdicts: RoundVerdicts = { a: null, final: null };
  const hashes: Record<string, string | null> = { a: null, b: null, final: null };
  const rejected: string[] = [];
  for (const [round, slot, part] of [["judge", "a", task.judge], ["final", "final", task.verify], ["finish", "finish", task.finish ?? null]] as const) {
    if (!part || !existsSync(join(runDir, part.output))) continue;
    if (!(await instrumentVerdictIsCurrent(runDir, task, round, observations))) {
      rejected.push(`${task.criterion}/${round}: no current stamp`);
      continue;
    }
    verdicts[slot] = await readJson<Verdict>(join(runDir, part.output));
    hashes[slot] = await sha256File(join(runDir, part.output));
  }
  // A finishing round that ran again with `tasks --again`: the verdict of the round before it is kept, to show what stood before.
  const earlierFinish = task.finish?.earlier?.at(-1);
  if (verdicts.finish && earlierFinish && existsSync(join(runDir, earlierFinish))) verdicts.finishBefore = await readJson<Verdict>(join(runDir, earlierFinish));
  const { answers, stale } = await loadAnswers(runDir, task.criterion, await countingVerdict(runDir, task, observations));
  if (stale > 0) rejected.push(`${task.criterion}/answer: ${stale} given to an earlier verdict`);
  return { verdicts, hashes, answers, rejected };
}

export async function evaluate(options: EvaluateOptions): Promise<Evaluation> {
  const startedAt = stepStart();
  const run = await loadRun(options.run);
  const manifest = await readJson<Manifest>(join(options.run, "manifest.json"));
  // A run is judged with instruments: one judge per criterion, then a verifier who writes the final verdict.
  if (!isInstrumentRun(options.run)) throw new Error(NO_TASKS_NL);
  const { tasks: instrumentTasks, templates } = await loadInstrumentIndex(options.run);
  const observations = loadObservations(options.run);
  const labelOfUrl = new Map(run.pages.map((page) => [page.item.url, page.label]));
  const { procedures } = loadAllProcedures();
  const prefix = sitePrefix(options.name);

  // The watch on the session stops here: what it saw is final from now on.
  const watch = stopSessionWatch(options.run);
  const criteria: CriterionResult[] = [];
  const rejected: string[] = [];
  const readAloud = voiceOverSessions(observations.records);
  const gatheredAll = new Map<string, GatheredVerdicts>();
  for (const task of instrumentTasks) gatheredAll.set(task.criterion, await gatherVerdicts(options.run, task, observations));
  // What each judge saw that belongs to another criterion: the verdicts there have to have ruled on it.
  const judged = new Map([...gatheredAll].flatMap(([id, gathered]): [string, Verdict][] => (gathered.verdicts.a ? [[id, gathered.verdicts.a]] : [])));
  for (const criterion of allCriteriaSorted()) {
    const procedure = procedures.find((entry) => entry.id === criterion.id);
    const instrumentTask = instrumentTasks.find((entry) => entry.criterion === criterion.id);
    // The judge's verdict is slot "a". Only the verifier's verdict gives an outcome, or after it that of the finishing round.
    const gathered: GatheredVerdicts = gatheredAll.get(criterion.id) ?? { verdicts: { a: null, final: null }, hashes: { a: null, b: null, final: null }, answers: [], rejected: [] };
    const { verdicts, hashes } = gathered;
    rejected.push(...gathered.rejected);
    const resolved = resolveCriterion(
        {
          criterion,
          verdicts,
          // The open point about the duration of the session is closed by the watch, when it finished without the session running out.
          answers: criterion.id === "2.2.1" ? [...gathered.answers, ...sessionWatchAnswers(watch, (verdicts.finish ?? verdicts.final)?.missingNl ?? [])] : gathered.answers,
          // A limit that says no screen reader was used, or nobody logged in, holds only when that is so for this criterion in this run.
          procedure: procedure ? { version: procedure.version, sha256: procedure.sha256, class: procedure.class, limitsNl: procedure.limitsNl === null ? null : runLimitsNl(procedure.limitsNl, { screenReader: [instrumentTask?.judge.session, instrumentTask?.verify?.session, instrumentTask?.finish?.session].some((session) => session !== undefined && readAloud.has(session)), loggedIn: Boolean(run.login) }) } : null,
          provenance: { dossierSha256: instrumentTask?.dossierSha256 ?? null, verdictSha256: hashes },
          unruledNl: instrumentTask ? unruledCrossPoints(judged, criterion.id, [verdicts.final, verdicts.finish]) : [],
          outage: instrumentTask !== undefined && !verdicts.finish && skippedForOutage(options.run, instrumentTask),
        },
        prefix,
    );
    // The findings in the evaluation are those of the verdict that counts: the finishing round's when there is one.
    const counted = verdicts.finish ?? verdicts.final;
    if (instrumentTask && counted && (counted.verification || counted.finish)) {
      // Where a finding is, read from the observations it cites; and whether it was seen again from a fresh page.
      const checks = counted.verification?.findings ?? [];
      const repeats = counted.finish?.findings ?? [];
      resolved.findings.forEach((finding, position) => {
        const key = counted.findings[position]?.key;
        const targets = new Map<string, { page: string; path: string[]; state: string | null }>();
        for (const ref of finding.evidence) {
          const record = observations.records.get(ref);
          if (!record?.target?.path?.length || !record.page) continue;
          const target = { page: labelOfUrl.get(record.page.url) ?? record.page.url, path: record.target.path, state: (record.state?.steps?.length ?? 0) > 0 ? (record.state?.id ?? null) : null };
          targets.set(JSON.stringify(target), target);
        }
        if (targets.size > 0) finding.targets = [...targets.values()];
        const check = checks.find((entry) => entry.key === key);
        const repeat = repeats.find((entry) => entry.key === key);
        // After the finishing round no verifier comes: its agent showed the finding twice itself, and the report says so.
        // A finding the verifier added itself has been seen once, by the verifier: nobody reproduced it.
        finding.verification = counted.finish ? { status: "repeated", evidence: repeat?.repeated ?? [] } : check?.reproduced ? { status: "reproduced", evidence: check.evidence } : { status: "unverified", evidence: [] };
      });
    }
    // Which elements of the vendor a finding touches. Where it is does not say whose fault it is, so the owner stays
    // what the judge said, unless the advice is about the inside of such an element: that only the vendor can change.
    const vendor = run.inventory.vendor;
    if (vendor) for (const finding of resolved.findings) markVendor(finding, vendor);
    criteria.push(resolved);
  }

  const earlier = options.previous ? await readEvaluation(options.previous) : undefined;

  // Which criteria got their outcome from the finishing round, and which from a person.
  // A criterion the finishing round left open was not established by it, so it is not counted here.
  const finished = criteria.filter((criterion) => criterion.established?.by === "finishing" && criterion.outcome !== "cantTell").map((criterion) => criterion.id);
  const byPerson = criteria.filter((criterion) => criterion.established?.by === "person").map((criterion) => criterion.id);
  const answered = criteria.some((criterion) => (criterion.answers ?? []).length > 0);

  const technologies = new Set<string>(["HTML", "CSS", "JavaScript"]);
  if (run.inventory.totals.shadowRoots) technologies.add("Web Components (shadow DOM)");
  if (run.pages.some((page) => page.facts.images.some((image) => image.tag === "svg"))) technologies.add("SVG");
  if (run.pages.some((page) => [...page.facts.controls, ...page.facts.links, ...page.facts.landmarks].some((element) => element.roleAttr || element.ariaLabel))) technologies.add("WAI-ARIA");

  // The other browsers that answered as a second opinion in a session: which, which version, for what and how often.
  const secondBrowsers = secondBrowserUse(observations.records);
  // Every implementation that answered a measurement in a session: what, which version, for what and how often. Read from the observations, so it lists what was used and not what happened to be installed.
  const QUESTION_NL: Record<string, string> = { name: "naam, rol en toestand", ax: "naam, rol en toestand", rules: "toetsregels", contrast: "contrast", target: "aanwijsgebied", taborder: "Tab-volgorde", focus: "focusaanduiding", ocr: "tekst in beeld", lang: "taal", source: "geldige HTML", motion: "beweging", media: "video en geluid", document: "documenten van de site", order: "volgorde in code en beeld", reflow: "reflow op 320 pixels", spacing: "tekstafstand", zoom: "vergroten tot 200%", speak: "volgens de standaard voorgelezen", forced: "geforceerde kleuren en meer contrast", distinct: "kleur als enig onderscheid", voiceover: "voorgelezen door een echte schermlezer (VoiceOver met Safari)" };
  // The licence of each implementation comes from the register of methods, so it does not depend on a session having asked for the list.
  const licences = new Map(METHODS.map((method) => [method.implementation, method.licence]));
  const used = new Map<string, { implementation: string; version: string | null; commands: Set<string>; measurements: number }>();
  for (const { command, method } of methodAnswers(observations.records)) {
    if (typeof method.implementation !== "string" || method.error) continue;
    const version = typeof method.version === "string" ? method.version : null;
    const entry = used.get(`${method.implementation} ${version}`) ?? { implementation: method.implementation, version, commands: new Set<string>(), measurements: 0 };
    entry.commands.add(command);
    entry.measurements++;
    used.set(`${method.implementation} ${version}`, entry);
  }
  const instruments: NonNullable<Evaluation["instruments"]> = [...used.values()]
    .sort((a, b) => a.implementation.localeCompare(b.implementation) || String(a.version).localeCompare(String(b.version)))
    .map((entry) => ({ implementation: entry.implementation, version: entry.version, licence: licences.get(entry.implementation) || null, usedForNl: [...new Set([...entry.commands].sort().map((command) => QUESTION_NL[command] ?? command))], measurements: entry.measurements }));
  const screenReader = screenReaderUse(instruments);
  // The programs that measured the documents of the sample ran outside a session: the step in the manifest names them.
  const documentStep = [...manifest.steps].reverse().find((step) => step.command === "documents") as { read?: number; tools?: { implementation: string; version: string | null; licence: string }[] } | undefined;
  for (const tool of documentStep?.tools ?? []) if (tool.version) instruments.push({ implementation: tool.implementation, version: tool.version, licence: tool.licence, usedForNl: ["documenten van de site"], measurements: documentStep?.read ?? 0 });

  const browsersUsed = browserUse(manifest.browser.version, secondBrowsers);
  const browsersNl = repeatedInBrowsersNl(secondBrowsers);

  // Documents: what was found, what was read and what was not. An inventory from before documents were looked for says what it said then.
  const searchedForDocuments = run.inventory.documents !== undefined;
  // The origins of the site: one in most runs, more when the inventory was given --also-origin.
  const origins = siteOrigins(run.inventory);
  const population = run.sample.documentPopulation;
  const documents = population ? evaluationDocuments(run.documents ?? [], population, procedures.filter((procedure) => procedure.evidence.includes("documents")).map((procedure) => procedure.id)) : null;
  const documentScope = searchedForDocuments ? documentScopeNl(documents, origins, siteDocuments(run.inventory).elsewhere) : null;

  const limitations = [
    browsersNl,
    screenReader.limitationNl,
    `Versturen van formulieren: ${run.writes ? writesAllowedNl(run.writes) : WRITES_BLOCKED_NL}.`,
    ...(readsAllowedNl(run.reads ?? []) ? [`Leesverzoeken: ${readsAllowedNl(run.reads ?? [])}.`] : []),
    // A site that blocked the run: what the sessions could not ask any more is missing.
    ...blockadesNl(options.run),
    "De beoordeling per criterium is gedaan door een taalmodel, op basis van bewijs dat scripts hebben verzameld en van eigen waarnemingen met meetinstrumenten. Elke handeling en meting van het model is vastgelegd als waarneming en kan worden nagespeeld.",
    "Metingen zijn gedaan op de pagina's van de steekproef, met meldingen open en gesloten, en met de onderdelen geopend die een verkenner vooraf heeft vastgelegd. Een onderdeel dat de verkenner niet vond of niet open kreeg, is door de scripts niet gemeten. Het model heeft zelf in een steekproef van pagina's en toestanden gekeken en gemeten, niet op elke pagina in elke toestand.",
    run.login ? `${loginNl(run.login)}.` : NOT_LOGGED_IN_NL,
    ...(documentScope ? documentScope.limitationsNl : ["Pdf-bestanden en andere documenten die geen webpagina zijn, zijn niet beoordeeld; zie de scope."]),
    "Video en geluid zijn alleen beluisterd en bekeken als het bestand op te halen was en de hulpprogramma's daarvoor aanwezig waren, ook in een speler in een ingesloten venster. Media die als stream wordt afgespeeld, is niet beluisterd of bekeken. Spraak en tekst in beeld zijn herkend door software, die fouten maakt, en de flitsmeting is een benadering van de norm.",
    ...(finished.length > 0
      ? [`Bij ${finished.length === 1 ? "1 criterium" : `${finished.length} criteria`} (${finished.join(", ")}) is het oordeel vastgesteld in een aanvullende meting, nadat het eerst open bleef door een beperking van het onderzoek. Die meting is niet nog eens gecontroleerd: een bevinding is daar twee keer door dezelfde beoordelaar vastgelegd, de tweede keer vanaf een verse pagina, en een goedkeuring is niet door een tweede beoordelaar aangevallen.`]
      : []),
    ...(byPerson.length > 0
      ? [`Bij ${byPerson.length === 1 ? "1 criterium" : `${byPerson.length} criteria`} (${byPerson.join(", ")}) is de uitkomst vastgesteld door een persoon, niet door een instrument. Het onderzoek heeft dat antwoord vastgelegd en niet gecontroleerd; de functie van die persoon staat bij het criterium.`]
      : []),
    ...criteria.filter((criterion) => criterion.procedure?.limitsNl).map((criterion) => `${criterion.id} ${criterion.titleNl}: ${criterion.procedure!.limitsNl}`),
  ];

  // Only in a run with a site model: the states each page was measured in besides the way it loads.
  const { siteModel, siteStates } = run;
  const measuredStates =
    siteModel && siteStates
      ? Object.fromEntries(
          run.pages.map((page) => {
            const type = siteModel.pageTypes.find((entry) => entry.pages.includes(page.item.url));
            return [page.label, siteStates.states.filter((state) => state.reached && type !== undefined && state.pageTypes.includes(type.id)).map((state) => state.id)];
          }),
        )
      : undefined;

  // What each embedded frame is and whether it counts: what counts first, as the site model has them.
  const scopeFrames = (siteModel?.frames ?? [])
    .map((frame) => ({ address: frame.address, descriptionNl: frame.descriptionNl, kindNl: frameStanding(frame).labelNl, standingNl: frameStanding(frame).standingNl, counts: frameStanding(frame).counts, reasonNl: frame.reasonNl ?? null, decidedBy: frame.decidedBy ?? null }))
    .sort((a, b) => Number(b.counts) - Number(a.counts));

  // What the explorer wrote about the site as a whole; an older site model has no such text.
  const description = siteModel?.descriptionNl?.trim() || null;
  const gatePath = join(options.run, "gate.json");
  const gate = existsSync(gatePath) ? await readJson<Gate>(gatePath) : null;
  const gateSummary = gate
    ? { sufficient: gate.sufficient, checks: gate.checks.length, checksPassed: gate.checks.filter((check) => check.ok).length, exploreRounds: gate.exploreRound, acceptedNl: gate.accepted.map(gateLineNl), limitationsNl: gate.limitations.map(gateLineNl), ...(gate.review?.answered ? { review: { sheets: gate.review.sheets.length, pageTypesWithoutSheet: gate.review.withoutSheet.length } } : {}) }
    : null;

  // Which model each agent said it ran on, per role. Nothing in the run can confirm it.
  const agentModels = await reportedModels(options.run);
  // How often an agent added to its own budget, per role: a run where that happens often has budgets that do not fit.
  const extensions = extensionUse(options.run);

  const evaluation: Evaluation = {
    schema: "loep/evaluation/1",
    site: { name: options.name, baseUrl: run.inventory.baseUrl, ...(origins.length > 1 ? { origins } : {}), organisation: options.organisation, ...(description ? { descriptionNl: description } : {}) },
    ...(run.inventory.vendor ? { vendor: run.inventory.vendor } : {}),
    evaluatedAt: manifest.steps.find((step) => step.command === "collect")?.at ?? new Date().toISOString(),
    method: {
      name: "WCAG-EM",
      version: "2.0",
      url: "https://www.w3.org/TR/WCAG-EM-2/",
      typeNl: "Automatisch onderzoek: regel-engines, scripts die het gedrag in de browser meten, een verkenning en een rondgang per paginatype door een taalmodel, beoordeling per criterium door een taalmodel met meetinstrumenten, en een tweede ronde waarin een andere agent elke bevinding moet bevestigen.",
      deviationsNl: [
        "Stap 4 (beoordelen) is niet door een mens uitgevoerd maar door een taalmodel, volgens een vaste procedure per criterium.",
        ...(run.sample.method === "census" ? ["Er is geen steekproef getrokken: alle pagina's van de site zijn onderzocht."] : []),
        `Volledige processen (stap 3c) zijn alleen onderzocht voor zover de verkenner ze als reeks stappen kon vastleggen.${run.writes ? "" : " Een proces stopt voor het versturen."}`,
        screenReader.deviationNl,
        ...otherCodeNl(options.run, manifest.toolbox.commit),
      ],
    },
    standards: { wcag: ["WCAG 2.2 niveau A en AA", "WCAG 2.1 niveau A en AA"], en301549: documents ? "EN 301 549 v3.2.1, hoofdstuk 9 (webpagina's) en hoofdstuk 10 (documenten)" : "EN 301 549 v3.2.1, hoofdstuk 9" },
    scope: {
      includedNl: [pagesInScopeNl(origins), ...(documentScope?.includedNl ?? [])],
      excludedNl: ["Websites van derden waarnaar wordt gelinkt, ook inloggen bij DigiD, eHerkenning of eIDAS: die diensten hebben een eigen toegankelijkheidsverklaring", ...(documentScope ? documentScope.excludedNl : ["Pdf-bestanden en andere documenten die geen webpagina zijn, ook als ze op de site zelf staan"])],
      ...(scopeFrames.length > 0 ? { frames: scopeFrames } : {}),
    },
    sample: run.sample,
    baseline: {
      browsers: [
        { name: "Chromium (Chrome for Testing)", version: manifest.browser.version, engine: secondBrowsers.length > 0 ? "Blink; alle metingen" : "Blink" },
        ...secondBrowsers.map((entry) => ({ name: SECOND[entry.browser].name, version: entry.version, engine: `${SECOND[entry.browser].engine}; alleen voor het herhalen van ${whatOf(entry)} (${entry.count} metingen)` })),
      ],
      assistiveTechnology: screenReader.assistiveTechnology,
      noteNl: screenReader.noteNl,
    },
    browsers: browsersUsed,
    technologies: [...technologies].sort(),
    toolchain: { toolbox: manifest.toolbox, runtime: manifest.runtime, packages: manifest.packages, browser: manifest.browser, rendering: manifest.rendering },
    ...(instruments.length > 0 ? { instruments } : {}),
    aiGenerated: aiGeneratedMark({ model: options.model, models: agentModels }, criteria),
    versionAccuracy: readVersionAccuracy(manifest.toolbox.version),
    judgment: { model: options.model, ...(agentModels.length > 0 ? { models: agentModels } : {}), ...(extensions.length > 0 ? { extensions } : {}), rounds: ["rondgang per paginatype", "beoordeling met instrumenten", "verificatie en eindoordeel", ...(criteria.some((criterion) => criterion.rounds.finish !== undefined) ? ["afmaakronde voor wat het onderzoek zelf open liet"] : []), ...(answered ? ["antwoorden van een persoon op open punten"] : [])], promptTemplates: templates },
    criteria,
    summary: summarise(criteria),
    limitationsNl: limitations,
    ...(measuredStates ? { measuredStates } : {}),
    ...(documents ? { documents } : {}),
    chain: { kind: "instruments", gate: gateSummary, writes: { allowed: Boolean(run.writes), noteNl: run.writes ? writesAllowedNl(run.writes) : WRITES_BLOCKED_NL }, ...((run.reads ?? []).length > 0 ? { reads: run.reads!.map((rule) => ({ method: rule.method, origin: rule.origin, path: rule.path, service: rule.service, reasonNl: rule.reasonNl })) } : {}) },
    signature: null,
  };
  if (earlier) {
    // A finding at the same place under the same criterion keeps its identifier.
    const result = carryFindingIds(criteria, matchFindings(sideOf(evaluation), sideOf(earlier)));
    process.stderr.write(`${result.carried} bevindingen houden hun identificatie, ${result.fresh} zijn nieuw\n`);
    // Only a signed evaluation is named in the report: nobody can look up a concept.
    if (signatureIsCurrent(earlier)) evaluation.followsUp = { evaluatedAt: earlier.evaluatedAt, sha256: evaluationHash(earlier), signedAt: earlier.signature!.signedAt };
  }
  // Findings about the same place become one defect; the findings themselves stay as they are.
  const merged = await mergeInto(options.run, evaluation, earlier);
  process.stderr.write(`${merged.defects} gebreken uit ${merged.findings} bevindingen\n`);
  await writeEvaluation(join(options.run, "evaluation.json"), evaluation);
  for (const problem of rejected) process.stderr.write(`rejected ${problem}\n`);
  // Per criterion who or what established the outcome: counted here, and said for every one that is not the verifier's.
  const by = (kind: keyof typeof ESTABLISHED_BY_NL): CriterionResult[] => criteria.filter((criterion) => criterion.established?.by === kind);
  const shown = (list: CriterionResult[]): string => list.map((criterion) => `${criterion.id} ${OUTCOME_LABEL[criterion.outcome].toLowerCase()}`).join("; ");
  for (const kind of Object.keys(ESTABLISHED_BY_NL) as (keyof typeof ESTABLISHED_BY_NL)[]) if (by(kind).length > 0) process.stderr.write(`vastgesteld door ${ESTABLISHED_BY_NL[kind]} (${by(kind).length}): ${shown(by(kind))}\n`);
  for (const entry of extensions.filter((role) => role.extended > 0)) process.stderr.write(`budget verlengd, ${entry.roleNl}: ${entry.extended} van de ${entry.sessions} sessies (${entry.extensions} keer)\n`);
  const without = criteria.filter((criterion) => !criterion.established);
  if (without.length > 0) process.stderr.write(`zonder oordeel (${without.length}): ${without.map((criterion) => criterion.id).join("; ")}\n`);
  const open = openCriteria(criteria);
  // What waits only for permission to send needs no person: said apart, with the declaration that would close it.
  const notSent = open.owner.filter((id) => waitsOnlyOnSending(criteria.find((criterion) => criterion.id === id)!.missingNl));
  const person = open.owner.filter((id) => !notSent.includes(id));
  if (person.length > 0) process.stderr.write(`open, vraagt een mens of een keuze: ${idsAcrossVersionsNl(person, criteria)}. Een persoon legt het antwoord vast met answer; daarna opnieuw evaluate.\n`);
  if (notSent.length > 0) process.stderr.write(`open, alleen omdat het onderzoek niet mocht versturen: ${idsAcrossVersionsNl(notSent, criteria)}. Geen persoon nodig: een nieuw onderzoek met een testomgeving, verklaard bij inventory (--test-environment <origin> --declared-by "<naam>, <functie>"), meet het met een instrument. Die origin mag die van alleen het ingesloten venster zijn.\n`);
  if (open.evaluation.length > 0) process.stderr.write(`LET OP: het onderzoek is niet af. Door dit onderzoek niet vastgesteld: ${idsAcrossVersionsNl(open.evaluation, criteria)}. Draai tasks en pending: de afmaakronde meet wat ontbrak. Is die al geweest, dan kan alleen een persoon het punt nog sluiten, met answer, behalve een punt "${UNREACHABLE}" of "proef werkte niet": dat meet een nieuwe afmaakronde met tasks --again <criteria>.\n`);
  // A part of the site that did not load is no fault of loep and no work for the owner: said apart, with the way to measure it once it loads.
  const unreachable = open.evaluation.filter((id) => criteria.find((criterion) => criterion.id === id)!.missingNl.some((point) => openPoint(point).kind?.prefix === UNREACHABLE));
  if (unreachable.length > 0) process.stderr.write(`open, een deel van de site was niet bereikbaar: ${idsAcrossVersionsNl(unreachable, criteria)}. Laadt het weer, zet dan een nieuwe afmaakronde klaar met tasks --again ${unreachable.join(",")}, en draai daarna opnieuw evaluate.\n`);
  // The phases with agents leave no step of their own: what their sessions say about begin, end and time per agent is kept here.
  await writeManifest(options.run, { command: "evaluate", startedAt, criteria: criteria.length, rejectedVerdicts: rejected.length, defects: merged.defects, mergeProposal: merged.proposal, establishedBy: { verification: by("verification").length, finishing: finished.length, person: byPerson.length }, open, extensions, agentPhases: agentPhaseTimings(options.run) });
  return evaluation;
}

// What a second browser repeated, in the words of the report. `ax` and `name` ask the same of a second browser: what it hands to assistive technology.
const WHAT_NL: Record<string, string> = { taborder: "de Tab-volgorde", tabwalk: "de Tab-volgorde", name: "de toegankelijke naam en rol", ax: "de toegankelijke naam en rol", reflow: "reflow op 320 pixels", zoom: "vergroten tot 200%", spacing: "de tekstafstand" };
const SECOND = { webkit: { name: "WebKit", nameNl: "WebKit (de motor van Safari)", engine: "WebKit" }, firefox: { name: "Firefox", nameNl: "Firefox", engine: "Gecko" } } as const;

const ACCEPTED_BY_NL: Record<AcceptedGapDecider, string> = { verkenner: "Aanvaard door de verkenner, niet door een persoon.", persoon: "Aanvaard door een persoon, volgens het sitemodel; loep gaat dat niet na." };

/** A gap or limitation of the gate as the report lists it, with who accepted it for an accepted gap. A gate.json from before that was asked does not say. */
export function gateLineNl(gap: { page?: string | null; missingNl: string; reasonNl?: string; decidedBy?: AcceptedGapDecider }): string {
  const line = `${gap.page ? `${gap.page}: ` : ""}${gap.missingNl}${gap.reasonNl ? ` ${gap.reasonNl}` : ""}`;
  return gap.decidedBy ? `${line.replace(/[^.!?]$/, "$&.")} ${ACCEPTED_BY_NL[gap.decidedBy]}` : line;
}

export interface SecondBrowserUse {
  browser: keyof typeof SECOND;
  /** The version as the measurement recorded it; null when a record carries none. */
  version: string | null;
  commands: Set<string>;
  count: number;
}

/**
 * What the report says about assistive technology, from the instruments that answered in a
 * session: VoiceOver is named with its versions only when an agent read with it.
 */
export function screenReaderUse(instruments: { implementation: string; version: string | null; measurements: number }[]): { assistiveTechnology: { name: string; version: string }[]; limitationNl: string; deviationNl: string; noteNl: string } {
  const used = instruments.filter((entry) => entry.implementation === "voiceover");
  const readings = used.reduce((sum, entry) => sum + entry.measurements, 0);
  if (readings === 0)
    return {
      assistiveTechnology: [],
      limitationNl: "Er is niet getest met hulpsoftware zoals een schermlezer. Wat hulpsoftware aangeboden krijgt, is afgelezen uit de toegankelijkheidsboom van de browser.",
      deviationNl: "Er is geen basisniveau van hulpsoftware vastgesteld: er is geen hulpsoftware gebruikt.",
      noteNl: "Er is geen hulpsoftware gebruikt. Een schermlezer is niet getest.",
    };
  const times = readings === 1 ? "één keer" : `${readings} keer`;
  return {
    assistiveTechnology: used.map((entry) => ({ name: "VoiceOver met Safari, in een virtuele Mac", version: entry.version ?? "onbekend" })),
    limitationNl: `Een echte schermlezer is alleen gebruikt waar een agent dat deed, ${times}: VoiceOver met Safari in een virtuele Mac. Wat VoiceOver uitspreekt, kan in NVDA of JAWS anders zijn; met die schermlezers is niet getest. Verder is wat hulpsoftware aangeboden krijgt afgelezen uit de toegankelijkheidsboom van de browser.`,
    deviationNl: "Er is geen basisniveau van hulpsoftware vastgesteld: alleen VoiceOver met Safari is gebruikt, voor een deel van de metingen.",
    noteNl: `VoiceOver met Safari las ${times} voor, waar een agent dat deed. NVDA en JAWS zijn niet getest.`,
  };
}

const whatOf = (entry: SecondBrowserUse): string => [...new Set([...entry.commands].sort().map((command) => WHAT_NL[command] ?? command))].join(" en ");

/** "a", "a en b", "a, b en c". */
const listNl = (items: string[]): string => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} en ${items.at(-1)}`);

/** Which measurements a second browser repeated, per browser, so that each browser is named once. */
export function repeatedInBrowsersNl(secondBrowsers: SecondBrowserUse[]): string {
  if (secondBrowsers.length === 0) return "Alle metingen zijn gedaan in één browser: Chromium, de motor van Chrome en Edge. Geen meting is in een andere browser herhaald.";
  const perBrowser = new Map<string, Set<string>>();
  for (const entry of secondBrowsers) {
    const whats = perBrowser.get(SECOND[entry.browser].nameNl) ?? new Set<string>();
    for (const command of entry.commands) whats.add(WHAT_NL[command] ?? command);
    perBrowser.set(SECOND[entry.browser].nameNl, whats);
  }
  const distinct = new Set([...perBrowser.values()].flatMap((whats) => [...whats]));
  const parts = [...perBrowser.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([browser, whats]) => `in ${browser} ${listNl([...whats].sort((a, b) => a.localeCompare(b)))}`);
  return `Alle metingen zijn gedaan in Chromium, de motor van Chrome en Edge. ${distinct.size === 1 ? "Eén meting is" : "Deze metingen zijn"} daarna herhaald in een andere browser: ${parts.join("; ")}. De andere metingen zijn alleen in Chromium gedaan.`;
}

interface AnsweredMethod {
  method?: unknown;
  implementation?: unknown;
  version?: unknown;
  error?: unknown;
}

/**
 * Every answer of a method in the recorded observations, with the command it answered. A slow
 * method that was still running when its command returned is in the record of the `wait` that
 * picked it up: it counts for the command it completes, and only when the record of that
 * command did not have the answer yet.
 */
export function* methodAnswers(records: ReadonlyMap<string, { command: string; result: unknown }>): Generator<{ command: string; method: AnsweredMethod }> {
  const methodsOf = (result: unknown): AnsweredMethod[] => {
    const methods = (result as { methods?: unknown } | null)?.methods;
    return Array.isArray(methods) ? (methods as AnsweredMethod[]) : [];
  };
  const key = (method: AnsweredMethod): string => `${String(method.method)} ${String(method.implementation)}`;
  for (const record of records.values()) {
    for (const method of methodsOf(record.result)) yield { command: record.command, method };
    const completed = (record.result as { completed?: unknown } | null)?.completed;
    for (const entry of Array.isArray(completed) ? (completed as { completes?: string; command?: string; result?: unknown }[]) : []) {
      const had = new Set(methodsOf(records.get(entry.completes ?? "")?.result).map(key));
      for (const method of methodsOf(entry.result)) if (!had.has(key(method))) yield { command: entry.command ?? record.command, method };
    }
  }
}

/** The sessions in which a real screen reader read aloud: VoiceOver answered a measurement without an error. */
export function voiceOverSessions(records: ReadonlyMap<string, { id: string; command: string; result: unknown }>): Set<string> {
  const sessions = new Set<string>();
  for (const record of records.values()) {
    for (const { method } of methodAnswers(new Map([[record.id, record]]))) if (method.implementation === "voiceover" && !method.error) sessions.add(sessionOfObservation(record.id));
  }
  return sessions;
}

/** The measurements a second browser answered, per browser and version, read from the recorded observations. A method that failed is not a measurement. */
export function secondBrowserUse(records: ReadonlyMap<string, { command: string; result: unknown }>): SecondBrowserUse[] {
  const second = new Map<string, SecondBrowserUse>();
  for (const { command, method } of methodAnswers(records)) {
    if ((method.implementation !== "webkit" && method.implementation !== "firefox") || method.error) continue;
    const version = typeof method.version === "string" ? method.version : null;
    const entry = second.get(`${method.implementation} ${version}`) ?? { browser: method.implementation, version, commands: new Set<string>(), count: 0 };
    entry.commands.add(command);
    entry.count++;
    second.set(`${method.implementation} ${version}`, entry);
  }
  return [...second.values()].sort((a, b) => a.browser.localeCompare(b.browser) || String(a.version).localeCompare(String(b.version)));
}

/**
 * Every browser the toolbox can measure in, with the version that ran in this run and what it
 * was used for. A browser no measurement ran in gets no version: none was observed.
 */
export function browserUse(chromiumVersion: string | null, second: SecondBrowserUse[]): BrowserUse[] {
  return [
    { name: "Chromium (Chrome for Testing)", engine: "Blink", version: chromiumVersion, used: true, usedForNl: "alle metingen" },
    ...(["webkit", "firefox"] as const).flatMap((browser): BrowserUse[] => {
      const rows = second.filter((entry) => entry.browser === browser);
      if (rows.length === 0) return [{ name: SECOND[browser].name, engine: SECOND[browser].engine, version: null, used: false, usedForNl: "" }];
      return rows.map((entry) => ({ name: SECOND[browser].name, engine: SECOND[browser].engine, version: entry.version, used: true, usedForNl: `tweede mening voor ${whatOf(entry)} (${entry.count} ${entry.count === 1 ? "meting" : "metingen"})` }));
    }),
  ];
}
