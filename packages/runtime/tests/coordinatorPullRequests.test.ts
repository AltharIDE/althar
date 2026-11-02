import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { ConnectorFailed } from '@althar/connectors'
import type { ProjectId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from '../src/Connections'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, fakeConnectors, HOST, hosted, runtime } from './support'

/*
 * The coordinator acting on the project's pull requests (ADR-081): running
 * checks again, reading the default branch's, marking ready, closing,
 * reopening and replying: on Althar's own, and on others', as each kind
 * allows, and on each host as it can.
 */

const seeded = (service: FakeService) => {
  const { working } = hosted(['meridian', 'api'])
  service.addRepository(['meridian', 'api'])
  return working
}

const withQueries = (github: FakeService) =>
  Queries.layer.pipe(Layer.provideMerge(runtime(':memory:', {}, { connectors: fakeConnectors({ github }) })))

/** A project of the repository, GitHub (or whichever the fake is) connected, and the coordinator's tools. */
const project = (path: string) =>
  Effect.gen(function* () {
    const instance = yield* Instance
    yield* (yield* Connections).connectToken({ product: 'github', token: 't', actorId: instance.personId, webUrl: HOST })
    const projects = yield* Projects
    const opened = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path })
    const task = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', { title: 'Retry checkout' }),
      projectId: opened.projectId,
      title: 'Retry checkout',
    })
    const coordinator: ToolAccess = {
      role: 'coordinator',
      projectId: opened.projectId,
      threadId: yield* (yield* Coordinator).thread(opened.projectId),
      sessionId: 'coordinator-session',
      taskId: null,
    }
    return { projectId: opened.projectId as ProjectId, taskId: task.taskId, coordinator }
  })

/** A pull request Althar opened for the task: its link is the task's. */
const openedFor = (projectId: string, taskId: string, url: string, number: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const at = new Date().toISOString()
    yield* sql`INSERT INTO external_links ${sql.insert({
      id: `xlink_${String(number).repeat(32).slice(0, 32)}`,
      projectId,
      taskId,
      connectionId: null,
      product: 'github',
      kind: 'change',
      externalId: String(number),
      ref: String(number),
      key: String(number),
      url,
      snapshot: JSON.stringify({
        number,
        title: 'Retry checkout',
        url,
        state: 'open',
        draft: false,
        words: { noun: 'pull request', short: 'PR', prefix: '#' },
        repository: ['meridian', 'api'],
      }),
      createdAt: at,
      updatedAt: at,
    })}`
  })

describe('the coordinator marking ready, closing and reopening', () => {
  it.live('does these on Althar’s own pull requests, and refuses one a person opened', () => {
    const github = makeFakeService()
    const working = seeded(github)
    const mine = github.addPullRequest({ path: ['meridian', 'api'], title: 'Retry checkout', author: 'althar', draft: true })
    const theirs = github.addPullRequest({ path: ['meridian', 'api'], title: 'Their fix', author: 'dana', draft: true })
    return Effect.gen(function* () {
      const { projectId, taskId, coordinator } = yield* project(working)
      yield* openedFor(projectId, taskId, mine.url, mine.number)

      assert.include(yield* callTool(coordinator, 'mark_ready', { pull_request: '#1' }), 'PR #1 is ready for review')
      assert.isFalse(github.changes[0]?.draft)
      assert.include(yield* callTool(coordinator, 'mark_ready', { pull_request: '#1' }), 'ready for review already')
      assert.include(yield* callTool(coordinator, 'mark_ready', { pull_request: '#2' }), 'isn’t one Althar opened')
      assert.isTrue(github.changes[1]?.draft)

      assert.include(yield* callTool(coordinator, 'close_pull_request', { pull_request: '#1' }), 'PR #1 is closed')
      assert.strictEqual(github.changes[0]?.state, 'closed')
      assert.include(yield* callTool(coordinator, 'close_pull_request', { pull_request: '#2' }), 'isn’t one Althar opened')
      assert.strictEqual(github.changes[1]?.state, 'open')

      assert.include(
        yield* callTool(coordinator, 'reopen_pull_request', { pull_request: `${HOST}/meridian/api/pull/1` }),
        'PR #1 is open again',
      )
      assert.strictEqual(github.changes[0]?.state, 'open')
      assert.include(yield* callTool(coordinator, 'reopen_pull_request', { pull_request: '#1' }), 'open already')
      assert.include(yield* callTool(coordinator, 'reopen_pull_request', { pull_request: '#2' }), 'isn’t one Althar opened')
      assert.strictEqual(theirs.number, 2)
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('says a merged one cannot be opened again, in the host’s words', () => {
    const github = makeFakeService()
    const working = seeded(github)
    const mine = github.addPullRequest({ path: ['meridian', 'api'], title: 'Retry checkout', author: 'althar' })
    return Effect.gen(function* () {
      const { projectId, taskId, coordinator } = yield* project(working)
      yield* openedFor(projectId, taskId, mine.url, mine.number)
      github.mergeByHand(1)
      assert.include(yield* callTool(coordinator, 'reopen_pull_request', { pull_request: '#1' }), 'is merged, so it can’t be opened again')
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('refuses closing where the host can’t reopen (Bitbucket Cloud), until the person’s word is on main', () => {
    // Connected through the one fake host the harness has, declaring what Bitbucket Cloud's adapter does: no reopening.
    const bitbucket = makeFakeService()
    ;(bitbucket.capabilities as { reopen: boolean }).reopen = false
    const working = seeded(bitbucket)
    const mine = bitbucket.addPullRequest({ path: ['meridian', 'api'], title: 'Retry checkout', author: 'althar' })
    return Effect.gen(function* () {
      const { projectId, taskId, coordinator } = yield* project(working)
      yield* openedFor(projectId, taskId, mine.url, mine.number)
      const closing = yield* callTool(coordinator, 'close_pull_request', { pull_request: '#1' })
      assert.include(closing, 'waits for the person’s word')
      assert.strictEqual(bitbucket.changes[0]?.state, 'open')
      bitbucket.close(1)
      assert.include(yield* callTool(coordinator, 'close_pull_request', { pull_request: '#1' }), 'is closed already')
    }).pipe(Effect.provide(withQueries(bitbucket)))
  })
})

describe('the coordinator replying', () => {
  it.live('replies, signed, on Althar’s own and on a member’s, and leaves an outside author’s to the person', () => {
    const github = makeFakeService()
    const working = seeded(github)
    const mine = github.addPullRequest({ path: ['meridian', 'api'], title: 'Retry checkout', author: 'althar' })
    github.addPullRequest({ path: ['meridian', 'api'], title: 'A teammate’s', author: 'dana', member: true })
    github.addPullRequest({ path: ['meridian', 'api'], title: 'A stranger’s', author: 'passerby', member: false })
    return Effect.gen(function* () {
      const { projectId, taskId, coordinator } = yield* project(working)
      yield* openedFor(projectId, taskId, mine.url, mine.number)
      assert.include(
        yield* callTool(coordinator, 'reply_on_pull_request', { pull_request: '#1', body: 'Fixed in the next push.' }),
        'Replied on PR #1',
      )
      assert.include(github.commentsOn(1)[0]?.body ?? '', 'Fixed in the next push.')
      assert.include(github.commentsOn(1)[0]?.body ?? '', 'From Althar')
      assert.include(yield* callTool(coordinator, 'reply_on_pull_request', { pull_request: '#2', body: 'Thanks!' }), 'Replied on PR #2')
      const stranger = yield* callTool(coordinator, 'reply_on_pull_request', { pull_request: '#3', body: 'Hello' })
      assert.include(stranger, 'waits for the person’s word')
      assert.lengthOf(github.commentsOn(3), 0)
      assert.include(yield* callTool(coordinator, 'reply_on_pull_request', { pull_request: '#1', body: '  ' }), 'Say what to reply')
    }).pipe(Effect.provide(withQueries(github)))
  })
})

describe('the coordinator running checks again', () => {
  it.live('runs a pull request’s failed checks again, names the one it cannot, and reads the default branch’s', () => {
    const github = makeFakeService({
      checksFor: () => [
        { name: 'unit', state: 'failed' },
        { name: 'vercel', state: 'failed', url: 'https://vercel.test/d/1', rerun: false },
        { name: 'lint', state: 'passed' },
      ],
      checksOn: (sha) => (sha === 'main' ? [{ name: 'post-merge', state: 'failed', log: 'Error: timeout in busy.test.ts' }] : undefined),
    })
    const working = seeded(github)
    github.addPullRequest({ path: ['meridian', 'api'], title: 'Their fix', author: 'dana' })
    return Effect.gen(function* () {
      const { coordinator } = yield* project(working)
      const said = yield* callTool(coordinator, 'rerun_check', { pull_request: '#1' })
      assert.include(said, 'Running unit on PR #1 again')
      assert.include(said, "vercel can't be run again here")
      assert.include(said, 'https://vercel.test/d/1')
      assert.lengthOf(github.reruns, 1)
      assert.include(yield* callTool(coordinator, 'rerun_check', { pull_request: '#1', check: 'nope' }), 'has no check called "nope"')
      assert.include(yield* callTool(coordinator, 'rerun_check', { pull_request: '#1', check: 'lint' }), 'Running lint on PR #1 again')

      const base = yield* callTool(coordinator, 'read_default_branch_checks', {})
      assert.include(base, 'main, its latest commit: 0 passed, 1 failed, 0 running')
      assert.include(base, 'timeout in busy.test.ts')
      assert.include(yield* callTool(coordinator, 'rerun_check', {}), 'Running post-merge on main again')
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('says what the host said where it refuses to run a check again (Data Center: whose build it is)', () => {
    const refusal = new ConnectorFailed({
      product: 'bitbucket_dc',
      reason: 'rejected',
      message:
        'build is built by another service (Jenkins, Bamboo or the like), not by Bitbucket Data Center. Its page: https://ci.example.com/job/7',
    })
    const github = makeFakeService({
      checksFor: () => [{ name: 'build', state: 'failed', url: 'https://ci.example.com/job/7', rerun: refusal }],
    })
    const working = seeded(github)
    github.addPullRequest({ path: ['meridian', 'api'], title: 'Their fix', author: 'dana' })
    return Effect.gen(function* () {
      const { coordinator } = yield* project(working)
      const said = yield* callTool(coordinator, 'rerun_check', { pull_request: '#1' })
      assert.include(said, 'would not run build again')
      assert.include(said, 'another service')
      assert.include(said, 'https://ci.example.com/job/7')
      assert.lengthOf(github.reruns, 0)
    }).pipe(Effect.provide(withQueries(github)))
  })
})
