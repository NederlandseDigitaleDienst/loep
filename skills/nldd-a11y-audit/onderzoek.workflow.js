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
// Four phases of at most three rounds each (two attempts and the round that skips), and the round that finds everything done.
const MAX_ROUNDS = 16
const MAX_ATTEMPTS = 2
// Sites that no agent of this run may open, for example a set that is held back for a final test. Empty when the caller gives none.
const NEVER_OPEN =
  Array.isArray(neverOpen) && neverOpen.length > 0
    ? `Open of bevraag nooit, op geen enkele manier, een van deze sites: ${neverOpen.join(', ')}. Je werkt alleen op de site uit je opdracht.`
    : 'Je werkt alleen op de site uit je opdracht.'

// The model of each role. A role without a choice sets no model, so its agents run on the model of the session.
const ROLES = ['stand', 'walks', 'judges', 'verifiers', 'finishers']
const KNOWN_MODELS = ['opus', 'sonnet', 'haiku']
function chooseModels(given) {
  if (given === undefined || given === null) return {}
  if (typeof given !== 'object' || Array.isArray(given)) throw new Error(`models moet een object zijn, bijvoorbeeld { "walks": "sonnet" }, niet ${JSON.stringify(given)}`)
  const chosen = {}
  for (const [role, model] of Object.entries(given)) {
    if (!ROLES.includes(role)) throw new Error(`models: onbekende rol "${role}"; kies uit ${ROLES.join(', ')}`)
    if (!KNOWN_MODELS.includes(model)) throw new Error(`models: onbekend model ${JSON.stringify(model)} voor "${role}"; kies uit ${KNOWN_MODELS.join(', ')}`)
    chosen[role] = model
  }
  return chosen
}
const MODEL = chooseModels(models)
const withModel = (role, options) => (MODEL[role] ? { ...options, model: MODEL[role] } : options)

const ITEM = {
  type: 'object',
  properties: {
    pageType: { type: 'string' },
    criterion: { type: 'string' },
    task: { type: 'string' },
    session: { type: 'string' },
  },
  required: ['task'],
}
const PENDING = {
  type: 'object',
  properties: {
    phase: { type: 'string', description: 'walks, judges, verifiers, finishers, done of error' },
    walks: { type: 'array', items: ITEM },
    judges: { type: 'array', items: ITEM },
    verifiers: { type: 'array', items: ITEM },
    finishers: { type: 'array', items: ITEM },
    note: { type: 'string' },
  },
  required: ['phase', 'walks', 'judges', 'verifiers', 'finishers'],
}

function shell(commands, round) {
  const numbered = commands.map((command, index) => `${index + 1}. ${command}`).join('\n')
  return agent(
    `Voer in een shell precies deze commando's uit, na elkaar, en doe verder niets. Lees geen bestanden en wijzig niets. ${NEVER_OPEN}\n${numbered}\nHet laatste commando drukt één JSON-object af met de sleutels phase, walks, judges, verifiers en finishers. Geef dat object ongewijzigd terug als je antwoord. Mislukt een commando, geef dan phase "error" terug met lege lijsten en in note de foutmelding.`,
    withModel('stand', { schema: PENDING, label: `stand ${round}`, phase: 'Stand', effort: 'low' }),
  )
}

function work(task) {
  return `Lees het bestand ${task} en voer de opdracht die daarin staat volledig en precies uit. Het bestand bevat alles wat je nodig hebt. Lees niets onder de map fixtures van de toolbox. Wijzig geen andere bestanden dan de bestanden die je opdracht noemt. Start of stop geen andere processen dan je eigen sessie. ${NEVER_OPEN} Meld na afloop in hooguit drie regels de uitkomst die je hebt opgeschreven en of de controle is geslaagd.`
}

const PHASES = {
  walks: { title: 'Rondgangen', id: (item) => item.pageType, skip: (id) => `--page-type ${id}` },
  judges: { title: 'Beoordelen', id: (item) => item.criterion, skip: (id) => `--criterion ${id}` },
  verifiers: { title: 'Verifiëren', id: (item) => item.criterion, skip: (id) => `--criterion ${id} --round final` },
  // Only for a criterion that the evaluation itself left open after the verifiers; a run without one goes from verifiers to done.
  finishers: { title: 'Afmaken', id: (item) => item.criterion, skip: (id) => `--criterion ${id} --round finish` },
}

// A pool: `limit` workers each take the next item as soon as their own is done. So `limit` agents run for
// as long as there is work, and never more: a slow agent holds up one place and not a whole group.
// An agent that fails frees its place like one that finished; the next round finds its task still open.
async function pool(items, limit, run) {
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]
      try {
        await run(item)
      } catch (error) {
        log(`agent gestopt met een fout: ${error && error.message ? error.message : error}`)
      }
    }
  }
  await parallel(Array.from({ length: Math.min(limit, items.length) }, () => worker))
}

const attempts = {}
const skipped = []
const history = []
let pendingSkips = []
let last = null

for (let round = 1; round <= MAX_ROUNDS; round++) {
  const commands = [
    ...pendingSkips.map((entry) => `node ${cli} skip --run ${run} ${entry} --reason "de agent leverde na twee pogingen geen geldig resultaat"`),
    `node ${cli} tasks --run ${run}`,
    `node ${cli} pending --run ${run}`,
  ]
  pendingSkips = []
  const state = await shell(commands, round)
  last = state
  if (!state || state.phase === 'error') {
    log(`stand ${round}: fout ${state ? state.note : 'geen antwoord'}`)
    history.push({ round, phase: 'error', note: state ? state.note : null })
    break
  }
  if (state.phase === 'done') {
    history.push({ round, phase: 'done' })
    break
  }
  const kind = PHASES[state.phase]
  if (!kind) {
    history.push({ round, phase: state.phase, note: 'onbekende fase' })
    break
  }
  const todo = []
  for (const item of state[state.phase] || []) {
    const key = `${state.phase}:${kind.id(item)}`
    attempts[key] = (attempts[key] || 0) + 1
    if (attempts[key] > MAX_ATTEMPTS) {
      pendingSkips.push(kind.skip(kind.id(item)))
      skipped.push(key)
    } else todo.push(item)
  }
  log(`ronde ${round}: ${state.phase}, ${todo.length} taken, ${pendingSkips.length} overgeslagen`)
  history.push({ round, phase: state.phase, tasks: todo.length, skippedNow: pendingSkips.length })
  await pool(todo, AT_ONCE, (item) => agent(work(item.task), withModel(state.phase, { label: `${state.phase} ${kind.id(item)}`, phase: kind.title })))
}

return { history, skipped, last: last ? last.phase : null, models: Object.fromEntries(ROLES.map((role) => [role, MODEL[role] || null])) }
