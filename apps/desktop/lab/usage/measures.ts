import {
  addTokens,
  type AgentId,
  DAY,
  DAYS,
  type Finding,
  HOUR,
  MODELS,
  type ModelId,
  NO_TOKENS,
  NOW,
  OUTSIDE,
  type Outcome,
  type Preset,
  type Task,
  TASKS,
  type Tokens,
  USES,
  WEEK_HOLDS,
  weekStartOf,
} from './facts.ts'

/*
 * What each direction reads of the facts, for a period (the last 7, 30 or 90
 * days, or the same length before it) and a scope (this project, or all).
 * Each is what a runtime read would answer; where the runtime keeps no such
 * fact today, the README says.
 */

export type Range = 7 | 30 | 90
export type Scope = 'althar' | 'meridian' | 'all'

export interface Period {
  readonly from: number
  readonly to: number
  readonly days: number
}

/** The last `days` days, ending now; `back` periods earlier for 1, 2… */
export const periodOf = (days: Range, back = 0): Period => {
  const to = NOW - back * days * DAY
  return { from: to - days * DAY, to, days }
}

const inScope = (scope: Scope) => (one: { readonly project: string }) => scope === 'all' || one.project === scope
const within = (period: Period) => (at: number) => at >= period.from && at < period.to

export const median = (values: ReadonlyArray<number>): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}
export const quantile = (values: ReadonlyArray<number>, q: number): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]!
}
const sum = (values: ReadonlyArray<number>) => values.reduce((a, b) => a + b, 0)

/** Tasks that ended in the period, and those still going that started in it. */
export const tasksIn = (period: Period, scope: Scope): ReadonlyArray<Task> =>
  TASKS.filter(inScope(scope)).filter((task) =>
    task.endedAt === null ? task.startedAt < period.to && period.to >= NOW : within(period)(task.endedAt),
  )

export const isChange = (task: Task) => task.preset === 'change' || task.preset === 'small'
export const mergedOf = (tasks: ReadonlyArray<Task>) => tasks.filter((task) => task.outcome === 'merged')
export const toMerge = (task: Task) => task.worked + task.checking + task.waited

/** What everything cost in the period at list prices, by agent: every step and the coordinator's day, when it ran. */
export const spentIn = (period: Period, scope: Scope) => {
  const uses = USES.filter(inScope(scope)).filter((use) => within(period)(use.at))
  const by = (agent: AgentId) => sum(uses.filter((use) => use.agent === agent).map((use) => use.cost))
  return {
    total: sum(uses.map((use) => use.cost)),
    'claude-code': by('claude-code'),
    codex: by('codex'),
    coordinator: sum(uses.filter((use) => use.taskId === null).map((use) => use.cost)),
  }
}

/** Tokens of everything in the period, and what reading from the cache saved against paying full input price for it. */
export const tokensIn = (period: Period, scope: Scope, agent?: AgentId) => {
  let tokens: Tokens = NO_TOKENS
  let saved = 0
  const add = (model: ModelId, t: Tokens) => {
    if (agent !== undefined && MODELS[model].agent !== agent) return
    tokens = addTokens(tokens, t)
    saved += (t.cached * (MODELS[model].price.input - MODELS[model].price.read)) / 1e6
  }
  for (const task of TASKS.filter(inScope(scope))) for (const one of task.steps) if (within(period)(one.to)) add(one.model, one.tokens)
  for (const day of DAYS.filter(inScope(scope))) if (within(period)(day.at)) add(day.model, day.tokens)
  return { tokens, saved }
}

// ——— the team ———

export interface LeadRow {
  readonly model: ModelId
  readonly led: number
  readonly merged: number
  readonly perChange: number | null
  readonly toMerge: number | null
  /** Findings its work drew in its first review, what was fixed of them counted alone. */
  readonly foundFirst: number | null
  /** Of its reviewed changes, the share that took more than one round. */
  readonly rework: number | null
  readonly cost: number
}

const firstReview = (task: Task) => task.steps.find((one) => one.key === 'review' && one.round === 1)
const reviewsOf = (task: Task) => task.steps.filter((one) => one.key === 'review')

export const leadsIn = (period: Period, scope: Scope): ReadonlyArray<LeadRow> => {
  const tasks = tasksIn(period, scope).filter((task) => task.preset !== 'review')
  const models = [...new Set(tasks.map((task) => task.lead))]
  return models
    .map((model) => {
      const led = tasks.filter((task) => task.lead === model)
      const merged = mergedOf(led).filter(isChange)
      const reviewed = led.filter((task) => firstReview(task) !== undefined)
      return {
        model,
        led: led.length,
        merged: merged.length,
        perChange: median(merged.map((task) => task.cost)),
        toMerge: median(merged.map(toMerge)),
        foundFirst: reviewed.length === 0 ? null : sum(reviewed.map((task) => firstReview(task)!.findings?.length ?? 0)) / reviewed.length,
        rework: reviewed.length === 0 ? null : reviewed.filter((task) => reviewsOf(task).length > 1).length / reviewed.length,
        cost: sum(led.map((task) => task.cost)),
      }
    })
    .sort((a, b) => b.led - a.led)
}

export interface ReviewerRow {
  readonly model: ModelId
  readonly reviews: number
  readonly perReview: number
  readonly fixed: number | null
  readonly setAside: number | null
  readonly dismissed: number | null
  readonly blocking: number
  readonly cost: number | null
}

const shareOf = (findings: ReadonlyArray<Finding>, state: Finding['state']) =>
  findings.length === 0 ? null : findings.filter((one) => one.state === state).length / findings.length

export const reviewersIn = (period: Period, scope: Scope): ReadonlyArray<ReviewerRow> => {
  const steps = tasksIn(period, scope)
    .filter(isChange)
    .flatMap((task) => reviewsOf(task))
  const models = [...new Set(steps.map((one) => one.model))]
  return models
    .map((model) => {
      const its = steps.filter((one) => one.model === model)
      const findings = its.flatMap((one) => one.findings ?? [])
      return {
        model,
        reviews: its.length,
        perReview: findings.length / Math.max(1, its.length),
        fixed: shareOf(findings, 'fixed'),
        setAside: shareOf(findings, 'set_aside'),
        dismissed: shareOf(findings, 'dismissed'),
        blocking: findings.filter((one) => one.severity === 'blocking').length,
        cost: median(its.map((one) => one.cost)),
      }
    })
    .sort((a, b) => b.reviews - a.reviews)
}

export interface Pair {
  readonly lead: ModelId
  readonly reviewer: ModelId
  readonly reviews: number
  readonly perReview: number
  readonly fixed: number | null
}

export const pairsIn = (period: Period, scope: Scope): ReadonlyArray<Pair> => {
  const pairs = new Map<string, { lead: ModelId; reviewer: ModelId; reviews: number; findings: Finding[] }>()
  for (const task of tasksIn(period, scope).filter(isChange))
    for (const one of reviewsOf(task)) {
      const key = `${task.lead}|${one.model}`
      const pair = pairs.get(key) ?? { lead: task.lead, reviewer: one.model, reviews: 0, findings: [] }
      pair.reviews += 1
      pair.findings.push(...(one.findings ?? []))
      pairs.set(key, pair)
    }
  return [...pairs.values()].map((pair) => ({
    lead: pair.lead,
    reviewer: pair.reviewer,
    reviews: pair.reviews,
    perReview: pair.findings.length / pair.reviews,
    fixed: shareOf(pair.findings, 'fixed'),
  }))
}

/** A model's family, as the mix and the moves group them: Opus, Sol, Fable… */
export const familyOf = (model: ModelId) => MODELS[model].short.split(' ')[0]!

/** Tasks led by each family of models, a bucket at a time: days up to a month, weeks beyond. Whole buckets, back from now. */
export const mixIn = (period: Period, scope: Scope) => {
  const size = period.days <= 30 ? DAY : 7 * DAY
  const count = Math.ceil((period.to - period.from) / size)
  const from = period.to - count * size
  const tasks = tasksIn({ from, to: period.to, days: (period.to - from) / DAY }, scope).filter((task) => task.preset !== 'review')
  return Array.from({ length: count }, (_, i) => {
    const start = from + i * size
    const its = tasks.filter((task) => (task.endedAt ?? NOW) >= start && (task.endedAt ?? NOW) < start + size)
    const by: Record<string, number> = {}
    for (const task of its) by[familyOf(task.lead)] = (by[familyOf(task.lead)] ?? 0) + 1
    return { from: start, to: start + size, by, total: its.length }
  })
}

// ——— the plans ———

export interface WeekPoint {
  readonly at: number
  readonly used: number
}

export interface PlanWeek {
  readonly agent: AgentId
  readonly from: number
  readonly to: number
  /** How far through it now is, where it is this week. */
  readonly now: number | null
  readonly points: ReadonlyArray<WeekPoint>
  readonly used: number
  /** When it ran out, where it did. */
  readonly outAt: number | null
  /** Work started on it after it ran out, that moved to another agent. */
  readonly moved: number
  /** At this pace, where it ends, and when it runs out where it would. */
  readonly forecast: { readonly ends: number; readonly outAt: number | null } | null
  /** What drew on it, by task, in points of the week; the coordinator and outside Althar apart. */
  readonly tasks: ReadonlyArray<{ readonly task: Task; readonly points: number }>
  readonly coordinator: number
  readonly outside: number
}

const TASK_BY_ID = new Map(TASKS.map((task) => [task.id, task]))

export const weekOf = (agent: AgentId, start: number): PlanWeek => {
  const to = start + 7 * DAY
  const end = Math.min(to, NOW)
  const holds = WEEK_HOLDS[agent]
  const uses = USES.filter((use) => use.agent === agent && use.at >= start && use.at < end)
  const points: WeekPoint[] = [{ at: start, used: 0 }]
  let used = 0
  let outAt: number | null = null
  // Outside Althar, spread through the day.
  const outsideAt = (at: number) => (OUTSIDE[agent] * (at - start)) / DAY
  for (const use of uses) {
    used += (use.cost / holds) * 100
    const total = used + outsideAt(use.at)
    if (total >= 100 && outAt === null) outAt = use.at
    points.push({ at: use.at, used: Math.min(100, total) })
  }
  const last = Math.min(100, used + outsideAt(end))
  points.push({ at: end, used: last })
  const byTask = new Map<string, number>()
  let coordinator = 0
  for (const use of uses) {
    const share = (use.cost / holds) * 100
    if (use.taskId === null) coordinator += share
    else byTask.set(use.taskId, (byTask.get(use.taskId) ?? 0) + share)
  }
  // Scaled where it ran out: what it says used can't be more than all of it.
  const over = used + outsideAt(end) > 100 ? 100 / (used + outsideAt(end)) : 1
  const isNow = NOW < to
  let forecast: PlanWeek['forecast'] = null
  if (isNow && outAt === null) {
    // The pace of the last day, on to the reset.
    const dayAgo = points.findLast((point) => point.at <= NOW - DAY) ?? points[0]!
    const rate = (last - dayAgo.used) / Math.max(1, NOW - Math.max(dayAgo.at, start))
    const ends = last + rate * (to - NOW)
    forecast = { ends: Math.min(ends, 140), outAt: ends > 100 ? NOW + (100 - last) / rate : null }
  }
  return {
    agent,
    from: start,
    to,
    now: isNow ? (NOW - start) / (to - start) : null,
    points,
    used: last,
    outAt,
    moved:
      outAt === null
        ? 0
        : TASKS.filter((task) => MODELS[task.lead].agent === agent && task.startedAt > outAt! && task.startedAt < to).length,
    forecast,
    tasks: [...byTask].map(([id, points]) => ({ task: TASK_BY_ID.get(id)!, points: points * over })).sort((a, b) => b.points - a.points),
    coordinator: coordinator * over,
    outside: Math.min(100, outsideAt(end)) * over,
  }
}

export const thisWeek = (agent: AgentId) => weekOf(agent, weekStartOf(agent, NOW))

/** The plan's weeks back from this one, the oldest first, as far as the period reaches, four at least. */
export const weeksIn = (agent: AgentId, period: Period) => {
  const first = Math.min(...USES.map((use) => use.at))
  const count = Math.max(4, Math.ceil(period.days / 7))
  const out: PlanWeek[] = []
  for (let i = count - 1; i >= 0; i--) {
    const start = weekStartOf(agent, NOW) - i * 7 * DAY
    if (start + 7 * DAY < first) continue
    out.push(weekOf(agent, start))
  }
  return out
}

// ——— comparing periods ———

export interface Score {
  readonly finished: number
  readonly merged: number
  readonly toMerge: number | null
  /** Of reviewed changes, the share whose first review found nothing to fix. */
  readonly clean: number | null
  readonly findings: number | null
  readonly abandoned: number
  readonly perChange: number | null
  readonly spent: number
}

export const scoreOf = (period: Period, scope: Scope): Score => {
  const tasks = tasksIn(period, scope).filter((task) => task.outcome !== 'open')
  const merged = mergedOf(tasks).filter(isChange)
  const reviewed = tasks.filter((task) => isChange(task) && firstReview(task) !== undefined)
  return {
    finished: tasks.length,
    merged: merged.length,
    toMerge: median(merged.map(toMerge)),
    clean:
      reviewed.length === 0
        ? null
        : reviewed.filter((task) => !(firstReview(task)!.findings ?? []).some((one) => one.state === 'fixed')).length / reviewed.length,
    findings:
      reviewed.length === 0
        ? null
        : sum(reviewed.map((task) => sum(reviewsOf(task).map((one) => one.findings?.length ?? 0)))) / reviewed.length,
    abandoned: tasks.filter((task) => task.outcome === 'abandoned').length,
    perChange: median(merged.map((task) => task.cost)),
    spent: spentIn(period, scope).total,
  }
}

/** A score a day at a time, for its line. */
export const dailyOf = (period: Period, scope: Scope): ReadonlyArray<Score> =>
  Array.from({ length: period.days }, (_, i) => {
    const from = period.from + i * DAY
    return scoreOf({ from, to: from + DAY, days: 1 }, scope)
  })

/** Where the time to merge went, on average: agents at work, checks, waiting on the person. */
export const timeSplitOf = (period: Period, scope: Scope) => {
  const merged = mergedOf(tasksIn(period, scope)).filter(isChange)
  const n = Math.max(1, merged.length)
  return {
    worked: sum(merged.map((task) => task.worked)) / n,
    checking: sum(merged.map((task) => task.checking)) / n,
    waited: sum(merged.map((task) => task.waited)) / n,
    count: merged.length,
  }
}

export const ENDINGS: ReadonlyArray<Exclude<Outcome, 'open'>> = ['merged', 'branch', 'answered', 'reviewed', 'abandoned']
export const endingsOf = (period: Period, scope: Scope) => {
  const tasks = tasksIn(period, scope)
  return Object.fromEntries(ENDINGS.map((outcome) => [outcome, tasks.filter((task) => task.outcome === outcome).length])) as Record<
    Exclude<Outcome, 'open'>,
    number
  >
}

/** Tasks finished each day, from the Monday of the first week with any, 13 weeks at least, to this week's Sunday. */
export const calendarOf = (scope: Scope) => {
  const mondayOf = (at: number) => {
    const d = new Date(at)
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY
  }
  const tasks = TASKS.filter(inScope(scope)).filter((task) => task.endedAt !== null && task.outcome !== 'abandoned')
  const last = mondayOf(NOW)
  const first = Math.min(last - 12 * 7 * DAY, mondayOf(Math.min(...tasks.map((task) => task.endedAt!))))
  const weeks = Math.round((last - first) / (7 * DAY)) + 1
  return Array.from({ length: weeks * 7 }, (_, i) => {
    const at = first + i * DAY
    const its = tasks.filter((task) => task.endedAt! >= at && task.endedAt! < at + DAY)
    return { at, finished: its.length, merged: its.filter((task) => task.outcome === 'merged').length, future: at > NOW }
  })
}

/** What moved most between two periods: the share of the work each kind took, and each family of models led, in points. */
export const movesOf = (now: Period, before: Period, scope: Scope) => {
  const a = tasksIn(now, scope)
  const b = tasksIn(before, scope)
  const share = (tasks: ReadonlyArray<Task>, test: (task: Task) => boolean) =>
    tasks.length === 0 ? 0 : tasks.filter(test).length / tasks.length
  const moves: Array<{ readonly what: string; readonly kind: 'preset' | 'family'; readonly now: number; readonly before: number }> = []
  for (const preset of ['change', 'small', 'prototype', 'chat', 'review'] as const satisfies ReadonlyArray<Preset>)
    moves.push({
      what: preset,
      kind: 'preset',
      now: share(a, (task) => task.preset === preset),
      before: share(b, (task) => task.preset === preset),
    })
  for (const family of new Set((Object.keys(MODELS) as ModelId[]).map(familyOf)))
    moves.push({
      what: family,
      kind: 'family',
      now: share(a, (task) => familyOf(task.lead) === family),
      before: share(b, (task) => familyOf(task.lead) === family),
    })
  return moves
    .filter((move) => Math.abs(move.now - move.before) >= 0.01)
    .sort((x, y) => Math.abs(y.now - y.before) - Math.abs(x.now - x.before))
    .slice(0, 5)
}

export const hoursOf = (ms: number) => ms / HOUR

/** The points of each plan's week a task took: its steps at list prices, against what a week holds. */
export const weekShareOf = (task: Task): Readonly<Record<AgentId, number>> => {
  const out = { 'claude-code': 0, codex: 0 }
  for (const one of task.steps) out[MODELS[one.model].agent] += (one.cost / WEEK_HOLDS[MODELS[one.model].agent]) * 100
  return out
}

/** A task's tokens, all its steps'. */
export const taskTokens = (task: Task): Tokens => task.steps.reduce((all, one) => addTokens(all, one.tokens), NO_TOKENS)
