import { assert, describe, it } from '@effect/vitest'
import { Effect, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { hosted, items, notices, until } from './support'
import {
  runtimeWith,
  git,
  cards,
  worktreeOf,
  rounds,
  asked,
  titled,
  type Checks,
  PASSED,
  RUNNING,
  FAILED,
  holdsMain,
  holdsFix,
  hostOf,
  moveHostMainOn,
  opened,
  given,
  fixedHere,
} from './conflictsSupport'

describe('a conflict its pull request’s host reports, and the checks on its merge', () => {
  it.live('leaves a fix the lead made to the person when they interrupt it before its turn ends, and pushes nothing', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) && !holdsFix(bare, sha) ? FAILED : PASSED))
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve] [lead:fix-hold]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The checks failed on what Althar pushed to PR #1: test.')
      const merge = git(bare, 'rev-parse', 'althar/add-a-retry')
      yield* fixedHere(taskId)
      yield* (yield* Changes).leadStopped({ threadId }, 'interrupted')
      yield* (yield* Sessions).interrupt(threadId)
      const said = (yield* notices(threadId)).find((notice) => notice.title === 'The lead fixed the checks on the merge.')
      assert.strictEqual(said?.description, 'The lead was stopped, so it waits for you to look at it and push it to PR #1.')
      yield* Effect.sleep('300 millis')
      assert.strictEqual(git(bare, 'rev-parse', 'althar/add-a-retry'), merge)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('waits for the person to push a fix where they said something to the lead meanwhile', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) && !holdsFix(bare, sha) ? FAILED : PASSED))
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve] [lead:fix-hold]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The checks failed on what Althar pushed to PR #1: test.')
      const merge = git(bare, 'rev-parse', 'althar/add-a-retry')
      yield* fixedHere(taskId)
      yield* (yield* Sessions).send({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId,
        body: 'Keep the old name too.',
        disposition: 'interrupt_and_continue',
      })
      yield* titled(threadId, 'The lead fixed the checks on the merge.')
      const said = (yield* notices(threadId)).find((notice) => notice.title === 'The lead fixed the checks on the merge.')
      assert.strictEqual(
        said?.description,
        'The lead was asked something else meanwhile, so the fix waits for you to look at it and push it to PR #1.',
      )
      assert.strictEqual(git(bare, 'rev-parse', 'althar/add-a-retry'), merge)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('gives the checks to the person when the lead commits no fix, after its one more try', () => {
    const { working, bare } = hosted()
    // A check that failed with no log to pass on.
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) ? [{ name: 'test', state: 'failed' }] : PASSED))
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The checks failed on what Althar pushed to PR #1: test.')
      yield* titled(threadId, 'The lead couldn’t fix the checks on the merge.')
      const [round] = yield* rounds(taskId)
      assert.deepStrictEqual([round?.state, round?.attempt], ['failed', 2])
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('has the lead fix the checks that fail on the merge, within the round, and pushes the fix too', () => {
    const { working, bare } = hosted()
    // The merge breaks a check, which the lead's fix mends.
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) && !holdsFix(bare, sha) ? FAILED : PASSED))
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve] [lead:fix]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The checks failed on what Althar pushed to PR #1: test.')
      yield* titled(threadId, 'The lead fixed the checks on the merge, and Althar pushed the fix to PR #1.')
      assert.isTrue(holdsFix(bare, 'althar/add-a-retry'))
      yield* titled(threadId, 'The checks passed on what Althar pushed to PR #1.')
      const [round] = yield* rounds(taskId)
      assert.deepStrictEqual(
        [round?.state, round?.attempt, round?.pushedHead],
        ['resolved', 2, git(bare, 'rev-parse', 'althar/add-a-retry')],
      )
      // Told within the round that Althar pushes the fix, never that the person does.
      const said = yield* given(threadId)
      const fix = said.filter((body) => body.startsWith('Checks failed on the merge Althar pushed to PR #1: test.'))
      assert.strictEqual(fix.length, 1)
      assert.include(fix[0], 'FAIL limit.test.ts')
      assert.include(fix[0], 'commit the fix as one commit on top of the merge, with nothing else: Althar pushes it to PR #1 too.')
      assert.isFalse(said.some((body) => body.includes('the person looks at it and pushes it')))
      yield* until(cards(projectId), (all) => all[0]?.phase === 'ready' && all[0]?.change?.unpushed === 0)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('gives the round to the person when the checks fail on the fix too', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) ? FAILED : PASSED))
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve] [lead:fix]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead fixed the checks on the merge, and Althar pushed the fix to PR #1.')
      yield* until(
        notices(threadId),
        (all) => all.filter((notice) => notice.title === 'The checks failed on what Althar pushed to PR #1: test.').length === 2,
      )
      const [round] = yield* rounds(taskId)
      assert.deepStrictEqual([round?.state, round?.attempt], ['failed', 2])
      const last = (yield* notices(threadId)).at(-1)
      assert.deepStrictEqual(
        [last?.severity, last?.description],
        ['warning', 'The lead had its one more try. It’s yours to settle, or to ask the lead again.'],
      )
      // Asked to fix them once, and not told again, by the round or as failed checks always are.
      yield* Effect.sleep('500 millis')
      const said = yield* given(threadId)
      assert.strictEqual(said.filter((body) => body.startsWith('Checks failed')).length, 1)
      // Needs you.
      yield* until(cards(projectId), (all) => all[0]?.phase === 'ready')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('waits for the person to push a fix the lead committed other work after', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) && !holdsFix(bare, sha) ? FAILED : PASSED))
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve] [lead:fix-more]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to PR #1.')
      const merge = git(bare, 'rev-parse', 'althar/add-a-retry')
      yield* titled(threadId, 'The checks failed on what Althar pushed to PR #1: test.')
      yield* titled(threadId, 'The lead fixed the checks on the merge.')
      const said = (yield* notices(threadId)).find((notice) => notice.title === 'The lead fixed the checks on the merge.')
      assert.include(said?.description, 'commits besides the fix')
      // Neither the fix nor what came after it went up.
      assert.strictEqual(git(bare, 'rev-parse', 'althar/add-a-retry'), merge)
      const [round] = yield* rounds(taskId)
      assert.deepStrictEqual([round?.state, round?.attempt, round?.pushedHead], ['resolved', 2, merge])
      yield* until(cards(projectId), (all) => all[0]?.change?.unpushed === 2)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('leaves the checks to the person once they stop the lead, and doesn’t start it again for them', () => {
    const { working, bare } = hosted()
    let merged: Checks = RUNNING
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) ? merged : PASSED))
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* Sessions
      const { taskId, threadId } = yield* opened(working, '[lead:resolve] [lead:fix]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to PR #1.')
      assert.strictEqual((yield* rounds(taskId))[0]?.state, 'checking')
      // The person stops the lead while the checks run, as the window's Stop does.
      yield* until(
        Effect.map(sessions.running(threadId), (running) => (Option.isSome(running) ? [running.value] : [])),
        (running) => running.length === 1,
      )
      const [{ n: started } = { n: 0 }] = yield* sql<{
        n: number
      }>`SELECT count(*) AS n FROM provider_sessions WHERE thread_id = ${threadId}`
      yield* sessions.stop(threadId)
      yield* (yield* Changes).leadStopped({ threadId })
      yield* titled(threadId, 'You stopped the lead, so the checks on what Althar pushed to PR #1 are yours.')
      assert.strictEqual((yield* rounds(taskId))[0]?.state, 'resolved')
      // The checks fail: the thread says so, and the lead isn't started again to fix them.
      merged = FAILED
      yield* until(items(threadId), (all) =>
        all.some((item) => item.kind === 'arrival' && item.content.kind === 'checks' && item.content.failed === 1),
      )
      yield* Effect.sleep('500 millis')
      assert.isTrue(Option.isNone(yield* sessions.running(threadId)))
      assert.strictEqual(
        (yield* sql<{ n: number }>`SELECT count(*) AS n FROM provider_sessions WHERE thread_id = ${threadId}`)[0]?.n,
        started,
      )
      assert.isFalse((yield* asked(threadId)).some((body) => body.startsWith('Checks failed')))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('gives the round to the person when they stop listening, and a later conflict starts another', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) ? RUNNING : PASSED))
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve]')
      const url = (yield* cards(projectId))[0]?.change?.url ?? ''
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to PR #1.')
      // Its checks never finish, and the person stops listening to it.
      yield* (yield* Changes).stopListening(taskId, url)
      yield* titled(threadId, 'Althar no longer follows the checks on what it pushed to PR #1.')
      assert.deepStrictEqual(
        (yield* rounds(taskId)).map((round) => round.state),
        ['resolved'],
      )
      // Listened to again, as opening its pull request again does, a new conflict is the lead's once more.
      yield* sql`UPDATE external_links SET listening = 1 WHERE task_id = ${taskId}`
      moveHostMainOn(working, bare, 'rate limits, again\n')
      yield* until(rounds(taskId), (all) => all.length === 2)
      yield* until(asked(threadId), (all) => all.length === 2)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('waits for the person to push a merge the lead committed more than a fix on top of', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve-more]')
      const before = git(bare, 'rev-parse', 'althar/add-a-retry')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt.')
      const said = (yield* notices(threadId)).find((notice) => notice.title === 'The lead resolved the conflict with main, in change.txt.')
      assert.include(said?.description, 'commits besides the merge')
      // Neither the merge nor what came after it went up.
      assert.strictEqual(git(bare, 'rev-parse', 'althar/add-a-retry'), before)
      const [round] = yield* rounds(taskId)
      assert.deepStrictEqual([round?.state, round?.pushedHead], ['resolved', null])
      const [waiting] = yield* until(cards(projectId), (all) => all[0]?.change?.unpushed === 4)
      assert.strictEqual(waiting?.change?.localHead, git((yield* worktreeOf(taskId)).path, 'rev-parse', 'HEAD'))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('waits for the person to push the merge where the branch has other commits the pull request doesn’t', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare)
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:fix] [lead:resolve]')
      // The lead fixed a check and committed it, for the person to push.
      github.setChecks(1, FAILED)
      yield* until(cards(projectId), (all) => all[0]?.change?.unpushed === 1)
      const before = git(bare, 'rev-parse', 'althar/add-a-retry')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt.')
      // Neither the merge nor the fix went up: both wait for the person's push.
      assert.strictEqual(git(bare, 'rev-parse', 'althar/add-a-retry'), before)
      const [round] = yield* rounds(taskId)
      assert.deepStrictEqual([round?.state, round?.pushedHead], ['resolved', null])
      const [waiting] = yield* until(cards(projectId), (all) => (all[0]?.change?.unpushed ?? 0) > 1)
      assert.strictEqual(waiting?.change?.localHead, git((yield* worktreeOf(taskId)).path, 'rev-parse', 'HEAD'))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})
