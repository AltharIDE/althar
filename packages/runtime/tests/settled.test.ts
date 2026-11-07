import { assert, describe, it } from '@effect/vitest'
import { Effect, Fiber, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { settledAmong, settling } from '../src/settled'
import { Tasks } from '../src/Tasks'
import { repository, runtime, until } from './support'

/*
 * Tasks over and projects removed, for the app to clear what the pages
 * beside their conversations kept, where the person keeps cookies only
 * that long (ADR-100).
 */

const made = Effect.gen(function* () {
  const projects = yield* Projects
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  const task = (title: string) =>
    Effect.gen(function* () {
      return yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title,
        draft: true,
      })
    })
  const one = yield* task('Fix the band')
  const two = yield* task('Say arm64')
  return { projectId: project.projectId, one: one.taskId, two: two.taskId }
})

describe('tasks and projects that are over', () => {
  it.live('are those done or abandoned, removed, or no longer there; ids that are neither are left out', () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, one, two } = yield* made
      assert.deepStrictEqual(yield* settledAmong([one, two, projectId]), [])
      yield* sql`UPDATE tasks SET state = 'done' WHERE id = ${one}`
      const gone = `task_${'0'.repeat(32)}`
      assert.deepStrictEqual(yield* settledAmong([one, two, projectId, gone, 'thr_x', '../task_x']), [one, gone])
      yield* sql`UPDATE tasks SET state = 'abandoned' WHERE id = ${two}`
      assert.deepStrictEqual(yield* settledAmong([one, two, one]), [one, two])
      assert.deepStrictEqual(yield* settledAmong([]), [])
    }).pipe(Effect.provide(runtime())),
  )

  it.live('are said as each comes to be over, and not before', () =>
    Effect.gen(function* () {
      const tasks = yield* Tasks
      const projects = yield* Projects
      const { projectId, one, two } = yield* made
      const said: Array<ReadonlyArray<string>> = []
      const listening = yield* Effect.forkChild(Stream.runForEach(settling, (owners) => Effect.sync(() => said.push(owners))))
      yield* Effect.yieldNow
      yield* tasks.abandon({ envelope: yield* Runtime.envelope('task.abandon', {}), taskId: one })
      yield* until(
        Effect.sync(() => said.flat()),
        (owners) => owners.includes(one),
      )
      assert.isFalse(said.flat().includes(two))
      yield* projects.remove(projectId)
      yield* until(
        Effect.sync(() => said.flat()),
        (owners) => owners.includes(projectId),
      )
      yield* Fiber.interrupt(listening)
    }).pipe(Effect.provide(runtime())),
  )
})
