import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Queries } from '../src/Queries'
import { hosted, notices, until } from './support'
import {
  runtimeWith,
  git,
  conflictsIn,
  cardOf,
  inTurn,
  worktreeOf,
  rounds,
  asked,
  titled,
  PASSED,
  FAILED,
  holdsMain,
  holdsFix,
  hostOf,
  moveHostMainOn,
  opened,
  given,
} from './conflictsSupport'

describe('a conflict its pull request’s host reports, and a lead waiting on its tests', () => {
  it.live('waits for a lead that left the full tests running, then pushes the merge it commits once they end, asking it once', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve-tests]')
      moveHostMainOn(working, bare)
      // Its turn ends with the merge settled and not committed, the tests still running: not yet judged.
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to PR #1.')
      yield* titled(threadId, 'The checks passed on what Althar pushed to PR #1.')
      // Asked once, with no retry used: the merge was committed after its turn, by the lead the tests woke.
      const said = yield* given(threadId)
      assert.strictEqual(said.filter((body) => body.includes('Bring the branch up to date')).length, 1)
      assert.isFalse(said.some((body) => body.includes('Try once more') || body.includes('not committed: commit')))
      assert.isFalse((yield* notices(threadId)).some((notice) => notice.title?.includes('isn’t resolved yet') === true))
      const [round] = yield* rounds(taskId)
      assert.deepStrictEqual([round?.state, round?.attempt], ['resolved', 1])
      assert.strictEqual(round?.pushedHead, git(bare, 'rev-parse', 'althar/add-a-retry'))
      // The merge went up as the lead committed it.
      assert.strictEqual(git(bare, 'merge-base', '--is-ancestor', 'main', 'althar/add-a-retry'), '')
      assert.isFalse(conflictsIn(bare, 'main', 'althar/add-a-retry'))
      assert.strictEqual(git((yield* worktreeOf(taskId)).path, 'status', '--short'), '')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('waits for a lead whose tests Codex reports only after its turn, asking it once', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve-tests-codex]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The checks passed on what Althar pushed to PR #1.')
      // Not judged at the end of its turn: the tests were reported just after, and it was woken by them.
      const said = yield* given(threadId)
      assert.strictEqual(said.filter((body) => body.includes('Bring the branch up to date')).length, 1)
      assert.isFalse(said.some((body) => body.includes('Try once more') || body.includes('not committed: commit')))
      const [round] = yield* rounds(taskId)
      assert.deepStrictEqual([round?.state, round?.attempt], ['resolved', 1])
      assert.isFalse(conflictsIn(bare, 'main', 'althar/add-a-retry'))
    }).pipe(Effect.provide(runtimeWith({ github }, { reports: Duration.seconds(1) })))
  })

  it.live('waits for a lead that is slow to be woken by its tests, longer than it is quiet, asking it once', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve-tests-slow]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The checks passed on what Althar pushed to PR #1.')
      // The tests ended and the lead said nothing for longer than the quiet: still not judged.
      const said = yield* given(threadId)
      assert.strictEqual(said.filter((body) => body.includes('Bring the branch up to date')).length, 1)
      assert.isFalse(said.some((body) => body.includes('Try once more') || body.includes('not committed: commit')))
      const [round] = yield* rounds(taskId)
      assert.deepStrictEqual([round?.state, round?.attempt], ['resolved', 1])
      assert.isFalse(conflictsIn(bare, 'main', 'althar/add-a-retry'))
    }).pipe(Effect.provide(runtimeWith({ github }, { wake: Duration.seconds(10) })))
  })

  it.live('waits for a lead that is slow to be woken, though what its tests printed last came meanwhile, asking it once', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve-tests-output]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The checks passed on what Althar pushed to PR #1.')
      const said = yield* given(threadId)
      assert.isFalse(said.some((body) => body.includes('Try once more') || body.includes('not committed: commit')))
      const [round] = yield* rounds(taskId)
      assert.deepStrictEqual([round?.state, round?.attempt], ['resolved', 1])
    }).pipe(Effect.provide(runtimeWith({ github }, { wake: Duration.seconds(10) })))
  })

  it.live('settles a lead that, once woken, left more tests running outside its turn, when they and its work are done', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve-tests-again]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The checks passed on what Althar pushed to PR #1.')
      const said = yield* given(threadId)
      assert.isFalse(said.some((body) => body.includes('Try once more') || body.includes('not committed: commit')))
      const [round] = yield* rounds(taskId)
      assert.deepStrictEqual([round?.state, round?.attempt], ['resolved', 1])
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('waits for tests that print a local address as they run, then asks the lead nothing', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve-tests-url]')
      moveHostMainOn(working, bare)
      // Its turn over and the tests still running, well past the report window: the round is still open.
      yield* until(
        Effect.map(inTurn(threadId), (turn) => [turn]),
        ([turn]) => turn === false,
      )
      yield* Effect.sleep(Duration.millis(1200))
      const [during] = yield* rounds(taskId)
      assert.deepStrictEqual([during?.state, during?.attempt], ['resolving', 1])
      yield* titled(threadId, 'The checks passed on what Althar pushed to PR #1.')
      const said = yield* given(threadId)
      assert.isFalse(said.some((body) => body.includes('Try once more') || body.includes('not committed: commit')))
      const [round] = yield* rounds(taskId)
      assert.deepStrictEqual([round?.state, round?.attempt], ['resolved', 1])
    }).pipe(Effect.provide(runtimeWith({ github }, { reports: Duration.millis(200) })))
  })

  it.live('pushes the merge with the one fix the lead committed after it, whether it made it at once or once the tests ended', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve-fix]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge and its fix to PR #1.')
      yield* titled(threadId, 'The checks passed on what Althar pushed to PR #1.')
      const [round] = yield* rounds(taskId)
      assert.deepStrictEqual(
        [round?.state, round?.attempt, round?.pushedHead],
        ['resolved', 1, git(bare, 'rev-parse', 'althar/add-a-retry')],
      )
      // Both went up, the fix on top of the merge.
      const tip = git(bare, 'rev-parse', 'althar/add-a-retry')
      assert.strictEqual(git(bare, 'log', '-1', '--format=%s', tip), 'Fix what the tests found')
      assert.strictEqual(git(bare, 'merge-base', '--is-ancestor', 'main', tip), '')
      assert.strictEqual(git((yield* worktreeOf(taskId)).path, 'rev-parse', 'HEAD'), tip)
      assert.strictEqual((yield* given(threadId)).filter((body) => body.includes('Bring the branch up to date')).length, 1)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('waits for the lead the tests woke to commit the merge and a fix for what they found, and pushes both', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve-tests-fix]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge and its fix to PR #1.')
      yield* titled(threadId, 'The checks passed on what Althar pushed to PR #1.')
      const tip = git(bare, 'rev-parse', 'althar/add-a-retry')
      assert.strictEqual(git(bare, 'log', '-1', '--format=%s', tip), 'Fix what the tests found')
      assert.strictEqual(git(bare, 'merge-base', '--is-ancestor', 'main', tip), '')
      const [round] = yield* rounds(taskId)
      assert.deepStrictEqual([round?.state, round?.attempt, round?.pushedHead], ['resolved', 1, tip])
      assert.strictEqual((yield* given(threadId)).filter((body) => body.includes('Bring the branch up to date')).length, 1)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live(
    'judges the branch as it is once a lead has been at work as long as it waits, asks once more to commit, then gives it to the person',
    () => {
      const { working, bare } = hosted()
      const github = hostOf(bare, () => PASSED)
      return Effect.gen(function* () {
        const { taskId, threadId } = yield* opened(working, '[lead:resolve-tests-hang]')
        const before = git(bare, 'rev-parse', 'althar/add-a-retry')
        moveHostMainOn(working, bare)
        yield* titled(threadId, 'The lead couldn’t resolve the conflict with main, in change.txt')
        // Judged as today: the merge isn't committed, so it is asked once more, saying only that, and then it is the person's.
        const said = yield* given(threadId)
        assert.strictEqual(said.filter((body) => body.includes('Bring the branch up to date')).length, 1)
        const again = said.at(-1) ?? ''
        assert.match(again, /^Your merge is resolved but not committed: commit it\. Don't end your turn with the merge uncommitted/)
        assert.notInclude(again, 'Bring the branch up to date')
        assert.deepStrictEqual(
          (yield* rounds(taskId)).map((round) => [round.state, round.attempt]),
          [['failed', 2]],
        )
        const failed = (yield* notices(threadId)).find((notice) => notice.title?.startsWith('The lead couldn’t resolve') === true)
        assert.include(failed?.description, "The merge of origin/main isn't committed.")
        // Nothing was pushed for it.
        assert.strictEqual(git(bare, 'rev-parse', 'althar/add-a-retry'), before)
      }).pipe(Effect.provide(runtimeWith({ github }, { within: Duration.seconds(1) })))
    },
  )

  it.live('asks a lead that settled the merge and forgot to commit it just to commit it, and pushes it once it has', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve-forgets]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to PR #1.')
      yield* titled(threadId, 'The checks passed on what Althar pushed to PR #1.')
      const said = yield* given(threadId)
      const notes = said.filter((body) => body.includes('Bring the branch up to date') || body.includes('resolved but not committed'))
      assert.strictEqual(notes.length, 2)
      assert.match(notes[1] ?? '', /^Your merge is resolved but not committed: commit it\./)
      assert.notInclude(notes[1], 'Try once more')
      assert.notInclude(notes[1], 'settle each conflict')
      // The retry was the one more try: the merge it then committed is what went up.
      const [round] = yield* rounds(taskId)
      assert.deepStrictEqual([round?.state, round?.attempt], ['resolved', 2])
      assert.strictEqual(round?.pushedHead, git(bare, 'rev-parse', 'althar/add-a-retry'))
      assert.strictEqual(git(bare, 'merge-base', '--is-ancestor', 'main', 'althar/add-a-retry'), '')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('shows the card at work while the lead resolves a conflict, between its turns too, and ready again once it is done', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const { projectId, threadId } = yield* opened(working, '[lead:resolve-tests]')
      assert.deepStrictEqual(yield* cardOf(projectId), { phase: 'ready', step: null, handedBack: null })
      moveHostMainOn(working, bare)
      // At work on the conflict: its turn over, the full tests still running, and the card says so, not "ready".
      yield* until(
        Effect.map(Effect.all([cardOf(projectId), inTurn(threadId)]), ([card, turn]) => [{ ...card, turn }]),
        ([seen]) => seen?.phase === 'running' && seen.step === 'conflict' && !seen.turn,
      )
      // Pushed, it waits for the checks on what Althar pushed: ready for the person to accept once they pass.
      yield* titled(threadId, 'The checks passed on what Althar pushed to PR #1.')
      assert.deepStrictEqual(yield* cardOf(projectId), { phase: 'ready', step: null, handedBack: null })
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('shows the card at work while the lead fixes the checks that failed on the merge, between its turns too', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) && !holdsFix(bare, sha) ? FAILED : PASSED))
    return Effect.gen(function* () {
      const { projectId, threadId } = yield* opened(working, '[lead:resolve] [lead:fix-late]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The checks failed on what Althar pushed to PR #1: test.')
      yield* until(
        Effect.map(Effect.all([cardOf(projectId), inTurn(threadId)]), ([card, turn]) => [{ ...card, turn }]),
        ([seen]) => seen?.phase === 'running' && seen.step === 'checks' && !seen.turn,
      )
      yield* titled(threadId, 'The checks passed on what Althar pushed to PR #1.')
      assert.deepStrictEqual(yield* cardOf(projectId), { phase: 'ready', step: null, handedBack: null })
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('puts the card in Needs you with why when the lead couldn’t resolve the conflict, until the branch moves', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve-fails]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead couldn’t resolve the conflict with main, in change.txt')
      const card = yield* cardOf(projectId)
      assert.strictEqual(card.phase, 'ready')
      assert.strictEqual(
        card.handedBack,
        "The lead couldn’t resolve the conflict with main in change.txt. origin/main isn't merged into the branch.",
      )
      // The thread header says so as well, from the same card.
      const queries = yield* Queries
      assert.strictEqual((yield* Effect.orDie(queries.thread(threadId))).task.handedBack, card.handedBack)
      // Once its branch moves it is the person's own again, and the card says nothing of the round.
      git((yield* worktreeOf(taskId)).path, 'commit', '-q', '--allow-empty', '-m', 'Look again')
      assert.deepStrictEqual(yield* cardOf(projectId), { phase: 'ready', step: null, handedBack: null })
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('leaves a stopped task’s lead alone, until its run is done', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { taskId, threadId } = yield* opened(working, '[lead:resolve]')
      // Stopped, as stopping a task mid-step leaves its run: suspended, for the person to resume.
      yield* sql`UPDATE runs SET state = 'suspended' WHERE task_id = ${taskId}`
      moveHostMainOn(working, bare)
      yield* Effect.sleep('1 second')
      assert.deepStrictEqual(yield* rounds(taskId), [])
      assert.deepStrictEqual(yield* asked(threadId), [])
      // Its run done, the same conflict is the lead's.
      yield* sql`UPDATE runs SET state = 'succeeded' WHERE task_id = ${taskId}`
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and Althar pushed the merge to PR #1.')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})
