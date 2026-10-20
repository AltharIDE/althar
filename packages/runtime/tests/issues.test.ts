import { makeFakeService } from '@althar/connectors/testing'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections, NotConnected } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { coordinatorNews, modelNamer } from '../src/coordinatorNews'
import { NotAnIssue, NotFound } from '../src/errors'
import { Instance } from '../src/Instance'
import { Issues } from '../src/Issues'
import { Plans } from '../src/Plans'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, items, runtime, until } from './support'

/*
 * Issues (docs/plans/integrations.md): a link to one, pasted to the
 * coordinator, unfurls; the coordinator drafts a task from it, whose branch
 * and pull request carry its key, and whose issue gets a link to the pull
 * request, and moves to In Progress as the task starts. The person's own
 * issues are listed across their trackers.
 */

const linear = () => {
  const service = makeFakeService({ product: 'linear' })
  service.addIssue({ ref: 'MER-231', title: 'Rate-limit refunds like charges', body: 'Refunds skip the limiter.' })
  service.addIssue({ ref: 'MER-232', title: 'Someone else’s', assigned: false })
  return service
}

const connect = (product: 'github' | 'linear' | 'trello', webUrl?: string) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    return yield* connections.connectToken({ product, token: 't', actorId: instance.personId, ...(webUrl === undefined ? {} : { webUrl }) })
  })

const opened = (working: string) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const coordinator = yield* Coordinator
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
    return { projectId: project.projectId as ProjectId, threadId: yield* coordinator.thread(project.projectId) }
  })

const LINK = 'https://linear.app/meridian/issue/MER-231/rate-limit-refunds'

/** The notices in a thread, by their titles. */
const notices = (threadId: string) =>
  Effect.map(items(threadId), (all) => all.flatMap((item) => (item.kind === 'notice' ? [String(item.content.title)] : [])))

/** A task from MER-231, its issue tied to it, and a plan that waits to start. */
const fromIssue = (working: string, description = '[lead:finish]') =>
  Effect.gen(function* () {
    const { projectId } = yield* opened(working)
    const projects = yield* Projects
    const plans = yield* Plans
    const instance = yield* Instance
    const created = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId,
      title: 'Rate-limit refunds',
      description,
      issueKey: 'MER-231',
    })
    yield* (yield* Issues).attach({ projectId, taskId: created.taskId, issue: 'MER-231' })
    const planId = yield* plans.propose({
      projectId,
      taskId: created.taskId,
      steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
      reason: null,
      actorId: instance.personId,
      startsIn: Duration.minutes(5),
      end: 'none',
    })
    return {
      projectId,
      taskId: created.taskId,
      threadId: created.threadId,
      slug: created.slug,
      start: plans.start(planId, instance.personId),
    }
  })

/** What became of moving a task's issue, as the record has it. */
const outcomes = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql<{ type: string; payload: string }>`
      SELECT e.type, e.payload FROM record_events e JOIN external_links x ON x.id = e.aggregate_id
      WHERE x.task_id = ${taskId} AND e.type IN ('external_link.issue_started', 'external_link.issue_start_failed')`
  })

describe('an issue', () => {
  it.live('unfurls where its link was pasted, and a task drafted from it carries its key to the pull request', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    const tracker = linear()
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const linearConnection = yield* connect('linear')
      const { projectId, threadId } = yield* opened(working)
      const coordinator = yield* Coordinator
      const issues = yield* Issues
      const body = `Rate-limit refunds ${LINK} [coordinator:plan] [lead:finish] [lead:edit] [review:pass]`
      const envelope = yield* Runtime.envelope('thread.send', { body })
      yield* coordinator.say({ envelope, threadId, body, disposition: 'after_current' })
      yield* issues.unfurlInput(envelope.commandId)

      const [said] = (yield* items(threadId)).filter((item) => item.kind === 'user_message')
      const links = (said?.content.links ?? []) as ReadonlyArray<Record<string, unknown>>
      assert.deepInclude(links[0], {
        kind: 'issue',
        product: 'linear',
        key: 'MER-231',
        title: 'Rate-limit refunds like charges',
      })

      const queries = yield* Queries
      const cards = Effect.map(queries.coordinator(projectId), (snapshot) =>
        snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : [])),
      )
      const [ready] = yield* until(cards, (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      // With the connection it is read through, which its project's settings say Althar's standing on.
      assert.deepInclude(ready?.issue, { product: 'linear', key: 'MER-231', connectionId: linearConnection.id })
      assert.strictEqual(ready?.branch, 'althar/mer-231-rate-limit-refunds')
      assert.strictEqual(github.changes[0]?.title, 'MER-231: Rate-limit refunds')
      assert.include(github.changes[0]?.body, 'Issue: [MER-231](https://linear.app/fake/issue/MER-231/rate-limit-refunds-like-charges)')
      assert.deepStrictEqual(tracker.linksOn('MER-231'), [
        { url: github.changes[0]?.url ?? '', title: 'PR #1: MER-231: Rate-limit refunds' },
      ])
      const snapshot = yield* queries.thread(ready?.threadId ?? '')
      // It moved to In Progress as its task started, and the card says so.
      assert.deepStrictEqual(snapshot.task.issue?.status, { name: 'In Progress', category: 'started' })
      assert.deepStrictEqual(yield* notices(ready?.threadId ?? ''), ['Moved MER-231 to In Progress'])
      // The coordinator hears of it, and reads it with the task, so it doesn't ask the person to.
      assert.include(
        (yield* coordinatorNews(threadId, projectId, yield* modelNamer)) ?? '',
        'as it started, Althar moved its issue MER-231 to In Progress on Linear. Don’t ask the person to.',
      )
      const access: ToolAccess = { role: 'coordinator', projectId, threadId, sessionId: 'none', taskId: null }
      assert.include(
        yield* callTool(access, 'read_task', { task: ready?.slug ?? '' }),
        'Issue: MER-231, In Progress, https://linear.app/fake/issue/MER-231/rate-limit-refunds-like-charges. Althar moved it to In Progress as the task started: the person needn’t.',
      )
      // Its header has its plan's steps, done with them, and when it started; it hasn't settled.
      assert.deepStrictEqual(
        snapshot.task.steps.map((step) => step.key),
        ['implement', 'review'],
      )
      assert.strictEqual(snapshot.task.step, null)
      assert.strictEqual(snapshot.task.startedAt, ready?.startedAt)
      assert.isNotNull(snapshot.task.startedAt)
      assert.isNull(snapshot.task.settledAt)
      // Its project counts it as ready for the person, and nothing under way.
      const [listed] = (yield* queries.projects).projects
      assert.deepInclude(listed, { working: 0, ready: 1, waiting: 0 })
    }).pipe(
      Effect.provide(
        Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github, linear: tracker }) }))),
      ),
    )
  })

  it.live('moves to In Progress once its task’s first step starts, not as its plan is proposed', () => {
    const { working } = hosted()
    const tracker = linear()
    return Effect.gen(function* () {
      yield* connect('linear')
      const { taskId, threadId, start } = yield* fromIssue(working)
      // Proposed, its plan waits: the issue stays as it was.
      yield* Effect.sleep(Duration.millis(200))
      assert.notInclude(tracker.calls, 'start')
      yield* start
      yield* until(outcomes(taskId), (rows) => rows.length > 0, Duration.seconds(20))
      assert.strictEqual((yield* tracker.issue('MER-231')).status.category, 'started')
      assert.deepStrictEqual(yield* notices(threadId), ['Moved MER-231 to In Progress'])
      // Started again, as by a later plan, it is left to the person.
      yield* (yield* Issues).started(taskId)
      yield* Effect.sleep(Duration.millis(200))
      assert.lengthOf(
        tracker.calls.filter((call) => call === 'start'),
        1,
      )
      assert.lengthOf(yield* outcomes(taskId), 1)
    }).pipe(Effect.provide(runtime(':memory:', {}, { connectors: fakeConnectors({ linear: tracker }) })))
  })

  it.live('says in a line when it can’t be moved, and the task goes on', () => {
    const { working } = hosted()
    const tracker = linear()
    tracker.failNext('start', 'forbidden')
    return Effect.gen(function* () {
      yield* connect('linear')
      const { projectId, taskId, threadId, slug, start } = yield* fromIssue(working)
      yield* start
      const [failed] = yield* until(outcomes(taskId), (rows) => rows.length > 0, Duration.seconds(20))
      assert.strictEqual(failed?.type, 'external_link.issue_start_failed')
      assert.deepStrictEqual(yield* notices(threadId), ['Couldn’t move MER-231 to In Progress: The fake start failed (forbidden)'])
      const access: ToolAccess = { role: 'coordinator', projectId, threadId: '', sessionId: 'none', taskId: null }
      assert.include(
        yield* callTool(access, 'read_task', { task: slug }),
        'Althar couldn’t move it to In Progress as the task started: The fake start failed (forbidden).',
      )
      assert.strictEqual((yield* tracker.issue('MER-231')).status.category, 'todo')
      // Its step finishes as it would have: nothing waits on the issue.
      const results = Effect.map(items(threadId), (all) => all.filter((item) => item.kind === 'step_result'))
      yield* until(results, (rows) => rows.length > 0, Duration.seconds(20))
    }).pipe(Effect.provide(runtime(':memory:', {}, { connectors: fakeConnectors({ linear: tracker }) })))
  })

  it.live('is left as it is, without a word, once someone has started it or finished it', () => {
    const { working } = hosted()
    const tracker = makeFakeService({ product: 'linear' })
    tracker.addIssue({ ref: 'MER-231', title: 'Rate-limit refunds like charges', status: { name: 'In Review', category: 'started' } })
    return Effect.gen(function* () {
      yield* connect('linear')
      const { taskId, threadId } = yield* fromIssue(working)
      yield* (yield* Issues).started(taskId)
      const [left] = yield* until(outcomes(taskId), (rows) => rows.length > 0)
      assert.deepStrictEqual(JSON.parse(left?.payload ?? '{}'), {
        key: 'MER-231',
        moved: false,
        status: { name: 'In Review', category: 'started' },
      })
      assert.deepStrictEqual(yield* notices(threadId), [])
      assert.strictEqual((yield* tracker.issue('MER-231')).status.name, 'In Review')
    }).pipe(Effect.provide(runtime(':memory:', {}, { connectors: fakeConnectors({ linear: tracker }) })))
  })

  it.live('is left as it is, without a word, on a tracker with no In Progress of its own', () => {
    const { working } = hosted()
    const fake = linear()
    // As GitHub's and GitLab's issues are: open or closed, with nothing in between.
    const tracker = { ...fake, capabilities: { ...fake.capabilities, starts: false } }
    return Effect.gen(function* () {
      yield* connect('linear')
      const { taskId, threadId } = yield* fromIssue(working)
      yield* (yield* Issues).started(taskId)
      yield* Effect.sleep(Duration.millis(300))
      assert.notInclude(fake.calls, 'start')
      assert.lengthOf(yield* outcomes(taskId), 0)
      assert.deepStrictEqual(yield* notices(threadId), [])
    }).pipe(Effect.provide(runtime(':memory:', {}, { connectors: fakeConnectors({ linear: tracker }) })))
  })

  it.live('says it couldn’t be moved once its tracker’s connection is gone, and stays as it was', () => {
    const { working } = hosted()
    const tracker = linear()
    return Effect.gen(function* () {
      const connection = yield* connect('linear')
      const { taskId, threadId } = yield* fromIssue(working)
      yield* (yield* Connections).remove(connection.id, (yield* Instance).personId)
      yield* (yield* Issues).started(taskId)
      const [failed] = yield* until(outcomes(taskId), (rows) => rows.length > 0)
      assert.strictEqual(failed?.type, 'external_link.issue_start_failed')
      const [said] = yield* notices(threadId)
      assert.match(said ?? '', /^Couldn’t move MER-231 to In Progress: /)
      assert.notInclude(tracker.calls, 'start')
      assert.strictEqual((yield* tracker.issue('MER-231')).status.category, 'todo')
    }).pipe(Effect.provide(runtime(':memory:', {}, { connectors: fakeConnectors({ linear: tracker }) })))
  })

  it.live('stays where it is when the project’s rules say not to move issues', () => {
    const { working } = hosted()
    const tracker = linear()
    return Effect.gen(function* () {
      yield* connect('linear')
      const { projectId, taskId, threadId } = yield* fromIssue(working)
      yield* (yield* Policies).set(projectId, { moveIssues: false }, (yield* Instance).personId)
      yield* (yield* Issues).started(taskId)
      yield* Effect.sleep(Duration.millis(300))
      assert.notInclude(tracker.calls, 'start')
      assert.lengthOf(yield* outcomes(taskId), 0)
      assert.deepStrictEqual(yield* notices(threadId), [])
    }).pipe(Effect.provide(runtime(':memory:', {}, { connectors: fakeConnectors({ linear: tracker }) })))
  })

  it.live('is read by its link, its key, or its number in the project’s repository; and someone’s are listed across trackers', () => {
    const { working } = hosted()
    const github = makeFakeService()
    github.addRepository(['meridian', 'api'])
    github.addIssue({ ref: 'meridian/api#12', title: 'Refunds ignore the limit' })
    const tracker = linear()
    const trello = makeFakeService({ product: 'trello' })
    trello.addIssue({ ref: 'dRlAmgAi', title: 'Siri shortcuts', assigned: false })
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      yield* connect('linear')
      yield* connect('trello')
      const { projectId } = yield* opened(working)
      const issues = yield* Issues
      assert.strictEqual((yield* issues.read(LINK)).key, 'MER-231')
      assert.strictEqual((yield* issues.read('mer-231')).title, 'Rate-limit refunds like charges')
      // Each tracker reads its own keys as typed: a Trello card's short link is in its own case.
      assert.strictEqual((yield* issues.read('dRlAmgAi')).product, 'trello')
      assert.instanceOf(yield* Effect.flip(issues.read('DRLAMGAI')), NotFound)
      assert.strictEqual((yield* issues.read('#12', projectId)).title, 'Refunds ignore the limit')
      assert.strictEqual((yield* issues.read('12', projectId)).product, 'github')
      assert.instanceOf(yield* Effect.flip(issues.read('NOPE-1')), NotFound)
      assert.instanceOf(yield* Effect.flip(issues.read('https://linear.app/meridian/project/x')), NotConnected)
      // A tracker not connected is named by its link.
      const unconnected = yield* Effect.flip(issues.read('https://meridian.atlassian.net/browse/PROJ-9'))
      assert.instanceOf(unconnected, NotConnected)
      assert.strictEqual(unconnected.product, 'jira_cloud')
      // A pull request's link, given for an issue, says what it is.
      const change = yield* Effect.flip(issues.read(`${HOST}/meridian/api/pull/12`))
      assert.instanceOf(change, NotAnIssue)
      assert.strictEqual(change.what, 'pull request')
      github.addIssue({ ref: 'meridian/api#13', title: 'Newer' })
      const mine = yield* issues.mine(projectId)
      // Newest change first, whichever tracker it is on (the two fakes' clocks tie on the others).
      assert.strictEqual(mine[0]?.key, '#13')
      assert.sameMembers(
        mine.map((issue) => issue.key),
        ['#13', '#12', 'MER-231'],
      )
      // A tracker that can't answer leaves the others' issues listed.
      tracker.failNext('mine', 'unreachable')
      assert.deepStrictEqual(
        (yield* issues.mine(projectId)).map((issue) => issue.key),
        ['#13', '#12'],
      )
    }).pipe(Effect.provide(runtime(':memory:', {}, { connectors: fakeConnectors({ github, linear: tracker, trello }) })))
  })

  it.live('ties a task to it, once, and the coordinator reads and finds them', () => {
    const { working } = hosted()
    const tracker = linear()
    return Effect.gen(function* () {
      yield* connect('linear')
      const { projectId } = yield* opened(working)
      const projects = yield* Projects
      const issues = yield* Issues
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId,
        title: 'Do it',
        issueKey: 'MER-231',
      })
      assert.strictEqual(created.branch, 'althar/mer-231-do-it')
      yield* issues.attach({ projectId, taskId: created.taskId, issue: 'MER-231' })
      yield* issues.attach({ projectId, taskId: created.taskId, issue: LINK })
      const sql = yield* SqlClient.SqlClient
      const links = yield* sql<{ key: string }>`SELECT key FROM external_links WHERE task_id = ${created.taskId}`
      assert.deepStrictEqual(
        links.map((link) => link.key),
        ['MER-231'],
      )
      assert.strictEqual((yield* issues.ofTask(created.taskId))?.title, 'Rate-limit refunds like charges')
      const other = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId,
        title: 'Other',
        issueKey: '#12',
      })
      assert.strictEqual(other.branch, 'althar/issue-12-other')
      assert.isNull(yield* issues.ofTask(other.taskId))
    }).pipe(Effect.provide(runtime(':memory:', {}, { connectors: fakeConnectors({ linear: tracker }) })))
  })
})
