import { randomUUID } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { agents as registry } from '@althar/provider-adapters'
import { scenarios } from '@althar/provider-adapters/testing'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Accounts } from '../src/Accounts'
import { type AgentEntry, Agents } from '../src/Config'
import { PlanUsage } from '../src/PlanUsage'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { atListPrices, boundingReadings, LONG_STRETCH, spentOf, tookOf, type TurnSpan } from '../src/Spending'
import { fakeAgents, runtime, task, turns, until } from './support'

/*
 * What a task, or the coordinator's day, used of each account its agents ran
 * on (ADR-084): a plan's week, by the rises between its readings put on the
 * turns that ran then; dollars, as the agent said them or at list prices.
 */

const MINUTE = 60_000
const turn = (from: number, to: number, tokens: number, ours = true): TurnSpan => ({ from, to, tokens, ours })
const week = (at: number, usedPercent: number, resetsAt: string | null = 'Thu') => ({ at, usedPercent, resetsAt })

describe('a week’s share', () => {
  it('is the rise between two readings while only the task ran', () => {
    assert.strictEqual(tookOf([week(0, 40), week(10 * MINUTE, 43)], [turn(MINUTE, 9 * MINUTE, 1000)]), 3)
  })

  it('shares a rise with the turns of other tasks that ran then, by their tokens', () => {
    const took = tookOf([week(0, 40), week(10 * MINUTE, 44)], [turn(0, 10 * MINUTE, 3000), turn(0, 10 * MINUTE, 1000, false)])
    assert.strictEqual(took, 3)
  })

  it('shares by time where no turn said its tokens', () => {
    const took = tookOf([week(0, 40), week(10 * MINUTE, 44)], [turn(0, 5 * MINUTE, 0), turn(0, 10 * MINUTE, 0, false)])
    assert.closeTo(took ?? 0, 4 / 3, 1e-9)
  })

  it('puts nothing on the task where none of its turns ran, nor a fall', () => {
    assert.strictEqual(tookOf([week(0, 40), week(10 * MINUTE, 44)], [turn(20 * MINUTE, 30 * MINUTE, 500)]), 0)
    assert.strictEqual(tookOf([week(0, 44), week(10 * MINUTE, 40)], [turn(0, 10 * MINUTE, 500)]), 0)
  })

  it('counts all a week says once it started again', () => {
    assert.strictEqual(tookOf([week(0, 90, 'Mon'), week(10 * MINUTE, 2, 'next Mon')], [turn(0, 10 * MINUTE, 500)]), 2)
  })

  it('counts of readings far apart only the part the task ran in', () => {
    const stretch = 4 * LONG_STRETCH
    const took = tookOf([week(0, 40), week(stretch, 48)], [turn(0, stretch / 4, 500)])
    assert.closeTo(took ?? 0, 2, 1e-9)
  })

  it('puts all of a rise on a task that ran after a quiet stretch, from the reading just before it', () => {
    const quiet = 2 * 60 * MINUTE
    const took = tookOf([week(0, 40), week(quiet, 40), week(quiet + 10 * MINUTE, 44)], [turn(quiet, quiet + 10 * MINUTE, 800)])
    assert.closeTo(took ?? 0, 4, 1e-9)
  })

  it('is unknown with no reading', () => {
    assert.isNull(tookOf([], [turn(0, MINUTE, 5)]))
  })

  it('reads from the last reading before the turns to the first after them', () => {
    const readings = [week(0, 1), week(5, 2), week(10, 3), week(20, 4), week(30, 5)]
    assert.deepStrictEqual(
      boundingReadings(readings, 7, 15).map((one) => one.at),
      [5, 10, 20],
    )
    assert.deepStrictEqual(
      boundingReadings(readings, -5, 50).map((one) => one.at),
      [0, 5, 10, 20, 30],
    )
  })
})

describe('dollars at list prices', () => {
  const price = { input: 5, output: 25 }
  it('prices input, output and thinking, and a cache read at a tenth of an input token unless the list says', () => {
    const usage = JSON.stringify({ inputTokens: 1e6, outputTokens: 1e5, thoughtTokens: 1e5, cachedReadTokens: 1e6, totalTokens: 2.2e6 })
    assert.closeTo(atListPrices(usage, price) ?? 0, 5 + 5 + 0.5, 1e-9)
    assert.closeTo(atListPrices(usage, { ...price, cacheRead: 1 }) ?? 0, 5 + 5 + 1, 1e-9)
  })

  it('is unknown with no price, and nothing for a turn that said no usage', () => {
    assert.isNull(atListPrices('{}', null))
    assert.strictEqual(atListPrices(null, price), 0)
    assert.strictEqual(atListPrices('not json', price), 0)
  })
})

describe('an account’s dollars', () => {
  it('adds what each session’s agent said, and is no estimate', () => {
    assert.deepStrictEqual(
      spentOf([
        { said: 0.5, turns: [] },
        { said: 0.25, turns: [] },
      ]),
      { spent: 0.75, estimated: false },
    )
  })

  it('is an estimate where a session was priced at list prices', () => {
    assert.deepStrictEqual(
      spentOf([
        { said: 0.5, turns: [] },
        { said: null, turns: [0.25, 0] },
      ]),
      { spent: 0.75, estimated: true },
    )
  })

  it('is unknown where a session nothing priced came before or after one its agent said', () => {
    assert.isNull(
      spentOf([
        { said: null, turns: [null] },
        { said: 0.5, turns: [] },
      ]).spent,
    )
    assert.isNull(
      spentOf([
        { said: 0.5, turns: [] },
        { said: null, turns: [null] },
      ]).spent,
    )
  })
})

const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    return yield* sessions.send({
      envelope: yield* Runtime.envelope('thread.send', { threadId, body }),
      threadId,
      body,
      disposition: 'after_current',
    })
  })

const ended = (threadId: string, count: number) =>
  until(turns(threadId), (rows) => rows.filter((row) => !['pending', 'delivered'].includes(row.state)).length >= count)

const withQueries = () => Queries.layer.pipe(Layer.provideMerge(runtime()))

describe('a task’s usage', () => {
  it.live('says the dollars its agent said it cost, and its tokens, for an account paid per use', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const queries = yield* Queries
      const sql = yield* SqlClient.SqlClient
      const { task: created } = yield* task()
      yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
      yield* ended(created.threadId, 1)
      yield* say(created.threadId, scenarios.updates)
      yield* ended(created.threadId, 2)
      yield* say(created.threadId, scenarios.hello)
      const done = yield* ended(created.threadId, 3)
      // The cost it said is kept on its session.
      yield* until(
        sql<{ reportedCost: number | null }>`SELECT reported_cost FROM provider_sessions WHERE thread_id = ${created.threadId}`,
        (rows) => rows[0]?.reportedCost === 0.02,
      )
      const snapshot = yield* Effect.orDie(queries.thread(created.threadId))
      const [line] = snapshot.usage ?? []
      const tokens = done.reduce((sum, row) => sum + ((JSON.parse(row.usage ?? '{}') as { totalTokens?: number }).totalTokens ?? 0), 0)
      assert.deepInclude(line, { agentId: 'codex', paidBy: 'key', took: null, spent: 0.02, estimated: false, tokens })
      assert.strictEqual(snapshot.usage?.length, 1)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('says the share of its week for an account on a plan, from the readings around its turns', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const queries = yield* Queries
      const sql = yield* SqlClient.SqlClient
      const { task: created } = yield* task()
      yield* sessions.start({ threadId: created.threadId, agentId: 'codex' })
      yield* ended(created.threadId, 1)
      yield* say(created.threadId, scenarios.hello)
      yield* ended(created.threadId, 2)
      const [span] = yield* sql<{ accountId: string; from: string; to: string }>`
        SELECT s.account_id, min(coalesce(d.delivered_at, d.requested_at)) AS "from", max(d.ended_at) AS "to"
        FROM turn_deliveries d JOIN provider_sessions s ON s.id = d.provider_session_id WHERE d.thread_id = ${created.threadId}`
      const at = (time: string, by: number) => new Date(Date.parse(time) + by).toISOString()
      yield* sql`INSERT INTO plan_usage_weeks ${sql.insert([
        { accountId: span!.accountId, usedPercent: 40, resetsAt: 'Thu', observedAt: at(span!.from, -1000) },
        { accountId: span!.accountId, usedPercent: 42.5, resetsAt: 'Thu', observedAt: at(span!.to, 1000) },
      ])}`
      const [line] = (yield* Effect.orDie(queries.thread(created.threadId))).usage ?? []
      assert.deepInclude(line, { paidBy: 'plan', spent: null, estimated: true })
      assert.closeTo(line?.took ?? 0, 2.5, 1e-9)
    }).pipe(Effect.provide(withQueries())),
  )

  it.live('keeps each move of an account’s week, and of a quiet stretch where it began and its latest reading', () =>
    Effect.gen(function* () {
      const usage = yield* PlanUsage
      const sql = yield* SqlClient.SqlClient
      const [account] = yield* (yield* Accounts).of('claude-code')
      const accountId = account!.id
      const weekly = (usedPercent: number) => [{ kind: 'weekly' as const, usedPercent, resetsAt: '2026-11-05T00:00:00.000Z' }]
      const kept = sql<{ usedPercent: number; observedAt: string }>`
        SELECT used_percent, observed_at FROM plan_usage_weeks WHERE account_id = ${accountId} ORDER BY observed_at`
      const hear = (usedPercent: number, count: number) =>
        Effect.gen(function* () {
          yield* Effect.sleep('5 millis')
          yield* usage.heard(accountId, 'claude-code', weekly(usedPercent))
          return yield* until(kept, (rows) => rows.length === count)
        })
      yield* hear(30, 1)
      yield* hear(30, 2)
      const second = (yield* kept)[1]!.observedAt
      // Still the same: the latest reading moves up, and no row is added for it.
      const quiet = yield* hear(30, 2)
      assert.isAbove(Date.parse(quiet[1]!.observedAt), Date.parse(second))
      const rows = yield* hear(31, 3)
      assert.deepStrictEqual(
        rows.map((row) => row.usedPercent),
        [30, 30, 31],
      )
      assert.deepStrictEqual(yield* usage.paidBy(accountId), { paidBy: 'plan', plan: null })
    }).pipe(Effect.provide(runtime())),
  )
})

/*
 * An OpenCode account mixes providers, each paid its own way: Zen per use, Go a plan, ChatGPT the plan Codex reads. A task's
 * turns on it are seeded as they were kept, each on the provider its model names.
 */
describe('an OpenCode account’s usage, by the provider each turn ran on', () => {
  const HOUR = 60 * MINUTE
  const hex = () => randomUUID().replaceAll('-', '')
  /** The fake agents, OpenCode with the registry's providers: a model is `provider/model`. */
  const agentsWithProviders = (perUse: ReadonlyArray<string>) =>
    Layer.effect(
      Agents,
      Effect.gen(function* () {
        const fake = yield* Agents
        const real = (entry: AgentEntry): AgentEntry =>
          entry.definition.id === 'opencode'
            ? {
                ...entry,
                definition: { ...entry.definition, signIn: { ...entry.definition.signIn, providers: registry.opencode.signIn.providers! } },
              }
            : entry
        return Agents.of({ list: fake.list.map(real), get: (agentId) => Effect.map(fake.get(agentId), real) })
      }),
    ).pipe(Layer.provide(fakeAgents({}, [], {}, perUse)))
  /** GPT-6 Astra at $10 in and $50 out a million, as OpenRouter's list says. */
  const prices = () => {
    const cache = join(mkdtempSync(join(tmpdir(), 'althar-facts-')), 'models.json')
    writeFileSync(cache, JSON.stringify({ data: [{ id: 'openai/gpt-6-astra', pricing: { prompt: '0.00001', completion: '0.00005' } }] }))
    return { url: 'https://models.test', cache, fetch: () => Promise.reject(new Error('No network in tests')) }
  }
  /** OpenCode signed in to Zen, Go and ChatGPT; Codex on a ChatGPT plan unless the test says it's paid per use. */
  const MIXED = [
    { provider: 'opencode', pays: 'key' },
    { provider: 'opencode-go', pays: 'key' },
    { provider: 'openai', pays: 'plan' },
  ] as const
  const withMixed = (
    perUse: ReadonlyArray<string> = [],
    credentials: ReadonlyArray<{ readonly provider: string; readonly pays: 'plan' | 'key' | 'unknown' }> = MIXED,
  ) =>
    Queries.layer.pipe(
      Layer.provideMerge(
        runtime(
          ':memory:',
          {},
          {
            agents: agentsWithProviders(perUse),
            perUse,
            modelFacts: prices(),
            usage: {
              every: Duration.zero,
              kept: Duration.zero,
              readVersion: async () => '2.2.5',
              readCredentials: async () => ({ kind: 'credentials', credentials }),
              readAgent: async () => ({
                kind: 'usage',
                usage: {
                  source: 'agent',
                  plan: 'plus',
                  windows: [{ kind: 'five_hour', usedPercent: 5 }],
                  observedAt: new Date().toISOString(),
                },
              }),
            },
          },
        ),
      ),
    )

  const at = (by: number) => new Date(Date.now() - HOUR + by).toISOString()
  /** A session on the account, and its one turn, from and to minutes into an hour ago. */
  const ran = (
    where: { readonly projectId: string; readonly threadId: string },
    agentId: string,
    accountId: string,
    model: string,
    from: number,
    to: number,
    usage: { readonly inputTokens: number; readonly outputTokens: number },
  ) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessionId = `sess_${hex()}`
      yield* sql`INSERT INTO provider_sessions ${sql.insert({
        id: sessionId,
        projectId: where.projectId,
        threadId: where.threadId,
        agentId,
        model,
        state: 'completed',
        startedAt: at(from * MINUTE),
        accountId,
      })}`
      yield* sql`INSERT INTO turn_deliveries ${sql.insert({
        id: `turn_${hex()}`,
        projectId: where.projectId,
        threadId: where.threadId,
        providerSessionId: sessionId,
        controllerGeneration: 1,
        model,
        usage: JSON.stringify({ ...usage, totalTokens: usage.inputTokens + usage.outputTokens }),
        state: 'completed',
        requestedAt: at(from * MINUTE),
        deliveredAt: at(from * MINUTE),
        endedAt: at(to * MINUTE),
      })}`
    })
  const weekOf = (accountId: string, ...readings: ReadonlyArray<readonly [minutes: number, usedPercent: number]>) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO plan_usage_weeks ${sql.insert(
        readings.map(([minutes, usedPercent]) => ({ accountId, usedPercent, resetsAt: 'Thu', observedAt: at(minutes * MINUTE) })),
      )}`
    })
  /** A task with turns on Zen, Go and ChatGPT through OpenCode, and the two accounts. */
  const mixedTask = (read = true) =>
    Effect.gen(function* () {
      if (read) yield* (yield* PlanUsage).now(true)
      const openCode = (yield* (yield* Accounts).of('opencode'))[0]!.id
      const codex = (yield* (yield* Accounts).of('codex'))[0]!.id
      const { project, task: created } = yield* task()
      const here = { projectId: project.projectId, threadId: created.threadId }
      yield* ran(here, 'opencode', openCode, 'opencode/gpt-6-astra', 0, 1, { inputTokens: 100_000, outputTokens: 10_000 })
      yield* ran(here, 'opencode', openCode, 'opencode-go/glm-5.3', 2, 3, { inputTokens: 40_000, outputTokens: 10_000 })
      yield* ran(here, 'opencode', openCode, 'openai/gpt-6-sol', 4, 6, { inputTokens: 25_000, outputTokens: 5_000 })
      return { openCode, codex, created, here }
    })
  const usageOf = (threadId: string) =>
    Effect.gen(function* () {
      const queries = yield* Queries
      return (yield* Effect.orDie(queries.thread(threadId))).usage ?? []
    })

  it.live('prices each part as its provider is paid: Zen in dollars, Go and ChatGPT a share of their weeks', () =>
    Effect.gen(function* () {
      const { openCode, codex, created } = yield* mixedTask()
      // Codex ran as much on the same ChatGPT plan meanwhile, in another task: the week's rise is shared with it.
      const { project: elsewhere, task: other } = yield* task('Another')
      yield* ran({ projectId: elsewhere.projectId, threadId: other.threadId }, 'codex', codex, 'gpt-6-sol', 4, 6, {
        inputTokens: 25_000,
        outputTokens: 5_000,
      })
      yield* weekOf(codex, [3.5, 20], [6.5, 23])
      const lines = yield* usageOf(created.threadId)
      assert.deepStrictEqual(
        lines.map((line) => line.provider),
        ['opencode', 'opencode-go', 'openai'],
      )
      const [zen, go, chatGpt] = lines
      // 100k in at $10 and 10k out at $50 a million, at list prices as OpenCode didn't say.
      assert.deepInclude(zen, {
        accountId: openCode,
        paidBy: 'key',
        took: null,
        estimated: true,
        models: ['opencode/gpt-6-astra'],
        tokens: 110_000,
      })
      assert.closeTo(zen?.spent ?? 0, 1.5, 1e-9)
      assert.isUndefined(zen?.why)
      // Go's week was never read: no figure, and why.
      assert.deepInclude(go, { paidBy: 'plan', took: null, spent: null, models: ['opencode-go/glm-5.3'], tokens: 50_000 })
      assert.include(go?.why ?? '', 'OpenCode Go')
      // Half of Codex's three points, as Codex's own turn had as many tokens.
      assert.deepInclude(chatGpt, { paidBy: 'plan', spent: null, estimated: true, models: ['openai/gpt-6-sol'] })
      assert.closeTo(chatGpt?.took ?? 0, 1.5, 1e-9)
    }).pipe(Effect.provide(withMixed())),
  )

  it.live('gives Go its share of the account’s own week, which a Zen turn then doesn’t draw on', () =>
    Effect.gen(function* () {
      const { openCode, created } = yield* mixedTask()
      // A Zen turn in another task while Go's ran: paid per use, it takes none of Go's week.
      const { project: elsewhere, task: other } = yield* task('Another')
      yield* ran({ projectId: elsewhere.projectId, threadId: other.threadId }, 'opencode', openCode, 'opencode/gpt-6-astra', 2, 3, {
        inputTokens: 40_000,
        outputTokens: 10_000,
      })
      yield* weekOf(openCode, [1.5, 10], [3.5, 12])
      const go = (yield* usageOf(created.threadId)).find((line) => line.provider === 'opencode-go')
      assert.closeTo(go?.took ?? 0, 2, 1e-9)
      assert.isUndefined(go?.why)
    }).pipe(Effect.provide(withMixed())),
  )

  it.live('has no ChatGPT figure where Codex isn’t on a ChatGPT plan here, and says why', () =>
    Effect.gen(function* () {
      const { created } = yield* mixedTask()
      const chatGpt = (yield* usageOf(created.threadId)).find((line) => line.provider === 'openai')
      assert.deepInclude(chatGpt, { paidBy: 'plan', took: null, spent: null })
      assert.include(chatGpt?.why ?? '', 'through Codex')
    }).pipe(Effect.provide(withMixed(['codex']))),
  )

  it.live('shares the ChatGPT week between Codex’s line and OpenCode’s where both ran in the task, never counting it twice', () =>
    Effect.gen(function* () {
      const { codex, created, here } = yield* mixedTask()
      yield* ran(here, 'codex', codex, 'gpt-6-sol', 4, 6, {
        inputTokens: 25_000,
        outputTokens: 5_000,
      })
      yield* weekOf(codex, [3.5, 20], [6.5, 23])
      const lines = yield* usageOf(created.threadId)
      const codexLine = lines.find((line) => line.agentId === 'codex')
      const chatGpt = lines.find((line) => line.provider === 'openai')
      // As many tokens each: the three points split between them.
      assert.closeTo(codexLine?.took ?? 0, 1.5, 1e-9)
      assert.closeTo(chatGpt?.took ?? 0, 1.5, 1e-9)
    }).pipe(Effect.provide(withMixed())),
  )

  it.live('never prices a sign-in it can’t classify as a key: a declared plan says why it has no figure, the rest that it can’t tell', () =>
    Effect.gen(function* () {
      const { openCode, created, here } = yield* mixedTask()
      yield* ran(here, 'opencode', openCode, 'google/gemini-4-pro', 7, 8, { inputTokens: 10_000, outputTokens: 1_000 })
      yield* ran(here, 'opencode', openCode, 'anthropic/claude-sonnet-5-5', 9, 10, { inputTokens: 10_000, outputTokens: 1_000 })
      const lines = yield* usageOf(created.threadId)
      const google = lines.find((line) => line.provider === 'google')
      const anthropic = lines.find((line) => line.provider === 'anthropic')
      assert.deepInclude(google, { paidBy: 'plan', took: null, spent: null })
      assert.include(google?.why ?? '', 'Gemini')
      assert.deepInclude(anthropic, { paidBy: 'plan', took: null, spent: null })
      assert.include(anthropic?.why ?? '', 'can’t tell')
    }).pipe(Effect.provide(withMixed([], [...MIXED, { provider: 'google', pays: 'unknown' }, { provider: 'anthropic', pays: 'unknown' }]))),
  )

  it.live('has no dollars for a provider before OpenCode’s sign-ins are read, but Zen’s are as they always are', () =>
    Effect.gen(function* () {
      const { created } = yield* mixedTask(false)
      const lines = yield* usageOf(created.threadId)
      const chatGpt = lines.find((line) => line.provider === 'openai')
      assert.deepInclude(chatGpt, { paidBy: 'plan', took: null, spent: null })
      assert.include(chatGpt?.why ?? '', 'openai sign-in is paid yet')
      assert.closeTo(lines.find((line) => line.provider === 'opencode')?.spent ?? 0, 1.5, 1e-9)
    }).pipe(Effect.provide(withMixed())),
  )
})
