import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'
import { scenarios } from '@charrette/provider-adapters/testing'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { SessionFailed } from '../src/errors'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { notices, runtime, task, turns, until } from './support'

const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const records = (sessionId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [session] = yield* sql<{ state: string }>`SELECT state FROM provider_sessions WHERE id = ${sessionId}`
    const processes = yield* sql<{
      state: string
      pid: number | null
      processGroupId: number | null
      osStartedAt: string | null
      environmentDigest: string | null
      exitCode: number | null
      signal: string | null
      executable: string
    }>`SELECT state, pid, process_group_id, os_started_at, environment_digest, exit_code, signal, executable FROM processes WHERE provider_session_id = ${sessionId}`
    return { session: session?.state, processes }
  })

describe('agents as processes', () => {
  it.live('records the process an agent runs as, and how it was stopped', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      const sessionId = yield* sessions.start({ threadId: created.threadId, agentId: 'process' })
      const running = yield* records(sessionId)
      const [process] = running.processes
      assert.strictEqual(process?.state, 'running')
      assert.strictEqual(process?.pid, process?.processGroupId)
      assert.match(process?.environmentDigest ?? '', /^[0-9a-f]{64}$/)
      assert.isNotNull(process?.osStartedAt)
      assert.isTrue(alive(process?.pid ?? 0))

      yield* sessions.stop(created.threadId)
      const stopped = yield* records(sessionId)
      assert.strictEqual(stopped.session, 'completed')
      assert.strictEqual(stopped.processes[0]?.state, 'killed')
      assert.strictEqual(stopped.processes[0]?.signal, 'SIGTERM')
      assert.isFalse(alive(process?.pid ?? 0))
    }).pipe(Effect.provide(runtime())),
  )

  it.live('marks a session lost, and its turn failed, when the agent exits mid-turn', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const { task: created } = yield* task()
      const sessionId = yield* sessions.start({ threadId: created.threadId, agentId: 'process' })
      // The brief goes first; then the turn in which the agent exits.
      yield* until(turns(created.threadId), (rows) => rows[0]?.state === 'completed')
      yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', {}), threadId: created.threadId, body: scenarios.exit })
      const [, turn] = yield* until(turns(created.threadId), (rows) => rows[1]?.state === 'failed')
      assert.strictEqual(turn?.errorClass, 'agent_exited')
      const after = yield* until(
        Effect.map(records(sessionId), (row) => [row]),
        ([row]) => row?.session === 'lost',
      )
      assert.deepStrictEqual(
        after.map((row) => [row.session, row.processes[0]?.state, row.processes[0]?.exitCode]),
        [['lost', 'exited', 3]],
      )
      // The thread says why nothing is happening.
      const [said] = yield* until(notices(created.threadId), (rows) => rows.length > 0)
      assert.strictEqual(said?.title, 'Fake process stopped on its own.')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('records a session that could not start, and its process as unknown', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const sql = yield* SqlClient.SqlClient
      const { task: created } = yield* task()
      const error = yield* Effect.flip(sessions.start({ threadId: created.threadId, agentId: 'missing' }))
      assert.instanceOf(error, SessionFailed)
      const [row] = yield* sql<{ session: string; process: string; pid: number | null }>`
        SELECT s.state AS session, p.state AS process, p.pid FROM provider_sessions s JOIN processes p ON p.provider_session_id = s.id`
      assert.deepStrictEqual(row, { session: 'failed', process: 'unknown', pid: null })
      assert.strictEqual(error.summary, "charrette-no-such-agent isn't installed, or isn't on this Mac's PATH.")
      assert.deepStrictEqual(yield* notices(created.threadId), [
        { source: 'runtime', severity: 'error', title: "Fake missing couldn't start.", description: error.summary },
      ])
    }).pipe(Effect.provide(runtime())),
  )

  it.live('stops and records every session when the runtime closes', () =>
    Effect.gen(function* () {
      const file = join(mkdtempSync(join(tmpdir(), 'charrette-profile-')), 'charrette.sqlite')
      const { sessionId, pid } = yield* Effect.gen(function* () {
        const sessions = yield* Sessions
        const { task: created } = yield* task()
        const sessionId = yield* sessions.start({ threadId: created.threadId, agentId: 'process' })
        const running = yield* records(sessionId)
        return { sessionId, pid: running.processes[0]?.pid ?? 0 }
      }).pipe(Effect.provide(runtime(file)))
      assert.isFalse(alive(pid))
      const after = yield* records(sessionId).pipe(Effect.provide(runtime(file)))
      assert.deepStrictEqual([after.session, after.processes[0]?.state], ['completed', 'killed'])
    }),
  )
})
