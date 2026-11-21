import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { holds } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { controlGoal, readGoal } from '../src/threadGoals'
import { callTool, repository, runtime, until } from './support'

const newTask = Effect.gen(function* () {
  const projects = yield* Projects
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  const task = yield* projects.createTask({
    envelope: yield* Runtime.envelope('task.create', {}),
    projectId: project.projectId,
    title: 'Verify the migration',
    draft: true,
    plain: true,
  })
  return { ...task, projectId: project.projectId }
})

const objective = 'Verify the migration [lead:slowly]'
const lead = { agentId: 'codex' }
const setGoal = (threadId: string) => controlGoal(threadId, { action: 'set', objective }, lead)

const liveGoal = (threadId: string, except: string | null = null) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [turn] = yield* until(
      sql<{ id: string; sessionId: string; prompt: string }>`
        SELECT id, provider_session_id AS session_id, prompt FROM turn_deliveries
        WHERE thread_id = ${threadId} AND goal_round = 1 AND state = 'delivered'
          AND (provider_session_id <> ${except} OR ${except} IS NULL)`,
      (found) => found.length > 0,
    )
    return turn
  })

describe('thread goals', () => {
  it.live('recovers a goal accepted before its first lead could start', () => {
    const database = join(mkdtempSync(join(tmpdir(), 'althar-cold-goal-')), 'home.sqlite')
    const gate = holds()
    return Effect.gen(function* () {
      const threadId = yield* Effect.gen(function* () {
        const task = yield* newTask
        yield* setGoal(task.threadId)
        return task.threadId
      }).pipe(Effect.provide(runtime(database, { holds: gate })), Effect.scoped)
      yield* Effect.gen(function* () {
        const turn = yield* liveGoal(threadId)
        assert.include(turn?.prompt ?? '', objective)
        assert.strictEqual((yield* readGoal(threadId))?.rounds, 1)
        yield* controlGoal(threadId, { action: 'pause' })
        gate.open('[lead:slowly]')
      }).pipe(Effect.provide(runtime(database, { holds: gate })), Effect.scoped)
    })
  })

  it.live('carries its objective, progress and used rounds across runtime shutdown and restart', () => {
    const database = join(mkdtempSync(join(tmpdir(), 'althar-goal-restart-')), 'home.sqlite')
    const gate = holds()
    return Effect.gen(function* () {
      const { task, sessionId } = yield* Effect.gen(function* () {
        const task = yield* newTask
        const { goal } = yield* setGoal(task.threadId)
        yield* (yield* Sessions).kickGoal(task.threadId, goal?.revision ?? 0, lead)
        const before = yield* liveGoal(task.threadId)
        const sessionId = before?.sessionId ?? ''
        assert.include(
          yield* callTool(
            { role: 'lead', projectId: task.projectId, taskId: task.taskId, threadId: task.threadId, sessionId },
            'report_goal',
            { turn: before?.id, status: 'progress', detail: 'The local migration passed. Staging remains.' },
          ),
          'Goal progress recorded',
        )
        return { task, sessionId }
      }).pipe(Effect.provide(runtime(database, { holds: gate })), Effect.scoped)
      yield* Effect.gen(function* () {
        const after = yield* liveGoal(task.threadId, sessionId)
        const goal = yield* readGoal(task.threadId)
        assert.strictEqual(goal?.status, 'active')
        assert.strictEqual(goal?.progress, 'The local migration passed. Staging remains.')
        assert.strictEqual(goal?.rounds, 2)
        assert.include(after?.prompt ?? '', goal?.progress ?? 'missing progress')
        assert.include(
          yield* callTool(
            { role: 'lead', projectId: task.projectId, taskId: task.taskId, threadId: task.threadId, sessionId: after?.sessionId ?? '' },
            'report_goal',
            { turn: after?.id, status: 'complete', detail: 'Both local and staging migrations passed.' },
          ),
          'evidence recorded',
        )
        gate.open('[lead:slowly]')
        assert.strictEqual((yield* readGoal(task.threadId))?.status, 'complete')
      }).pipe(Effect.provide(runtime(database, { holds: gate })), Effect.scoped)
    })
  })
})
