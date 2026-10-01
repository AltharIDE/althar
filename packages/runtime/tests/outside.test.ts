import { execFileSync } from 'node:child_process'

import { makeFakeService } from '@charrette/connectors/testing'
import type { ProjectId } from '@charrette/domain'
import { assert, describe, it } from '@effect/vitest'
import { Cause, Duration, Effect, Exit, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Connections, credentialFor, NotConnected } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { NoChangeToOpen, NotFound } from '../src/errors'
import { Instance } from '../src/Instance'
import { Issues } from '../src/Issues'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import { Runs } from '../src/Runs'
import * as Runtime from '../src/Runtime'
import { callTool, fakeConnectors, HOST, hosted, items, repository, runtime, until } from './support'

/*
 * The rest of what reaching outside involves: a task from an issue in its
 * own repository (whose pull request mentions it plainly), a tracker that
 * has no links, links that unfurl to pull requests or to nothing, what a
 * card makes of an issue as last seen, what a credential makes of a kept
 * secret, and a task that ends on its branch because its host isn't
 * connected.
 */

const connect = (product: 'github' | 'linear', webUrl?: string) =>
  Effect.gen(function* () {
    const connections = yield* Connections
    const instance = yield* Instance
    return yield* connections.connectToken({ product, token: 't', actorId: instance.personId, ...(webUrl === undefined ? {} : { webUrl }) })
  })

const say = (threadId: string, body: string) =>
  Effect.gen(function* () {
    const coordinator = yield* Coordinator
    const envelope = yield* Runtime.envelope('thread.send', { body })
    yield* coordinator.say({ envelope, threadId, body, disposition: 'after_current' })
    return envelope.commandId
  })

describe('a credential', () => {
  it('is what its kept secret makes, sent as its product sends tokens', () => {
    assert.deepStrictEqual(credentialFor('key', { kind: 'oauth', accessToken: 'a', refreshToken: null, expiresAt: null }), {
      kind: 'bearer',
      token: 'a',
    })
    assert.deepStrictEqual(credentialFor('key', { kind: 'token', token: 'k', user: null }), { kind: 'key', token: 'k' })
    assert.deepStrictEqual(credentialFor('basic', { kind: 'token', token: 't', user: 'you@meridian.dev' }), {
      kind: 'basic',
      user: 'you@meridian.dev',
      token: 't',
    })
    assert.deepStrictEqual(credentialFor('basic', { kind: 'token', token: 't', user: null }), { kind: 'basic', user: '', token: 't' })
  })
})

describe('a task from an issue in its own repository', () => {
  it.live('mentions it plainly in its pull request, which the host links by itself', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    github.addIssue({ ref: 'meridian/api#12', title: 'Refunds ignore the limit' })
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const projects = yield* Projects
      const coordinator = yield* Coordinator
      const queries = yield* Queries
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const threadId = yield* coordinator.thread(project.projectId)
      yield* say(
        threadId,
        `Fix the limit ${HOST}/meridian/api/issues/12 [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]`,
      )
      const cards = Effect.map(queries.coordinator(project.projectId), (snapshot) =>
        snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : [])),
      )
      const [ready] = yield* until(cards, (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      assert.strictEqual(ready?.branch, 'charrette/issue-12-fix-the-limit')
      assert.strictEqual(github.changes[0]?.title, 'Fix the limit')
      assert.include(github.changes[0]?.body, 'Issue: #12')
      assert.deepStrictEqual(github.linksOn('meridian/api#12'), [])
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }) })))))
  })
})

describe('links', () => {
  it.live('unfurl to a pull request as it stands, and to nothing on a host no one connected', () => {
    const { working } = hosted()
    const github = makeFakeService()
    const repository = github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      yield* github.openChange(repository, { title: 'Draft one', body: '', source: 'a', target: 'main', draft: true })
      yield* github.openChange(repository, { title: 'Merged one', body: '', source: 'b', target: 'main', draft: false })
      github.mergeByHand(2)
      const projects = yield* Projects
      const coordinator = yield* Coordinator
      const issues = yield* Issues
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const threadId = yield* coordinator.thread(project.projectId)
      const commandId = yield* say(
        threadId,
        `Compare ${HOST}/meridian/api/pull/1 with ${HOST}/meridian/api/pull/2, ${HOST}/meridian/api/pull/9 and https://example.com/x`,
      )
      yield* issues.unfurlInput(commandId)
      const [said] = (yield* items(threadId)).filter((item) => item.kind === 'user_message')
      const links = said?.content.links as ReadonlyArray<Record<string, unknown>>
      assert.deepStrictEqual(
        links.map((link) => [link.kind, link.key, link.state, link.repository]),
        [
          ['change', 'PR #1', 'draft', 'meridian/api'],
          ['change', 'PR #2', 'merged', 'meridian/api'],
        ],
      )
      // A message with no links, links nothing reaches, or one the runtime never heard, unfurls nothing.
      yield* issues.unfurlInput(yield* say(threadId, 'Nothing linked here.'))
      yield* issues.unfurlInput(yield* say(threadId, 'Only https://example.com/elsewhere here.'))
      yield* issues.unfurlInput('cmd_00000000000000000000000000000000')
      const plain = (yield* items(threadId)).filter((item) => item.kind === 'user_message')[1]
      assert.isUndefined(plain?.content.links)
    }).pipe(Effect.provide(runtime(':memory:', {}, { connectors: fakeConnectors({ github }) })))
  })

  it.live('to an issue in the project’s repository need its host connected', () => {
    const { working } = hosted()
    return Effect.gen(function* () {
      const projects = yield* Projects
      const issues = yield* Issues
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      assert.instanceOf(yield* Effect.flip(issues.read('#12', project.projectId)), NotConnected)
      assert.lengthOf(yield* issues.mine(project.projectId), 0)
    }).pipe(Effect.provide(runtime()))
  })
})

describe('an issue as last seen', () => {
  it.live('makes do on a card with what its snapshot lacks', () => {
    const { working } = hosted()
    return Effect.gen(function* () {
      const projects = yield* Projects
      const queries = yield* Queries
      const issues = yield* Issues
      const sql = yield* SqlClient.SqlClient
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const created = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId: project.projectId,
        title: 'x',
      })
      const at = new Date().toISOString()
      const link = (id: string, product: string, snapshot: unknown) =>
        sql`INSERT INTO external_links ${sql.insert({
          id,
          projectId: project.projectId,
          taskId: created.taskId,
          connectionId: null,
          product,
          kind: 'issue',
          externalId: id,
          ref: 'MER-9',
          key: 'MER-9',
          url: 'https://linear.app/m/issue/MER-9',
          snapshot: JSON.stringify(snapshot),
          createdAt: at,
          updatedAt: at,
        })}`
      yield* link(`xlink_${'1'.repeat(32)}`, 'linear', {
        status: { name: 'In Progress', category: 'started' },
        priority: { level: 'high', name: 'High' },
      })
      const shown = (yield* queries.thread(created.threadId)).task.issue
      assert.deepInclude(shown, {
        title: 'MER-9',
        status: { name: 'In Progress', category: 'started' },
        priority: { level: 'high', name: 'High' },
        container: null,
      })
      assert.deepInclude(yield* issues.ofTask(created.taskId), {
        title: 'MER-9',
        status: { name: 'In Progress', category: 'started' },
        container: null,
      })
      yield* sql`UPDATE external_links SET snapshot = '{}'`
      assert.deepInclude((yield* queries.thread(created.threadId)).task.issue, {
        status: { name: 'Todo', category: 'todo' },
        priority: null,
      })
      assert.deepInclude(yield* issues.ofTask(created.taskId), {
        status: { name: 'Todo', category: 'todo' },
        priority: null,
        updatedAt: '',
      })
      yield* sql`UPDATE external_links SET product = 'trello', snapshot = '{"status":{"category":"lost"}}'`
      assert.deepInclude((yield* queries.thread(created.threadId)).task.issue, { status: { name: 'Todo', category: 'todo' } })
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime()))))
  })
})

describe('the issue tool', () => {
  it.live('reads what it is given, and refuses what isn’t an issue', () => {
    const linear = makeFakeService({ product: 'linear' })
    linear.addIssue({ ref: 'MER-231', title: 'Rate-limit refunds' })
    return Effect.gen(function* () {
      yield* connect('linear')
      const projects = yield* Projects
      const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: hosted().working })
      const lead = { role: 'lead' as const, projectId: project.projectId as ProjectId, threadId: 't', sessionId: 's', taskId: 'x' }
      assert.strictEqual(
        yield* callTool(lead, 'read_issue', { issue: 'MER-231' }),
        'MER-231: Rate-limit refunds\n\nTodo, in MER. https://linear.app/fake/issue/MER-231/rate-limit-refunds\n\nNo description.',
      )
      assert.match(yield* callTool(lead, 'read_issue', { issue: 3 }), /can’t read that issue/)
      // The coordinator reads it with its priority.
      const coordinator = {
        role: 'coordinator' as const,
        projectId: project.projectId as ProjectId,
        threadId: 't',
        sessionId: 'c',
        taskId: null,
      }
      assert.strictEqual(
        yield* callTool(coordinator, 'read_issue', { issue: 'MER-231' }),
        'MER-231: Rate-limit refunds\n\nTodo, High priority, in MER. https://linear.app/fake/issue/MER-231/rate-limit-refunds\n\nNo description.',
      )
      const changes = yield* Changes
      assert.isNull(yield* changes.endFor('proj_00000000000000000000000000000000'))
    }).pipe(Effect.provide(runtime(':memory:', {}, { connectors: fakeConnectors({ linear }) })))
  })
})

describe('a project’s host', () => {
  it.live('is where its remote says, connected or not, and nothing for a local one', () => {
    const github = makeFakeService()
    return Effect.gen(function* () {
      const projects = yield* Projects
      const queries = yield* Queries
      const hostOf = (path: string) =>
        Effect.gen(function* () {
          const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
          return (yield* queries.coordinator(project.projectId)).host
        })
      // On github.com, not yet connected: the project says so, and which service it is.
      const onGitHub = hosted().working
      execFileSync('git', ['remote', 'set-url', 'origin', 'git@github.com:meridian/api.git'], { cwd: onGitHub })
      assert.deepStrictEqual(yield* hostOf(onGitHub), { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: false })
      // On an instance the person connected.
      yield* connect('github', HOST)
      assert.deepStrictEqual(yield* hostOf(hosted().working), { product: 'github', name: 'GitHub', webUrl: HOST, connected: true })
      // A repository with no remote, or one on a host no one knows, is on nothing Charrette reaches.
      const local = hosted().working
      execFileSync('git', ['remote', 'remove', 'origin'], { cwd: local })
      assert.isNull(yield* hostOf(local))
      const elsewhere = hosted().working
      execFileSync('git', ['remote', 'set-url', 'origin', 'https://git.example.com/a/b.git'], { cwd: elsewhere })
      assert.isNull(yield* hostOf(elsewhere))
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }) })))))
  })
})

/** A task with a plan that ends on its branch, as one made while its host wasn't connected is; started once `before` is done. */
const onItsBranch = (path: string, before: Effect.Effect<unknown, unknown, Connections | Instance> = Effect.void) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const plans = yield* Plans
    const queries = yield* Queries
    const instance = yield* Instance
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', {}),
      projectId: project.projectId,
      title: 'Retry the checkout [lead:edit] [lead:finish]',
      draft: true,
    })
    const planId = yield* plans.propose({
      projectId: project.projectId as ProjectId,
      taskId: task.taskId,
      steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
      reason: null,
      actorId: instance.personId,
      end: null,
    })
    yield* before
    yield* plans.start(planId, instance.personId)
    const cards = Effect.map(queries.coordinator(project.projectId), (snapshot) =>
      snapshot.items.flatMap((item) => (item.kind === 'task' ? [item.content] : [])),
    )
    yield* until(cards, (all) => all[0]?.phase === 'ready', Duration.seconds(20))
    return {
      task,
      projectId: project.projectId,
      cards,
      said: Effect.map(items(task.threadId), (all) => all.filter((item) => item.kind === 'notice' || item.kind === 'step_result')),
    }
  })

describe('a task that ends on its branch', () => {
  it.live('says why, and opens its pull request when the person connects its host and asks', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const runs = yield* Runs
      execFileSync('git', ['remote', 'set-url', 'origin', 'git@github.com:meridian/api.git'], { cwd: working })
      const { task, projectId, cards, said } = yield* onItsBranch(working)
      const notice = (yield* said).find((item) => item.kind === 'notice')
      assert.deepStrictEqual(notice?.content, {
        source: 'runtime',
        severity: 'info',
        title: "The task ends on its branch: GitHub isn't connected.",
        description: 'Nothing was pushed. Connect GitHub from the project, then open the pull request from here.',
      })
      assert.lengthOf(github.changes, 0)
      assert.instanceOf(yield* Effect.flip(runs.publish(task.taskId)), NotConnected)

      yield* connect('github')
      // Two quick clicks are one action: one pull request, one line in the thread, and the second hears it has one.
      const [first, second] = yield* Effect.all([Effect.exit(runs.publish(task.taskId)), Effect.exit(runs.publish(task.taskId))], {
        concurrency: 2,
      })
      assert.deepStrictEqual(
        [first, second].map((exit) => (Exit.isSuccess(exit) ? 'done' : (Cause.squash(exit.cause) as NoChangeToOpen).why)).sort(),
        ['done', 'opened'],
      )
      assert.lengthOf(github.changes, 1)
      assert.deepStrictEqual([github.changes[0]?.title, github.changes[0]?.draft], ['Retry the checkout [lead:edit] [lead:finish]', true])
      const results = (yield* said).filter((item) => item.kind === 'step_result' && item.content.step === 'publish')
      assert.deepStrictEqual(
        results.map((item) => item.content.summary),
        ['Opened draft pull request #1.'],
      )
      const [card] = yield* until(cards, (all) => all[0]?.change !== null)
      assert.strictEqual(card?.change?.number, 1)
      // Once is enough; and a task whose work isn't done has none to open yet.
      const again = yield* Effect.flip(runs.publish(task.taskId))
      assert.deepStrictEqual([again instanceof NoChangeToOpen, (again as NoChangeToOpen).why], [true, 'opened'])
      const projects = yield* Projects
      const fresh = yield* projects.createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId,
        title: 'Not started',
      })
      assert.strictEqual(((yield* Effect.flip(runs.publish(fresh.taskId))) as NoChangeToOpen).why, 'working')
      // Work that stopped short has none; a settled task keeps its branch as it is.
      const sql = yield* SqlClient.SqlClient
      yield* sql`UPDATE runs SET state = 'failed' WHERE task_id = ${task.taskId}`
      assert.strictEqual(((yield* Effect.flip(runs.publish(task.taskId))) as NoChangeToOpen).why, 'stopped')
      yield* sql`UPDATE tasks SET state = 'done' WHERE id = ${task.taskId}`
      assert.strictEqual(((yield* Effect.flip(runs.publish(task.taskId))) as NoChangeToOpen).why, 'settled')
      assert.instanceOf(yield* Effect.flip(runs.publish('task_none')), NotFound)
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }) })))))
  })

  it.live('opens its pull request after all when its host is connected before the work is done', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const { said } = yield* onItsBranch(working, connect('github', HOST))
      assert.deepStrictEqual(
        (yield* said).map((item) => [item.kind, item.content.summary ?? item.content.title]),
        [
          ['step_result', 'Did the task.'],
          ['step_result', 'Opened draft pull request #1.'],
        ],
      )
      assert.isTrue(github.changes[0]?.draft)
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }) })))))
  })

  it.live('says so where its repository is on no host Charrette knows', () =>
    Effect.gen(function* () {
      const { said } = yield* onItsBranch(repository())
      assert.deepStrictEqual(
        (yield* said).flatMap((item) => (item.kind === 'notice' ? [item.content.description] : [])),
        ["Its repository isn't on a code host Charrette knows, so nothing was pushed."],
      )
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
  )
})
