import { makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { coordinatorNews, modelNamer } from '../src/coordinatorNews'
import { Instance } from '../src/Instance'
import { IssueDrafts } from '../src/IssueDrafts'
import { Issues } from '../src/Issues'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, repository, runtime, turns, until } from './support'

/*
 * What the coordinator hears of issues and plans since it last spoke, where
 * the loop's own tests don't take it: an issue Althar couldn't move as its
 * task started, one it left as it was, a plan only it changed, and a plan
 * the person changed beside an issue they discarded.
 */

const MERIDIAN = { id: 'team-1', key: 'MER', name: 'Meridian' }

/** Linear, connected, with MER-231 in the state given. */
const tracker = (status?: { readonly name: string; readonly category: 'started' }) => {
  const linear = makeFakeService({ product: 'linear' })
  linear.addContainer(MERIDIAN)
  linear.addIssue({ ref: 'MER-231', title: 'Rate-limit refunds like charges', ...(status === undefined ? {} : { status }) })
  return linear
}

/** A project with Linear connected, a task from MER-231 whose plan waits an hour, and a coordinator that has spoken once since. */
const spoken = Effect.gen(function* () {
  const connections = yield* Connections
  const instance = yield* Instance
  const projects = yield* Projects
  const coordinator = yield* Coordinator
  const plans = yield* Plans
  yield* connections.connectToken({ product: 'linear', token: 't', actorId: instance.personId })
  const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: repository() })
  const projectId = project.projectId as ProjectId
  const task = yield* projects.createTask({
    envelope: yield* Runtime.envelope('task.create', {}),
    projectId,
    title: 'Rate-limit refunds',
    description: '[lead:finish]',
    issueKey: 'MER-231',
    draft: true,
  })
  yield* (yield* Issues).attach({ projectId, taskId: task.taskId, issue: 'MER-231' })
  const planId = yield* plans.propose({
    projectId,
    taskId: task.taskId,
    steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
    reason: null,
    actorId: instance.coordinatorId,
    startsIn: Duration.hours(1),
    end: null,
  })
  const threadId = yield* coordinator.thread(projectId)
  yield* coordinator.say({
    envelope: yield* Runtime.envelope('thread.send', { body: 'How are things?' }),
    threadId,
    body: 'How are things?',
    disposition: 'after_current',
  })
  yield* until(turns(threadId), (rows) => rows.length >= 1 && rows.every((row) => !['pending', 'delivered'].includes(row.state)))
  const news = Effect.flatMap(modelNamer, (named) => coordinatorNews(threadId, projectId, named))
  return { projectId, threadId, task, planId, news, instance }
})

const outcome = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ type: string }>`
      SELECT e.type FROM record_events e JOIN external_links x ON x.id = e.aggregate_id
      WHERE x.task_id = ${taskId} AND e.type IN ('external_link.issue_started', 'external_link.issue_start_failed')`
  })

describe('what the coordinator hears of issues and plans', () => {
  it.live('is an issue Althar couldn’t move to In Progress, and that it is as it was', () => {
    const linear = tracker()
    linear.failNext('start', 'forbidden')
    return Effect.gen(function* () {
      const { task, news } = yield* spoken
      yield* (yield* Issues).started(task.taskId)
      yield* until(outcome(task.taskId), (rows) => rows.length === 1)
      assert.strictEqual(
        yield* news,
        [
          'Since you last spoke, in Althar:',
          `- ${task.slug} (Rate-limit refunds): Althar couldn’t move its issue MER-231 to In Progress on Linear: The fake start failed (forbidden). It is as it was; the person can move it themselves.`,
          'Speak of these issues as they are now.',
        ].join('\n'),
      )
    }).pipe(Effect.provide(runtime(':memory:', {}, { connectors: fakeConnectors({ linear }) })))
  })

  it.live('is nothing of an issue someone had started already, nor of a plan only it changed', () => {
    const linear = tracker({ name: 'In Review', category: 'started' })
    return Effect.gen(function* () {
      const plans = yield* Plans
      const { task, planId, news, instance } = yield* spoken
      yield* (yield* Issues).started(task.taskId)
      yield* until(outcome(task.taskId), (rows) => rows.length === 1)
      assert.isNull(yield* news)
      // Changed by the coordinator itself, still counting down: nothing it doesn't know.
      yield* plans.change(planId, [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }], instance.coordinatorId)
      assert.isNull(yield* news)
    }).pipe(Effect.provide(runtime(':memory:', {}, { connectors: fakeConnectors({ linear }) })))
  })

  it.live('is a plan the person held beside an issue they discarded, and to speak of both as they are now', () => {
    const linear = tracker()
    return Effect.gen(function* () {
      const plans = yield* Plans
      const drafts = yield* IssueDrafts
      const sql = yield* SqlClient.SqlClient
      const { projectId, threadId, task, planId, news, instance } = yield* spoken
      const access: ToolAccess = { role: 'coordinator', projectId, threadId, sessionId: 'coordinator-session', taskId: null }
      yield* callTool(access, 'draft_issue', { title: 'Retry webhooks' })
      const [draft] = yield* sql<{ id: string }>`SELECT id FROM issue_drafts WHERE title = 'Retry webhooks'`
      yield* drafts.discard(draft?.id ?? '', instance.personId)
      yield* plans.hold(planId, instance.personId)
      assert.strictEqual(
        yield* news,
        [
          'Since you last spoke, in Althar:',
          `- ${task.slug} (Rate-limit refunds): The person is holding it: it waits until they start it.`,
          '- The person discarded the issue “Retry webhooks”: nothing was filed.',
          'Speak of these plans and issues as they are now, not as you proposed or drafted them.',
        ].join('\n'),
      )
    }).pipe(Effect.provide(runtime(':memory:', {}, { connectors: fakeConnectors({ linear }) })))
  })
})
