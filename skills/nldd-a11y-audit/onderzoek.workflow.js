export const meta = {
  name: 'onderzoek-met-instrumenten',
  description: 'Rondgangen, beoordelaars, verifieerders en de afmaakronde van één run, tot de toolbox meldt dat alles klaar is',
  phases: [
    { title: 'Stand', detail: 'taken aanmaken en opvragen wat er nog te doen is' },
    { title: 'Rondgangen', detail: 'één agent per paginatype' },
    { title: 'Beoordelen', detail: 'één agent per criterium' },
    { title: 'Verifiëren', detail: 'één agent per criterium' },
    { title: 'Afmaken', detail: 'één agent per criterium dat open bleef door het onderzoek zelf; geen als er geen is' },
  ],
}

// args: { cli: absolute path of toolbox/src/cli.ts, run: absolute path of the run, atOnce?: agents at the same time, neverOpen?: hosts no agent may open, models?: model per role, for example { walks: 'sonnet' } }
const { cli, run, atOnce, neverOpen, models } = args
// Every agent holds a session, and the session process of a run allows 4 at the same time unless it was
// started with --max-sessions. One of those is the session of whoever leads the audit, so 3 are left.
// More agents need a process that was started with a higher limit: pass that limit minus one.
const AT_ONCE = atOnce || 3
// Four phases of at most three rounds each (two attempts and the round that skips), a round per phase for agents that
// stopped with an error and get their task again, and the round that finds everything done.
const MAX_ROUNDS = 20
const MAX_ATTEMPTS = 2
// This many agents in a row that stop with an error, or every agent of a round, is a failure of the model and not of
// the agents: the workflow pauses instead of skipping. A start after the pause goes on from the run.
const FAILS_IN_A_ROW = 3
const PAUSED_NL = 'storing van het model, run gepauzeerd; start de werkstroom opnieuw om verder te gaan'
// The site does not answer (`pending` says siteOutage, or an agent heard it from its session): the workflow pauses as well,
// and an agent that stopped for it counts no attempt.
const SITE_PAUSED_NL = 'storing van de site, run gepauzeerd; start de werkstroom opnieuw als de site weer antwoordt (pending zegt het)'
const SITE_DOWN = /storing van de site/i
// Sites that no agent of this run may open, for example a set that is held back for a final test. Empty when the caller gives none.
const NEVER_OPEN =
  Array.isArray(neverOpen) && neverOpen.length > 0
    ? `Open of bevraag nooit, op geen enkele manier, een van deze sites: ${neverOpen.join(', ')}. Je werkt alleen op de site uit je opdracht.`
    : 'Je werkt alleen op de site uit je opdracht.'

// The model of each role. A role without a choice sets no model, so its agents run on the model of the session.
// The stand only runs two commands and hands back their JSON, so it runs on Haiku unless `models` says otherwise.
const ROLES = ['stand', 'walks', 'judges', 'verifiers', 'finishers']
const KNOWN_MODELS = ['opus', 'sonnet', 'haiku']
const DEFAULT_MODELS = { stand: 'haiku' }
function chooseModels(given) {
  if (given === undefined || given === null) return { ...DEFAULT_MODELS }
  if (typeof given !== 'object' || Array.isArray(given)) throw new Error(`models moet een object zijn, bijvoorbeeld { "walks": "sonnet" }, niet ${JSON.stringify(given)}`)
  const chosen = { ...DEFAULT_MODELS }
  for (const [role, model] of Object.entries(given)) {
    if (!ROLES.includes(role)) throw new Error(`models: onbekende rol "${role}"; kies uit ${ROLES.join(', ')}`)
    if (!KNOWN_MODELS.includes(model)) throw new Error(`models: onbekend model ${JSON.stringify(model)} voor "${role}"; kies uit ${KNOWN_MODELS.join(', ')}`)
    chosen[role] = model
  }
  return chosen
}
const MODEL = chooseModels(models)
const withModel = (role, options) => (MODEL[role] ? { ...options, model: MODEL[role] } : options)

// What `pending --brief` gives per open task: its id (a page type or a criterion) and how often an agent came back from it without a result that holds.
const ITEM = {
  type: 'object',
  properties: { id: { type: 'string' }, attempts: { type: 'integer' } },
  required: ['id', 'attempts'],
}
const PENDING = {
  type: 'object',
  properties: {
    phase: { type: 'string', description: 'walks, judges, verifiers, finishers, done of error' },
    walks: { type: 'array', items: ITEM },
    judges: { type: 'array', items: ITEM },
    verifiers: { type: 'array', items: ITEM },
    finishers: { type: 'array', items: ITEM },
    siteOutage: { type: 'string', description: 'alleen als de site een storing heeft' },
    again: { type: 'array', items: { type: 'string' }, description: 'alleen bij done: criteria die na een storing van de site een nieuwe afmaakronde kunnen krijgen' },
    note: { type: 'string' },
  },
  required: ['phase', 'walks', 'judges', 'verifiers', 'finishers'],
}

function shell(commands, round) {
  const numbered = commands.map((command, index) => `${index + 1}. ${command}`).join('\n')
  return tryAgent(
    `Voer in een shell precies deze commando's uit, elk één keer, na elkaar, en doe verder niets. Lees geen bestanden en wijzig niets. ${NEVER_OPEN}\n${numbered}\nHet laatste commando drukt één JSON-object af met de sleutels phase, walks, judges, verifiers en finishers, en soms siteOutage of again. Geef dat object ongewijzigd terug als je antwoord. Mislukt een commando, geef dan phase "error" terug met lege lijsten en in note de foutmelding.`,
    withModel('stand', { schema: PENDING, label: `stand ${round}`, phase: 'Stand', effort: 'low' }),
  )
}

function work(task) {
  return `Lees het bestand ${task} en voer de opdracht die daarin staat volledig en precies uit. Het bestand bevat alles wat je nodig hebt. Lees niets onder de map fixtures van de toolbox. Wijzig geen andere bestanden dan de bestanden die je opdracht noemt. Start of stop geen andere processen dan je eigen sessie. ${NEVER_OPEN} Zegt loep dat de site een storing heeft ("storing van de site"), stop dan meteen: schrijf geen oordeel en geen open punt, stop je sessie en antwoord alleen met: storing van de site. Meld anders na afloop in hooguit drie regels de uitkomst die je hebt opgeschreven en of de controle is geslaagd.`
}

// The task file of each phase follows from its id, as TASK_FILES in toolbox/src/commands/instrument-tasks.ts says; a test holds the two together.
const PHASES = {
  walks: { title: 'Rondgangen', task: (id) => `${run}/rondgang/${id}.md`, name: (id) => `--page-type ${id}` },
  judges: { title: 'Beoordelen', task: (id) => `${run}/tasks/${id}/beoordeel.md`, name: (id) => `--criterion ${id}` },
  verifiers: { title: 'Verifiëren', task: (id) => `${run}/tasks/${id}/verifieer.md`, name: (id) => `--criterion ${id} --round final` },
  // Only for a criterion that the evaluation itself left open after the verifiers; a run without one goes from verifiers to done.
  finishers: { title: 'Afmaken', task: (id) => `${run}/tasks/${id}/afmaak.md`, name: (id) => `--criterion ${id} --round finish` },
}

// An agent that throws, or comes back with nothing (the host gives null for an agent that died on an error of the
// model after its retries), did not attempt its task: a limit of the subscription, a failure of the service or an
// agent that was stopped is no agent that failed. It counts no attempt, and the next round has the task again.
const failed = (result) => result === null || result === undefined
async function tryAgent(prompt, options) {
  try {
    const result = await agent(prompt, options)
    return failed(result) ? { error: 'geen antwoord van het model' } : { result }
  } catch (error) {
    return { error: error && error.message ? error.message : String(error) }
  }
}

// A pool: `limit` workers each take the next item as soon as their own is done. So `limit` agents run for
// as long as there is work, and never more: a slow agent holds up one place and not a whole group.
// After FAILS_IN_A_ROW errors in a row no worker takes a new item: the model is not there, and more agents would only fail too.
// An agent that answers that the site has an outage did not attempt its task either, and no worker takes a new item after it.
async function pool(items, limit, start) {
  let next = 0
  let inARow = 0
  let stopped = false
  let siteDown = 0
  const done = []
  const errors = []
  const worker = async () => {
    while (next < items.length && !stopped && siteDown === 0) {
      const item = items[next++]
      const outcome = await start(item)
      if (outcome.error) {
        errors.push(outcome.error)
        log(`agent gestopt met een fout: ${outcome.error}`)
        if (++inARow >= FAILS_IN_A_ROW) stopped = true
      } else if (typeof outcome.result === 'string' && SITE_DOWN.test(outcome.result)) {
        siteDown++
        log(`agent gestopt door een storing van de site: ${item.id}`)
      } else {
        inARow = 0
        done.push(item)
      }
    }
  }
  await parallel(Array.from({ length: Math.min(limit, items.length) }, () => worker))
  return { done, errors, siteDown, outage: stopped || (items.length > 0 && done.length === 0 && siteDown === 0) }
}

const skipped = []
const history = []
let pendingSkips = []
let attempted = []
let last = null
let paused = null
// Criteria that get a new finishing round once the site answers again after an outage: once per start of the workflow.
let again = []
let askedAgain = false

for (let round = 1; round <= MAX_ROUNDS; round++) {
  const commands = [
    ...pendingSkips.map((entry) => `node ${cli} skip --run ${run} ${entry} --kind "geen geldig resultaat" --reason "de agent leverde na ${MAX_ATTEMPTS} pogingen geen geldig resultaat"`),
    `node ${cli} tasks --run ${run}${attempted.length > 0 ? ` --attempted ${attempted.join(',')}` : ''}${again.length > 0 ? ` --again ${again.join(',')}` : ''}`,
    `node ${cli} pending --run ${run} --brief`,
  ]
  const asked = await shell(commands, round)
  if (asked.error) {
    // Without the stand nothing is known about the run; skipping now would turn the failure into an outcome.
    paused = `${PAUSED_NL} (stand ${round}: ${asked.error})`
    history.push({ round, phase: 'storing', note: asked.error })
    break
  }
  pendingSkips = []
  attempted = []
  again = []
  const state = asked.result
  last = state.phase
  if (state.phase === 'error') {
    log(`stand ${round}: fout ${state.note}`)
    history.push({ round, phase: 'error', note: state.note || null })
    break
  }
  if (state.phase === 'done' && Array.isArray(state.again) && state.again.length > 0 && !askedAgain) {
    askedAgain = true
    again = state.again
    log(`ronde ${round}: de site antwoordt weer, nieuwe afmaakronde voor ${again.join(', ')}`)
    history.push({ round, phase: 'done', again })
    continue
  }
  if (state.phase === 'done') {
    history.push({ round, phase: 'done' })
    break
  }
  if (state.siteOutage) {
    paused = `${SITE_PAUSED_NL} (stand ${round}: ${state.siteOutage})`
    history.push({ round, phase: 'storing van de site', note: state.siteOutage })
    break
  }
  const kind = PHASES[state.phase]
  if (!kind) {
    history.push({ round, phase: state.phase, note: 'onbekende fase' })
    break
  }
  // The attempts come from the run, so a workflow that starts again goes on where the last one stopped.
  const todo = []
  for (const item of state[state.phase] || []) {
    if ((item.attempts || 0) >= MAX_ATTEMPTS) {
      pendingSkips.push(kind.name(item.id))
      skipped.push(`${state.phase}:${item.id}`)
    } else todo.push(item)
  }
  log(`ronde ${round}: ${state.phase}, ${todo.length} taken, ${pendingSkips.length} overgeslagen`)
  history.push({ round, phase: state.phase, tasks: todo.length, skippedNow: pendingSkips.length })
  const ran = await pool(todo, AT_ONCE, (item) => tryAgent(work(kind.task(item.id)), withModel(state.phase, { label: `${state.phase} ${item.id}`, phase: kind.title })))
  attempted = ran.done.map((item) => `${state.phase}:${item.id}`)
  if (ran.siteDown > 0) {
    paused = `${SITE_PAUSED_NL} (${ran.siteDown} van ${todo.length} agents van ronde ${round} stopten door een storing van de site)`
    history.push({ round, phase: 'storing van de site', note: `${ran.siteDown} agents` })
    break
  }
  if (ran.outage) {
    paused = `${PAUSED_NL} (${ran.errors.length} van ${todo.length} agents van ronde ${round} stopten met een fout, de laatste: ${ran.errors.at(-1)})`
    history.push({ round, phase: 'storing', note: ran.errors.at(-1) })
    break
  }
}

// The agents that came back in the round that paused are not counted: the stand that would record it cannot run.
// A start after the pause gives each of them at most one attempt more, which errs on the side of trying.
if (paused) {
  log(paused)
  last = 'storing'
}
return { history, skipped, last, paused, models: Object.fromEntries(ROLES.map((role) => [role, MODEL[role] || null])) }
