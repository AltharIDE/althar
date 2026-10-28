import { ConnectorFailed } from '@althar/connectors'
import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { FIX_ROUNDS } from '../src/Changes'
import { Queries } from '../src/Queries'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import { callTool, fakeConnectors, HOST, hosted, items, runtime, until } from './support'

import { refused, runtimeWith, connect, ask, cards, tipOf, git, arrivals } from './changesSupport'

/*
 * A task that ends in a pull request (docs/plans/integrations.md): when its
 * steps are done, Althar commits what the lead left, pushes the branch to
 * the code host (here, a bare repository in its place), and opens a draft
 * pull request on it (here, the fake service); then it listens. What people
 * say arrives in the thread and reaches the lead; failed checks too; a merge
 * settles the task.
 */

describe('a change whose checks Althar sees through', () => {
  /** Checks for each commit, in the order the host first saw them. */
  const byCommit = (
    checksOf: (
      index: number,
    ) => ReadonlyArray<{ readonly name: string; readonly state: 'running' | 'passed' | 'failed'; readonly log?: string }>,
  ) => {
    const seen: Array<string> = []
    return (_: number, sha: string) => {
      if (!seen.includes(sha)) seen.push(sha)
      return checksOf(seen.indexOf(sha))
    }
  }
  const failing = { name: 'test', state: 'failed' as const, log: 'FAIL limit.test.ts' }
  const passing = { name: 'test', state: 'passed' as const }
  const pushRequests = (threadId: string) => Effect.map(items(threadId), (all) => all.filter((item) => item.kind === 'push_request'))
  const notices = (threadId: string) =>
    Effect.map(items(threadId), (all) => all.flatMap((item) => (item.kind === 'notice' ? [String(item.content.title)] : [])))
  const fixesOn = (bare: string) =>
    git(bare, 'ls-tree', '--name-only', 'althar/add-a-retry')
      .split('\n')
      .filter((name) => name.startsWith('fixed-'))

  it.live('is under way while its checks run, and comes to the person once they pass', () => {
    const { working, bare } = hosted()
    let state: 'running' | 'passed' = 'running'
    const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare), checksFor: () => [{ name: 'test', state }] })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const projectId = yield* ask(working, 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]')
      const [running] = yield* until(cards(projectId), (all) => all[0]?.step === 'checks_running', Duration.seconds(20))
      assert.strictEqual(running?.phase, 'running')
      assert.isNotNull(running?.change)
      state = 'passed'
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      assert.isNull(ready?.step)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('brings a change in a repository that has never had checks to the person at once', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare) })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const projectId = yield* ask(working, 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]')
      // A minute for checks to appear, as the app gives: none ever have here, so it isn't kept waiting.
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      assert.isNull(ready?.step)
    }).pipe(
      Effect.provide(
        Queries.layer.pipe(
          Layer.provideMerge(
            runtime(
              ':memory:',
              {},
              { connectors: fakeConnectors({ github }), listenEvery: Duration.millis(100), checksAppear: Duration.minutes(1) },
            ),
          ),
        ),
      ),
    )
  })

  it.live('has its lead fix failing checks alone, and pushes the fix without asking the person', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({
      pushUrl: () => bare,
      headOf: tipOf(bare),
      checksFor: byCommit((index) => (index === 0 ? [failing] : [passing])),
    })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:fix-push]',
      )
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready' && fixesOn(bare).length === 1, Duration.seconds(30))
      // The fix went up without the person: nothing asked of them, and their card comes once the checks pass.
      assert.lengthOf(yield* pushRequests(ready?.threadId ?? ''), 0)
      assert.strictEqual(ready?.change?.unpushed ?? 0, 0)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live(
    'starts its lead again for a failure when its session has ended',
    () => {
      const { working, bare } = hosted()
      let first: 'running' | 'failed' = 'running'
      const github = makeFakeService({
        pushUrl: () => bare,
        headOf: tipOf(bare),
        checksFor: byCommit((index) => (index === 0 ? [{ ...failing, state: first }] : [passing])),
      })
      github.addRepository(['meridian', 'api'])
      return Effect.gen(function* () {
        yield* connect('github', HOST)
        const projectId = yield* ask(
          working,
          'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:fix-push]',
        )
        const [running] = yield* until(cards(projectId), (all) => all[0]?.step === 'checks_running', Duration.seconds(20))
        const sessions = yield* Sessions
        yield* sessions.stop(running?.threadId ?? '')
        first = 'failed'
        yield* until(cards(projectId), (all) => all[0]?.phase === 'ready' && fixesOn(bare).length === 1, Duration.seconds(30))
        const sql = yield* SqlClient.SqlClient
        const started = yield* sql<{ id: string }>`SELECT id FROM provider_sessions WHERE thread_id = ${running?.threadId ?? ''}`
        assert.lengthOf(started, 2)
      }).pipe(Effect.provide(runtimeWith({ github })))
    },
    60_000,
  )

  it.live(
    `gives the change to the person once its checks still fail after ${FIX_ROUNDS} fixes`,
    () => {
      const { working, bare } = hosted()
      const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare), checksFor: byCommit(() => [failing]) })
      github.addRepository(['meridian', 'api'])
      return Effect.gen(function* () {
        yield* connect('github', HOST)
        const projectId = yield* ask(
          working,
          'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:fix-push]',
        )
        const [given] = yield* until(
          cards(projectId),
          (all) => all[0]?.phase === 'ready' && fixesOn(bare).length === FIX_ROUNDS,
          Duration.seconds(100),
        )
        const threadId = given?.threadId ?? ''
        assert.include(
          yield* until(
            notices(threadId),
            (said) => said.some((title) => title.includes('so the change is yours now')),
            Duration.seconds(20),
          ),
          `The checks on PR #1 still fail after ${FIX_ROUNDS} fixes by its lead, so the change is yours now.`,
        )
        // The fix after that is the person's to push.
        yield* until(pushRequests(threadId), (asked) => asked.length === 1, Duration.seconds(20))
        assert.lengthOf(fixesOn(bare), FIX_ROUNDS)
      }).pipe(Effect.provide(runtimeWith({ github })))
    },
    150_000,
  )

  it.live('asks the person to push once they have opened the task', () => {
    const { working, bare } = hosted()
    let first: 'running' | 'failed' = 'running'
    const github = makeFakeService({
      pushUrl: () => bare,
      headOf: tipOf(bare),
      checksFor: byCommit((index) => (index === 0 ? [{ ...failing, state: first }] : [passing])),
    })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:fix-push]',
      )
      const [running] = yield* until(cards(projectId), (all) => all[0]?.step === 'checks_running', Duration.seconds(20))
      // Opened by the person, it is theirs: ready though its checks run, and a fix waits for them to push it.
      yield* (yield* Tasks).see({ taskId: running?.taskId ?? '' })
      yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      first = 'failed'
      yield* until(pushRequests(running?.threadId ?? ''), (asked) => asked.length === 1, Duration.seconds(30))
      assert.lengthOf(fixesOn(bare), 0)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

/*
 * What failed, said in full (ADR-041): a failed check run again once before
 * its lead is told, a check's whole log a page at a time, and the thread
 * saying when Althar can't read the checks, or when they have run too long.
 */
describe('what failed, in full', () => {
  const failing = { name: 'test', state: 'failed' as const, log: 'FAIL limit.test.ts' }
  const passing = { name: 'test', state: 'passed' as const }
  const notices = (threadId: string) =>
    Effect.map(items(threadId), (all) => all.flatMap((item) => (item.kind === 'notice' ? [String(item.content.title)] : [])))
  const fixesOn = (bare: string) =>
    git(bare, 'ls-tree', '--name-only', 'althar/add-a-retry')
      .split('\n')
      .filter((name) => name.startsWith('fixed-'))
  const AGAIN = 'Running test on PR #1 again, once, in case it failed by chance.'

  it.live('runs a failed check again once, and tells its lead only if it fails again, not while the old failure still shows', () => {
    const { working, bare } = hosted()
    const first: Array<string> = []
    let after = 0
    const github: FakeService = makeFakeService({
      pushUrl: () => bare,
      headOf: tipOf(bare),
      checksFor: (_, sha) => {
        if (first.length === 0) first.push(sha)
        if (sha !== first[0]) return [passing]
        if (github.reruns.length === 0) return [failing]
        // Run again: the old failure still shows for a reading, then it runs, then it fails again. The lead's fix passes.
        after += 1
        return after <= 1 ? [failing] : after <= 3 ? [{ ...failing, state: 'running' }] : [failing]
      },
    })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:fix-push]',
      )
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready' && fixesOn(bare).length === 1, Duration.seconds(30))
      assert.lengthOf(github.reruns, 1)
      assert.include(yield* notices(ready?.threadId ?? ''), AGAIN)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('takes a check that passes when run again as passed: its lead isn’t told', () => {
    const { working, bare } = hosted()
    const github: FakeService = makeFakeService({
      pushUrl: () => bare,
      headOf: tipOf(bare),
      checksFor: () => (github.reruns.length === 0 ? [failing] : [passing]),
    })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:fix-push]',
      )
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready' && github.reruns.length === 1, Duration.seconds(30))
      yield* Effect.sleep('500 millis')
      assert.lengthOf(fixesOn(bare), 0)
      assert.include(yield* notices(ready?.threadId ?? ''), AGAIN)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('gives its lead a check’s whole log, a page at a time', () => {
    const { working, bare } = hosted()
    const log = Array.from({ length: 700 }, (_, index) => `line ${index + 1}`).join('\n')
    const github = makeFakeService({
      pushUrl: () => bare,
      headOf: tipOf(bare),
      checksFor: () => [
        { name: 'test', state: 'running', log },
        { name: 'verify', state: 'failed', log: refused },
        {
          name: 'busy',
          state: 'failed',
          log: new ConnectorFailed({ product: 'github', reason: 'unreachable', message: 'The service did not answer in time' }),
        },
        { name: 'ci/circleci', state: 'failed', url: 'https://circleci.com/gh/meridian/api/7' },
      ],
    })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const projectId = yield* ask(working, 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]')
      const [card] = yield* until(cards(projectId), (all) => all[0]?.change != null, Duration.seconds(20))
      const lead = { role: 'lead' as const, projectId, threadId: card?.threadId ?? '', sessionId: 'none', taskId: card?.taskId ?? '' }
      const last = yield* callTool(lead, 'read_check_log', { check: 'test' })
      assert.match(last, /^Lines 401 to 700 of 700 of test's log on PR #1; from_line 101 reads the page before:\n```\nline 401\n/)
      assert.match(last, /line 700\n```$/)
      const firstPage = yield* callTool(lead, 'read_check_log', { check: 'Test', from_line: 1 })
      assert.match(firstPage, /^Lines 1 to 300 of 700 of test's log on PR #1; from_line 301 reads on:\n```\nline 1\n/)
      assert.include(
        yield* callTool(lead, 'read_check_log', { check: 'lint' }),
        'PR #1 has no check called "lint". Its checks: test, verify, busy, ci/circleci.',
      )
      // A log its host won't give says why, in plain words; one it keeps none of, where to see the check instead.
      assert.include(
        yield* callTool(lead, 'read_check_log', { check: 'verify' }),
        "Althar couldn't read verify's log: GitHub refused (403): Resource not accessible by integration. Its sign-in may not be allowed to read logs. Reading it again with read_check_log would fail the same way",
      )
      assert.include(
        yield* callTool(lead, 'read_check_log', { check: 'busy' }),
        "Althar couldn't read busy's log: GitHub didn't answer: The service did not answer in time. read_check_log may read it in a while.",
      )
      assert.strictEqual(
        yield* callTool(lead, 'read_check_log', { check: 'ci/circleci' }),
        "PR #1: Althar couldn't read ci/circleci's log: GitHub keeps no log of it that Althar can read. Its page: https://circleci.com/gh/meridian/api/7",
      )
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('makes a change the person’s when its checks run too long, and says so', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare), checksFor: () => [{ name: 'test', state: 'running' }] })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const projectId = yield* ask(working, 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]')
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(30))
      const said = yield* until(
        notices(ready?.threadId ?? ''),
        (all) => all.some((title) => title.includes('have run for')),
        Duration.seconds(10),
      )
      assert.isTrue(
        said.some((title) => /^The checks on PR #1 have run for (a minute|\d+ minutes), so the change is yours now\.$/.test(title)),
      )
    }).pipe(
      Effect.provide(
        Queries.layer.pipe(
          Layer.provideMerge(
            runtime(
              ':memory:',
              {},
              { connectors: fakeConnectors({ github }), listenEvery: Duration.millis(100), checksStuck: Duration.millis(300) },
            ),
          ),
        ),
      ),
    )
  })

  it.live('says when it can’t read the checks, and hears the rest all the same', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare) })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const projectId = yield* ask(working, 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]')
      const [card] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      github.failNext('checks', 'forbidden')
      github.commentAs(1, 'dana', 'Looks good.')
      const threadId = card?.threadId ?? ''
      yield* until(arrivals(threadId), (all) => all.some((one) => one.kind === 'comment'), Duration.seconds(10))
      assert.isTrue(
        (yield* notices(threadId)).some((title) => title.startsWith("Althar can't read the checks on PR #1: its host refused them")),
      )
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})
