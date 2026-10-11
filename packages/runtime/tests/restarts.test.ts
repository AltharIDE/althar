import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Ids, newId } from '@althar/domain'

import { Accounts } from '../src/Accounts'
import { Agents } from '../src/Config'
import { Instance } from '../src/Instance'
import { Policies } from '../src/Policies'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
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

/** The task's Review attempts, oldest first, with the agent each ran on. */
const review = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  return yield* sql<{ state: string; agentId: string | null }>`
    SELECT a.state, s.agent_id FROM node_attempts a JOIN nodes n ON n.id = a.node_id
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

const store = () => join(mkdtempSync(join(tmpdir(), 'althar-restarts-')), 'althar.sqlite')

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

  it.live('carries a review on as a new round attempt, on its reviewer', () =>
    Effect.gen(function* () {
      const file = store()
      const task = yield* Effect.gen(function* () {
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
          description: '[lead:finish] [review:wait]',
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
        yield* until(review, (rows) => rows[0]?.state === 'running')
        return created
      }).pipe(Effect.provide(runtime(file)))
      yield* Effect.gen(function* () {
        const [stopped, again] = yield* until(review, (rows) => rows.length === 2 && rows[1]?.state === 'running')
        assert.strictEqual(stopped?.state, 'failed')
        assert.strictEqual(again?.agentId, 'codex')
        assert.deepStrictEqual(yield* callsOf(task.taskId), [])
        assert.strictEqual((yield* notices(task.threadId)).filter((notice) => notice.title === CARRIED).length, 1)
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
