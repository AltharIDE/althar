import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeFakeService } from '@althar/connectors/testing'
import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from '../src/Changes'
import { Instance } from '../src/Instance'
import { Policies } from '../src/Policies'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { Tasks } from '../src/Tasks'
import { hosted, notices, until } from './support'
import {
  runtimeWith,
  git,
  conflictsIn,
  cards,
  worktreeOf,
  rounds,
  asked,
  PUSHED_FOR_IT,
  briefOf,
  titled,
  taskSays,
  type Checks,
  PASSED,
  RUNNING,
  FAILED,
  holdsMain,
  hostOf,
  moveHostMainOn,
  opened,
  given,
  mergedHere,
} from './conflictsSupport'

describe('a conflict its pull request’s host reports', () => {
  it.live('is resolved by the lead, pushed by Althar, and done once its checks pass', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to PR #1.')
      const [note] = yield* asked(threadId)
      assert.include(note, 'merge origin/main into it, which Althar has fetched')
      assert.include(note, "Merge, don't rebase: a branch that was pushed can't be rewritten.")
      assert.include(note, 'Commit the merge as soon as the conflicts are settled and the quick checks pass')
      assert.include(note, "don't end your turn with the merge uncommitted, or while you wait on something running in the background")
      assert.include(note, "Althar pushes the merge and that fix to PR #1. Don't push it yourself.")
      // Its brief says what Althar pushes for it, and that it never pushes itself.
      assert.include(yield* briefOf(threadId), PUSHED_FOR_IT)
      // The pull request has the merge, and conflicts no more.
      assert.strictEqual(git(bare, 'merge-base', '--is-ancestor', 'main', 'althar/add-a-retry'), '')
      assert.isFalse(conflictsIn(bare, 'main', 'althar/add-a-retry'))
      // The checks on it settle the round.
      yield* titled(threadId, 'The checks passed on what Althar pushed to PR #1.')
      const [round] = yield* rounds(taskId)
      assert.deepStrictEqual(
        [round?.state, round?.attempt, round?.pushedHead],
        ['resolved', 1, git(bare, 'rev-parse', 'althar/add-a-retry')],
      )
      // Nothing left to push, and it waits on the person to merge it.
      yield* until(cards(projectId), (all) => all[0]?.phase === 'ready' && all[0]?.change?.unpushed === 0, Duration.seconds(20))
      // Asked once, though the host said so on every look until the merge was pushed.
      assert.strictEqual((yield* asked(threadId)).length, 1)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('leaves it to the person where the task says so, though its project has its leads resolve conflicts', () => {
    const { working, bare } = hosted()
    let heard = 0
    const github = hostOf(
      bare,
      () => PASSED,
      () => void (heard += 1),
    )
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve]')
      const pushed = git(bare, 'rev-parse', 'althar/add-a-retry')
      yield* taskSays(taskId, false)
      moveHostMainOn(working, bare)
      // Heard a few times over that it conflicts, nothing is asked of the lead, and nothing pushed.
      yield* until(
        Effect.sync(() => [heard]),
        ([times]) => (times ?? 0) >= 3,
        Duration.seconds(20),
      )
      assert.deepStrictEqual(yield* rounds(taskId), [])
      assert.deepStrictEqual(yield* asked(threadId), [])
      assert.strictEqual(git(bare, 'rev-parse', 'althar/add-a-retry'), pushed)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('leaves a merge the lead made to the person when they interrupt it before its turn ends, and pushes nothing', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve-hold]')
      const pushed = git(bare, 'rev-parse', 'althar/add-a-retry')
      moveHostMainOn(working, bare)
      yield* mergedHere(taskId)
      // As the window's interrupt does: the round is handed over, then the lead interrupted.
      yield* (yield* Changes).leadStopped({ threadId }, 'interrupted')
      yield* (yield* Sessions).interrupt(threadId)
      const said = (yield* notices(threadId)).find((notice) => notice.title === 'The lead resolved the conflict with main, in change.txt.')
      assert.strictEqual(said?.description, 'The lead was stopped, so it waits for you to look at it and push it to PR #1.')
      assert.strictEqual((yield* rounds(taskId))[0]?.state, 'resolved')
      yield* Effect.sleep('300 millis')
      assert.strictEqual(git(bare, 'rev-parse', 'althar/add-a-retry'), pushed)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('waits for the person to push a merge where they said something to the lead meanwhile', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve-hold]')
      const pushed = git(bare, 'rev-parse', 'althar/add-a-retry')
      moveHostMainOn(working, bare)
      yield* mergedHere(taskId)
      // The person talks to the lead in the middle of it: the round goes on, and what the lead commits may be for that.
      yield* (yield* Sessions).send({
        envelope: yield* Runtime.envelope('thread.send', {}),
        threadId,
        body: 'Keep the old name too.',
        disposition: 'interrupt_and_continue',
      })
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt.')
      const said = (yield* notices(threadId)).find((notice) => notice.title === 'The lead resolved the conflict with main, in change.txt.')
      assert.strictEqual(
        said?.description,
        'The lead was asked something else meanwhile, so the merge waits for you to look at it and push it to PR #1.',
      )
      assert.strictEqual(git(bare, 'rev-parse', 'althar/add-a-retry'), pushed)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('says where it couldn’t push the merge, for the person to push it', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve]')
      moveHostMainOn(working, bare)
      // The host refuses what comes to the task's branch from here on.
      writeFileSync(join(bare, 'hooks', 'pre-receive'), '#!/bin/sh\necho "refused" >&2\nexit 1\n', { mode: 0o755 })
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, but Althar couldn’t push the merge.')
      const said = (yield* notices(threadId)).find((notice) => notice.title?.endsWith('but Althar couldn’t push the merge.') === true)
      // Why, as the task's Push card says it: what the host said, in a sentence, not git's hint.
      assert.match(said?.description ?? '', /^PR #1 refused the push: pre-receive hook declined\. Push it from PR #1’s card\.$/)
      assert.strictEqual((yield* rounds(taskId))[0]?.state, 'resolved')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('asks nothing where the branch here merges cleanly, whatever the host says', () => {
    const { working, bare } = hosted()
    let heard = 0
    const github = makeFakeService({
      pushUrl: () => bare,
      headOf: () => git(bare, 'rev-parse', 'althar/add-a-retry'),
      conflictsOf: () => {
        heard += 1
        return true
      },
      checksFor: () => PASSED,
    })
    github.addRepository(['meridian', 'api'])
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve]')
      yield* until(
        Effect.sync(() => [heard]),
        ([times]) => (times ?? 0) >= 3,
        Duration.seconds(20),
      )
      assert.deepStrictEqual(yield* rounds(taskId), [])
      assert.deepStrictEqual(yield* asked(threadId), [])
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('gives the conflict to the person when they stop listening while the lead resolves it', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve-wait]')
      const url = (yield* cards(projectId))[0]?.change?.url ?? ''
      moveHostMainOn(working, bare)
      yield* until(asked(threadId), (all) => all.length === 1, Duration.seconds(20))
      yield* (yield* Changes).stopListening(taskId, url)
      yield* titled(threadId, 'Althar no longer follows the conflict on PR #1.')
      const [round] = yield* rounds(taskId)
      assert.strictEqual(round?.state, 'failed')
      // Looked at again, a pull request no longer listened to isn't asked about.
      yield* (yield* Changes).resolveNow({ projectId })
      yield* Effect.sleep('300 millis')
      assert.strictEqual((yield* rounds(taskId)).length, 1)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('resolves what a pull request already conflicts on once its project says to', () => {
    const { working, bare } = hosted()
    let heard = 0
    const github = hostOf(
      bare,
      () => PASSED,
      () => void (heard += 1),
    )
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve]', false)
      moveHostMainOn(working, bare)
      yield* until(
        Effect.sync(() => [heard]),
        ([times]) => (times ?? 0) >= 2,
        Duration.seconds(20),
      )
      assert.deepStrictEqual(yield* rounds(taskId), [])
      yield* (yield* Policies).set(projectId, { resolveConflicts: true }, (yield* Instance).personId)
      yield* (yield* Changes).resolveNow({ projectId })
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to PR #1.')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('ends its round once the person merges the pull request while its checks run', () => {
    const { working, bare } = hosted()
    let polled = 0
    const github = hostOf(bare, (sha) => {
      if (holdsMain(bare, sha)) polled += 1
      return holdsMain(bare, sha) ? RUNNING : PASSED
    })
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to PR #1.')
      // Its checks are heard running a while.
      yield* until(
        Effect.sync(() => [polled]),
        ([times]) => (times ?? 0) >= 2,
        Duration.seconds(20),
      )
      assert.strictEqual((yield* rounds(taskId))[0]?.state, 'checking')
      const url = (yield* cards(projectId))[0]?.change?.url ?? ''
      yield* (yield* Changes).merge(taskId, git(bare, 'rev-parse', 'althar/add-a-retry'), url)
      yield* until(rounds(taskId), (all) => all[0]?.state === 'resolved', Duration.seconds(20))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('ends its round once the pull request moves on past what Althar pushed', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) ? RUNNING : PASSED))
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to PR #1.')
      // Someone else pushes to its branch.
      git(working, 'fetch', '-q', bare, 'althar/add-a-retry')
      git(working, 'checkout', '-q', 'FETCH_HEAD')
      git(working, 'commit', '-q', '--allow-empty', '-m', 'From elsewhere')
      git(working, 'push', '-q', bare, 'HEAD:althar/add-a-retry')
      git(working, 'checkout', '-q', 'main')
      yield* until(rounds(taskId), (all) => all[0]?.state === 'resolved', Duration.seconds(20))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('leaves checks that fail after the lead committed more as failed checks always are', () => {
    const { working, bare } = hosted()
    let merged: Checks = RUNNING
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) ? merged : PASSED))
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to PR #1.')
      // More is committed on the branch here, then the checks fail.
      git((yield* worktreeOf(taskId)).path, 'commit', '-q', '--allow-empty', '-m', 'More')
      merged = FAILED
      yield* until(rounds(taskId), (all) => all[0]?.state === 'resolved', Duration.seconds(20))
      // The lead hears them as it always does, not as the round's to fix.
      yield* until(given(threadId), (all) => all.some((body) => body.startsWith('Checks failed')), Duration.seconds(20))
      assert.isFalse((yield* given(threadId)).some((body) => body.includes('commit the fix as one commit on top of the merge')))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('doesn’t ask the lead to fix checks that fail once the task is abandoned', () => {
    const { working, bare } = hosted()
    let merged: Checks = RUNNING
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) ? merged : PASSED))
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to PR #1.')
      yield* (yield* Tasks).abandon({ envelope: yield* Runtime.envelope('task.abandon', { taskId }), taskId })
      merged = FAILED
      yield* until(rounds(taskId), (all) => all[0]?.state === 'resolved', Duration.seconds(20))
      assert.isFalse((yield* given(threadId)).some((body) => body.includes('commit the fix as one commit on top of the merge')))
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('takes it as ready once no checks have come for a while', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => [])
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { taskId, threadId } = yield* opened(working, '[lead:resolve]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to PR #1.')
      // None yet, so far: it waits.
      yield* Effect.sleep('400 millis')
      assert.strictEqual((yield* rounds(taskId))[0]?.state, 'checking')
      // As though it had waited a few minutes.
      const before = new Date(Date.now() - 3 * 60_000).toISOString()
      yield* sql`UPDATE conflict_resolutions SET updated_at = ${before} WHERE task_id = ${taskId}`
      yield* titled(threadId, 'No checks ran on what Althar pushed to PR #1.')
      assert.strictEqual((yield* rounds(taskId))[0]?.state, 'resolved')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})
