import { store } from './store'
import { SCENARIOS, type Scenario, type ScenarioKey, type TaskSpec } from './world'

/*
 * The plan: what the coordinator proposes to do with a big request, before
 * any of it runs. It goes through versions as the person and the coordinator
 * talk it over: each answer of the coordinator's that changes it is a new
 * version, and what the person changes by hand (who leads a step, a note on
 * it, dropping it, a dependency taken away) goes onto the latest one. Once
 * they launch it, its latest version is what runs: the simulation's tasks
 * are its steps.
 */

export const SCENARIO_KEYS: ReadonlyArray<ScenarioKey> = ['two', 'six', 'cloud']
export const SCENARIO_NAMES: Readonly<Record<ScenarioKey, string>> = { two: '2 tasks', six: '6 tasks', cloud: 'Althar Cloud · 12' }

const query = new URLSearchParams(window.location.search)

export const scenarioKey = store<ScenarioKey>(SCENARIO_KEYS.find((one) => one === query.get('s')) ?? 'cloud')

/** Before the person launches it, the plan, talked over; after, the run. */
export type Stage = 'plan' | 'run'
export const stage = store<Stage>(query.get('stage') === 'run' ? 'run' : 'plan')

/* ——— what the primitive is called ——— */

/** What a request run as a graph of tasks is called: the person hasn't picked a word yet. */
export const NOUNS = ['Mission', 'Goal', 'Milestone', 'Constellation'] as const
export type Noun = (typeof NOUNS)[number]
export const noun = store<Noun>(NOUNS.find((one) => one.toLowerCase() === (query.get('noun') ?? '').toLowerCase()) ?? 'Mission')
/** The word, capitalised or not, and with its article: Mission, mission, a mission. */
export const word = (form: 'One' | 'one' | 'a one' = 'One'): string => {
  const one = noun.get()
  if (form === 'One') return one
  if (form === 'one') return one.toLowerCase()
  return `${/^[AEIOU]/.test(one) ? 'an' : 'a'} ${one.toLowerCase()}`
}

/* ——— the plan ——— */

export interface Step extends TaskSpec {
  readonly dropped: boolean
  /** What changed on this step in the latest version, or by the person since: lead, effort, note, dropped, after. */
  readonly changed: ReadonlyArray<'lead' | 'effort' | 'note' | 'dropped' | 'after'>
}

export interface Version {
  readonly n: number
  readonly steps: ReadonlyArray<Step>
  /** What changed from the version before, a line each; empty for the first. */
  readonly changes: ReadonlyArray<string>
}

export type Said =
  | { readonly id: string; readonly kind: 'you'; readonly text: string; readonly minute: number }
  | {
      readonly id: string
      readonly kind: 'says'
      readonly text: string
      readonly minute: number
      /** The version this answer made, where it changed the plan. */
      readonly version: number | null
    }

export interface Plan {
  readonly versions: ReadonlyArray<Version>
  /** The talk after the coordinator's first answer, in order: the person's messages and its answers. */
  readonly talk: ReadonlyArray<Said>
  /** What the person changed by hand since the coordinator last answered, a line each, for its next version to take in. */
  readonly edits: ReadonlyArray<string>
  /** Notes on the whole plan, for every step's lead. */
  readonly notes: ReadonlyArray<string>
  /** The coordinator is answering. */
  readonly thinking: boolean
}

const stepsOf = (scenario: Scenario): ReadonlyArray<Step> => scenario.tasks.map((one) => ({ ...one, dropped: false, changed: [] }))

/** Where a request starts: the coordinator's first version, and for Althar Cloud a turn of talk that made a second. */
const seedOf = (key: ScenarioKey): Plan => {
  const base = SCENARIOS[key]
  const first: Version = { n: 1, steps: stepsOf(base), changes: [] }
  if (key !== 'cloud') return { versions: [first], talk: [], edits: [], notes: [], thinking: false }
  const second: Version = {
    n: 2,
    steps: first.steps.map((one): Step => {
      if (one.key === 'hosts')
        return { ...one, effort: 'xhigh', notes: ['Use green for a host that’s online.'], changed: ['effort', 'note'] }
      if (one.key === 'reconnect') return { ...one, lead: 'codex', model: 'gpt-6.1-sol', changed: ['lead'] }
      return one
    }),
    changes: ['Hosts screen: Opus 5.5 at extra high, with your note', 'Reconnect: Codex on GPT-6.1 Sol'],
  }
  return {
    versions: [first, second],
    talk: [
      {
        id: 'talk_seed_you',
        kind: 'you',
        text: 'The Hosts screen is a design step: give it Opus at extra high, and use green for a host that’s online. Codex can take Reconnect.',
        minute: -22,
      },
      {
        id: 'talk_seed_says',
        kind: 'says',
        text: 'Done. The Hosts screen runs at extra high with your note on it, and Reconnect moves to Codex. Neither changes what waits for what.',
        minute: -21.5,
        version: 2,
      },
    ],
    edits: [],
    notes: [],
    thinking: false,
  }
}

export const plan = store<Plan>(seedOf(scenarioKey.get()))
/** Back to where the request starts: its first versions, nothing changed by hand. */
export const replan = () => plan.set(seedOf(scenarioKey.get()))
scenarioKey.subscribe(replan)

export const latest = (one: Plan = plan.get()): Version => one.versions.at(-1) as Version

/** The request as it runs: the latest version's steps, without those dropped, each waiting only for steps still in it. */
let made: { plan: Plan; key: ScenarioKey; scenario: Scenario } | null = null
export const scenario = (): Scenario => {
  const now = plan.get()
  const key = scenarioKey.get()
  if (made?.plan === now && made.key === key) return made.scenario
  const kept = latest(now).steps.filter((one) => !one.dropped)
  const keys = new Set(kept.map((one) => one.key))
  const notes = now.notes
  const tasks = kept.map(({ dropped: _dropped, changed: _changed, ...one }): TaskSpec => ({
    ...one,
    deps: one.deps.filter((dep) => keys.has(dep)),
    notes: [...notes, ...(one.notes ?? [])],
  }))
  made = { plan: now, key, scenario: { ...SCENARIOS[key], tasks } }
  return made.scenario
}

/* ——— who can lead a step ——— */

export const LEADS: ReadonlyArray<{
  readonly model: string
  readonly lead: TaskSpec['lead']
  readonly name: string
  readonly short: string
}> = [
  { model: 'claude-opus-5-5', lead: 'claude-code', name: 'Claude Opus 5.5', short: 'Opus 5.5' },
  { model: 'claude-sonnet-5-5', lead: 'claude-code', name: 'Claude Sonnet 5.5', short: 'Sonnet 5.5' },
  { model: 'gpt-6.1-sol', lead: 'codex', name: 'GPT-6.1 Sol', short: 'GPT-6.1 Sol' },
  { model: 'gpt-6.1-terra', lead: 'codex', name: 'GPT-6.1 Terra', short: 'GPT-6.1 Terra' },
]
export const leadOf = (model: string) => LEADS.find((one) => one.model === model) ?? (LEADS[0] as (typeof LEADS)[number])
export const EFFORTS: Readonly<Record<NonNullable<TaskSpec['effort']>, string>> = { medium: 'medium', high: 'high', xhigh: 'extra high' }

/* ——— what the person changes by hand ——— */

const edit = (key: string, change: (step: Step) => Step, line: (step: Step) => string) =>
  plan.set((now) => {
    const last = latest(now)
    const step = last.steps.find((one) => one.key === key)
    if (step === undefined) return now
    const next = change(step)
    return {
      ...now,
      versions: [...now.versions.slice(0, -1), { ...last, steps: last.steps.map((one) => (one.key === key ? next : one)) }],
      edits: [...now.edits, line(next)],
    }
  })

const marked = (step: Step, what: Step['changed'][number]): Step['changed'] =>
  step.changed.includes(what) ? step.changed : [...step.changed, what]

export const setLead = (key: string, model: string) =>
  edit(
    key,
    (step) => ({ ...step, model, lead: leadOf(model).lead, changed: marked(step, 'lead') }),
    (step) => `${step.short}: ${leadOf(step.model).name}`,
  )

export const setEffort = (key: string, effort: NonNullable<TaskSpec['effort']>) =>
  edit(
    key,
    (step) => ({ ...step, effort, changed: marked(step, 'effort') }),
    (step) => `${step.short}: ${EFFORTS[effort]} effort`,
  )

export const addNote = (key: string, text: string) => {
  const clean = text.trim()
  if (clean === '') return
  edit(
    key,
    (step) => ({ ...step, notes: [...(step.notes ?? []), clean], changed: marked(step, 'note') }),
    (step) => `Note on ${step.short}: “${clean}”`,
  )
}

export const removeNote = (key: string, index: number) =>
  edit(
    key,
    (step) => ({ ...step, notes: (step.notes ?? []).filter((_, i) => i !== index) }),
    (step) => `A note off ${step.short}`,
  )

export const setDropped = (key: string, dropped: boolean) =>
  edit(
    key,
    (step) => ({ ...step, dropped, changed: dropped ? marked(step, 'dropped') : step.changed.filter((one) => one !== 'dropped') }),
    (step) => (dropped ? `Dropped ${step.short}` : `${step.short} back in`),
  )

export const unlinkStep = (key: string, dep: string) => {
  const other = latest().steps.find((one) => one.key === dep)?.short ?? dep
  edit(
    key,
    (step) => ({ ...step, deps: step.deps.filter((one) => one !== dep), changed: marked(step, 'after') }),
    (step) => `${step.short} no longer waits for ${other}`,
  )
}

/* ——— talking it over with the coordinator ——— */

const NUMBERS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']

/** The steps a message names, in the order it names them: by their name, a word of their title, or "step three". */
const named = (text: string, steps: ReadonlyArray<Step>): Step[] => {
  const lower = text.toLowerCase()
  const found: Array<{ step: Step; at: number }> = []
  for (const [i, step] of steps.entries()) {
    const words = [
      step.short.toLowerCase(),
      step.key,
      ...step.short
        .toLowerCase()
        .split(/[\s&]+/)
        .filter((one) => one.length > 4),
    ]
    const at = Math.min(...words.map((one) => (one.length > 2 ? lower.indexOf(one) : -1)).map((one) => (one < 0 ? Infinity : one)))
    const byNumber = new RegExp(`step (${i + 1}|${NUMBERS[i]})\\b`).exec(lower)
    const where = Math.min(at, byNumber === null ? Infinity : byNumber.index)
    if (where !== Infinity) found.push({ step, at: where })
  }
  return found.toSorted((a, b) => a.at - b.at).map((one) => one.step)
}

/** What the coordinator makes of a message: the plan's next steps and what changed, in words, or a question back. */
const read = (text: string, now: Plan): { steps: ReadonlyArray<Step>; changes: string[]; notes: string[]; reply: string } => {
  const lower = text.toLowerCase()
  const last = latest(now)
  const steps = last.steps.filter((one) => !one.dropped)
  const mentioned = named(text, steps)
  const target = mentioned[0]
  const changes: string[] = []
  let next = last.steps
  const put = (key: string, change: (step: Step) => Step) => {
    next = next.map((one) => (one.key === key ? change(one) : one))
  }
  const model = /sonnet/.test(lower)
    ? 'claude-sonnet-5-5'
    : /terra/.test(lower)
      ? 'gpt-6.1-terra'
      : /\b(sol|codex|gpt)\b/.test(lower)
        ? 'gpt-6.1-sol'
        : /\b(opus|claude)\b/.test(lower)
          ? 'claude-opus-5-5'
          : null
  const effort = /extra high|xhigh/.test(lower) ? 'xhigh' : /\bhigh\b/.test(lower) ? 'high' : /\bmedium\b/.test(lower) ? 'medium' : null
  const drop = /\b(drop|remove|skip|cut|no need for|don.t need)\b/.test(lower)
  const after = /\b(after|wait(s)? for|once)\b/.exec(lower)
  if (target === undefined) {
    if (model !== null || drop) return { steps: last.steps, changes: [], notes: [], reply: 'Which step should that go on?' }
    return {
      steps: last.steps,
      changes: [`A note on every step: “${text.trim()}”`],
      notes: [text.trim()],
      reply: 'Every step’s lead will have that as a note.',
    }
  }
  if (drop) {
    put(target.key, (one) => ({ ...one, dropped: true, changed: ['dropped'] }))
    const left = steps.filter((one) => one.deps.includes(target.key) && one.key !== target.key)
    changes.push(`Dropped ${target.short}`)
    return {
      steps: next,
      changes,
      notes: [],
      reply:
        left.length === 0
          ? `Dropped ${target.short}. Nothing else waited for it.`
          : `Dropped ${target.short}. ${left.map((one) => one.short).join(' and ')} no longer wait for it, and start sooner.`,
    }
  }
  if (after !== null && mentioned.length > 1) {
    const other = mentioned.find((one) => one.key !== target.key && text.toLowerCase().indexOf(one.short.toLowerCase()) > after.index)
    if (other !== undefined && !target.deps.includes(other.key)) {
      put(target.key, (one) => ({ ...one, deps: [...one.deps, other.key], changed: ['after'] }))
      changes.push(`${target.short} waits for ${other.short}`)
    }
  }
  if (model !== null && model !== target.model) {
    put(target.key, (one) => ({ ...one, model, lead: leadOf(model).lead, changed: [...one.changed, 'lead'] }))
    changes.push(`${target.short}: ${leadOf(model).name}`)
  }
  if (effort !== null && effort !== target.effort) {
    put(target.key, (one) => ({ ...one, effort, changed: [...one.changed, 'effort'] }))
    changes.push(`${target.short}: ${EFFORTS[effort]} effort`)
  }
  if (changes.length === 0 || /\b(use|make sure|remember|note|should|must|keep|don.t|never|always)\b/.test(lower)) {
    const note = text.trim().replace(/^(on |for )?(step \w+|the [\w\s&]+? step)[,:]?\s*/i, '')
    const clean = note.charAt(0).toUpperCase() + note.slice(1)
    put(target.key, (one) => ({ ...one, notes: [...(one.notes ?? []), clean], changed: [...one.changed, 'note'] }))
    changes.push(`Note on ${target.short}: “${clean}”`)
  }
  return {
    steps: next.map((one) => (one.key === target.key ? one : { ...one, changed: [] })),
    changes,
    notes: [],
    reply: `Done. ${changes.join('; ')}.`,
  }
}

let told = 0
/**
 * The person says something to the coordinator about the plan: it shows at once, and the coordinator answers a moment
 * later, with a new version where it changed anything. `minute` is when, on the lab's clock.
 */
export const tell = (text: string, minute: number, onAnswer?: () => void) => {
  told += 1
  const id = `talk_${told}`
  plan.set((now) => ({ ...now, thinking: true, talk: [...now.talk, { id: `${id}_you`, kind: 'you', text, minute }] }))
  setTimeout(() => {
    plan.set((now) => {
      const made = read(text, now)
      const changed = made.changes.length > 0
      const n = latest(now).n + 1
      const version: Version | null = changed ? { n, steps: made.steps, changes: [...now.edits, ...made.changes] } : null
      return {
        ...now,
        thinking: false,
        versions: version === null ? now.versions : [...now.versions, version],
        edits: version === null ? now.edits : [],
        notes: [...now.notes, ...made.notes],
        talk: [...now.talk, { id: `${id}_says`, kind: 'says', text: made.reply, minute: minute + 0.05, version: version?.n ?? null }],
      }
    })
    onAnswer?.()
  }, 1400)
}
