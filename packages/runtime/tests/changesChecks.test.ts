import { budget } from '@althar/testing'
import { ConnectorFailed } from '@althar/connectors'
import { type FakeService, makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes, FIX_ROUNDS } from '../src/Changes'
import { Queries } from '../src/Queries'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import { callTool, fakeConnectors, HOST, hosted, items, runtime, until } from './support'

import { refused, runtimeWith, connect, ask, cards, tipOf, git, arrivals, pushByHand } from './changesSupport'

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
      const [running] = yield* until(cards(projectId), (all) => all[0]?.step === 'checks_running')
      assert.strictEqual(running?.phase, 'running')
      assert.isNotNull(running?.change)
      state = 'passed'
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
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
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
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
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready' && fixesOn(bare).length === 1)
      // The fix went up without the person: nothing asked of them, and their card comes once the checks pass.
      assert.lengthOf(yield* pushRequests(ready?.threadId ?? ''), 0)
      assert.strictEqual(ready?.change?.unpushed ?? 0, 0)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('starts its lead again for a failure when its session has ended', () => {
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
      const [running] = yield* until(cards(projectId), (all) => all[0]?.step === 'checks_running')
      const sessions = yield* Sessions
      yield* sessions.stop(running?.threadId ?? '')
      first = 'failed'
      yield* until(cards(projectId), (all) => all[0]?.phase === 'ready' && fixesOn(bare).length === 1)
      const sql = yield* SqlClient.SqlClient
      const started = yield* sql<{ id: string }>`SELECT id FROM provider_sessions WHERE thread_id = ${running?.threadId ?? ''}`
      assert.lengthOf(started, 2)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

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
        const [given] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready' && fixesOn(bare).length === FIX_ROUNDS)
        const threadId = given?.threadId ?? ''
        assert.include(
          yield* until(notices(threadId), (said) => said.some((title) => title.includes('still fail after'))),
          `The checks on PR #1 still fail after ${FIX_ROUNDS} fixes.`,
        )
        // Its lead says what it tried, and tries no more: the card says why, and nothing is asked of the person to push.
        const [why] = yield* until(cards(projectId), (all) => all[0]?.checksBack != null)
        assert.strictEqual(
          why?.checksBack,
          'Tried three fixes to the retry limit; the test still fails. The test expects a limit the brief doesn’t give.',
        )
        assert.strictEqual(why?.phase, 'ready')
        assert.lengthOf(yield* pushRequests(threadId), 0)
        assert.lengthOf(fixesOn(bare), FIX_ROUNDS)
      }).pipe(Effect.provide(runtimeWith({ github })))
    },
    budget.large,
  )

  it.live('wakes its lead for a failure after the person has opened the task: under way, and its fix pushed without asking', () => {
    const { working, bare } = hosted()
    let first: 'running' | 'failed' = 'running'
    let second: 'running' | 'passed' = 'running'
    const github = makeFakeService({
      pushUrl: () => bare,
      headOf: tipOf(bare),
      checksFor: byCommit((index) => (index === 0 ? [{ ...failing, state: first }] : [{ ...passing, state: second }])),
    })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:fix-push]',
      )
      const [running] = yield* until(cards(projectId), (all) => all[0]?.step === 'checks_running')
      const threadId = running?.threadId ?? ''
      // Opened by the person, it is theirs while its checks run; its lead's session ends.
      yield* (yield* Tasks).see({ taskId: running?.taskId ?? '' })
      yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
      yield* (yield* Sessions).stop(threadId)
      first = 'failed'
      // The failure goes to its lead all the same, started again; its fix goes up, and the card is under way while its checks run.
      const [fixing] = yield* until(
        cards(projectId),
        (all) => all[0]?.phase === 'running' && all[0].step === 'checks_running' && fixesOn(bare).length === 1,
      )
      assert.isNull(fixing?.checksBack ?? null)
      assert.lengthOf(yield* pushRequests(threadId), 0)
      second = 'passed'
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
      assert.isNull(ready?.checksBack ?? null)
      const sql = yield* SqlClient.SqlClient
      const started = yield* sql<{ id: string }>`SELECT id FROM provider_sessions WHERE thread_id = ${threadId}`
      assert.lengthOf(started, 2)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live(
    'asks its lead once to finish when it ends its turn on a failure with nothing done, then brings it to the person with why',
    () => {
      const { working, bare } = hosted()
      const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare), checksFor: () => [failing] })
      github.addRepository(['meridian', 'api'])
      return Effect.gen(function* () {
        yield* connect('github', HOST)
        // A lead that answers the failure, and its ask after, without a fix, a rerun or a line for the person.
        const projectId = yield* ask(working, 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]')
        const [ready] = yield* until(cards(projectId), (all) => all[0]?.checksBack != null)
        assert.strictEqual(ready?.phase, 'ready')
        assert.strictEqual(ready?.checksBack, 'test still fails, and the lead stopped. Tell it what to do.')
        const threadId = ready?.threadId ?? ''
        assert.include(yield* notices(threadId), ready?.checksBack ?? '')
        // Asked once to finish, between.
        const sql = yield* SqlClient.SqlClient
        const asked = yield* sql<{ id: string }>`SELECT id FROM user_inputs WHERE thread_id = ${threadId} AND body LIKE 'Your turn ended%'`
        assert.lengthOf(asked, 1)
        assert.lengthOf(fixesOn(bare), 0)
      }).pipe(Effect.provide(runtimeWith({ github })))
    },
  )

  it.live('starts its lead again once when its agent goes after it is told of a failure, then brings it to the person with why', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({ pushUrl: () => bare, headOf: tipOf(bare), checksFor: () => [failing] })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      // A lead whose agent goes each time it hears of the failure, before it does anything with it.
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:fix-gone]',
      )
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.checksBack != null)
      assert.strictEqual(ready?.phase, 'ready')
      assert.strictEqual(ready?.checksBack, "test still fails, and the lead's agent stopped. Tell it what to do.")
      const threadId = ready?.threadId ?? ''
      // Started again once, between, to be asked to see them through.
      const sql = yield* SqlClient.SqlClient
      const asked = yield* sql<{ id: string }>`SELECT id FROM user_inputs WHERE thread_id = ${threadId} AND body LIKE 'Your agent stopped%'`
      assert.lengthOf(asked, 1)
      const lost = yield* sql<{ id: string }>`SELECT id FROM provider_sessions WHERE thread_id = ${threadId} AND state = 'lost'`
      assert.lengthOf(lost, 2)
      assert.lengthOf(fixesOn(bare), 0)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('leaves a fix to the person to push where the branch had commits not pushed yet when its checks failed', () => {
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
        pushByHand,
      )
      const [running] = yield* until(cards(projectId), (all) => all[0]?.step === 'checks_running')
      const threadId = running?.threadId ?? ''
      // Work committed on the branch while its checks run, not pushed: the person's to push.
      const sql = yield* SqlClient.SqlClient
      const [worktree] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${running?.taskId ?? ''}`
      git(worktree?.path ?? '', '-c', 'user.name=Test', '-c', 'user.email=test@althar.test', 'commit', '-q', '--allow-empty', '-m', 'More')
      first = 'failed'
      // The lead's fix goes to the person with it, rather than up by itself.
      const [asked] = yield* until(pushRequests(threadId), (all) => all.length === 1)
      assert.strictEqual(asked?.content.count, 2)
      assert.lengthOf(fixesOn(bare), 0)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('leaves a fix to the person, saying why, where someone else pushed what failed (ADR-072)', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({
      pushUrl: () => bare,
      headOf: tipOf(bare),
      checksFor: byCommit((index) => (index === 0 ? [{ ...failing, state: 'running' as const }] : index === 1 ? [failing] : [passing])),
    })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:fix-push]',
      )
      const [running] = yield* until(cards(projectId), (all) => all[0]?.step === 'checks_running')
      const threadId = running?.threadId ?? ''
      // The person commits in the task's folder and pushes it themselves, outside Althar; its checks fail, and the lead is told.
      const sql = yield* SqlClient.SqlClient
      const [worktree] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${running?.taskId ?? ''}`
      const path = worktree?.path ?? ''
      git(path, '-c', 'user.name=Test', '-c', 'user.email=test@althar.test', 'commit', '-q', '--allow-empty', '-m', 'Mine')
      git(path, 'push', '-q', bare, 'HEAD:refs/heads/althar/add-a-retry')
      const theirs = git(path, 'rev-parse', 'HEAD')
      // The lead's fix waits for the person rather than going up on top of what they pushed, unseen.
      const [asked] = yield* until(pushRequests(threadId), (all) => all.length === 1)
      assert.strictEqual(asked?.content.count, 1)
      assert.lengthOf(fixesOn(bare), 0)
      assert.strictEqual(git(bare, 'rev-parse', 'althar/add-a-retry'), theirs)
      const [card] = yield* until(cards(projectId), (all) => all[0]?.change?.pushing?.held != null)
      assert.strictEqual(card?.change?.pushing?.held, 'Someone else pushed to PR #1')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('stops counting a failure on a pull request Althar no longer follows', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({
      pushUrl: () => bare,
      headOf: tipOf(bare),
      checksFor: () => [failing],
      checksOn: (sha) => (sha === git(bare, 'rev-parse', 'main') ? [failing] : undefined),
    })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:checks-main]',
      )
      const [handed] = yield* until(cards(projectId), (all) => all[0]?.checksBack != null)
      // Followed no more, as one an attached pull request replaces: its failure, open still as last seen, says nothing of the task.
      yield* (yield* Changes).stopListening(handed?.taskId ?? '', handed?.change?.url ?? '')
      const [after] = yield* until(cards(projectId), (all) => all[0]?.checksBack == null)
      assert.notStrictEqual(after?.phase, 'running')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('waits for the checks on a fix only so long, however often it looks', () => {
    const { working, bare } = hosted()
    // The fix's checks never show.
    const github = makeFakeService({
      pushUrl: () => bare,
      headOf: tipOf(bare),
      checksFor: byCommit((index) => (index === 0 ? [failing] : [])),
    })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:fix-push]',
      )
      yield* until(cards(projectId), (all) => all[0]?.change != null && fixesOn(bare).length === 1)
      // Looked at every 100 ms, it is the person's once the 2 s for checks to show are up.
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
      assert.isNull(ready?.step)
    }).pipe(
      Effect.provide(
        Queries.layer.pipe(
          Layer.provideMerge(
            runtime(
              ':memory:',
              {},
              { connectors: fakeConnectors({ github }), listenEvery: Duration.millis(100), checksAppear: Duration.seconds(2) },
            ),
          ),
        ),
      ),
    )
  })

  it.live('brings a failure that is broken on main to the person with its lead’s line, changing nothing', () => {
    const { working, bare } = hosted()
    const github = makeFakeService({
      pushUrl: () => bare,
      headOf: tipOf(bare),
      checksFor: () => [failing],
      // Main's latest commit fails the same check.
      checksOn: (sha) => (sha === git(bare, 'rev-parse', 'main') ? [failing, { name: 'lint', state: 'passed' }] : undefined),
    })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:checks-main]',
      )
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.checksBack != null)
      assert.strictEqual(ready?.phase, 'ready')
      assert.strictEqual(ready?.checksBack, 'Fails on main too: test fails in limit.test.ts. Fixing it on main brings this one green.')
      const threadId = ready?.threadId ?? ''
      assert.include(yield* notices(threadId), 'Fails on main too: test fails in limit.test.ts')
      assert.lengthOf(fixesOn(bare), 0)
      assert.lengthOf(yield* pushRequests(threadId), 0)
      // What it read of main.
      const lead = { role: 'lead' as const, projectId, threadId, sessionId: 'none', taskId: ready?.taskId ?? '' }
      const main = yield* callTool(lead, 'read_default_branch_checks', {})
      assert.match(
        main,
        /^The checks on main's latest commit, [0-9a-f]{7}: 1 passed, 1 failed, 0 running\.\n\n- test: failed\n- lint: passed\n\nThe end of test's log:/,
      )
      // Its line stands: the same failure isn't the lead's again.
      yield* Effect.sleep('500 millis')
      assert.strictEqual((yield* cards(projectId))[0]?.phase, 'ready')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('leaves a failure to the person once they stop its lead, and wakes it again only for a new one on a new commit', () => {
    const { working, bare } = hosted()
    // The first commit's checks fail, and run again by Althar, run until the test says.
    let first: string | undefined
    let hold = true
    const github: FakeService = makeFakeService({
      pushUrl: () => bare,
      headOf: tipOf(bare),
      checksFor: (_, sha) => {
        first ??= sha
        return sha === first && hold && github.reruns.length > 0 ? [{ ...failing, state: 'running' }] : [failing]
      },
    })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      yield* connect('github', HOST)
      const projectId = yield* ask(working, 'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit]')
      const sql = yield* SqlClient.SqlClient
      // Its checks failed, and run again: under way. The person stops its lead meanwhile.
      const [card] = yield* until(cards(projectId), (all) => all[0]?.step === 'checks_running' && github.reruns.length === 1)
      const threadId = card?.threadId ?? ''
      const taskId = card?.taskId ?? ''
      const changes = yield* Changes
      yield* (yield* Sessions).stop(threadId)
      yield* changes.leadStopped({ threadId })
      const [stopped] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
      assert.isNull(stopped?.checksBack ?? null)
      const sessionsOf = sql<{ id: string }>`SELECT id FROM provider_sessions WHERE thread_id = ${threadId}`
      const before = (yield* sessionsOf).length
      // The same failure, failing again, doesn't start it again: the person has it.
      hold = false
      yield* until(
        sql<{ id: string }>`SELECT id FROM observations WHERE kind = 'checks' AND json_extract(payload, '$.id') LIKE '%:failed:again'`,
        (heard) => heard.length > 0,
      )
      yield* Effect.sleep('500 millis')
      assert.lengthOf(yield* sessionsOf, before)
      assert.strictEqual((yield* cards(projectId))[0]?.phase, 'ready')
      // The person commits and pushes: a new commit, and its failure is the lead's again, started again for it.
      const [worktree] = yield* sql<{ path: string }>`SELECT path FROM workspaces WHERE task_id = ${taskId}`
      const path = worktree?.path ?? ''
      git(path, '-c', 'user.name=Test', '-c', 'user.email=test@althar.test', 'commit', '-q', '--allow-empty', '-m', 'Try again')
      yield* changes.push(taskId, git(path, 'rev-parse', 'HEAD'), card?.change?.url ?? '')
      yield* until(sessionsOf, (now) => now.length > before)
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
  const AGAIN = 'Running a failed check on PR #1 again.'

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
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready' && fixesOn(bare).length === 1)
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
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready' && github.reruns.length === 1)
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
      const [card] = yield* until(cards(projectId), (all) => all[0]?.change != null)
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
      const [ready] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
      const said = yield* until(notices(ready?.threadId ?? ''), (all) => all.some((title) => title.includes('still running after')))
      assert.isTrue(said.some((title) => /^The checks on PR #1 are still running after (a minute|\d+ minutes)\.$/.test(title)))
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
      const [card] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
      github.failNext('checks', 'forbidden')
      github.commentAs(1, 'dana', 'Looks good.')
      const threadId = card?.threadId ?? ''
      yield* until(arrivals(threadId), (all) => all.some((one) => one.kind === 'comment'))
      assert.isTrue((yield* notices(threadId)).some((title) => title === "Can't read the checks on PR #1."))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})
