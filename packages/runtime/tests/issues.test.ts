import { makeFakeService } from '@charrette/connectors/testing'
import type { ProjectId } from '@charrette/domain'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections, NotConnected } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { NotFound } from '../src/errors'
import { Instance } from '../src/Instance'
import { Issues } from '../src/Issues'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { fakeConnectors, HOST, hosted, items, runtime, until } from './support'

/*
 * Issues (docs/plans/integrations.md): a link to one, pasted to the
 * coordinator, unfurls; the coordinator drafts a task from it, whose branch
 * and pull request carry its key, and whose issue gets a link to the pull
 * request. The person's own issues are listed across their trackers.
 */

const linear = () => {
  const service = makeFakeService({ product: 'linear' })
  service.addIssue({ ref: 'MER-231', title: 'Rate-limit refunds like charges', body: 'Refunds skip the limiter.' })
  service.addIssue({ ref: 'MER-232', title: 'Someone else’s', assigned: false })
  return service
}

const connect = (product: 'github' | 'linear', webUrl?: string) =>
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

describe('an issue', () => {
  it.live('unfurls where its link was pasted, and a task drafted from it carries its key to the pull request', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    const tracker = linear()
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      yield* connect('linear')
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
      assert.deepInclude(ready?.issue, { product: 'linear', key: 'MER-231' })
      assert.strictEqual(ready?.branch, 'charrette/mer-231-rate-limit-refunds')
      assert.strictEqual(github.changes[0]?.title, 'MER-231: Rate-limit refunds')
      assert.include(github.changes[0]?.body, 'Issue: [MER-231](https://linear.app/fake/issue/MER-231/rate-limit-refunds-like-charges)')
      assert.deepStrictEqual(tracker.linksOn('MER-231'), [
        { url: github.changes[0]?.url ?? '', title: 'PR #1: MER-231: Rate-limit refunds' },
      ])
      const snapshot = yield* queries.thread(ready?.threadId ?? '')
      assert.strictEqual(snapshot.task.issue?.status.category, 'todo')
    }).pipe(
      Effect.provide(
        Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github, linear: tracker }) }))),
      ),
    )
  })

  it.live('is read by its link, its key, or its number in the project’s repository; and someone’s are listed across trackers', () => {
    const { working } = hosted()
    const github = makeFakeService()
    github.addRepository(['meridian', 'api'])
    github.addIssue({ ref: 'meridian/api#12', title: 'Refunds ignore the limit' })
    const tracker = linear()
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      yield* connect('linear')
      const { projectId } = yield* opened(working)
      const issues = yield* Issues
      assert.strictEqual((yield* issues.read(LINK)).key, 'MER-231')
      assert.strictEqual((yield* issues.read('mer-231')).title, 'Rate-limit refunds like charges')
      assert.strictEqual((yield* issues.read('#12', projectId)).title, 'Refunds ignore the limit')
      assert.strictEqual((yield* issues.read('12', projectId)).product, 'github')
      assert.instanceOf(yield* Effect.flip(issues.read('NOPE-1')), NotFound)
      assert.instanceOf(yield* Effect.flip(issues.read('https://linear.app/meridian/project/x')), NotConnected)
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
    }).pipe(Effect.provide(runtime(':memory:', {}, { connectors: fakeConnectors({ github, linear: tracker }) })))
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
      assert.strictEqual(created.branch, 'charrette/mer-231-do-it')
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
      assert.strictEqual(other.branch, 'charrette/issue-12-other')
      assert.isNull(yield* issues.ofTask(other.taskId))
    }).pipe(Effect.provide(runtime(':memory:', {}, { connectors: fakeConnectors({ linear: tracker }) })))
  })
})
