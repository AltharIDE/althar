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

const newTask = (scratch = false) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId: project.projectId,
      title: 'Verify the migration',
      draft: true,
      plain: true,
      ...(scratch ? { shelf: 'scratch' as const } : {}),
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
      sql<{ id: string; sessionId: string; prompt: string; model: string | null }>`
        SELECT id, provider_session_id AS session_id, prompt, model FROM turn_deliveries
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
        const task = yield* newTask()
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
        const task = yield* newTask()
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

  it.live('treats a goal as the first instruction in an aside and can report a blocker', () => {
    const gate = holds()
    return Effect.gen(function* () {
      const task = yield* newTask(true)
      const sessions = yield* Sessions
      yield* sessions.start({ threadId: task.threadId, ...lead })
      const chosen = { ...lead, model: 'small' }
      const { goal } = yield* controlGoal(task.threadId, { action: 'set', objective }, chosen)
      yield* sessions.kickGoal(task.threadId, goal?.revision ?? 0, chosen)
      const live = yield* liveGoal(task.threadId)
      assert.include(live?.prompt ?? '', objective)
      assert.strictEqual(live?.model, 'small')
      const report = (input: Record<string, unknown>) =>
        callTool(
          {
            role: 'lead',
            projectId: task.projectId,
            taskId: task.taskId,
            threadId: task.threadId,
            sessionId: live?.sessionId ?? '',
          },
          'report_goal',
          input,
        )
      assert.include(yield* report({ turn: live?.id, status: 'blocked', detail: ' ' }), 'short report')
      assert.include(yield* report({ turn: 'old-turn', status: 'blocked', detail: 'Need staging access.' }), 'no longer holds')
      assert.include(yield* report({ turn: live?.id, status: 'blocked', detail: 'Need staging access.' }), 'Goal blocker recorded')
      gate.open('[lead:slowly]')
      assert.include(yield* readGoal(task.threadId), { status: 'blocked', detail: 'Need staging access.', rounds: 1 })
    }).pipe(Effect.provide(runtime(':memory:', { holds: gate })), Effect.scoped)
  })

  it.live('starts only the replacement goal after the previous revision changed during first launch', () => {
    let asked: () => void = () => undefined
    const starting = new Promise<void>((resolve) => (asked = resolve))
    let finishStartup: () => void = () => undefined
    const launch = new Promise<void>((resolve) => (finishStartup = resolve))
    const gate = holds()
    return Effect.gen(function* () {
      const task = yield* newTask()
      const sessions = yield* Sessions
      const first = yield* setGoal(task.threadId)
      yield* sessions.kickGoal(task.threadId, first.goal?.revision ?? 0, lead)
      yield* Effect.promise(() => starting)
      const newer = yield* controlGoal(task.threadId, { action: 'edit', objective: 'Verify production [lead:slowly]' })
      yield* sessions.kickGoal(task.threadId, newer.goal?.revision ?? 0)
      finishStartup()

      const live = yield* liveGoal(task.threadId)
      assert.include(live?.prompt ?? '', 'Verify production')
      assert.notInclude(live?.prompt ?? '', objective)
      assert.include(yield* readGoal(task.threadId), { status: 'active', rounds: 1 })
      gate.open('[lead:slowly]')
    }).pipe(
      Effect.ensuring(Effect.sync(finishStartup)),
      Effect.provide(
        runtime(
          ':memory:',
          { holds: gate },
          {
            each: {
              codex: {
                beforeNewSession: () => {
                  asked()
                  return launch
                },
              },
            },
          },
        ),
      ),
      Effect.scoped,
    )
  })

  it.live('shows a disconnected goal as blocked and resumes it on a new session', () => {
    const gate = holds()
    const connections: Array<{ readonly close: () => void }> = []
    return Effect.gen(function* () {
      const task = yield* newTask()
      const sessions = yield* Sessions
      const { goal } = yield* setGoal(task.threadId)
      yield* sessions.kickGoal(task.threadId, goal?.revision ?? 0, lead)
      const before = yield* liveGoal(task.threadId)
      connections[0]?.close()
      const blocked = yield* until(readGoal(task.threadId), (goal) => goal?.status === 'blocked')
      assert.include(blocked, { rounds: 1 })
      const resumed = yield* controlGoal(task.threadId, { action: 'resume' })
      yield* sessions.kickGoal(task.threadId, resumed.goal?.revision ?? 0)
      const after = yield* liveGoal(task.threadId, before?.sessionId)
      assert.notStrictEqual(before?.sessionId, after?.sessionId)
      assert.include(yield* readGoal(task.threadId), { status: 'active', rounds: 2 })
      gate.open('[lead:slowly]')
    }).pipe(Effect.provide(runtime(':memory:', { holds: gate, sessionControls: (controls) => connections.push(controls) })), Effect.scoped)
  })
})
