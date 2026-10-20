import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Coordinator } from '../src/Coordinator'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, items, repository, runtime, turns, until } from './support'

/*
 * How a step's turn or session ending is read, where coordinator.test.ts,
 * rounds.test.ts and restarts.test.ts don't go: a lead that goes while it
 * asks the person, a turn that did nothing on a task stopped meanwhile, and a quick task's round
 * that changed nothing.
 */

const withQueries = (...args: Parameters<typeof runtime>) => Queries.layer.pipe(Layer.provideMerge(runtime(...args)))

const opened = Effect.gen(function* () {
  const projects = yield* Projects
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  return project.projectId as ProjectId
})

/** A task planned for Codex to implement as its description says, started at once. */
const planned = (projectId: ProjectId, title: string, description: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const plans = yield* Plans
    const projects = yield* Projects
    const [person] = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'person'`
    const actor = (person?.id ?? '') as Parameters<typeof plans.hold>[1]
    const created = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId,
      title,
      description,
      draft: true,
    })
    const planId = yield* plans.propose({
      projectId,
      taskId: created.taskId,
      steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
      reason: null,
      actorId: actor,
      end: null,
    })
    yield* plans.start(planId, actor)
    return created
  })

const runsOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{
      state: string
      planId: string | null
    }>`SELECT state, plan_id FROM runs WHERE task_id = ${taskId} ORDER BY created_at, rowid`
  })

const callsOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{
      kind: string
      state: string
    }>`SELECT kind, state FROM attention_requests WHERE task_id = ${taskId} ORDER BY created_at`
  })

const gone = (threadId: string) =>
  Effect.flatMap(Sessions, (sessions) =>
    until(
      Effect.map(sessions.running(threadId), (running) => (running._tag === 'None' ? [running] : [])),
      (rows) => rows.length === 1,
    ),
  )

const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const sessions = yield* Sessions
    yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { body }), threadId, body })
  })

describe("a step's lead that goes", () => {
  it.live('while it asks the person something, needs nothing more of them than its question', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const projectId = yield* opened
      const task = yield* planned(projectId, 'Pick the cache', 'Ask which database first. [lead:ask]')
      yield* until(callsOf(task.taskId), (rows) => rows.some((row) => row.kind === 'question' && row.state === 'open'))
      yield* sessions.stop(task.threadId)
      yield* gone(task.threadId)
      // A moment for its going to be read: its question is still the one call.
      yield* Effect.sleep(Duration.millis(500))
      assert.deepStrictEqual(yield* callsOf(task.taskId), [{ kind: 'question', state: 'open' }])
    }).pipe(Effect.provide(withQueries())),
  )
})

describe('a lead whose turn did nothing', () => {
  it.live('is not told to carry on once its task is stopped meanwhile', () =>
    Effect.gen(function* () {
      const tasks = yield* Tasks
      const projectId = yield* opened
      const task = yield* planned(projectId, 'Stopped soon', 'Do it. [lead:finish]')
      yield* until(
        Effect.map(items(task.threadId), (rows) =>
          rows.filter((row) => row.kind === 'notice' && String(row.content.title).startsWith('Its turn ended before it could do anything')),
        ),
        (rows) => rows.length === 1,
      )
      yield* tasks.stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: task.taskId })
      yield* Effect.sleep(Duration.millis(1_500))
      assert.isFalse((yield* turns(task.threadId)).some((turn) => turn.prompt?.startsWith('Your last turn ended before') === true))
    }).pipe(Effect.provide(withQueries(':memory:', { blank: 1 }, { idle: { blank: Duration.seconds(1) } }))),
  )
})

describe("a quick task's round of work", () => {
  it.live('that changed nothing in the repository ends with its summary, the task back where it was', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const projectId = yield* opened
      const threadId = yield* (yield* Coordinator).thread(projectId)
      const access: ToolAccess = { role: 'coordinator', projectId, threadId, sessionId: 'none', taskId: null }
      yield* callTool(access, 'start_task', {
        title: 'Look around',
        description: 'Look. [lead:finish]',
        lead: { agent: 'codex', model: 'small' },
      })
      const [task] = yield* until(
        sql<{ taskId: string; threadId: string }>`
          SELECT k.id AS task_id, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task' WHERE k.title = 'Look around'`,
        (rows) => rows.length === 1,
      )
      if (task === undefined) return yield* Effect.die(new Error('No task'))
      yield* until(runsOf(task.taskId), (rows) => rows[0]?.state === 'succeeded', Duration.seconds(20))
      yield* say(task.threadId, 'And the docs? [lead:finish]')
      const said = yield* until(
        Effect.map(items(task.threadId), (rows) =>
          rows.filter((row) => row.kind === 'agent_message' && String(row.content.text).includes('changed this round')),
        ),
        (rows) => rows.length === 1,
        Duration.seconds(20),
      )
      assert.strictEqual(
        said[0]?.content.text,
        'Althar has your summary. Nothing in the repository changed this round, so the task is back where it was.',
      )
    }).pipe(Effect.provide(withQueries())),
  )
})
