import type { AccountUse } from '@althar/contracts'
import { Clock, Effect } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { Agents } from './Config'
import { ModelFacts } from './ModelFacts'
import { PlanUsage } from './PlanUsage'

/*
 * What a task, or the coordinator's day, used of each account its agents ran
 * on (ADR-084): on a plan, the share of its week it took; paid per use, the
 * dollars it spent; and its tokens.
 *
 * A week's share is an estimate. Each time an account's week moves, the store
 * keeps the reading (plan_usage_weeks); the rise between two readings is put on
 * the turns that ran on the account between them, by their tokens, a task's
 * among other tasks'. Where the readings are far apart, only the part of the
 * stretch the turns ran in counts: the rest may be the account's use outside
 * Althar.
 *
 * Dollars are what the agent said a session cost (its usage_update), else the
 * turns' tokens at the model's list prices.
 */

/** A turn as a share reads it: when it ran, its tokens, and whether it is one of those asked about. */
export interface TurnSpan {
  readonly from: number
  readonly to: number
  readonly tokens: number
  readonly ours: boolean
}

/** A reading of an account's week. */
export interface WeekReading {
  readonly at: number
  readonly usedPercent: number
  readonly resetsAt: string | null
}

/** Past this, two readings are far apart: only the part of the stretch between them the turns ran in counts. */
export const LONG_STRETCH = 30 * 60_000

/** How long the turns ran within a stretch, overlaps counted once. */
const covered = (turns: ReadonlyArray<TurnSpan>, from: number, to: number) => {
  const spans = turns
    .map((turn) => [Math.max(turn.from, from), Math.min(turn.to, to)] as const)
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0])
  let total = 0
  let reach = from
  for (const [start, end] of spans) {
    if (end <= reach) continue
    total += end - Math.max(start, reach)
    reach = end
  }
  return total
}

/**
 * The points of a week the turns asked about took: each rise between two
 * readings, shared among the turns that ran then by their tokens (by their time
 * where none said any). A week that started again between two readings rose by
 * all the later one says. Null with no reading at all.
 */
export const tookOf = (readings: ReadonlyArray<WeekReading>, turns: ReadonlyArray<TurnSpan>): number | null => {
  if (readings.length === 0) return null
  let took = 0
  for (let at = 1; at < readings.length; at++) {
    const before = readings[at - 1]!
    const after = readings[at]!
    const rise = after.resetsAt === before.resetsAt ? after.usedPercent - before.usedPercent : after.usedPercent
    const stretch = after.at - before.at
    if (rise <= 0 || stretch <= 0) continue
    let ours = 0
    let all = 0
    let oursByTime = 0
    let allByTime = 0
    for (const turn of turns) {
      const overlap = Math.min(turn.to, after.at) - Math.max(turn.from, before.at)
      if (overlap <= 0) continue
      const part = overlap / Math.max(turn.to - turn.from, 1)
      all += turn.tokens * part
      allByTime += overlap
      if (turn.ours) {
        ours += turn.tokens * part
        oursByTime += overlap
      }
    }
    const share = all > 0 ? ours / all : allByTime > 0 ? oursByTime / allByTime : 0
    if (share === 0) continue
    const counted = stretch <= LONG_STRETCH ? 1 : Math.min(1, covered(turns, before.at, after.at) / stretch)
    took += rise * share * counted
  }
  return took
}

/** The readings that bound the turns: the last at or before the first began, to the first at or after the last ended. */
export const boundingReadings = (readings: ReadonlyArray<WeekReading>, from: number, to: number) => {
  const first = readings.findLastIndex((reading) => reading.at <= from)
  const last = readings.findIndex((reading) => reading.at >= to)
  return readings.slice(Math.max(first, 0), last === -1 ? readings.length : last + 1)
}

/** What a turn's usage says of its tokens. */
const tokensIn = (usage: string | null) => {
  if (usage === null) return 0
  try {
    const parsed = JSON.parse(usage) as { readonly totalTokens?: unknown }
    return typeof parsed.totalTokens === 'number' && Number.isFinite(parsed.totalTokens) ? parsed.totalTokens : 0
  } catch {
    return 0
  }
}

interface Usage {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly thoughtTokens?: number
  readonly cachedReadTokens?: number
  readonly cachedWriteTokens?: number
}

/** A cache read where the list gives no price: a tenth of an input token, as the makers price theirs. */
const CACHE_READ = 0.1

/** A turn's tokens at list prices, dollars per million: null where the model has none. */
export const atListPrices = (
  usage: string | null,
  price: { readonly input: number; readonly output: number; readonly cacheRead?: number } | null,
): number | null => {
  if (price === null) return null
  if (usage === null) return 0
  let read: Usage
  try {
    read = JSON.parse(usage) as Usage
  } catch {
    return 0
  }
  const n = (value: number | undefined) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
  // Thinking is billed as output; ACP's input counts what wasn't read from the cache.
  return (
    (n(read.inputTokens) * price.input +
      n(read.cachedWriteTokens) * price.input +
      (n(read.outputTokens) + n(read.thoughtTokens)) * price.output +
      n(read.cachedReadTokens) * (price.cacheRead ?? price.input * CACHE_READ)) /
    1e6
  )
}

interface TurnRow {
  readonly id: string
  readonly sessionId: string
  readonly model: string | null
  readonly usage: string | null
  readonly fromAt: string
  readonly toAt: string | null
  readonly accountId: string
  readonly agentId: string
  readonly reportedCost: number | null
  readonly reportedCurrency: string | null
}

/** Whose usage: a task's, every thread of it; or one thread's since a time, as the coordinator's day. */
export type SpendingOf = { readonly taskId: string } | { readonly threadId: string; readonly since: string }

/** What the turns asked about used of each account they ran on, in the order the accounts were first used. */
export const spendingOf = (
  of: SpendingOf,
): Effect.Effect<ReadonlyArray<AccountUse>, SqlError.SqlError, SqlClient.SqlClient | Agents | ModelFacts | PlanUsage> =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const agents = yield* Agents
    const facts = yield* ModelFacts
    const planUsage = yield* PlanUsage
    const now = yield* Clock.currentTimeMillis
    const turns = yield* sql<TurnRow>`
      SELECT d.id, d.provider_session_id AS session_id, d.model, d.usage,
        coalesce(d.delivered_at, d.requested_at) AS from_at, d.ended_at AS to_at,
        s.account_id, s.agent_id, s.reported_cost, s.reported_currency
      FROM turn_deliveries d JOIN provider_sessions s ON s.id = d.provider_session_id
      WHERE s.account_id IS NOT NULL AND ${
        'taskId' in of
          ? sql`d.thread_id IN (SELECT id FROM threads WHERE task_id = ${of.taskId})`
          : sql`d.thread_id = ${of.threadId} AND d.requested_at >= ${of.since}`
      }
      ORDER BY coalesce(d.delivered_at, d.requested_at), d.rowid`
    if (turns.length === 0) return []
    const accountIds = [...new Set(turns.map((turn) => turn.accountId))]
    const accounts = yield* sql<{ id: string; name: string; several: number }>`
      SELECT a.id, a.name, (SELECT count(*) FROM agent_accounts o
        WHERE o.agent_id = a.agent_id AND o.device_id = a.device_id AND o.removed_at IS NULL) > 1 AS several
      FROM agent_accounts a WHERE a.id IN ${sql.in(accountIds)}`
    // A session's own cost is all of it: the share of its tokens these turns had, where some of it is the day before.
    const sessionIds = [...new Set(turns.map((turn) => turn.sessionId))]
    const sessionTokens = new Map(
      (yield* sql<{ sessionId: string; tokens: number }>`
        SELECT provider_session_id AS session_id, sum(coalesce(json_extract(usage, '$.totalTokens'), 0)) AS tokens
        FROM turn_deliveries WHERE provider_session_id IN ${sql.in(sessionIds)} GROUP BY provider_session_id`).map((row) => [
        row.sessionId,
        row.tokens,
      ]),
    )
    const timeOf = (at: string | null) => (at === null ? now : Date.parse(at))

    const used: AccountUse[] = []
    for (const accountId of accountIds) {
      const its = turns.filter((turn) => turn.accountId === accountId)
      const agentId = its[0]!.agentId
      const entry = agents.list.find((each) => each.definition.id === agentId)
      const agent = { id: agentId, name: entry?.definition.name ?? agentId }
      const account = accounts.find((each) => each.id === accountId)
      const tokens = its.reduce((sum, turn) => sum + tokensIn(turn.usage), 0)
      const models = [...new Set(its.flatMap((turn) => (turn.model === null ? [] : [turn.model])))]

      // Paid per use: each session's own figure where its agent said one in dollars, else its turns at list prices.
      let spent: number | null = 0
      for (const sessionId of new Set(its.map((turn) => turn.sessionId))) {
        const mine = its.filter((turn) => turn.sessionId === sessionId)
        const { reportedCost, reportedCurrency } = mine[0]!
        if (reportedCost !== null && (reportedCurrency === null || reportedCurrency.toUpperCase() === 'USD')) {
          const all = sessionTokens.get(sessionId) ?? 0
          const ours = mine.reduce((sum, turn) => sum + tokensIn(turn.usage), 0)
          spent = (spent ?? 0) + (all > 0 ? (reportedCost * ours) / all : reportedCost)
          continue
        }
        for (const turn of mine) {
          const priced = atListPrices(turn.usage, facts.of(agent, { id: turn.model ?? '', name: turn.model ?? '' })?.price ?? null)
          spent = priced === null || spent === null ? null : spent + priced
        }
      }

      // On a plan: the share of its week, from the readings around these turns.
      const from = Math.min(...its.map((turn) => timeOf(turn.fromAt)))
      const to = Math.max(...its.map((turn) => timeOf(turn.toAt)))
      const readings = boundingReadings(
        (yield* sql<{ usedPercent: number; resetsAt: string | null; observedAt: string }>`
          SELECT used_percent, resets_at, observed_at FROM plan_usage_weeks
          WHERE account_id = ${accountId} ORDER BY observed_at`).map((row) => ({
          at: Date.parse(row.observedAt),
          usedPercent: row.usedPercent,
          resetsAt: row.resetsAt,
        })),
        from,
        to,
      )
      let took: number | null = null
      if (readings.length > 0) {
        const ours = new Set(its.map((turn) => turn.id))
        const first = new Date(readings[0]!.at).toISOString()
        const last = new Date(readings.at(-1)!.at).toISOString()
        const around = yield* sql<{ id: string; usage: string | null; fromAt: string; toAt: string | null }>`
          SELECT d.id, d.usage, coalesce(d.delivered_at, d.requested_at) AS from_at, d.ended_at AS to_at
          FROM turn_deliveries d JOIN provider_sessions s ON s.id = d.provider_session_id
          WHERE s.account_id = ${accountId} AND coalesce(d.delivered_at, d.requested_at) <= ${last}
            AND (d.ended_at IS NULL OR d.ended_at >= ${first})`
        took = tookOf(
          readings,
          around.map((turn) => ({
            from: timeOf(turn.fromAt),
            to: timeOf(turn.toAt),
            tokens: tokensIn(turn.usage),
            ours: ours.has(turn.id),
          })),
        )
      }

      const held = yield* planUsage.paidBy(accountId)
      // Where nothing was read of how it is paid, a week kept for it says a plan.
      const paidBy = held?.paidBy ?? (readings.length > 0 ? 'plan' : 'key')
      used.push({
        accountId,
        agentId,
        agentName: agent.name,
        accountName: account?.name ?? agent.name,
        several: account !== undefined && account.several === 1,
        paidBy,
        plan: held?.plan ?? null,
        took: paidBy === 'plan' ? took : null,
        spent: paidBy === 'key' ? spent : null,
        models,
        tokens,
      })
    }
    return used
  })
