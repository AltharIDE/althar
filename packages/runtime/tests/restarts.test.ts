import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Ids, newId } from '@althar/domain'

import { Accounts } from '../src/Accounts'
import { Agents } from '../src/Config'
import { Instance } from '../src/Instance'
import { Policies } from '../src/Policies'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { fakeAgents, notices, repository, runtime, until } from './support'

/*
 * A step running when Althar stopped carries on by itself at the next
 * launch, with a line in the thread to say so; it needs the person only
 * where its lead can't start, or where a restart stopped it again soon after
 * the last one carried it on.
 */

const CARRIED = 'Althar restarted; the step carried on from here.'

/**
 * A task whose lead works on Implement until it is stopped, in the store at
 * `file`: on a project whose usage limits wait, where asked, and with the
 * lead's account out of usage until `out`, where given, as Althar stops.
 */
const working = (file: string, limited: { readonly usageLimit?: 'wait'; readonly out?: string } = {}) =>
  Effect.gen(function* () {
    const plans = yield* Plans
    const projects = yield* Projects
    const sql = yield* SqlClient.SqlClient
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
    const [person] = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'person'`
    const actor = (person?.id ?? '') as Parameters<typeof plans.hold>[1]
    const created = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId: project.projectId,
      title: 'Carry on after a restart',
      description: 'Work on it. [lead:wait]',
      draft: true,
    })
    if (limited.usageLimit !== undefined) {
      const policies = yield* Policies
      yield* policies.setUsageLimit(project.projectId, limited.usageLimit, actor)
    }
    const planId = yield* plans.propose({
      projectId: project.projectId as Parameters<typeof plans.propose>[0]['projectId'],
      taskId: created.taskId,
      steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
      reason: null,
      actorId: actor,
    })
    yield* plans.start(planId, actor)
    yield* until(implement, (rows) => rows[0]?.state === 'running')
    if (limited.out !== undefined) yield* outOfUsage(created.threadId, limited.out)
    return created
  }).pipe(Effect.provide(runtime(file)))

/** The account the thread's lead runs on is out of usage until `resetsAt`, as its agent would have said. */
const outOfUsage = (threadId: string, resetsAt: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const instance = yield* Instance
    const [session] = yield* sql<{ agentId: string; accountId: string }>`
      SELECT agent_id, account_id FROM provider_sessions WHERE thread_id = ${threadId} ORDER BY started_at DESC LIMIT 1`
    const principalId = yield* newId(Ids.principal)
    const at = new Date().toISOString()
    yield* sql`INSERT INTO principals ${sql.insert({ id: principalId, agentId: session?.agentId ?? '', accountId: session?.accountId ?? '', deviceId: instance.deviceId, subjectHint: 'Fake sign-in', authMode: 'vendor_cli', observedAt: at })}`
    yield* sql`INSERT INTO account_statuses ${sql.insert({
      id: yield* newId(Ids.accountStatus),
      principalId,
      state: 'limited',
      windows: JSON.stringify([{ kind: 'usage', resetsAt }]),
      source: 'error',
      observedAt: at,
    })}`
  })

/** The task's Implement attempts, oldest first. */
const implement = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  return yield* sql<{ id: string; state: string }>`
    SELECT a.id, a.state FROM node_attempts a JOIN nodes n ON n.id = a.node_id WHERE n.node_key = 'implement' ORDER BY a.admitted_at`
})

/** The task's Review attempts, oldest first, with their round and the agent each ran on. */
const review = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  return yield* sql<{ round: number; state: string; agentId: string | null }>`
    SELECT n.iteration AS round, a.state, s.agent_id FROM node_attempts a JOIN nodes n ON n.id = a.node_id
    LEFT JOIN provider_sessions s ON s.id = a.provider_session_id
    WHERE n.node_key = 'review' ORDER BY a.admitted_at, a.rowid`
})

/** The task's calls on the person, with why each was made. */
const callsOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ kind: string; state: string; why: string | null }>`
      SELECT kind, state, json_extract(payload, '$.why') AS why FROM attention_requests WHERE task_id = ${taskId} ORDER BY created_at`
  })

/** The sessions the task's lead ran in, oldest first. */
const sessionsOf = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ agentId: string }>`SELECT agent_id FROM provider_sessions WHERE thread_id = ${threadId} ORDER BY started_at, rowid`
  })

/** A task whose review, on Codex, reviews until it is stopped, in the store at `file`: with its account out of usage until `out`, where given. */
const reviewing = (file: string, out?: string, later = false) =>
  Effect.gen(function* () {
    const plans = yield* Plans
    const projects = yield* Projects
    const sql = yield* SqlClient.SqlClient
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
    const [person] = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'person'`
    const actor = (person?.id ?? '') as Parameters<typeof plans.hold>[1]
    const created = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId: project.projectId,
      title: 'Review after a restart',
      // Later, its first round finds something, the lead settles it, and the second reviews until it is stopped.
      description: later ? '[lead:finish] [review:findings] [review:wait-later]' : '[lead:finish] [review:wait]',
      draft: true,
    })
    const planId = yield* plans.propose({
      projectId: project.projectId as Parameters<typeof plans.propose>[0]['projectId'],
      taskId: created.taskId,
      steps: [
        { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
        { key: 'review', agentId: 'codex', model: null, skipped: false },
      ],
      reason: null,
      actorId: actor,
    })
    yield* plans.start(planId, actor)
    yield* until(review, (rows) => rows.some((row) => row.round === (later ? 1 : 0) && row.state === 'running'))
    if (out !== undefined) yield* outOfUsage(yield* reviewThread(created.taskId), out)
    return created
  }).pipe(Effect.provide(runtime(file)))

/** The task's review thread. */
const reviewThread = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${taskId} AND kind = 'step' AND node_key = 'review'`
    return thread?.id ?? ''
  })

const store = () => join(mkdtempSync(join(tmpdir(), 'althar-restarts-')), 'althar.sqlite')

/** A day passes while Althar is closed: every time the store at `file` keeps is a day earlier. */
const aDayLater = (file: string) => {
  const db = new DatabaseSync(file)
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all())
    for (const column of db.prepare(`PRAGMA table_info("${String(name)}")`).all())
      if (String(column.name).endsWith('_at'))
        db.exec(
          `UPDATE "${String(name)}" SET "${String(column.name)}" = strftime('%Y-%m-%dT%H:%M:%fZ', "${String(column.name)}", '-1 day') WHERE "${String(column.name)}" LIKE '____-__-__T%'`,
        )
  db.close()
}

/** The turns of the thread's latest session, oldest first, with the tokens each used. */
const turnsOf = (threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ state: string; tokens: number | null }>`
      SELECT state, json_extract(usage, '$.totalTokens') AS tokens FROM turn_deliveries
      WHERE provider_session_id = (SELECT id FROM provider_sessions WHERE thread_id = ${threadId} ORDER BY started_at DESC, rowid DESC LIMIT 1)
      ORDER BY requested_at, rowid`
  })

describe('A step a restart stopped', () => {
  it.live('carries on by itself, on its lead, with one quiet line in the thread and nothing asked of the person', () =>
    Effect.gen(function* () {
      const file = store()
      const task = yield* working(file)
      yield* Effect.gen(function* () {
        // The lead starts again on its own, on the same attempt.
        yield* until(sessionsOf(task.threadId), (rows) => rows.length === 2)
        const [attempt] = yield* until(implement, (rows) => rows.length === 1 && rows[0]?.state === 'running')
        assert.strictEqual(attempt?.state, 'running')
        assert.deepStrictEqual(
          (yield* sessionsOf(task.threadId)).map((row) => row.agentId),
          ['codex', 'codex'],
        )
        assert.deepStrictEqual(yield* callsOf(task.taskId), [])
        const said = (yield* notices(task.threadId)).filter((notice) => notice.title === CARRIED)
        assert.strictEqual(said.length, 1)
        assert.strictEqual(said[0]?.severity, 'info')
      }).pipe(Effect.provide(runtime(file)))
    }),
  )

  it.live('carries on a day later where its agent’s first turns do nothing, as Claude Code’s do while its sign-in is renewed', () =>
    Effect.gen(function* () {
      const file = store()
      const task = yield* working(file)
      aDayLater(file)
      yield* Effect.gen(function* () {
        // Started again at once, its first two turns end having done nothing: told to carry on after a pause, it does.
        const turns = yield* until(turnsOf(task.threadId), (rows) => rows.length === 3)
        assert.deepStrictEqual(
          turns.map((turn) => [turn.state, turn.tokens]),
          [
            ['completed', 0],
            ['completed', 0],
            ['delivered', null],
          ],
        )
        const [attempt] = yield* implement
        assert.strictEqual(attempt?.state, 'running')
        assert.deepStrictEqual(yield* callsOf(task.taskId), [])
        assert.strictEqual((yield* sessionsOf(task.threadId)).length, 2)
      }).pipe(Effect.provide(runtime(file, { blank: 2 }, { idle: { blank: Duration.millis(200) } })))
    }),
  )

  it.live('needs the person where its agent’s turns keep doing nothing', () =>
    Effect.gen(function* () {
      const file = store()
      const task = yield* working(file)
      yield* Effect.gen(function* () {
        const [call] = yield* until(callsOf(task.taskId), (rows) => rows.length === 1)
        assert.deepStrictEqual(call, { kind: 'stuck', state: 'open', why: 'stalled' })
        // Carried on, then told to carry on three times.
        assert.strictEqual((yield* turnsOf(task.threadId)).length, 4)
      }).pipe(Effect.provide(runtime(file, { blank: 10 }, { idle: { blank: Duration.millis(100) } })))
    }),
  )

  it.live('counts the turns that did nothing only in a row: a turn that did something gives it its tries again', () =>
    Effect.gen(function* () {
      const file = store()
      const task = yield* working(file)
      aDayLater(file)
      yield* Effect.gen(function* () {
        const sessions = yield* Sessions
        // Its first three turns do nothing; told to carry on, the fourth works, until the person stops it.
        yield* until(turnsOf(task.threadId), (rows) => rows.length === 4 && rows[3]?.state === 'delivered')
        yield* sessions.interrupt(task.threadId)
        yield* until(turnsOf(task.threadId), (rows) => rows[3]?.state === 'interrupted')
        // What they say next does nothing at first; told to carry on, it works again.
        const body = 'Go on.'
        yield* sessions.send({
          envelope: yield* Runtime.envelope('thread.send', { threadId: task.threadId, body }),
          threadId: task.threadId,
          body,
        })
        const turns = yield* until(turnsOf(task.threadId), (rows) => rows.length >= 6)
        assert.deepStrictEqual(
          turns.slice(3, 5).map((turn) => [turn.state, turn.tokens]),
          [
            ['interrupted', null],
            ['completed', 0],
          ],
        )
        assert.isNull(turns[5]?.tokens)
        assert.notInclude(
          (yield* callsOf(task.taskId)).map((call) => call.why),
          'stalled',
        )
      }).pipe(Effect.provide(runtime(file, { blank: [1, 2, 3, 5] }, { idle: { blank: Duration.millis(100) } })))
    }),
  )

  it.live('isn’t told to carry on where another turn came while it waited, as one the person stopped', () =>
    Effect.gen(function* () {
      const file = store()
      const task = yield* working(file)
      aDayLater(file)
      yield* Effect.gen(function* () {
        const sessions = yield* Sessions
        yield* until(turnsOf(task.threadId), (rows) => rows.length === 1 && rows[0]?.state === 'completed')
        // While Althar waits to tell it to carry on, the person says something, and stops the turn it starts.
        const body = 'And the docs.'
        yield* sessions.send({
          envelope: yield* Runtime.envelope('thread.send', { threadId: task.threadId, body }),
          threadId: task.threadId,
          body,
        })
        yield* until(turnsOf(task.threadId), (rows) => rows.length === 2 && rows[1]?.state === 'delivered')
        yield* sessions.interrupt(task.threadId)
        yield* until(turnsOf(task.threadId), (rows) => rows[1]?.state === 'interrupted')
        yield* Effect.sleep(Duration.seconds(2))
        // The turn the person stopped is theirs to carry on.
        assert.strictEqual((yield* turnsOf(task.threadId)).length, 2)
        assert.strictEqual((yield* implement)[0]?.state, 'running')
        assert.deepStrictEqual(yield* callsOf(task.taskId), [])
      }).pipe(Effect.provide(runtime(file, { blank: 1 }, { idle: { blank: Duration.seconds(1) } })))
    }),
  )

  it.live('carries a review on as a new round attempt, on its reviewer', () =>
    Effect.gen(function* () {
      const file = store()
      const task = yield* reviewing(file)
      yield* Effect.gen(function* () {
        const [stopped, again] = yield* until(review, (rows) => rows.length === 2 && rows[1]?.state === 'running')
        assert.strictEqual(stopped?.state, 'failed')
        assert.strictEqual(again?.agentId, 'codex')
        assert.deepStrictEqual(yield* callsOf(task.taskId), [])
        assert.strictEqual((yield* notices(task.threadId)).filter((notice) => notice.title === CARRIED).length, 1)
      }).pipe(Effect.provide(runtime(file)))
    }),
  )

  it.live('carries a later round of review on with what the lead settled before it', () =>
    Effect.gen(function* () {
      const file = store()
      const task = yield* reviewing(file, undefined, true)
      yield* Effect.gen(function* () {
        const rows = yield* until(review, (rows) => rows.filter((row) => row.round === 1).length === 2)
        assert.strictEqual(rows.find((row) => row.round === 1)?.state, 'failed')
        // The new reviewer is told what the lead settled, as the round it takes up was.
        const sql = yield* SqlClient.SqlClient
        const told = yield* until(
          sql<{ body: string }>`
            SELECT body FROM user_inputs WHERE thread_id = ${yield* reviewThread(task.taskId)} AND body LIKE 'Round 2.%' ORDER BY sequence`,
          (found) => found.length === 2,
        )
        assert.include(told[1]?.body ?? '', 'Fixed the heading.')
        assert.deepStrictEqual(yield* callsOf(task.taskId), [])
      }).pipe(Effect.provide(runtime(file)))
    }),
  )

  it.live('needs the person where a restart stops a review again soon after the last one carried it on', () =>
    Effect.gen(function* () {
      const file = store()
      const task = yield* reviewing(file)
      yield* until(review, (rows) => rows.length === 2 && rows[1]?.state === 'running').pipe(Effect.provide(runtime(file)))
      yield* Effect.gen(function* () {
        const [call] = yield* until(callsOf(task.taskId), (rows) => rows.length === 1)
        assert.deepStrictEqual(call, { kind: 'stuck', state: 'open', why: 'restarted' })
        assert.strictEqual((yield* review).length, 2)
      }).pipe(Effect.provide(runtime(file)))
    }),
  )

  it.live('hands a review whose reviewer is out of usage to another, by itself', () =>
    Effect.gen(function* () {
      const file = store()
      const task = yield* reviewing(file, new Date(Date.now() + 60 * 60 * 1000).toISOString())
      yield* Effect.gen(function* () {
        const [stopped, again] = yield* until(review, (rows) => rows.length === 2 && rows[1]?.state === 'running')
        assert.strictEqual(stopped?.state, 'failed')
        assert.notStrictEqual(again?.agentId, 'codex')
        assert.deepStrictEqual(yield* callsOf(task.taskId), [])
      }).pipe(Effect.provide(runtime(file)))
    }),
  )

  it.live('waits for the reset of the account the project runs it on, where that is out, though another of its agent’s is free', () =>
    Effect.gen(function* () {
      const file = store()
      const back = new Date(Date.now() + 60 * 60 * 1000).toISOString()
      // A second account the project doesn't move work to: it doesn't rotate.
      yield* Effect.gen(function* () {
        const accounts = yield* Accounts
        yield* accounts.add({ agentId: 'codex', name: 'Work' })
      }).pipe(Effect.provide(runtime(file)))
      const task = yield* working(file, { usageLimit: 'wait', out: back })
      yield* Effect.gen(function* () {
        const [held] = yield* until(implement, (rows) => rows[0]?.state === 'held')
        assert.strictEqual(held?.state, 'held')
        assert.deepStrictEqual(yield* callsOf(task.taskId), [])
        assert.strictEqual((yield* sessionsOf(task.threadId)).length, 1)
      }).pipe(Effect.provide(runtime(file)))
    }),
  )

  it.live('needs the person where its agent is out of usage and the one it is handed to can’t start', () =>
    Effect.gen(function* () {
      const file = store()
      const task = yield* working(file, { out: new Date(Date.now() + 60 * 60 * 1000).toISOString() })
      // The other agents are signed in, but none of them starts.
      const broken = Layer.effect(
        Agents,
        Effect.gen(function* () {
          const agents = yield* Agents
          const missing = yield* Effect.orDie(agents.get('missing'))
          const failing = (entry: (typeof agents.list)[number]) =>
            entry.definition.id === 'codex' ? entry : { ...entry, transport: missing.transport }
          return Agents.of({ list: agents.list.map(failing), get: (agentId) => Effect.map(agents.get(agentId), failing) })
        }),
      ).pipe(Layer.provide(fakeAgents()))
      yield* Effect.gen(function* () {
        const [call] = yield* until(callsOf(task.taskId), (rows) => rows.length === 1)
        assert.deepStrictEqual(call, { kind: 'stuck', state: 'open', why: 'failed_to_start' })
        const [attempt] = yield* implement
        assert.strictEqual(attempt?.state, 'waiting_attention')
      }).pipe(Effect.provide(runtime(file, {}, { agents: broken })))
    }),
  )

  it.live('needs the person where its lead can no longer start', () =>
    Effect.gen(function* () {
      const file = store()
      const task = yield* working(file)
      // The lead's agent is gone by the next launch.
      const gone = Layer.effect(
        Agents,
        Effect.gen(function* () {
          const agents = yield* Agents
          return Agents.of({ list: agents.list, get: (agentId) => agents.get(agentId === 'codex' ? 'missing' : agentId) })
        }),
      ).pipe(Layer.provide(fakeAgents()))
      yield* Effect.gen(function* () {
        const [call] = yield* until(callsOf(task.taskId), (rows) => rows.length === 1)
        assert.deepStrictEqual(call, { kind: 'stuck', state: 'open', why: 'failed_to_start' })
        const [attempt] = yield* implement
        assert.strictEqual(attempt?.state, 'waiting_attention')
      }).pipe(Effect.provide(runtime(file, {}, { agents: gone })))
    }),
  )

  it.live('needs the person where a restart stops it again soon after the last one carried it on', () =>
    Effect.gen(function* () {
      const file = store()
      const task = yield* working(file)
      // Carried on once, then stopped again at once, as Althar crashing on the step would.
      yield* until(sessionsOf(task.threadId), (rows) => rows.length === 2).pipe(Effect.provide(runtime(file)))
      yield* Effect.gen(function* () {
        const [call] = yield* until(callsOf(task.taskId), (rows) => rows.length === 1)
        assert.deepStrictEqual(call, { kind: 'stuck', state: 'open', why: 'restarted' })
        const [attempt] = yield* implement
        assert.strictEqual(attempt?.state, 'waiting_attention')
        // Not started a third time, and said once, for the time it was carried on.
        assert.strictEqual((yield* sessionsOf(task.threadId)).length, 2)
        assert.strictEqual((yield* notices(task.threadId)).filter((notice) => notice.title === CARRIED).length, 1)
      }).pipe(Effect.provide(runtime(file)))
    }),
  )
})
