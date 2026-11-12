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
import { callTool, fakeConnectors, HOST, hosted, runtime, turnsFor } from './support'

/*
 * The coordinator acting on the project's pull requests (ADR-081): running
 * checks again, reading the default branch's, marking ready, closing,
 * reopening and replying: on Althar's own and the person's own at once, on
 * anyone else's on the person's word, and on each host as it can.
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
  it.live('does these on Althar’s own pull requests unasked', () => {
    const github = makeFakeService()
    const working = seeded(github)
    const mine = github.addPullRequest({ path: ['meridian', 'api'], title: 'Retry checkout', author: 'althar', draft: true })
    return Effect.gen(function* () {
      const { projectId, taskId, coordinator } = yield* project(working)
      yield* openedFor(projectId, taskId, mine.url, mine.number)

      assert.include(yield* callTool(coordinator, 'mark_ready', { pull_request: '#1' }), 'PR #1 is ready for review')
      assert.isFalse(github.changes[0]?.draft)
      assert.include(yield* callTool(coordinator, 'mark_ready', { pull_request: '#1' }), 'ready for review already')

      assert.include(yield* callTool(coordinator, 'close_pull_request', { pull_request: '#1' }), 'PR #1 is closed')
      assert.strictEqual(github.changes[0]?.state, 'closed')

      assert.include(
        yield* callTool(coordinator, 'reopen_pull_request', { pull_request: `${HOST}/meridian/api/pull/1` }),
        'PR #1 is open again',
      )
      assert.strictEqual(github.changes[0]?.state, 'open')
      assert.include(yield* callTool(coordinator, 'reopen_pull_request', { pull_request: '#1' }), 'open already')
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('does them unasked on the person’s own pull requests too, which Althar didn’t open', () => {
    const github = makeFakeService()
    const working = seeded(github)
    // The connected account's login is the person's: `you`.
    github.addPullRequest({ path: ['meridian', 'api'], title: 'My old spike', author: 'you', draft: true })
    return Effect.gen(function* () {
      const { coordinator } = yield* project(working)
      assert.include(yield* callTool(coordinator, 'mark_ready', { pull_request: '#1' }), 'PR #1 is ready for review')
      assert.isFalse(github.changes[0]?.draft)
      assert.include(yield* callTool(coordinator, 'close_pull_request', { pull_request: '#1' }), 'PR #1 is closed')
      assert.strictEqual(github.changes[0]?.state, 'closed')
      assert.include(yield* callTool(coordinator, 'reopen_pull_request', { pull_request: '#1' }), 'PR #1 is open again')
      assert.strictEqual(github.changes[0]?.state, 'open')
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('closes, reopens and marks ready anyone’s on the person’s message in the turn, and only on it', () => {
    const github = makeFakeService()
    const working = seeded(github)
    github.addPullRequest({ path: ['meridian', 'api'], title: 'Their fix', author: 'dana', draft: true })
    return Effect.gen(function* () {
      const { coordinator: bare } = yield* project(working)
      const { access: coordinator, turn } = yield* turnsFor(bare)

      // Unasked, it says it goes on their word and what to name, and nothing changes.
      for (const tool of ['mark_ready', 'close_pull_request'] as const) {
        const said = yield* callTool(coordinator, tool, { pull_request: '#1' })
        assert.include(said, 'PR #1 is dana’s, so it goes on the person’s word')
        assert.include(said, 'message, from read_turn')
      }
      assert.isTrue(github.changes[0]?.draft)
      assert.strictEqual(github.changes[0]?.state, 'open')

      // News's message is no word of theirs.
      const news = yield* turn('PR #1 looks stale.', 'news')
      assert.include(
        yield* callTool(coordinator, 'close_pull_request', { pull_request: '#1', message: news }),
        "This needs the person's message in this turn",
      )
      assert.strictEqual(github.changes[0]?.state, 'open')

      // Their own message in this turn: done at once.
      const asked = yield* turn('Close my stale PR #1, then open it again and mark it ready.')
      assert.include(yield* callTool(coordinator, 'close_pull_request', { pull_request: '#1', message: asked }), 'PR #1 is closed')
      assert.strictEqual(github.changes[0]?.state, 'closed')
      assert.include(yield* callTool(coordinator, 'reopen_pull_request', { pull_request: '#1', message: asked }), 'PR #1 is open again')
      assert.strictEqual(github.changes[0]?.state, 'open')
      assert.include(yield* callTool(coordinator, 'mark_ready', { pull_request: '#1', message: asked }), 'PR #1 is ready for review')
      assert.isFalse(github.changes[0]?.draft)

      // A message from an earlier turn no longer stands.
      yield* turn('Thanks.')
      assert.include(
        yield* callTool(coordinator, 'close_pull_request', { pull_request: '#1', message: asked }),
        "This needs the person's message in this turn",
      )
      assert.strictEqual(github.changes[0]?.state, 'open')
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

  it.live('declines where the host can’t reopen (Bitbucket Cloud) only on the person’s word, even Althar’s own', () => {
    // Connected through the one fake host the harness has, declaring what Bitbucket Cloud's adapter does: no reopening.
    const bitbucket = makeFakeService()
    ;(bitbucket.capabilities as { reopen: boolean }).reopen = false
    const working = seeded(bitbucket)
    const mine = bitbucket.addPullRequest({ path: ['meridian', 'api'], title: 'Retry checkout', author: 'althar' })
    return Effect.gen(function* () {
      const { projectId, taskId, coordinator: bare } = yield* project(working)
      const { access: coordinator, turn } = yield* turnsFor(bare)
      yield* openedFor(projectId, taskId, mine.url, mine.number)
      const closing = yield* callTool(coordinator, 'close_pull_request', { pull_request: '#1' })
      assert.include(closing, 'is final, so it goes on the person’s word')
      assert.strictEqual(bitbucket.changes[0]?.state, 'open')
      const asked = yield* turn('Decline #1.')
      assert.include(yield* callTool(coordinator, 'close_pull_request', { pull_request: '#1', message: asked }), 'PR #1 is closed')
      assert.strictEqual(bitbucket.changes[0]?.state, 'closed')
      assert.include(yield* callTool(coordinator, 'close_pull_request', { pull_request: '#1' }), 'is closed already')
    }).pipe(Effect.provide(withQueries(bitbucket)))
  })
})

describe('the coordinator replying', () => {
  it.live('replies, signed, on Althar’s own and on a member’s, and on an outside author’s on the person’s word', () => {
    const github = makeFakeService()
    const working = seeded(github)
    const mine = github.addPullRequest({ path: ['meridian', 'api'], title: 'Retry checkout', author: 'althar' })
    github.addPullRequest({ path: ['meridian', 'api'], title: 'A teammate’s', author: 'dana', member: true })
    github.addPullRequest({ path: ['meridian', 'api'], title: 'A stranger’s', author: 'passerby', member: false })
    return Effect.gen(function* () {
      const { projectId, taskId, coordinator: bare } = yield* project(working)
      const { access: coordinator, turn } = yield* turnsFor(bare)
      yield* openedFor(projectId, taskId, mine.url, mine.number)
      assert.include(
        yield* callTool(coordinator, 'reply_on_pull_request', { pull_request: '#1', body: 'Fixed in the next push.' }),
        'Replied on PR #1',
      )
      assert.include(github.commentsOn(1)[0]?.body ?? '', 'Fixed in the next push.')
      assert.include(github.commentsOn(1)[0]?.body ?? '', 'From Althar')
      assert.include(yield* callTool(coordinator, 'reply_on_pull_request', { pull_request: '#2', body: 'Thanks!' }), 'Replied on PR #2')
      const stranger = yield* callTool(coordinator, 'reply_on_pull_request', { pull_request: '#3', body: 'Hello' })
      assert.include(stranger, 'PR #3 is passerby’s, an outside author’s, so it goes on the person’s word')
      assert.lengthOf(github.commentsOn(3), 0)
      const asked = yield* turn('Tell passerby thanks on #3.')
      assert.include(
        yield* callTool(coordinator, 'reply_on_pull_request', { pull_request: '#3', body: 'Thanks!', message: asked }),
        'Replied on PR #3',
      )
      assert.lengthOf(github.commentsOn(3), 1)
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

  it.live('says so where the project’s repository is on no connected host', () => {
    const github = makeFakeService()
    const working = seeded(github)
    return Effect.gen(function* () {
      const opened = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const coordinator: ToolAccess = {
        role: 'coordinator',
        projectId: opened.projectId,
        threadId: yield* (yield* Coordinator).thread(opened.projectId),
        sessionId: 'coordinator-session',
        taskId: null,
      }
      const unhosted = 'The project’s repository isn’t on a host Althar is connected to. The person connects it in Settings.'
      assert.include(yield* callTool(coordinator, 'rerun_check', {}), unhosted)
      assert.include(yield* callTool(coordinator, 'rerun_check', { pull_request: '#1' }), unhosted)
      assert.include(
        yield* callTool(coordinator, 'rerun_check', { pull_request: 'the last one' }),
        'Give the pull request’s link, or its number',
      )
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('names in each host’s words a check it can’t run again, and Bitbucket Cloud’s pipeline as run again whole', () =>
    Effect.gen(function* () {
      for (const [product, words] of [
        ['gitlab', "only a pipeline's job runs again from Althar, and it isn't one"],
        ['bitbucket_cloud', 'only a Bitbucket pipeline runs again from Althar, and it isn’t one'],
      ] as const) {
        const service = makeFakeService({
          product,
          checksFor: () => [
            { name: 'unit', state: 'failed' },
            { name: 'external', state: 'failed', rerun: false },
          ],
        })
        const working = seeded(service)
        service.addPullRequest({ path: ['meridian', 'api'], title: 'Their fix', author: 'dana' })
        const said = yield* Effect.gen(function* () {
          const { coordinator } = yield* project(working)
          return yield* callTool(coordinator, 'rerun_check', { pull_request: '#1' })
        }).pipe(Effect.provide(withQueries(service)))
        assert.include(said, `external can't be run again here: ${words}. The person runs it again where it ran.`, product)
        if (product === 'bitbucket_cloud') assert.include(said, '(the whole pipeline, on the same commit)')
      }
    }),
  )

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

describe('the coordinator bringing a pull request’s branch up to date', () => {
  it.live('merges the target in for any pull request, and says nothing to do when it is not behind', () => {
    const github = makeFakeService()
    const working = seeded(github)
    github.addPullRequest({ path: ['meridian', 'api'], title: 'A teammate’s', author: 'dana', member: true })
    return Effect.gen(function* () {
      const { coordinator } = yield* project(working)
      assert.include(yield* callTool(coordinator, 'update_branch', { pull_request: '#1' }), 'has all of main already')
      github.fallBehind(1)
      const said = yield* callTool(coordinator, 'update_branch', { pull_request: '#1' })
      assert.include(said, 'is merging main into PR #1')
      assert.lengthOf(github.branchesUpdated, 1)
      assert.include(yield* callTool(coordinator, 'update_branch', { pull_request: '#1' }), 'has all of main already')
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('says which files conflict and settles none', () => {
    const github = makeFakeService()
    const working = seeded(github)
    github.addPullRequest({ path: ['meridian', 'api'], title: 'A teammate’s', author: 'dana', member: true })
    return Effect.gen(function* () {
      const { coordinator } = yield* project(working)
      github.fallBehind(1, ['src/checkout.ts', 'package.json'])
      const said = yield* callTool(coordinator, 'update_branch', { pull_request: '#1' })
      assert.include(said, 'conflicts with main, so nothing was merged')
      assert.include(said, 'src/checkout.ts, package.json')
      assert.lengthOf(github.branchesUpdated, 0)
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('leaves an outside author’s branch the account can’t push to, and offers the person the ask instead of posting it', () => {
    const github = makeFakeService()
    const working = seeded(github)
    const theirs = github.addPullRequest({
      path: ['meridian', 'api'],
      title: 'A stranger’s',
      author: 'passerby',
      member: false,
      fork: ['passerby', 'api'],
    })
    return Effect.gen(function* () {
      const { coordinator } = yield* project(working)
      github.fallBehind(theirs.number)
      const said = yield* callTool(coordinator, 'update_branch', { pull_request: '#1' })
      assert.include(said, "can't push to PR #1's branch")
      assert.include(said, "goes on the person's word")
      // Nothing is posted on their pull request: asking them is a reply, which is the person's to ask for.
      assert.lengthOf(github.commentsOn(1), 0)
      assert.lengthOf(github.branchesUpdated, 0)
      // Where their fork lets the account push, it goes like any other.
      github.allowForkPush(theirs.number)
      assert.include(yield* callTool(coordinator, 'update_branch', { pull_request: '#1' }), 'is merging main into PR #1')
      assert.lengthOf(github.commentsOn(1), 0)
    }).pipe(Effect.provide(withQueries(github)))
  })

  it.live('refuses a closed pull request in the host’s words', () => {
    const github = makeFakeService()
    const working = seeded(github)
    github.addPullRequest({ path: ['meridian', 'api'], title: 'Old', author: 'dana', state: 'closed' })
    return Effect.gen(function* () {
      const { coordinator } = yield* project(working)
      assert.include(yield* callTool(coordinator, 'update_branch', { pull_request: '#1' }), 'is closed, so its branch isn')
    }).pipe(Effect.provide(withQueries(github)))
  })
})
