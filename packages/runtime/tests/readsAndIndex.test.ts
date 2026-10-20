import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { coordinatorFolder } from '../src/coordinatorFolder'
import { NotFound } from '../src/errors'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { documentText, outputText } from '../src/reading'
import { findTasks } from '../src/Search'
import { addItem } from '../src/threads'
import { runtime, task } from './support'

/*
 * What the window and the coordinator read past a thread's items, at their
 * edges: a command's output that was never kept or has gone, a document
 * named from a worktree that isn't there, a coordinator folder for a project
 * that isn't, what a lead reported without saying what it built, and a quick
 * plan changed before it starts.
 */

describe('what a command printed', () => {
  it.live('is not found for an item that isn’t a command’s, one that kept no output, or one whose output has gone', () =>
    Effect.gen(function* () {
      const { project, task: created } = yield* task()
      const place = { projectId: project.projectId as ProjectId, threadId: created.threadId }
      const message = yield* addItem(place, 'agent_message', { text: 'Done.' })
      const unkept = yield* addItem(
        place,
        'tool_call',
        { title: 'npm test', kind: 'execute', status: 'completed' },
        { toolCallId: 'call-1' },
      )
      const gone = yield* addItem(
        place,
        'tool_call',
        {
          title: 'npm test',
          kind: 'execute',
          status: 'completed',
          output: { sha256: 'a'.repeat(64), dropped: 0, lines: 3 },
        },
        { toolCallId: 'call-2' },
      )
      for (const itemId of [message, unkept, gone, 'item_none'])
        assert.instanceOf(yield* Effect.flip(outputText(created.threadId, itemId)), NotFound, itemId)
    }).pipe(Effect.provide(runtime())),
  )
})

describe('a document named from a worktree', () => {
  it.effect('is not found where the task has no worktree to name it from', () =>
    Effect.gen(function* () {
      assert.instanceOf(yield* Effect.flip(documentText('docs/plan.md', [])), NotFound)
    }),
  )
})

describe('the coordinator’s folder', () => {
  it.live('is not made for a project that isn’t there', () =>
    Effect.gen(function* () {
      assert.instanceOf(yield* Effect.flip(coordinatorFolder('proj_gone')), NotFound)
    }).pipe(Effect.provide(runtime())),
  )
})

describe('what a task is found by', () => {
  it.live('takes a report that says nothing of what it built, and leaves what isn’t a task’s alone', () =>
    Effect.gen(function* () {
      const { project, task: created } = yield* task('Look into the refunds')
      yield* addItem({ projectId: project.projectId as ProjectId, threadId: created.threadId }, 'step_result', {
        step: 'implement',
        summary: 'Refunds skip the limiter entirely.',
      })
      // A report on the coordinator's own thread is no task's: nothing is found by it.
      yield* addItem({ projectId: project.projectId as ProjectId, threadId: project.coordinatorThreadId }, 'step_result', {
        step: 'implement',
        summary: 'Nobody’s ledger reconciles.',
      })
      const found = yield* findTasks({ projectId: project.projectId, text: 'limiter' }, new Set())
      assert.deepStrictEqual(
        found.map((one) => one.taskId),
        [created.taskId],
      )
      assert.deepStrictEqual(yield* findTasks({ projectId: project.projectId, text: 'reconciles' }, new Set()), [])
    }).pipe(Effect.provide(runtime())),
  )
})

describe('a quick plan changed before it starts', () => {
  it.live('stays on this Mac, with its new lead', () =>
    Effect.gen(function* () {
      const plans = yield* Plans
      const instance = yield* Instance
      const sql = yield* SqlClient.SqlClient
      const { project, task: created } = yield* task('Try the new limiter')
      const planId = yield* plans.propose({
        projectId: project.projectId as ProjectId,
        taskId: created.taskId,
        steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
        reason: null,
        actorId: instance.personId,
        startsIn: Duration.hours(1),
        here: true,
      })
      yield* plans.change(planId, [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }], instance.personId)
      const [plan] = yield* sql<{ parameters: string }>`SELECT parameters FROM task_plans WHERE id = ${planId}`
      assert.deepInclude(JSON.parse(plan?.parameters ?? '{}'), {
        steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
        here: true,
      })
    }).pipe(Effect.provide(runtime())),
  )
})
