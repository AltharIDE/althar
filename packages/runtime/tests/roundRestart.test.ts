import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { notices, repository, runtime, until } from './support'

/*
 * A round of work (ADR-034) a restart stopped, where restarts.test.ts and
 * rounds.test.ts don't go: one whose lead's last turn had ended, having made
 * nothing new, as Althar stopped. It ends as that turn's end would have, the
 * task back where it was, and nothing is carried on.
 */

const withQueries = (file: string) => Queries.layer.pipe(Layer.provideMerge(runtime(file)))

const runsOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ state: string; planId: string | null }>`
      SELECT state, plan_id FROM runs WHERE task_id = ${taskId} ORDER BY created_at, rowid`
  })

describe('a round of work a restart stopped', () => {
  it.live('ends where its lead had made nothing new, back where the task was, with nothing carried on', () =>
    Effect.gen(function* () {
      const file = join(mkdtempSync(join(tmpdir(), 'althar-round-')), 'althar.sqlite')
      const task = yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const plans = yield* Plans
        const projects = yield* Projects
        const sessions = yield* Sessions
        const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
        const [person] = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'person'`
        const actor = (person?.id ?? '') as Parameters<typeof plans.hold>[1]
        const created = yield* projects.createTask({
          envelope: yield* Runtime.envelope('task.create', {}),
          projectId: project.projectId,
          title: 'Answer a question',
          description: 'Do it. [lead:finish]',
          draft: true,
        })
        const planId = yield* plans.propose({
          projectId: project.projectId as Parameters<typeof plans.propose>[0]['projectId'],
          taskId: created.taskId,
          steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
          reason: null,
          actorId: actor,
          end: null,
        })
        yield* plans.start(planId, actor)
        yield* until(runsOf(created.taskId), (rows) => rows[0]?.state === 'succeeded')
        // The person asks its lead something: a round of work opens, and its lead looks around.
        const body = 'What does the retry do? [lead:explore]'
        yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId: created.threadId, body })
        yield* until(runsOf(created.taskId), (rows) => rows.length === 2 && rows[1]?.state === 'running')
        return created
      }).pipe(Effect.provide(withQueries(file)))
      // Its turn had ended as Althar stopped, with nothing new made.
      const db = new DatabaseSync(file)
      db.prepare(
        `UPDATE turn_deliveries SET state = 'completed' WHERE id = (
          SELECT id FROM turn_deliveries WHERE thread_id = ? ORDER BY requested_at DESC, rowid DESC LIMIT 1)`,
      ).run(task.threadId)
      db.close()

      yield* Effect.gen(function* () {
        const [, round] = yield* until(runsOf(task.taskId), (rows) => rows[1]?.state === 'succeeded')
        assert.isNull(round?.planId)
        const sql = yield* SqlClient.SqlClient
        const [attempt] = yield* sql<{ state: string; output: string | null }>`
          SELECT a.state, a.output FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
          JOIN runs r ON r.id = e.run_id WHERE r.task_id = ${task.taskId} AND r.plan_id IS NULL`
        assert.deepStrictEqual([attempt?.state, JSON.parse(attempt?.output ?? '{}')], ['succeeded', { quiet: true }])
        assert.isFalse((yield* notices(task.threadId)).some((notice) => notice.title === 'Carried on after Althar restarted.'))
      }).pipe(Effect.provide(withQueries(file)))
    }),
  )
})
