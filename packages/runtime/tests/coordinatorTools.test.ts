import type { ProjectId } from '@althar/domain'
import { scenarios } from '@althar/provider-adapters/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Agents } from '../src/Config'
import { Coordinator, CoordinatorUnavailable } from '../src/Coordinator'
import { coordinatorNews, modelNamer, withEffort } from '../src/coordinatorNews'
import { UnknownAgent } from '../src/errors'
import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import { addItem } from '../src/threads'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, repository, runtime, turns, until } from './support'

/*
 * The coordinator's tools, and a lead's, at the turns the loop's own tests
 * don't take: a lead settling its quick task each way the person can ask,
 * and every way it can't; finding a task whose lead is at work; reading a
 * long thread back; and a coordinator with no agent to start on.
 */

const open = Effect.gen(function* () {
  const projects = yield* Projects
  return yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
})

/** A quick task, as the coordinator starts one with start_task, once its lead has finished its first turn. */
const quick = (projectId: string, title: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const threadId = yield* (yield* Coordinator).thread(projectId)
    const access: ToolAccess = { role: 'coordinator', projectId, threadId, sessionId: 'none', taskId: null }
    assert.match(yield* callTool(access, 'start_task', { title, description: '[lead:finish]', lead: { agent: 'codex' } }), /^Started /)
    const [task] = yield* sql<{ taskId: string; threadId: string }>`
      SELECT k.id AS task_id, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
      WHERE k.project_id = ${projectId} AND k.title = ${title}`
    if (task === undefined) return assert.fail('no task')
    yield* until(turns(task.threadId), (rows) => rows.length >= 1 && rows.every((row) => !['pending', 'delivered'].includes(row.state)))
    return task
  })

const stateOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ state: string; keptAt: string | null }>`SELECT state, kept_at FROM tasks WHERE id = ${taskId}`
  })

describe('a lead settling its task as the person says', () => {
  it.live('keeps it, settles it, and says so when it is kept or done already', () =>
    Effect.gen(function* () {
      const project = yield* open
      const task = yield* quick(project.projectId, 'Which partners still call v1')
      const lead: ToolAccess = {
        role: 'lead',
        projectId: project.projectId,
        threadId: task.threadId,
        sessionId: 'none',
        taskId: task.taskId,
      }
      const settle = (how: 'done' | 'keep' | 'discard') => callTool(lead, 'settle_task', { how })

      assert.match(yield* settle('keep'), /^Kept it for later: it is out of Needs you as it is/)
      assert.isNotNull((yield* stateOf(task.taskId))[0]?.keptAt)
      assert.strictEqual(yield* settle('keep'), 'It is kept for later already.')
      // The coordinator finds it as kept for later.
      const threadId = yield* (yield* Coordinator).thread(project.projectId)
      const coordinator: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, sessionId: 'none', taskId: null }
      assert.include(yield* callTool(coordinator, 'find_tasks', { text: 'partners' }), '(kept for later; id ')
      assert.match(yield* settle('done'), /^Marked it done: it is in Settled/)
      assert.strictEqual((yield* stateOf(task.taskId))[0]?.state, 'done')
      assert.strictEqual(yield* settle('done'), 'It is done already: it is in Settled.')
      assert.strictEqual(yield* settle('keep'), 'It is done already: it is in Settled, so there is nothing to keep.')
      assert.strictEqual(yield* settle('discard'), 'It is done already: it is in Settled, so there is nothing to discard.')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('settles it done when the person says so after its lead has stopped, with nothing left running to stop', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const tasks = yield* Tasks
      const project = yield* open
      const task = yield* quick(project.projectId, 'Check the partners')
      yield* sessions.stop(task.threadId)
      assert.isTrue(
        yield* tasks.markDone({ envelope: yield* Runtime.envelope('task.mark_done', { taskId: task.taskId }), taskId: task.taskId }),
      )
      assert.strictEqual((yield* stateOf(task.taskId))[0]?.state, 'done')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('discards it as its turn ends, and says so when it is discarded already', () =>
    Effect.gen(function* () {
      const project = yield* open
      const task = yield* quick(project.projectId, 'Sketch the settings')
      const lead: ToolAccess = {
        role: 'lead',
        projectId: project.projectId,
        threadId: task.threadId,
        sessionId: 'none',
        taskId: task.taskId,
      }
      assert.match(yield* callTool(lead, 'settle_task', { how: 'discard' }), /^It is discarded as your turn ends/)
      yield* until(stateOf(task.taskId), ([row]) => row?.state === 'abandoned', Duration.seconds(20))
      assert.strictEqual(yield* callTool(lead, 'settle_task', { how: 'done' }), 'It is discarded already.')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('leaves a change to the person, and is only for a task’s lead', () =>
    Effect.gen(function* () {
      const plans = yield* Plans
      const projects = yield* Projects
      const instance = yield* Instance
      const project = yield* open
      const change = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Retry the checkout',
        draft: true,
      })
      yield* plans.propose({
        projectId: project.projectId as ProjectId,
        taskId: change.taskId,
        steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
        reason: null,
        actorId: instance.personId,
        end: null,
        startsIn: Duration.hours(1),
      })
      const lead: ToolAccess = {
        role: 'lead',
        projectId: project.projectId,
        threadId: change.threadId,
        sessionId: 'none',
        taskId: change.taskId,
      }
      assert.strictEqual(
        yield* callTool(lead, 'settle_task', { how: 'done' }),
        'This task is a change: the person accepts it from its card, or abandons it from its menu. Carry on with what they asked.',
      )
      assert.strictEqual(
        yield* callTool({ ...lead, taskId: null }, 'settle_task', { how: 'keep' }),
        'Only the lead of one of the project’s tasks settles its task.',
      )
      assert.strictEqual((yield* stateOf(change.taskId))[0]?.state, 'draft')
    }).pipe(Effect.provide(runtime())),
  )
})

describe('the coordinator’s tools, at their other turns', () => {
  it.live('finds a task whose lead is at work as running', () =>
    Effect.gen(function* () {
      const sessions = yield* Sessions
      const projects = yield* Projects
      const project = yield* open
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Check the refund webhook',
      })
      yield* sessions.start({ threadId: task.threadId, agentId: 'codex' })
      yield* until(turns(task.threadId), (rows) => rows.length >= 1 && rows.every((row) => !['pending', 'delivered'].includes(row.state)))
      const threadId = yield* (yield* Coordinator).thread(project.projectId)
      const coordinator: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, sessionId: 'none', taskId: null }
      assert.notInclude(yield* callTool(coordinator, 'find_tasks', { text: 'refund' }), '(running')
      yield* sessions.send({
        envelope: yield* Runtime.envelope('thread.send', { threadId: task.threadId, body: scenarios.slow }),
        threadId: task.threadId,
        body: scenarios.slow,
        disposition: 'after_current',
      })
      yield* until(turns(task.threadId), (rows) => rows.some((row) => row.state === 'delivered'))
      assert.match(
        yield* callTool(coordinator, 'find_tasks', { text: 'refund' }),
        /^- check-the-refund-webhook: Check the refund webhook \(running; id task_/,
      )
      yield* sessions.interrupt(task.threadId)
    }).pipe(Effect.provide(runtime())),
  )

  it.live('reads a task with what its lead built and what it couldn’t show working', () =>
    Effect.gen(function* () {
      const projects = yield* Projects
      const project = yield* open
      const task = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'Retry refunds',
      })
      yield* addItem({ projectId: project.projectId as ProjectId, threadId: task.threadId }, 'step_result', {
        step: 'implement',
        summary: 'Retried refunds once.',
        built: 'Refunds retry once on a failed call.',
        unverified: ['The retry under the payment provider’s rate limit', ''],
      })
      const threadId = yield* (yield* Coordinator).thread(project.projectId)
      const coordinator: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, sessionId: 'none', taskId: null }
      const read = yield* callTool(coordinator, 'read_task', { task: task.slug })
      assert.include(read, 'What it built, as its lead says it now stands:\nRefunds retry once on a failed call.')
      assert.include(read, "What its lead couldn't show working:\n- The retry under the payment provider’s rate limit")
      assert.include(read, 'implement: Retried refunds once.')
    }).pipe(Effect.provide(runtime())),
  )

  it.live('reads a long conversation from its latest part, saying how to read further back', () =>
    Effect.gen(function* () {
      const project = yield* open
      const threadId = yield* (yield* Coordinator).thread(project.projectId)
      for (let at = 0; at < 40; at += 1)
        yield* addItem({ projectId: project.projectId as ProjectId, threadId }, 'agent_message', {
          text: `Note ${at}: ${'the partners still call v1 through the old gateway. '.repeat(20)}`,
        })
      const coordinator: ToolAccess = { role: 'coordinator', projectId: project.projectId, threadId, sessionId: 'none', taskId: null }
      const latest = yield* callTool(coordinator, 'read_thread', {})
      const omitted = Number(
        /^\(The (\d+) earliest items are left out: read_thread with before \1 reads back from there\.\)\n/.exec(latest)?.[1],
      )
      assert.isAbove(omitted, 0)
      assert.include(latest, 'Note 39:')
      assert.notInclude(latest, 'Note 0:')
      const earlier = yield* callTool(coordinator, 'read_thread', { before: omitted })
      assert.include(earlier, 'Note 0:')
      assert.notInclude(earlier, 'Note 39:')
    }).pipe(Effect.provide(runtime())),
  )
})

describe('what the coordinator hears since it last spoke', () => {
  it.live('is a quick task its lead made a change, under the name it had, with no review, and nothing more to say of plans', () =>
    Effect.gen(function* () {
      const coordinator = yield* Coordinator
      const project = yield* open
      const task = yield* quick(project.projectId, 'Sketch the settings')
      // It spoke once the task had started: what came since is its news.
      const threadId = yield* coordinator.thread(project.projectId)
      yield* coordinator.say({
        envelope: yield* Runtime.envelope('thread.send', { body: 'How is it going?' }),
        threadId,
        body: 'How is it going?',
        disposition: 'after_current',
      })
      yield* until(turns(threadId), (rows) => rows.length >= 1 && rows.every((row) => !['pending', 'delivered'].includes(row.state)))
      assert.isNull(yield* coordinatorNews(threadId, project.projectId, yield* modelNamer))
      const lead: ToolAccess = {
        role: 'lead',
        projectId: project.projectId,
        threadId: task.threadId,
        sessionId: 'none',
        taskId: task.taskId,
      }
      assert.match(
        yield* callTool(lead, 'make_it_a_change', { title: 'Sketch the settings', review: null, output: 'draft' }),
        /^The task is a change now, called “Sketch the settings”/,
      )
      assert.strictEqual(
        yield* coordinatorNews(threadId, project.projectId, yield* modelNamer),
        'Since you last spoke, in Althar:\n- sketch-the-settings (Sketch the settings): the person asked its lead to make this quick task a change, and it is one now: no review, and it ends on its branch, with nothing sent to the host.',
      )
    }).pipe(Effect.provide(runtime())),
  )

  it.live('names a step’s model with its effort, and an agent it doesn’t know by its id', () =>
    Effect.gen(function* () {
      const named = yield* modelNamer
      const step = { key: 'review' as const, agentId: 'codex', model: 'large', effort: 'high', skipped: false }
      assert.strictEqual(withEffort(named)(step), 'large (effort high)')
      assert.strictEqual(withEffort(named)({ ...step, effort: null }), 'large')
      assert.strictEqual(named({ ...step, agentId: 'cursor', model: null }), "cursor's default model")
    }).pipe(Effect.provide(runtime())),
  )
})

describe('a coordinator with no agent to start on', () => {
  const none = Layer.succeed(Agents, Agents.of({ list: [], get: (agentId) => Effect.fail(new UnknownAgent({ agentId })) }))

  it.live('suggests none, and says it can’t start when the person writes to it', () =>
    Effect.gen(function* () {
      const coordinator = yield* Coordinator
      const project = yield* open
      const threadId = yield* coordinator.thread(project.projectId)
      assert.isNull(yield* coordinator.suggested(project.projectId))
      const refused = yield* Effect.flip(
        coordinator.say({
          envelope: yield* Runtime.envelope('thread.send', { body: 'Add a retry.' }),
          threadId,
          body: 'Add a retry.',
          disposition: 'after_current',
        }),
      )
      assert.instanceOf(refused, CoordinatorUnavailable)
      assert.deepInclude(refused, { agentId: '', agentName: 'The agent' })
    }).pipe(Effect.provide(runtime(':memory:', {}, { agents: none }))),
  )
})
