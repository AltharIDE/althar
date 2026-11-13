import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { Ids } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Deferred, Duration, Effect, Fiber, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Connections } from '../src/Connections'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import { callTool, fakeConnectors, HOST, hosted, runtime, until } from './support'

/* Stop must revoke publication while it waits for the task's git mutex, before any git or host mutation begins. */

const layer = (github: FakeService) =>
  Queries.layer.pipe(
    Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }), listenEvery: Duration.hours(1) })),
  )

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Fake', '-c', 'user.email=fake@althar.test', ...args], { cwd })
    .toString()
    .trim()

for (const ending of ['plan', 'Ship'] as const) {
  describe(`${ending} publication waiting for the task git lock`, () => {
    it.live('does not start publishing after Stop cancelled its admitted attempt', () => {
      const { working, bare } = hosted()
      const host = Deferred.makeUnsafe<void>()
      const unlock = Deferred.makeUnsafe<void>()
      const github = makeFakeService({
        pushUrl: () => bare,
        waitsFor: (method) => (method === 'openChange' ? Deferred.await(host) : Effect.void),
      })
      github.addRepository(['meridian', 'api'])
      return Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const instance = yield* Instance
        yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
        const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
        const task = yield* (yield* Projects).createTask({
          envelope: yield* Runtime.envelope('task.create', {}),
          projectId: project.projectId,
          title: 'Publication waiting for git',
          description: `[lead:finish] [lead:edit] ${ending === 'plan' ? '[review:wait]' : '[review:wait-later]'}`,
          draft: true,
        })
        const plans = yield* Plans
        const runs = yield* Runs
        const planId = yield* plans.propose({
          projectId: Schema.decodeUnknownSync(Ids.project.schema)(project.projectId),
          taskId: task.taskId,
          steps: [
            { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
            { key: 'review', agentId: 'codex', model: null, skipped: false },
          ],
          end: ending === 'plan' ? 'draft' : 'none',
          held: true,
          reason: null,
          actorId: instance.personId,
        })
        yield* plans.start(planId, instance.personId)
        if (ending === 'Ship') {
          yield* until(
            sql<{ state: string }>`SELECT state FROM runs WHERE task_id = ${task.taskId}`,
            (rows) => rows[0]?.state === 'succeeded',
          )
          const sessions = yield* Sessions
          yield* until(
            Effect.gen(function* () {
              const threads = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${task.taskId}`
              return yield* Effect.forEach(threads, (thread) => sessions.busy(thread.id))
            }),
            (busy) => busy.every((one) => !one),
          )
          const [workspace] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${task.taskId}`
          const path = workspace?.path ?? assert.fail('no worktree')
          appendFileSync(join(path, 'accepted.txt'), 'accepted\n')
          git(path, 'add', 'accepted.txt')
          git(path, 'commit', '-q', '-m', 'The next accepted change')
          yield* runs.reshape({ taskId: task.taskId, end: 'draft', actorId: instance.personId })
          yield* runs.ship({ envelope: yield* Runtime.envelope('task.ship', {}), taskId: task.taskId })
        }
        const [reviewer] = yield* until(
          sql<{ threadId: string; sessionId: string }>`
            SELECT t.id AS thread_id, s.id AS session_id FROM threads t JOIN provider_sessions s ON s.thread_id = t.id
            JOIN node_attempts a ON a.provider_session_id = s.id JOIN nodes n ON n.id = a.node_id
            WHERE t.task_id = ${task.taskId} AND t.kind = 'step' AND t.node_key = 'review'
              AND s.state = 'active' AND a.state = 'running'`,
          (rows) => rows.length === 1,
        )
        assert.isDefined(reviewer)
        const remoteBefore = git(bare, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/althar/')
        const receiptsBefore = yield* sql`SELECT id FROM thread_items WHERE thread_id = ${task.threadId}
          AND kind = 'step_result' AND json_extract(content, '$.step') = 'publish' ORDER BY rowid`
        const acquired = yield* Deferred.make<void>()
        const lock = yield* Effect.forkChild(
          (yield* Changes).exclusive(task.taskId, Effect.andThen(Deferred.succeed(acquired, undefined), Deferred.await(unlock))),
        )
        yield* Deferred.await(acquired)
        // This separate MCP connection remains observable after Stop interrupts the fake reviewer's own turn.
        const reported = yield* Effect.forkChild(
          callTool(
            {
              role: 'reviewer',
              projectId: project.projectId,
              threadId: reviewer.threadId,
              sessionId: reviewer.sessionId,
              taskId: task.taskId,
            },
            'report_review',
            { verdict: 'pass', summary: 'It holds.' },
          ),
        )
        const [publish] = yield* until(
          sql<{ id: string; runId: string; state: string }>`
            SELECT a.id, e.run_id, a.state FROM node_attempts a JOIN nodes n ON n.id = a.node_id
            JOIN workflow_executions e ON e.id = n.execution_id JOIN runs r ON r.id = e.run_id
            WHERE r.task_id = ${task.taskId} AND n.node_key = 'publish' AND a.state = 'running'`,
          (rows) => rows.length === 1,
        )
        assert.isDefined(publish)
        yield* (yield* Tasks).stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: task.taskId })
        yield* Deferred.succeed(unlock, undefined)
        yield* Deferred.succeed(host, undefined)
        yield* Fiber.join(lock)
        assert.strictEqual(yield* Fiber.join(reported), 'Althar has your review. The change passes.')
        // Joining the reporting call also joins its conclude/Ship-ending work, so these are final observations, not timing guesses.
        assert.notInclude(github.calls, 'openChange')
        assert.lengthOf(github.changes, 0)
        assert.strictEqual(git(bare, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/althar/'), remoteBefore)
        const [attempt] = yield* sql<{ state: string }>`SELECT state FROM node_attempts WHERE id = ${publish.id}`
        const [run] = yield* sql<{ state: string }>`SELECT state FROM runs WHERE id = ${publish.runId}`
        assert.strictEqual(attempt?.state, 'cancelled')
        assert.strictEqual(run?.state, 'suspended')
        assert.deepStrictEqual(
          yield* sql`SELECT id FROM thread_items WHERE thread_id = ${task.threadId}
          AND kind = 'step_result' AND json_extract(content, '$.step') = 'publish' ORDER BY rowid`,
          receiptsBefore,
        )
        assert.deepStrictEqual(yield* sql`SELECT id FROM attention_requests WHERE task_id = ${task.taskId} AND state = 'open'`, [])
      }).pipe(
        Effect.ensuring(Effect.all([Deferred.succeed(unlock, undefined), Deferred.succeed(host, undefined)], { discard: true })),
        Effect.provide(layer(github)),
      )
    })
  })
}
