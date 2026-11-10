import type { AccountUse } from '@althar/contracts'
import { noReadingOf, usagePairs } from '@althar/provider-adapters'
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
 *
 * An OpenCode account mixes providers, each paid its own way: `opencode/…` is
 * Zen (prepaid, per use), `opencode-go/…` Go (a plan), `openai/…` with a
 * ChatGPT sign-in the plan Codex reads, the rest keys. Its use is split by the
 * provider each turn ran on, and each part priced as its provider is paid.
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
 * How far a week's reset time must move on for a new week. The plan's sources give
 * it to the millisecond, and not always the same millisecond (11:00:00.000,
 * 11:00:00.023, 10:59:59.867), and a window recomputed as it rolls may shift it
 * by hours; a new week moves it on by days.
 */
export const NEW_WEEK = 24 * 60 * 60_000

/**
 * How far a week's use must drop, where its reset time is unknown, for a new week.
 * The sources round its use differently (24 then 23 a minute later).
 */
export const NEW_WEEK_DROP = 5

const resetOf = (reading: WeekReading) => (reading.resetsAt === null ? Number.NaN : Date.parse(reading.resetsAt))

/**
 * The points of a week the turns asked about took: each rise between two
 * readings, shared among the turns that ran then by their tokens (by their time
 * where none said any). Within a week only a rise past its highest reading yet
 * counts, so a reading that dips and climbs back adds nothing. A week started
 * again when its reset time moved on by a day or more, or, where that's unknown,
 * its use dropped by more than rounding; it then rose by all the later reading
 * says. Never more than the week says at the last reading: a task can't have
 * taken more of the week than all of it used. Null with no reading at all.
 */
export const tookOf = (all: ReadonlyArray<WeekReading>, turns: ReadonlyArray<TurnSpan>): number | null => {
  if (all.length === 0) return null
  // A week only moves on: a reading whose reset is well before one already read is another window's, and is left out.
  let latest = Number.NEGATIVE_INFINITY
  const readings = all.filter((reading) => {
    const resets = resetOf(reading)
    if (Number.isNaN(resets)) return true
    if (resets < latest - NEW_WEEK) return false
    latest = Math.max(latest, resets)
    return true
  })
  let took = 0
  let highest = readings[0]!.usedPercent
  let weekResets = resetOf(readings[0]!)
  for (let at = 1; at < readings.length; at++) {
    const before = readings[at - 1]!
    const after = readings[at]!
    const resets = resetOf(after)
    const startedAgain =
      Number.isNaN(resets) || Number.isNaN(weekResets)
        ? after.usedPercent < before.usedPercent - NEW_WEEK_DROP
        : resets - weekResets >= NEW_WEEK
    // The new week's reset is the first one read in it, so a known one after an unknown one doesn't start it twice.
    if (startedAgain || Number.isNaN(weekResets)) weekResets = resets
    if (startedAgain) highest = 0
    const rise = after.usedPercent - highest
    if (rise > 0) highest = after.usedPercent
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
  return Math.min(took, readings.at(-1)!.usedPercent)
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

/** A session as its dollars read: what its agent said the turns asked about cost, else each turn at list prices, null unpriced. */
export interface SessionSpend {
  readonly said: number | null
  readonly turns: ReadonlyArray<number | null>
}

/**
 * The dollars of an account's sessions, and whether any was priced at list
 * prices rather than said by its agent. One session nothing priced leaves the
 * whole unknown, wherever it falls: a sum without it would read as all of it.
 */
export const spentOf = (sessions: ReadonlyArray<SessionSpend>): { readonly spent: number | null; readonly estimated: boolean } => {
  let spent: number | null = 0
  let estimated = false
  for (const session of sessions) {
    if (session.said !== null) {
      if (spent !== null) spent += session.said
      continue
    }
    estimated = true
    for (const priced of session.turns) spent = priced === null || spent === null ? null : spent + priced
  }
  return { spent, estimated }
}

/** OpenCode's own providers, paid as they always are: Zen per use, from prepaid credit; Go a plan with limits. */
const OPENCODE_PAYS: Readonly<Record<string, 'plan' | 'key'>> = { opencode: 'key', 'opencode-go': 'plan' }
/** OpenCode Go, whose week is the OpenCode account's own: the only plan Plan usage reads of an OpenCode account. */
const GO = 'opencode-go'
/** ChatGPT through OpenCode: the same plan Codex reads, by its sign-in. */
const CHATGPT = 'openai'

/**
 * How a provider an agent reaches is paid (OpenCode's `provider/model`): Zen
 * and Go always as they are, the rest as the account's listing says, and per
 * use where it doesn't list it: a provider OpenCode has no sign-in for runs
 * on a key. A sign-in Althar can't classify is a plan where one is declared
 * for its provider (Google, GitHub Copilot), else unknown; before the listing
 * is read, unread. Neither is ever taken for a key.
 */
export const providerPays = (
  agentId: string,
  provider: string,
  listed: Readonly<Record<string, 'plan' | 'key' | 'unknown'>> | undefined,
): 'plan' | 'key' | 'unknown' | 'unread' => {
  const own = OPENCODE_PAYS[provider]
  if (own !== undefined) return own
  if (listed === undefined) return 'unread'
  const pays = listed[provider] ?? 'key'
  if (pays !== 'unknown') return pays
  return usagePairs.some((one) => one.agent === agentId && one.provider === provider && one.pays === 'plan') ? 'plan' : 'unknown'
}

/** Why a plan's share can't be known, said on its "—". */
export const why = {
  /** A plan whose week was never read. */
  unread: 'Althar hasn’t read this plan’s week yet.',
  /** OpenCode Go, where its pair says no more. */
  go: 'OpenCode Go doesn’t report its usage to Althar.',
  /** ChatGPT through OpenCode, with no Codex on a ChatGPT plan here. */
  noCodex: 'Althar reads ChatGPT’s week through Codex, which isn’t signed in to a ChatGPT plan here.',
  /** ChatGPT through OpenCode, with a Codex sign-in here whose plan hasn't been read. */
  codexUnread: 'Althar reads ChatGPT’s week through Codex, and hasn’t read Codex’s plan yet.',
  /** A provider before the agent's sign-ins were read: how it is paid isn't known yet. */
  listingUnread: (agent: string, provider: string) => `Althar hasn’t read how ${agent}’s ${provider} sign-in is paid yet.`,
  /** A sign-in Althar can't classify. */
  unknownPays: (agent: string, provider: string) => `Althar can’t tell how ${agent}’s ${provider} sign-in is paid.`,
  /** ChatGPT through OpenCode, with Codex on several. */
  severalCodex: 'Codex is signed in to several ChatGPT plans here, and Althar can’t tell which one OpenCode used.',
  /** Another plan a provider bills by. */
  plan: (provider: string) => `${provider} doesn’t report its usage to Althar.`,
  /** Paid per use, with no price for the model and no cost said. */
  unpriced: 'The agent didn’t say what it cost, and no price is known for its model.',
} as const

interface TurnRow {
  readonly id: string
  readonly sessionId: string
  readonly model: string | null
  /** The session's model, where a turn didn't say its own: which provider it ran on. */
  readonly sessionModel: string | null
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

/**
 * What the turns asked about used of each account they ran on, in the order
 * the accounts were first used. An agent that reaches several providers, each
 * paid its own way (OpenCode), has a line for each provider its turns ran on:
 * Zen and keys in dollars; Go its share of the account's week; ChatGPT its
 * share of Codex's week, where Codex is on the one ChatGPT plan here; any
 * other plan no figure, and why.
 */
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
      SELECT d.id, d.provider_session_id AS session_id, d.model, s.model AS session_model, d.usage,
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
    const definitionOf = (agentId: string) => agents.list.find((each) => each.definition.id === agentId)?.definition
    /** The provider within its agent a turn ran on, for an agent that reaches several (OpenCode); undefined for the rest. */
    const providerOf = (turn: { readonly agentId: string; readonly model: string | null; readonly sessionModel: string | null }) => {
      const providers = definitionOf(turn.agentId)?.signIn.providers
      const model = turn.model ?? turn.sessionModel
      return providers === undefined ? undefined : ((model === null ? undefined : providers.of(model)) ?? '')
    }

    /**
     * The share of one account's week the turns took: from its readings around them, shared with every turn that ran
     * on the accounts `alongside` then and `counts` says draws on that week. Null where the week was never read.
     */
    const shareOf = (
      weekOf: string,
      alongside: ReadonlyArray<string>,
      counts: (turn: { readonly agentId: string; readonly model: string | null; readonly sessionModel: string | null }) => boolean,
      its: ReadonlyArray<TurnRow>,
    ) =>
      Effect.gen(function* () {
        const from = Math.min(...its.map((turn) => timeOf(turn.fromAt)))
        const to = Math.max(...its.map((turn) => timeOf(turn.toAt)))
        const readings = boundingReadings(
          (yield* sql<{ usedPercent: number; resetsAt: string | null; observedAt: string }>`
            SELECT used_percent, resets_at, observed_at FROM plan_usage_weeks
            WHERE account_id = ${weekOf} ORDER BY observed_at`).map((row) => ({
            at: Date.parse(row.observedAt),
            usedPercent: row.usedPercent,
            resetsAt: row.resetsAt,
          })),
          from,
          to,
        )
        if (readings.length === 0) return null
        const ours = new Set(its.map((turn) => turn.id))
        const first = new Date(readings[0]!.at).toISOString()
        const last = new Date(readings.at(-1)!.at).toISOString()
        const around = yield* sql<{
          id: string
          agentId: string
          model: string | null
          sessionModel: string | null
          usage: string | null
          fromAt: string
          toAt: string | null
        }>`
          SELECT d.id, s.agent_id, d.model, s.model AS session_model, d.usage,
            coalesce(d.delivered_at, d.requested_at) AS from_at, d.ended_at AS to_at
          FROM turn_deliveries d JOIN provider_sessions s ON s.id = d.provider_session_id
          WHERE s.account_id IN ${sql.in([weekOf, ...alongside])} AND coalesce(d.delivered_at, d.requested_at) <= ${last}
            AND (d.ended_at IS NULL OR d.ended_at >= ${first})`
        return tookOf(
          readings,
          around.filter(counts).map((turn) => ({
            from: timeOf(turn.fromAt),
            to: timeOf(turn.toAt),
            tokens: tokensIn(turn.usage),
            ours: ours.has(turn.id),
          })),
        )
      })

    /**
     * The ChatGPT week an account draws on, by the device it's on: Codex's, where Codex is on the one ChatGPT plan here,
     * with the OpenCode accounts here whose ChatGPT sign-in is a plan, which draw on it too. Else why there's none.
     */
    const chatGptWeek = (accountId: string) =>
      Effect.gen(function* () {
        const here = yield* sql<{ id: string; agentId: string }>`
          SELECT c.id, c.agent_id FROM agent_accounts c JOIN agent_accounts o ON o.device_id = c.device_id
          WHERE o.id = ${accountId} AND c.agent_id IN ('codex', 'opencode') AND c.removed_at IS NULL ORDER BY c.position`
        const onPlan: string[] = []
        let unread = false
        const openCode: string[] = []
        for (const { id, agentId } of here) {
          const held = yield* planUsage.paidBy(id)
          if (agentId === 'opencode') {
            if (held?.providers?.[CHATGPT] === 'plan') openCode.push(id)
          } else if (held === null) unread = true
          else if (held.paidBy === 'plan') onPlan.push(id)
        }
        // A Codex sign-in not yet read may be on a plan too: until it is, which week isn't known.
        if (onPlan.length > 1) return { why: why.severalCodex } as const
        if (unread) return { why: why.codexUnread } as const
        if (onPlan.length === 0) return { why: why.noCodex } as const
        return { codex: onPlan[0]!, openCode } as const
      })
    /** A turn that draws on the ChatGPT week: Codex's own, or OpenCode's through its ChatGPT sign-in. */
    const onChatGpt = (turn: { readonly agentId: string; readonly model: string | null; readonly sessionModel: string | null }) =>
      turn.agentId === 'codex' || (turn.agentId === 'opencode' && providerOf(turn) === CHATGPT)

    // Each account's turns, and an agent's that reaches several providers by the provider each ran on, in the order first used.
    const parts = new Map<string, { readonly accountId: string; readonly provider: string | undefined; readonly its: TurnRow[] }>()
    for (const turn of turns) {
      const provider = providerOf(turn)
      const key = provider === undefined ? turn.accountId : `${turn.accountId}\u0000${provider}`
      const part = parts.get(key)
      if (part === undefined) parts.set(key, { accountId: turn.accountId, provider, its: [turn] })
      else part.its.push(turn)
    }

    const used: AccountUse[] = []
    for (const { accountId, provider, its } of parts.values()) {
      const agentId = its[0]!.agentId
      const agent = { id: agentId, name: definitionOf(agentId)?.name ?? agentId }
      const account = accounts.find((each) => each.id === accountId)
      const tokens = its.reduce((sum, turn) => sum + tokensIn(turn.usage), 0)
      const models = [...new Set(its.flatMap((turn) => (turn.model === null ? [] : [turn.model])))]
      // Its tokens by model, as a task's usage reads by model, its helpers' sessions too (ADR-087).
      const byModel = models.map((model) => ({
        model,
        tokens: its.filter((turn) => turn.model === model).reduce((sum, turn) => sum + tokensIn(turn.usage), 0),
      }))

      // Paid per use: each session's own figure where its agent said one in dollars, else its turns at list prices.
      const { spent, estimated: listPriced } = spentOf(
        [...new Set(its.map((turn) => turn.sessionId))].map((sessionId) => {
          const mine = its.filter((turn) => turn.sessionId === sessionId)
          const { reportedCost, reportedCurrency } = mine[0]!
          if (reportedCost !== null && (reportedCurrency === null || reportedCurrency.toUpperCase() === 'USD')) {
            const all = sessionTokens.get(sessionId) ?? 0
            const ours = mine.reduce((sum, turn) => sum + tokensIn(turn.usage), 0)
            return { said: all > 0 ? (reportedCost * ours) / all : reportedCost, turns: [] }
          }
          return {
            said: null,
            turns: mine.map((turn) =>
              atListPrices(turn.usage, facts.of(agent, { id: turn.model ?? '', name: turn.model ?? '' })?.price ?? null),
            ),
          }
        }),
      )

      const held = yield* planUsage.paidBy(accountId)
      const line = {
        accountId,
        agentId,
        agentName: agent.name,
        accountName: account?.name ?? agent.name,
        several: account !== undefined && account.several === 1,
        models,
        tokens,
        ...(byModel.length > 1 ? { byModel } : {}),
        // A model OpenCode named without its provider: the agent's own line, priced per use.
        ...(provider === undefined || provider === '' ? {} : { provider }),
      }
      /** Its line on a plan: the share of a week, or none and why. */
      const onPlan = (took: number | null, unknown: string, plan: string | null = null) =>
        used.push({
          ...line,
          paidBy: 'plan',
          plan,
          took,
          spent: null,
          estimated: true,
          ...(took === null ? { why: unknown } : {}),
        })

      if (provider === undefined) {
        // On a plan: the share of its week, from the readings around these turns, among every turn on the account then;
        // and, Codex's, every OpenCode turn here through the same ChatGPT plan.
        const week = agentId === 'codex' && held?.paidBy === 'plan' ? yield* chatGptWeek(accountId) : undefined
        const took =
          week !== undefined && 'codex' in week && week.codex === accountId
            ? yield* shareOf(accountId, week.openCode, onChatGpt, its)
            : yield* shareOf(accountId, [], () => true, its)
        // Where nothing was read of how it is paid, a week kept for it says a plan.
        const paidBy = held?.paidBy ?? (took !== null ? 'plan' : 'key')
        if (paidBy === 'plan') {
          onPlan(took, held?.noReading ?? why.unread, held?.plan ?? null)
          continue
        }
        used.push({
          ...line,
          paidBy,
          plan: null,
          took: null,
          spent,
          estimated: listPriced,
          ...(spent === null ? { why: why.unpriced } : {}),
        })
        continue
      }

      // A provider of its own: priced by how it is paid, whatever pays for the agent's others.
      const sameProvider = (turn: { readonly agentId: string; readonly model: string | null; readonly sessionModel: string | null }) =>
        turn.agentId === agentId && providerOf(turn) === provider
      const pays = providerPays(agentId, provider, held?.providers)
      if (pays === 'key') {
        used.push({
          ...line,
          paidBy: 'key',
          plan: null,
          took: null,
          spent,
          estimated: listPriced,
          ...(spent === null ? { why: why.unpriced } : {}),
        })
        continue
      }
      if (pays === 'unread' || pays === 'unknown') {
        onPlan(null, (pays === 'unread' ? why.listingUnread : why.unknownPays)(agent.name, provider))
        continue
      }
      const pair = usagePairs.find((one) => one.agent === agentId && one.provider === provider && one.pays === 'plan')
      if (provider === GO) {
        // Go's week is the account's own, which only its turns on Go draw on.
        onPlan(yield* shareOf(accountId, [], sameProvider, its), (pair === undefined ? null : noReadingOf(pair)) ?? why.go)
        continue
      }
      if (provider === CHATGPT) {
        // The ChatGPT plan Codex reads: its week, which Codex's turns and these draw on alike, where Codex is on the one plan here.
        const week = yield* chatGptWeek(accountId)
        if ('why' in week) {
          onPlan(null, week.why)
          continue
        }
        onPlan(yield* shareOf(week.codex, [accountId, ...week.openCode], onChatGpt, its), why.unread)
        continue
      }
      onPlan(null, (pair === undefined ? null : noReadingOf(pair)) ?? why.plan(provider))
    }
    return used
  })
