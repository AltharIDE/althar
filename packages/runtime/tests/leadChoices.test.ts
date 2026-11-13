import { Ledger } from '@althar/persistence-sqlite'
import { holds } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Fiber, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Sessions } from '../src/Sessions'
import * as Runtime from '../src/Runtime'
import { runtime, task, turns, until } from './support'

const choices = (sessionId: string) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql<{ revision: number; payload: string }>`
  SELECT aggregate_revision AS revision, payload FROM record_events WHERE aggregate_type = 'provider_session'
    AND aggregate_id = ${sessionId} AND type = 'provider_session.lead_choice_changed' ORDER BY sequence`,
  )
const actual = (sessionId: string) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) =>
      sql<{
        state: string
        model: string | null
        effort: string | null
        externalSessionId: string | null
      }>`SELECT state, model, effort, external_session_id FROM provider_sessions WHERE id = ${sessionId}`,
  )
const cursor = Effect.flatMap(SqlClient.SqlClient, (sql) =>
  Effect.map(sql<{ cursor: number }>`SELECT coalesce(max(cursor), 0) AS cursor FROM change_log`, (rows) => rows[0]?.cursor ?? 0),
)
const started = Effect.gen(function* () {
  const sessions = yield* Sessions
  const { task: created } = yield* task()
  const sessionId = yield* sessions.start({ threadId: created.threadId, agentId: 'codex', model: 'large', effort: 'high' })
  yield* until(turns(created.threadId), (rows) => rows.length === 1 && rows[0]?.state === 'completed')
  return { ...created, sessionId }
})

describe('pending lead choices on the client feed', () => {
  for (const connected of [true, false]) {
    it.live(`keeps a cross-agent choice unresolved until its replacement ${connected ? 'connects' : 'fails'}`, () => {
      let finishStartup: () => void = () => {}
      const startup = new Promise<void>((resolve, reject) => {
        finishStartup = () => (connected ? resolve() : reject(new Error('Replacement startup refused')))
      })
      void startup.catch(() => {})
      return Effect.gen(function* () {
        const sessions = yield* Sessions
        const sql = yield* SqlClient.SqlClient
        const lead = yield* started
        yield* sessions.changeLead({ threadId: lead.threadId, agentId: 'opencode', model: 'small', effort: 'high' })
        yield* sessions.send({
          envelope: yield* Runtime.envelope('thread.send', {}),
          threadId: lead.threadId,
          body: 'Carry on with the chosen lead.',
          sender: { kind: 'window' },
        })
        yield* until(
          sql`SELECT id FROM provider_sessions WHERE thread_id = ${lead.threadId}
        AND agent_id = 'opencode' AND state = 'starting'`,
          (rows) => rows.length === 1,
        )
        const recorded = yield* choices(lead.sessionId)
        assert.lengthOf(recorded, 2)
        assert.deepStrictEqual(JSON.parse(recorded[0]?.payload ?? '{}'), {
          nextLead: { agentId: 'opencode', model: 'small', effort: 'high' },
          choice: { agentId: 'opencode', model: 'small', effort: 'high' },
        })
        assert.deepStrictEqual(
          JSON.parse(recorded[1]?.payload ?? '{}'),
          { nextLead: null },
          'consuming pending intent does not say the replacement accepted it',
        )
        assert.strictEqual(Option.getOrThrow(yield* sessions.running(lead.threadId)).agentId, 'codex')
        finishStartup()
        if (connected)
          yield* until(sessions.running(lead.threadId), (running) => Option.exists(running, (one) => one.agentId === 'opencode'))
        else {
          const resolved = yield* until(choices(lead.sessionId), (rows) => rows.length === 3)
          assert.deepStrictEqual(JSON.parse(resolved[2]?.payload ?? '{}'), { nextLead: null, resolved: true })
          assert.strictEqual(Option.getOrThrow(yield* sessions.running(lead.threadId)).agentId, 'codex')
          assert.strictEqual((yield* actual(lead.sessionId))[0]?.model, 'large')
        }
      }).pipe(
        Effect.ensuring(Effect.sync(finishStartup)),
        Effect.provide(
          runtime(
            ':memory:',
            {},
            {
              each: { opencode: { beforeNewSession: () => startup } },
            },
          ),
        ),
      )
    })
  }

  it.live('notifies another client while a turn runs, and notifies cancellation without changing actual settings', () => {
    const going = holds()
    return Effect.gen(function* () {
      const sessions = yield* Sessions
      const ledger = yield* Ledger
      const lead = yield* started
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId: lead.threadId,
        body: 'Keep working. [answers-after:5s]',
        sender: { kind: 'window' },
      })
      yield* until(sessions.running(lead.threadId), (running) => Option.exists(running, (one) => one.turnRunning))
      const before = yield* actual(lead.sessionId)
      const since = yield* cursor
      const changed = yield* ledger.listen
      const watching = yield* Effect.forkChild(changed)
      assert.strictEqual(yield* sessions.chooseLead({ threadId: lead.threadId, model: 'small' }), 'later')
      yield* Fiber.join(watching)
      const [chosen] = yield* choices(lead.sessionId)
      assert.deepStrictEqual(JSON.parse(chosen?.payload ?? '{}'), {
        nextLead: { agentId: 'codex', model: 'small' },
        choice: { agentId: 'codex', model: 'small', effort: 'high' },
      })
      assert.deepStrictEqual(yield* actual(lead.sessionId), before, 'intent does not impersonate agent acknowledgement')
      const changes = yield* ledger.changesSince(since, 1000)
      assert.isTrue(
        changes.some(
          (one) =>
            one.aggregateType === 'provider_session' && one.aggregateId === lead.sessionId && one.aggregateRevision === chosen?.revision,
        ),
      )
      assert.isTrue(changes.some((one) => one.aggregateType === 'task' && one.aggregateId === lead.taskId))

      assert.strictEqual(yield* sessions.chooseLead({ threadId: lead.threadId, model: 'large' }), 'same')
      const recorded = yield* choices(lead.sessionId)
      assert.lengthOf(recorded, 2)
      assert.deepStrictEqual(JSON.parse(recorded[1]?.payload ?? '{}'), {
        nextLead: null,
        choice: { agentId: 'codex', model: 'large', effort: 'high' },
      })
      assert.deepStrictEqual(yield* actual(lead.sessionId), before)
      assert.isUndefined(Option.getOrThrow(yield* sessions.running(lead.threadId)).nextLead)
    }).pipe(Effect.ensuring(Effect.sync(() => going.open('[answers-after:5s]'))), Effect.provide(runtime(':memory:', { holds: going })))
  })

  for (const accepted of [true, false]) {
    it.live(`notifies pending clear after the agent ${accepted ? 'accepts' : 'refuses'} the model`, () => {
      const model = 'small'
      let silent = false
      const asked: Array<string> = []
      return Effect.gen(function* () {
        const sessions = yield* Sessions
        const ledger = yield* Ledger
        const lead = yield* started
        const before = yield* actual(lead.sessionId)
        silent = true
        asked.length = 0
        yield* sessions.chooseLead({ threadId: lead.threadId, model })
        yield* until(
          Effect.sync(() => asked),
          (calls) => calls.includes(`model=${model}`),
        )
        assert.deepStrictEqual(yield* actual(lead.sessionId), before)
        const since = yield* cursor
        silent = false
        const recorded = yield* until(choices(lead.sessionId), (rows) => rows.length === 2)
        assert.deepStrictEqual(
          JSON.parse(recorded[1]?.payload ?? '{}'),
          { nextLead: null, resolved: true },
          'taking up or refusing a choice does not record another deliberate selection',
        )
        const changes = yield* ledger.changesSince(since, 1000)
        assert.isTrue(
          changes.some(
            (one) =>
              one.aggregateType === 'provider_session' &&
              one.aggregateId === lead.sessionId &&
              one.aggregateRevision === recorded[1]?.revision,
          ),
          'clearing pending intent has its own feed revision',
        )
        const [after] = yield* actual(lead.sessionId)
        assert.strictEqual(after?.state, before[0]?.state)
        assert.strictEqual(after?.model, accepted ? 'small' : 'large')
        assert.isUndefined(Option.getOrThrow(yield* sessions.running(lead.threadId)).nextLead)
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            silent = false
          }),
        ),
        Effect.provide(
          runtime(':memory:', {
            holdsSets: () => silent,
            optionAsked: (id, value) => void asked.push(`${id}=${value}`),
            ...(accepted ? {} : { failsOnce: ['small'] }),
          }),
        ),
      )
    })
  }

  it.live('records merged choices in order while an earlier setting is still waiting, and clears only the latest one', () => {
    let silent = false
    const asked: Array<string> = []
    return Effect.gen(function* () {
      const sessions = yield* Sessions
      const lead = yield* started
      silent = true
      asked.length = 0
      yield* sessions.chooseLead({ threadId: lead.threadId, model: 'small' })
      yield* until(
        Effect.sync(() => asked),
        (calls) => calls.includes('model=small'),
      )
      yield* sessions.chooseLead({ threadId: lead.threadId, effort: 'low' })
      const pending = yield* choices(lead.sessionId)
      assert.lengthOf(pending, 2)
      assert.deepStrictEqual(JSON.parse(pending[1]?.payload ?? '{}'), {
        nextLead: { agentId: 'codex', model: 'small', effort: 'low' },
        choice: { agentId: 'codex', model: 'small', effort: 'low' },
      })
      silent = false
      const recorded = yield* until(choices(lead.sessionId), (rows) => rows.length === 3)
      assert.deepStrictEqual(JSON.parse(recorded[2]?.payload ?? '{}'), { nextLead: null, resolved: true })
      assert.isAbove(recorded[1]?.revision ?? 0, recorded[0]?.revision ?? 0)
      assert.isAbove(recorded[2]?.revision ?? 0, recorded[1]?.revision ?? 0)
      const [after] = yield* actual(lead.sessionId)
      assert.deepStrictEqual([after?.model, after?.effort], ['small', 'low'])
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          silent = false
        }),
      ),
      Effect.provide(
        runtime(':memory:', {
          holdsSets: () => silent,
          optionAsked: (id, value) => void asked.push(`${id}=${value}`),
        }),
      ),
    )
  })
})
