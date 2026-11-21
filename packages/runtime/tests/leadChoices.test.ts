import { Ledger } from '@althar/persistence-sqlite'
import { holds } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Fiber, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Sessions } from '../src/Sessions'
import * as Runtime from '../src/Runtime'
import { notices, runtime, task, turns, until } from './support'

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

  /**
   * The model and effort a session was on as its first turn was asked of it: its last setting of either before that turn's
   * delivery was recorded (`provider_session.*` facts carry no option values, so its row as the turn ended, with no setting
   * after the turn began).
   */
  const firstTurnOn = (sessionId: string) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [first] = yield* sql<{ sequence: number }>`
        SELECT min(e.sequence) AS sequence FROM record_events e JOIN turn_deliveries t ON t.id = e.aggregate_id
        WHERE e.aggregate_type = 'turn_delivery' AND t.provider_session_id = ${sessionId}`
      const [settled] = yield* sql<{ sequence: number }>`
        SELECT max(sequence) AS sequence FROM record_events WHERE aggregate_type = 'provider_session' AND aggregate_id = ${sessionId}
          AND type = 'provider_session.lead_choice_changed'`
      return { firstTurn: first?.sequence ?? null, settled: settled?.sequence ?? null, on: (yield* actual(sessionId))[0] }
    })

  /** What the agent waits on once a test holds it, until the test opens it again: opened first, it doesn't wait. */
  const gate = () => {
    let held: Promise<void> | undefined
    let open: () => void = () => {}
    return {
      hold: () => {
        held = new Promise<void>((resolve) => {
          open = resolve
        })
      },
      wait: () => held ?? Promise.resolve(),
      open: () => {
        held = undefined
        open()
      },
    }
  }

  for (const at of ['connects', 'stops'] as const) {
    it.live(
      `sets a model and effort picked while a fresh session ${at === 'connects' ? 'connects' : 'replaces the one going out'} on it, before its first turn`,
      () => {
        // The switch is held where the person picks: the new session's start, or the old one's close, after it has let the thread go.
        const held = gate()
        return Effect.gen(function* () {
          const sessions = yield* Sessions
          const sql = yield* SqlClient.SqlClient
          const lead = yield* started
          held.hold()
          const switching = yield* Effect.forkChild(
            sessions.switchAgent({ threadId: lead.threadId, agentId: 'codex', model: 'large', effort: 'high' }),
          )
          if (at === 'connects')
            yield* until(
              sql`SELECT id FROM provider_sessions WHERE thread_id = ${lead.threadId} AND state = 'starting'`,
              (rows) => rows.length === 1,
            )
          else yield* until(sessions.running(lead.threadId), Option.isNone)
          // Two picks, as the picker sends a model and an effort: both kept for the session starting, never refused.
          assert.strictEqual(yield* sessions.chooseLead({ threadId: lead.threadId, model: 'small' }), 'later')
          assert.strictEqual(yield* sessions.chooseLead({ threadId: lead.threadId, effort: 'low' }), 'later')
          if (at === 'connects')
            assert.deepStrictEqual(Option.getOrThrow(yield* sessions.running(lead.threadId)).nextLead, {
              agentId: 'codex',
              model: 'small',
              effort: 'low',
            })
          held.open()
          const sessionId = yield* Fiber.join(switching)
          yield* until(turns(lead.threadId), (rows) => rows.some((row) => row.providerSessionId === sessionId && row.state === 'completed'))
          // The one going out stayed as it was; the new one was put on the pick before its first turn was asked of it.
          assert.strictEqual((yield* actual(lead.sessionId))[0]?.model, 'large')
          const first = yield* firstTurnOn(sessionId)
          assert.include(first.on, { model: 'small', effort: 'low' })
          assert.isNotNull(first.settled)
          assert.isBelow(first.settled ?? Infinity, first.firstTurn ?? -Infinity)
          // Said by the models' names, on the session that changed, with no switch from an agent to itself.
          const said = (yield* notices(lead.threadId)).map((notice) => notice['title'])
          assert.include(said, 'Model changed to Small.')
          assert.isFalse(said.some((title) => title?.startsWith('Switched from Fake codex') === true))
        }).pipe(
          Effect.ensuring(Effect.sync(() => held.open())),
          Effect.provide(
            runtime(':memory:', {}, { each: { codex: at === 'connects' ? { beforeNewSession: held.wait } : { beforeClose: held.wait } } }),
          ),
        )
      },
    )
  }

  it.live('takes the thread back to the agent going out where it is picked back while another takes it over', () => {
    const held = gate()
    return Effect.gen(function* () {
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      const lead = yield* started
      held.hold()
      const switching = yield* Effect.forkChild(sessions.switchAgent({ threadId: lead.threadId, agentId: 'opencode', model: 'large' }))
      yield* until(
        sql`SELECT id FROM provider_sessions WHERE thread_id = ${lead.threadId} AND state = 'starting'`,
        (rows) => rows.length === 1,
      )
      // A Codex model, as the picker shows it while OpenCode starts: Codex's, never set on OpenCode.
      assert.strictEqual(yield* sessions.chooseLead({ threadId: lead.threadId, agentId: 'codex', model: 'small' }), 'later')
      held.open()
      yield* Fiber.join(switching)
      // OpenCode took the thread, and Codex took it back on the model picked, before OpenCode's first turn.
      const back = yield* until(
        sql<{ id: string; agentId: string; model: string | null }>`
          SELECT id, agent_id, model FROM provider_sessions WHERE thread_id = ${lead.threadId} AND state = 'active'`,
        (rows) => rows.length === 1 && rows[0]?.agentId === 'codex' && rows[0].id !== lead.sessionId,
      )
      assert.strictEqual(back[0]?.model, 'small')
      const opencode = yield* sql<{
        id: string
      }>`SELECT id FROM provider_sessions WHERE thread_id = ${lead.threadId} AND agent_id = 'opencode'`
      assert.lengthOf(opencode, 1)
      assert.lengthOf(yield* sql`SELECT id FROM turn_deliveries WHERE provider_session_id = ${opencode[0]?.id ?? ''}`, 0)
      const said = (yield* notices(lead.threadId)).map((notice) => String(notice['title']))
      assert.isFalse(said.some((title) => title.includes('stays on its model')))
    }).pipe(
      Effect.ensuring(Effect.sync(() => held.open())),
      Effect.provide(runtime(':memory:', {}, { each: { opencode: { beforeNewSession: held.wait } } })),
    )
  })

  it.live('keeps the lead where the agent on the thread is picked back as it is over another waiting to take over', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      const lead = yield* started
      assert.strictEqual(yield* sessions.changeLead({ threadId: lead.threadId, agentId: 'opencode', model: 'small' }), 'later')
      // What the window sends for Codex picked again with nothing of its own chosen: Codex as it is.
      assert.strictEqual(yield* sessions.chooseLead({ threadId: lead.threadId, agentId: 'codex', model: 'large' }), 'same')
      assert.isUndefined(Option.getOrThrow(yield* sessions.running(lead.threadId)).nextLead)
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId: lead.threadId,
        body: 'Carry on.',
        sender: { kind: 'window' },
      })
      yield* until(turns(lead.threadId), (rows) => rows.length === 2 && rows.every((row) => row.state === 'completed'))
      const agents = yield* sql<{ agentId: string }>`SELECT agent_id FROM provider_sessions WHERE thread_id = ${lead.threadId}`
      assert.deepStrictEqual(agents, [{ agentId: 'codex' }])
    }).pipe(Effect.provide(runtime(':memory:', {}, {}))),
  )

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
