import { MERGES } from './merges.ts'

/*
 * What the usage lab's runtime knows, made up on althar's own history: every
 * pull request merged on main since the repository began (merges.json: when,
 * its title, its number, the lines it changed) is a finished change, and
 * around them the work that didn't merge: prototypes, chats, pull request
 * reviews, abandoned changes, and the coordinator's day. Who led each and
 * who reviewed it, its steps, their tokens, what each review found and what
 * became of it, are drawn from a seed, so every load is the same.
 *
 * The models and dates follow the project's notes: Claude Opus 5.5 leads most
 * work, GPT-6.1 Sol and Terra review; Fable 5.2 ran for a fortnight before the
 * person stopped it on 13 Nov for eating their usage; design work moved to
 * Claude on 31 Oct. Prices are made up, per million tokens.
 */

export const MIN = 60_000
export const HOUR = 60 * MIN
export const DAY = 24 * HOUR
export const NOW = Date.now()

export type AgentId = 'claude-code' | 'codex'
export type ModelId = 'opus-5.5' | 'opus-5' | 'sonnet-5.5' | 'fable-5.2' | 'haiku-5.5' | 'sol-6.1' | 'sol-6' | 'terra-6.1'
/** A model's colour, by its family, in the charts' fixed order: clay, indigo, ochre, plum; the rest neutral. */
export type Ink = 'clay' | 'indigo' | 'ochre' | 'plum' | 'neutral'

export interface ModelFact {
  readonly id: ModelId
  readonly name: string
  readonly short: string
  readonly agent: AgentId
  readonly lab: 'anthropic' | 'openai'
  readonly ink: Ink
  /** Dollars per million tokens: input not from the cache, output (thinking too), read from the cache, written to it. */
  readonly price: { readonly input: number; readonly output: number; readonly read: number; readonly write: number }
}

const model = (
  id: ModelId,
  name: string,
  short: string,
  agent: AgentId,
  ink: Ink,
  price: readonly [number, number, number, number],
): ModelFact => ({
  id,
  name,
  short,
  agent,
  lab: agent === 'codex' ? 'openai' : 'anthropic',
  ink,
  price: { input: price[0], output: price[1], read: price[2], write: price[3] },
})

export const MODELS: Readonly<Record<ModelId, ModelFact>> = {
  'opus-5.5': model('opus-5.5', 'Claude Opus 5.5', 'Opus 5.5', 'claude-code', 'clay', [5, 25, 0.5, 6.25]),
  'opus-5': model('opus-5', 'Claude Opus 5', 'Opus 5', 'claude-code', 'clay', [5, 25, 0.5, 6.25]),
  'sonnet-5.5': model('sonnet-5.5', 'Claude Sonnet 5.5', 'Sonnet 5.5', 'claude-code', 'plum', [3, 15, 0.3, 3.75]),
  'fable-5.2': model('fable-5.2', 'Claude Fable 5.2', 'Fable 5.2', 'claude-code', 'ochre', [15, 75, 1.5, 18.75]),
  'haiku-5.5': model('haiku-5.5', 'Claude Haiku 5.5', 'Haiku 5.5', 'claude-code', 'neutral', [1, 5, 0.1, 1.25]),
  'sol-6.1': model('sol-6.1', 'GPT-6.1 Sol', 'Sol 6.1', 'codex', 'indigo', [1.25, 10, 0.125, 0]),
  'sol-6': model('sol-6', 'GPT-6 Sol', 'Sol 6', 'codex', 'indigo', [1.25, 10, 0.125, 0]),
  'terra-6.1': model('terra-6.1', 'GPT-6.1 Terra', 'Terra 6.1', 'codex', 'neutral', [0.25, 2, 0.025, 0]),
}

export const AGENTS: Readonly<Record<AgentId, { readonly name: string; readonly plan: string; readonly price: number }>> = {
  'claude-code': { name: 'Claude Code', plan: 'Claude Code Max', price: 200 },
  codex: { name: 'Codex', plan: 'Codex Pro', price: 200 },
}

export type Preset = 'change' | 'small' | 'prototype' | 'chat' | 'review'
export const PRESETS: Readonly<Record<Preset, string>> = {
  change: 'Change',
  small: 'Small change',
  prototype: 'Prototype',
  chat: 'Chat',
  review: 'Review a PR',
}
/** The presets, several of them: Changes, PR reviews. */
export const PRESETS_MANY: Readonly<Record<Preset, string>> = {
  change: 'Changes',
  small: 'Small changes',
  prototype: 'Prototypes',
  chat: 'Chats',
  review: 'PR reviews',
}

/** How a task ended: merged, kept on its branch (a prototype), answered (a chat), its review posted, abandoned, or still going. */
export type Outcome = 'merged' | 'branch' | 'answered' | 'reviewed' | 'abandoned' | 'open'

export type StepKey = 'build' | 'review' | 'fix' | 'checks'
export const STEPS: Readonly<Record<StepKey, string>> = { build: 'Build', review: 'Review', fix: 'Fixes', checks: 'Checks' }

export interface Tokens {
  /** Read from the cache. */
  readonly cached: number
  /** Input not from the cache. */
  readonly uncached: number
  /** Written to the cache. */
  readonly written: number
  /** Output, thinking included. */
  readonly output: number
}

export type Severity = 'blocking' | 'major' | 'minor' | 'nit'
export interface Finding {
  readonly severity: Severity
  readonly state: 'fixed' | 'set_aside' | 'dismissed'
}

export interface Step {
  readonly key: StepKey
  /** Which review, or which round of fixes after it: 1, 2… */
  readonly round: number
  readonly model: ModelId
  readonly effort: string
  readonly from: number
  readonly to: number
  readonly tokens: Tokens
  /** At list prices. */
  readonly cost: number
  /** What a review found. */
  readonly findings?: ReadonlyArray<Finding>
}

export interface Task {
  readonly id: string
  readonly title: string
  readonly project: 'althar' | 'meridian'
  readonly preset: Preset
  readonly startedAt: number
  /** When it settled: merged, answered, abandoned; null while it goes on. */
  readonly endedAt: number | null
  readonly outcome: Outcome
  readonly pr: number | null
  readonly lines: number
  readonly lead: ModelId
  readonly effort: string
  readonly reviewer: ModelId | null
  readonly steps: ReadonlyArray<Step>
  /** Of the time from its start to its merge: agents at work, its checks running, and waiting on the person. */
  readonly worked: number
  readonly checking: number
  readonly waited: number
  readonly cost: number
}

/** The coordinator's day, and the asides on Scratch: not in a task. */
export interface Day {
  readonly at: number
  readonly project: 'althar' | 'meridian'
  readonly model: ModelId
  readonly tokens: Tokens
  readonly cost: number
}

// ——— a seed ———

/** Mulberry32: the same numbers for the same seed. */
const seeded = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
type Rand = () => number
const normal = (r: Rand) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r())
const lognormal = (r: Rand, median: number, spread: number) => median * Math.exp(normal(r) * spread)
const poisson = (r: Rand, mean: number) => {
  const limit = Math.exp(-mean)
  let k = 0
  let p = r()
  while (p > limit) {
    k += 1
    p *= r()
  }
  return k
}
const pick = <T>(r: Rand, weighted: ReadonlyArray<readonly [T, number]>): T => {
  const total = weighted.reduce((sum, [, w]) => sum + w, 0)
  let at = r() * total
  for (const [value, w] of weighted) {
    at -= w
    if (at <= 0) return value
  }
  return weighted.at(-1)![0]
}

// ——— prices ———

export const costOf = (tokens: Tokens, id: ModelId) => {
  const p = MODELS[id].price
  return (tokens.uncached * p.input + tokens.written * p.write + tokens.output * p.output + tokens.cached * p.read) / 1e6
}
export const totalOf = (t: Tokens) => t.cached + t.uncached + t.written + t.output
export const addTokens = (a: Tokens, b: Tokens): Tokens => ({
  cached: a.cached + b.cached,
  uncached: a.uncached + b.uncached,
  written: a.written + b.written,
  output: a.output + b.output,
})
export const NO_TOKENS: Tokens = { cached: 0, uncached: 0, written: 0, output: 0 }

/** A turn's worth of tokens, split as an agent's are: nearly all of it read back from the cache. */
const tokensOf = (r: Rand, total: number): Tokens => {
  const cached = 0.925 + r() * 0.04
  const written = 0.018 + r() * 0.012
  const uncached = 0.006 + r() * 0.008
  return {
    cached: total * cached,
    written: total * written,
    uncached: total * uncached,
    output: total * Math.max(0.006, 1 - cached - written - uncached),
  }
}

// ——— dates ———

const at = (iso: string) => Date.parse(iso)
const OPUS_55 = at('2026-10-15T00:00:00Z')
const SOL_61 = at('2026-10-25T00:00:00Z')
const FABLE_FROM = at('2026-10-28T00:00:00Z')
/** The person stopped Fable: it eats their usage. */
export const FABLE_UNTIL = at('2026-11-13T12:00:00Z')
/** Design work is led by Claude from here. */
const CLAUDE_DESIGNS = at('2026-10-31T00:00:00Z')

const looksLikeDesign = (title: string) =>
  /\b(card|page|bar|button|dialog|spacing|menu|screen|look|design|board|tab|window|icon|font|dark|light|layout|picture|prototype|lab|canvas|chip|row|colour|color)\b/i.test(
    title,
  )

const leadAt = (r: Rand, when: number, design: boolean): ModelId => {
  const claude = when >= OPUS_55 ? 'opus-5.5' : 'opus-5'
  const sol = when >= SOL_61 ? 'sol-6.1' : 'sol-6'
  const fable = when >= FABLE_FROM && when < FABLE_UNTIL
  if (design && when >= CLAUDE_DESIGNS)
    return pick<ModelId>(r, [[claude, 0.74], ['sonnet-5.5', 0.1], ...(fable ? ([['fable-5.2', 0.24]] as const) : [])])
  return pick<ModelId>(r, [[claude, 0.58], [sol, 0.27], ['sonnet-5.5', 0.09], ...(fable ? ([['fable-5.2', 0.2]] as const) : [])])
}

const reviewerAt = (r: Rand, when: number, lead: ModelId): ModelId => {
  const codexLead = MODELS[lead].agent === 'codex'
  if (when < SOL_61)
    return codexLead
      ? pick<ModelId>(r, [
          ['opus-5', 0.7],
          ['sol-6', 0.3],
        ])
      : pick<ModelId>(r, [
          ['sol-6', 0.8],
          ['opus-5', 0.2],
        ])
  const claude = when >= OPUS_55 ? 'opus-5.5' : 'opus-5'
  return codexLead
    ? pick<ModelId>(r, [
        [claude, 0.6],
        ['sol-6.1', 0.25],
        ['terra-6.1', 0.15],
      ])
    : pick<ModelId>(r, [
        ['sol-6.1', 0.62],
        ['terra-6.1', 0.26],
        [claude, 0.12],
      ])
}

/** How much work each model makes of the same change, and how much its reviewers find in it. */
const TOKENS_BY: Partial<Record<ModelId, number>> = { 'fable-5.2': 1.35, 'sol-6.1': 0.9, 'sol-6': 0.95, 'sonnet-5.5': 1.1 }
const FOUND_IN: Partial<Record<ModelId, number>> = {
  'opus-5.5': 0.85,
  'opus-5': 1,
  'fable-5.2': 0.8,
  'sol-6.1': 1.25,
  'sol-6': 1.35,
  'sonnet-5.5': 1.15,
}
const FINDS: Partial<Record<ModelId, number>> = { 'sol-6.1': 1.15, 'sol-6': 1.1, 'terra-6.1': 0.72, 'opus-5.5': 0.95, 'opus-5': 0.95 }
const KEPT: Partial<Record<ModelId, readonly [number, number, number]>> = {
  'sol-6.1': [0.76, 0.15, 0.09],
  'sol-6': [0.72, 0.17, 0.11],
  'terra-6.1': [0.55, 0.2, 0.25],
}

const SEVERITIES: ReadonlyArray<readonly [Severity, number]> = [
  ['blocking', 0.07],
  ['major', 0.28],
  ['minor', 0.43],
  ['nit', 0.22],
]

const findingsOf = (r: Rand, mean: number, reviewer: ModelId): ReadonlyArray<Finding> => {
  const [fixed, aside, dismissed] = KEPT[reviewer] ?? [0.7, 0.18, 0.12]
  return Array.from({ length: poisson(r, mean) }, () => {
    const severity = pick(r, SEVERITIES)
    // What blocks gets fixed far more often than a nit.
    const lean = severity === 'blocking' ? 0.2 : severity === 'major' ? 0.08 : severity === 'nit' ? -0.2 : 0
    return {
      severity,
      state: pick<Finding['state']>(r, [
        ['fixed', Math.max(0.05, fixed + lean)],
        ['set_aside', aside],
        ['dismissed', dismissed],
      ]),
    }
  })
}

const EFFORTS: Readonly<Record<AgentId, ReadonlyArray<readonly [string, number]>>> = {
  'claude-code': [
    ['medium', 0.62],
    ['high', 0.26],
    ['xhigh', 0.12],
  ],
  codex: [
    ['medium', 0.7],
    ['high', 0.3],
  ],
}

// ——— a task ———

interface Shape {
  readonly id: string
  readonly title: string
  readonly project: 'althar' | 'meridian'
  readonly preset: Preset
  readonly outcome: Outcome
  readonly pr: number | null
  readonly lines: number
  /** Where it ends (merged, answered…), or for one still going, when it started. */
  readonly anchor: number
  readonly seed: number
}

const step = (
  r: Rand,
  key: StepKey,
  round: number,
  who: ModelId,
  effort: string,
  from: number,
  minutes: number,
  total: number,
  findings?: ReadonlyArray<Finding>,
): Step => {
  const tokens = tokensOf(
    r,
    total * (key === 'review' ? 1 : (TOKENS_BY[who] ?? 1)) * (effort === 'xhigh' ? 1.4 : effort === 'high' ? 1.15 : 1),
  )
  return {
    key,
    round,
    model: who,
    effort,
    from,
    to: from + minutes * MIN,
    tokens,
    cost: costOf(tokens, who),
    ...(findings === undefined ? {} : { findings }),
  }
}

const taskOf = (shape: Shape): Task => {
  const r = seeded(shape.seed)
  const design = looksLikeDesign(shape.title) || shape.preset === 'prototype'
  // Its start is worked out backwards from its end; the lead is who led at about that time.
  const roughStart = shape.outcome === 'open' ? shape.anchor : shape.anchor - 3 * HOUR
  const lead = leadAt(r, roughStart, design)
  const agent = MODELS[lead].agent
  const effort = shape.preset === 'prototype' && agent === 'claude-code' ? 'xhigh' : pick(r, EFFORTS[agent])
  const reviewed = shape.preset === 'change' || shape.preset === 'small'
  const reviewer = reviewed ? reviewerAt(r, roughStart, lead) : shape.preset === 'review' ? lead : null

  const size = Math.min(shape.lines, 5000)
  const scale =
    shape.preset === 'small'
      ? 0.35
      : shape.preset === 'prototype'
        ? 2.4
        : shape.preset === 'chat'
          ? 0.18
          : shape.preset === 'review'
            ? 0.45
            : 1
  const steps: Step[] = []
  let clock = 0
  const buildMinutes = Math.min(170, lognormal(r, (12 + size * 0.05) * Math.max(scale, 0.4), 0.45))
  const buildTokens = Math.min(80e6, lognormal(r, (3.5e6 + size * 16e3) * scale, 0.45))
  if (shape.preset !== 'review') steps.push(step(r, 'build', 1, lead, effort, clock, buildMinutes, buildTokens))
  clock += buildMinutes * MIN

  if (shape.preset === 'review') {
    const minutes = lognormal(r, 14, 0.4)
    steps.push(step(r, 'review', 1, lead, effort, clock, minutes, lognormal(r, 4.5e6 + size * 4e3, 0.4), findingsOf(r, 2.4, lead)))
    clock += minutes * MIN
  }

  if (reviewed && reviewer !== null) {
    let mean = Math.min(4, 0.9 + size / 700) * (FOUND_IN[lead] ?? 1) * (FINDS[reviewer] ?? 1) * (shape.preset === 'small' ? 0.45 : 1)
    for (let round = 1; round <= 3; round++) {
      const minutes = lognormal(r, 6 + size * 0.006, 0.35)
      const found = findingsOf(r, mean, reviewer)
      steps.push(step(r, 'review', round, reviewer, 'medium', clock, minutes, lognormal(r, 2.2e6 + size * 3.5e3, 0.35), found))
      clock += minutes * MIN
      const fixed = found.filter((one) => one.state === 'fixed')
      if (fixed.length === 0) break
      const fixMinutes = lognormal(r, 4 + 5 * fixed.length, 0.4)
      steps.push(step(r, 'fix', round, lead, effort, clock, fixMinutes, lognormal(r, 1.2e6 + 1.6e6 * fixed.length, 0.4)))
      clock += fixMinutes * MIN
      // Another round where what was fixed mattered.
      if (!fixed.some((one) => one.severity === 'blocking' || one.severity === 'major') && r() > 0.25) break
      mean *= 0.35
    }
  }
  const worked = clock
  let checking = 0
  if (shape.outcome === 'merged') {
    checking = lognormal(r, 11, 0.3) * MIN
    if (r() < 0.22) {
      const minutes = lognormal(r, 9, 0.4)
      steps.push(step(r, 'checks', 1, lead, effort, clock + checking, minutes, lognormal(r, 2.4e6, 0.45)))
      checking += (minutes + lognormal(r, 10, 0.3)) * MIN
    }
  }
  // Waiting on the person: a press, mostly soon; overnight now and then.
  const waited =
    shape.outcome === 'merged' || shape.outcome === 'branch'
      ? Math.min(30 * HOUR, lognormal(r, shape.preset === 'small' ? 14 : 32, 1.15) * MIN + (r() < 0.12 ? lognormal(r, 9, 0.3) * HOUR : 0))
      : shape.outcome === 'abandoned'
        ? lognormal(r, 26, 0.8) * HOUR
        : 0
  const span = worked + checking + waited
  const startedAt = shape.outcome === 'open' ? shape.anchor : shape.anchor - span
  // A task still going has done only what fits in the time since it started.
  const shown = shape.outcome === 'open' ? steps.filter((one) => one.from < NOW - startedAt) : steps
  const placed = shown.map((one) => ({ ...one, from: startedAt + one.from, to: Math.min(NOW, startedAt + one.to) }))
  return {
    id: shape.id,
    title: shape.title,
    project: shape.project,
    preset: shape.preset,
    startedAt,
    endedAt: shape.outcome === 'open' ? null : shape.anchor,
    outcome: shape.outcome,
    pr: shape.pr,
    lines: shape.lines,
    lead,
    effort,
    reviewer,
    steps: placed,
    worked,
    checking,
    waited,
    cost: placed.reduce((sum, one) => sum + one.cost, 0),
  }
}

// ——— the work around the merges ———

const PROTOTYPES = [
  'Prototype: the conversation bar',
  'Prototype: Connect a home',
  'Prototype: the design canvas',
  'Prototype: the board in pictures',
  'Prototype: the whole team on one board',
  'Prototype: handing a design over',
  'Prototype: artifacts a team makes',
  'Prototype: many repositories in a project',
  'Prototype: Althar’s settings',
  'Prototype: a small change, fast',
  'Prototype: clearing a chat',
  'Prototype: the thread as it streams',
  'Prototype: runs along the status line',
  'Prototype: the dock on the menu bar',
  'Prototype: the finder',
  'Prototype: the first project',
]
const CHATS = [
  'Why does the dock flicker on wake?',
  'Why the merge queue reran every check',
  'How many times does the GitHub webhook retry?',
  'Release notes wording',
  'SQLite WAL size after a week',
  'Does Codex keep its sandbox between turns?',
  'Inter weights on Windows',
  'Notarization failing on the Intel build',
  'Which ports the lab servers use',
  'What does the e2e run spend its time on?',
  'Is Bun’s lockfile stable across versions?',
  'Read the 0.9.0 notes for narration',
  'How does Orca read Anthropic’s usage?',
  'What is left of ADR-048?',
]
const REVIEWS = [
  'Review #412 on meridian',
  'Review the Linear connector PR',
  'Review the Flatpak packaging PR',
  'Review a contributor’s Windows fix',
  'Review the relay’s reconnect',
  'Review the site’s gallery PR',
]
const ABANDONED = [
  'Keep the coordinator’s copies warm',
  'A While you were away strip over the board',
  'Turn the coordinator off for a project',
  'Merge two tasks into one',
  'Group the board by repository',
  'Sidebar of projects',
  'Retry flaky e2e specs three times',
  'Badge pills for task kinds',
]
const MERIDIAN = [
  'Paginate the orders export',
  'Fix the timezone in invoices',
  'Cache the catalogue search',
  'Upgrade to Postgres 18',
  'Stripe webhooks retry on 5xx',
  'Remove the legacy cart',
  'Rate-limit the public API',
  'Seed data for the demo account',
]

const shapes = (): Shape[] => {
  const out: Shape[] = []
  const merges = MERGES
  for (const [when, title, pr, lines] of merges) {
    const r = seeded(pr * 7919)
    const small = lines < 70 && r() < 0.75
    out.push({
      id: `t_${pr}`,
      title,
      project: 'althar',
      preset: small ? 'small' : 'change',
      outcome: 'merged',
      pr,
      lines,
      anchor: when,
      seed: pr,
    })
  }
  // A day at a time, from the first merge: what didn't merge.
  const first = Math.min(...merges.map(([when]) => when))
  const r = seeded(20261119)
  let n = 0
  for (let day = first; day < NOW; day += DAY) {
    const busy = 0.55 + 0.45 * Math.min(1, (day - first) / (40 * DAY))
    const add = (preset: Preset, outcome: Outcome, titles: ReadonlyArray<string>, perDay: number, project: Shape['project'] = 'althar') => {
      for (let k = poisson(r, perDay * busy); k > 0; k--) {
        n += 1
        const anchor = day + (8 + r() * 15) * HOUR
        if (anchor > NOW) continue
        out.push({
          id: `x_${n}`,
          title: titles[Math.floor(r() * titles.length)]!,
          project,
          preset,
          outcome,
          pr: null,
          lines: preset === 'prototype' ? Math.round(lognormal(r, 900, 0.5)) : preset === 'chat' ? 0 : Math.round(lognormal(r, 260, 0.8)),
          anchor,
          seed: 1e6 + n,
        })
      }
    }
    add('prototype', 'branch', PROTOTYPES, 0.9)
    add('chat', 'answered', CHATS, 1.6)
    add('review', 'reviewed', REVIEWS, 0.35)
    add('change', 'abandoned', ABANDONED, 0.45)
    add('change', 'merged', MERIDIAN, 0.7, 'meridian')
    add('small', 'merged', MERIDIAN, 0.5, 'meridian')
  }
  // Still going: this task among them.
  out.push({
    id: 'x_now',
    title: 'Prototype: usage and analytics of your work',
    project: 'althar',
    preset: 'prototype',
    outcome: 'open',
    pr: null,
    lines: 2400,
    anchor: NOW - 25 * MIN,
    seed: 4242,
  })
  out.push({
    id: 'x_now2',
    title: 'Cut a small change’s overhead',
    project: 'althar',
    preset: 'change',
    outcome: 'open',
    pr: null,
    lines: 600,
    anchor: NOW - 70 * MIN,
    seed: 4243,
  })
  out.push({
    id: 'x_now3',
    title: 'Keep stopped work Up next',
    project: 'althar',
    preset: 'change',
    outcome: 'open',
    pr: null,
    lines: 300,
    anchor: NOW - 40 * MIN,
    seed: 4244,
  })
  return out
}

export const TASKS: ReadonlyArray<Task> = shapes()
  .map(taskOf)
  .sort((a, b) => a.startedAt - b.startedAt)

/** The coordinator's day and the asides, a day at a time, for each project. */
export const DAYS: ReadonlyArray<Day> = (() => {
  const out: Day[] = []
  const first = Math.min(...TASKS.map((task) => task.startedAt))
  const r = seeded(77)
  for (let day = first - (first % DAY); day < NOW; day += DAY) {
    for (const project of ['althar', 'meridian'] as const) {
      const work = TASKS.filter((task) => task.project === project && task.startedAt >= day && task.startedAt < day + DAY).length
      if (work === 0) continue
      const who: ModelId = day >= OPUS_55 ? 'opus-5.5' : 'opus-5'
      const tokens = tokensOf(r, lognormal(r, 2.2e6 * work, 0.3))
      out.push({ at: day + 12 * HOUR, project, model: who, tokens, cost: costOf(tokens, who) })
    }
  }
  return out
})()

// ——— the plans' weeks ———

/** When each plan's week starts again: Claude Code's on Friday at 09:00, Codex's on Tuesday at 14:00. */
const RESET: Readonly<Record<AgentId, { readonly day: number; readonly hour: number }>> = {
  'claude-code': { day: 5, hour: 9 },
  codex: { day: 2, hour: 14 },
}

/** The start of the week a moment is in, for a plan. */
export const weekStartOf = (agent: AgentId, when: number) => {
  const d = new Date(when)
  const { day, hour } = RESET[agent]
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour)
  const back = (d.getUTCDay() - day + 7) % 7
  const candidate = start - back * DAY
  return candidate > when ? candidate - 7 * DAY : candidate
}

/** What each plan's use was at list prices, as moments: every step and the coordinator's day, at its end. */
export interface Use {
  readonly at: number
  readonly agent: AgentId
  readonly cost: number
  readonly taskId: string | null
  readonly project: 'althar' | 'meridian'
}

export const USES: ReadonlyArray<Use> = [
  ...TASKS.flatMap((task) =>
    task.steps.map(
      (one) => ({ at: one.to, agent: MODELS[one.model].agent, cost: one.cost, taskId: task.id, project: task.project }) satisfies Use,
    ),
  ),
  ...DAYS.map((day) => ({ at: day.at, agent: MODELS[day.model].agent, cost: day.cost, taskId: null, project: day.project }) satisfies Use),
].sort((a, b) => a.at - b.at)

/** Use outside Althar (the same sign-in, in a terminal), in points of the week a day. */
export const OUTSIDE: Readonly<Record<AgentId, number>> = { 'claude-code': 0.6, codex: 0.25 }

/**
 * A plan's week in dollars at list prices: what a full week holds. Set so
 * this week of Claude Code's ends about 84% used, and last week of Codex's
 * ran out a day before it started again: the Fable fortnight runs Claude
 * Code out twice.
 */
export const WEEK_HOLDS: Readonly<Record<AgentId, number>> = (() => {
  const weekOf = (agent: AgentId, start: number) =>
    USES.filter((use) => use.agent === agent && weekStartOf(agent, use.at) === start).reduce((sum, use) => sum + use.cost, 0)
  const claude = weekStartOf('claude-code', NOW)
  const codex = weekStartOf('codex', NOW) - 7 * DAY
  return {
    'claude-code': weekOf('claude-code', claude) / (0.84 - (OUTSIDE['claude-code'] * 7) / 100),
    codex: weekOf('codex', codex) / (1.18 - (OUTSIDE.codex * 7) / 100),
  }
})()
