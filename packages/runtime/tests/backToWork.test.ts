import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes, OFF_FOR_PROJECT, OFF_FOR_TASK } from '../src/Changes'
import { Coordinator } from '../src/Coordinator'
import { Instance } from '../src/Instance'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import type { ToolAccess } from '../src/ToolServer'
import { callTool, hosted, until } from './support'
import {
  asked,
  cards,
  type Checks,
  connect,
  FAILED,
  given,
  holdsFix,
  holdsMain,
  holdsTestsFix,
  hostOf,
  moveHostMainOn,
  opened,
  PASSED,
  RUNNING,
  rounds,
  runtimeWith,
  taskSays,
  titled,
} from './conflictsSupport'

/*
 * A task whose pull request conflicts with the branch it goes into, or whose
 * checks fail, goes back to work on its own: its lead is asked, once for
 * both where both come at once, and its card is under way, not in Needs
 * you. Unless the person turned resolving conflicts off, or stopped the
 * task: then its card says why it waits for them. And a round the lead
 * couldn't see through comes back to the person, with why, rather than
 * going round again.
 */

/** The task's card, as the board has it. */
const cardOf = (projectId: string) => Effect.map(cards(projectId), ([card]) => card)

/** The task stopped, as the person's Stop leaves it: its lead stopped and taken from Althar's hands, its run suspended. */
const stopped = (taskId: string, threadId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* (yield* Sessions).stop(threadId)
    yield* (yield* Changes).leadStopped({ threadId })
    yield* sql`UPDATE runs SET state = 'suspended' WHERE task_id = ${taskId}`
  })

describe('a conflict alone', () => {
  it.live('is the lead’s by default, and the card is under way while the checks on its merge run', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) ? RUNNING : PASSED))
    return Effect.gen(function* () {
      // Nothing set: the project's rules say nothing of conflicts, and the task neither.
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve]')
      assert.isUndefined((yield* (yield* Policies).current(projectId as never)).rules.resolveConflicts)
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and pushed the merge to PR #1.')
      assert.strictEqual((yield* rounds(taskId))[0]?.state, 'checking')
      // Waiting on the merge's checks, it is under way, not the person's to ask anything of.
      const card = yield* until(
        Effect.map(cardOf(projectId), (one) => [one]),
        ([one]) => one?.phase === 'running',
      )
      assert.strictEqual(card[0]?.step, 'checks_running')
      assert.isNull(card[0]?.conflictUnsent ?? null)
      assert.strictEqual((yield* asked(threadId)).length, 1)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('that comes back while the checks on the merge run is a round of its own, asked of the lead at once', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) ? RUNNING : PASSED))
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and pushed the merge to PR #1.')
      assert.strictEqual((yield* rounds(taskId))[0]?.state, 'checking')
      // Main moves on again just after the push, conflicting with the merge, as it did for PR #563.
      moveHostMainOn(working, bare, 'rate limits, again\n')
      const all = yield* until(rounds(taskId), (now) => now.length === 2)
      assert.strictEqual(all[0]?.state, 'resolved')
      yield* until(asked(threadId), (now) => now.length === 2)
      yield* until(rounds(taskId), (now) => now[1]?.state === 'checking')
      // Under way again, never left in Needs you with a button and no word.
      const [card] = yield* until(
        Effect.map(cardOf(projectId), (one) => [one]),
        ([one]) => one?.phase === 'running',
      )
      assert.isNull(card?.conflictUnsent ?? null)
      assert.isNull(card?.handedBack ?? null)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('failed checks alone', () => {
  it.live('are run again once, then go to the lead, whose fix goes up, with no button pressed', () => {
    const { working, bare } = hosted()
    let broken = false
    const github = hostOf(bare, (sha) => (broken && !holdsFix(bare, sha) ? FAILED : PASSED))
    return Effect.gen(function* () {
      const { projectId, threadId } = yield* opened(working, '[lead:fix]')
      broken = true
      // Run again first, as one may have failed by chance; failing again, the lead is told and fixes it.
      yield* until(
        Effect.sync(() => [github.reruns.length]),
        ([n]) => (n ?? 0) >= 1,
      )
      yield* until(given(threadId), (all) => all.some((body) => body.startsWith('Checks failed on PR #1: test.')))
      yield* until(
        Effect.sync(() => [holdsFix(bare, 'althar/add-a-retry')]),
        ([fixed]) => fixed === true,
      )
      yield* until(cardOf(projectId).pipe(Effect.map((one) => [one])), ([one]) => one?.change?.checks?.outcome === 'passed')
      assert.strictEqual((yield* given(threadId)).filter((body) => body.startsWith('Checks failed')).length, 1)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })

  it.live('keep the card under way while the rest still run, some failed already', () => {
    const { working, bare } = hosted()
    let checks: Checks = PASSED
    const github = hostOf(bare, () => checks)
    return Effect.gen(function* () {
      const { projectId } = yield* opened(working, '[lead:fix]')
      checks = [
        { name: 'test', state: 'failed', log: 'FAIL limit.test.ts' },
        { name: 'lint', state: 'running' },
      ]
      // Read with one failed and one running: on its way to the lead, not the person's.
      const [now] = yield* until(
        Effect.map(cardOf(projectId), (one) => [one]),
        ([one]) => one?.change?.checks?.failed === 1 && one.change.checks.running === 1 && one.phase === 'running',
      )
      assert.strictEqual(now?.step, 'checks_running')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('a conflict and failed checks at once', () => {
  it.live('are one ask of the lead, and the merge goes up with its fix for them', () => {
    const { working, bare } = hosted()
    let broken = false
    // The checks fail until the fix the lead makes on top of the merge.
    const github = hostOf(bare, (sha) => (broken && !holdsTestsFix(bare, sha) ? FAILED : PASSED))
    return Effect.gen(function* () {
      const { taskId, threadId } = yield* opened(working, '[lead:resolve-fix]')
      // Both at once, as PR #563 had them: its checks fail, and main moves on, conflicting.
      broken = true
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'PR #1 conflicts with main, in change.txt, and test failed.')
      const asks = yield* until(given(threadId), (all) => all.some((body) => body.includes('Bring the branch up to date')))
      const both = asks.filter((body) => body.includes('Bring the branch up to date'))
      assert.strictEqual(both.length, 1)
      assert.include(both[0], "PR #1's checks failed too: test.")
      assert.include(both[0], 'FAIL limit.test.ts')
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and pushed the merge and its fix to PR #1.')
      yield* titled(threadId, 'The checks passed on PR #1.')
      assert.isTrue(holdsTestsFix(bare, 'althar/add-a-retry'))
      // Never told the checks apart, nor run again while the conflict was the lead's.
      assert.isFalse((yield* given(threadId)).some((body) => body.startsWith('Checks failed')))
      assert.lengthOf(github.reruns, 0)
      assert.deepStrictEqual(
        (yield* rounds(taskId)).map((round) => round.state),
        ['resolved'],
      )
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('a quick task made a change', () => {
  it.live('goes back to work on a conflict as a drafted task does', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* connect
      const project = yield* (yield* Projects).open({ envelope: yield* Runtime.envelope('project.open', {}), path: working })
      const coordinator = yield* (yield* Coordinator).thread(project.projectId)
      const access: ToolAccess = {
        role: 'coordinator',
        projectId: project.projectId,
        threadId: coordinator,
        sessionId: 'none',
        taskId: null,
      }
      // Started as a quick task, as the coordinator's start_task does, then made a change by its lead when the person asks.
      assert.match(
        yield* callTool(access, 'start_task', {
          title: 'Sketch the settings',
          description: 'Sketch it. [lead:commit] [lead:finish] [review:pass] [lead:resolve]',
          lead: { agent: 'claude-code' },
        }),
        /^Started /,
      )
      const [task] = yield* until(cards(project.projectId), (all) => all[0]?.phase === 'ready' && all[0]?.kind === 'plain')
      const threadId = task?.threadId ?? ''
      const taskId = task?.taskId ?? ''
      const body = 'Make it real. [lead:make-change] [lead:finish]'
      yield* (yield* Sessions).send({ envelope: yield* Runtime.envelope('thread.send', { threadId, body }), threadId, body })
      yield* until(cards(project.projectId), (all) => all[0]?.kind === 'change' && all[0]?.change !== null && all[0]?.phase === 'ready')
      // Made a change, it says nothing of conflicts of its own, and its pull request is listened to.
      const [row] = yield* sql<{ resolveConflicts: number | null; listening: number }>`
        SELECT k.resolve_conflicts, l.listening FROM tasks k JOIN external_links l ON l.task_id = k.id AND l.kind = 'change'
        WHERE k.id = ${taskId}`
      assert.deepStrictEqual([row?.resolveConflicts, row?.listening], [null, 1])
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and pushed the merge to PR #1.')
      assert.strictEqual((yield* asked(threadId)).length, 1)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('a task the person stopped', () => {
  it.live('stays stopped through a conflict and failed checks, and its card says why', () => {
    const { working, bare } = hosted()
    let broken = false
    const github = hostOf(bare, () => (broken ? FAILED : PASSED))
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve] [lead:fix]')
      const before = (yield* given(threadId)).length
      yield* stopped(taskId, threadId)
      broken = true
      moveHostMainOn(working, bare)
      const [why] = yield* until(
        Effect.map(cardOf(projectId), (one) => [one?.conflictUnsent ?? null]),
        ([one]) => one !== null,
      )
      assert.strictEqual(why, 'It’s stopped.')
      yield* until(cardOf(projectId).pipe(Effect.map((one) => [one])), ([one]) => one?.change?.checks?.outcome === 'failed')
      yield* Effect.sleep('600 millis')
      // Nothing asked of its lead, nor a round begun.
      assert.deepStrictEqual(yield* rounds(taskId), [])
      assert.strictEqual((yield* given(threadId)).length, before)
      assert.strictEqual((yield* cardOf(projectId))?.phase, 'stopped')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('resolving conflicts turned off', () => {
  it.live('leaves a conflict to the person, the card saying it is off for the project, or for the task', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, () => PASSED)
    return Effect.gen(function* () {
      const { projectId, taskId } = yield* opened(working, '[lead:resolve]', false)
      moveHostMainOn(working, bare)
      const [project] = yield* until(
        Effect.map(cardOf(projectId), (one) => [one?.conflictUnsent ?? null]),
        ([one]) => one !== null,
      )
      assert.strictEqual(project, OFF_FOR_PROJECT)
      // The project's on again, the task's own say off.
      yield* taskSays(taskId, false)
      yield* (yield* Policies).set(projectId as never, { resolveConflicts: true }, (yield* Instance).personId)
      const [task] = yield* until(
        Effect.map(cardOf(projectId), (one) => [one?.conflictUnsent ?? null]),
        ([one]) => one === OFF_FOR_TASK,
      )
      assert.strictEqual(task, OFF_FOR_TASK)
      assert.deepStrictEqual(yield* rounds(taskId), [])
      assert.strictEqual((yield* cardOf(projectId))?.phase, 'ready')
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})

describe('checks that keep failing on the merge', () => {
  it.live('come back to the person with why once the lead’s tries are spent, rather than going round again', () => {
    const { working, bare } = hosted()
    const github = hostOf(bare, (sha) => (holdsMain(bare, sha) ? FAILED : PASSED))
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve] [lead:fix]')
      moveHostMainOn(working, bare)
      yield* until(rounds(taskId), (all) => all[0]?.state === 'failed')
      const [card] = yield* until(
        Effect.map(cardOf(projectId), (one) => [one]),
        ([one]) => one?.phase === 'ready' && one.handedBack != null,
      )
      assert.match(card?.handedBack ?? '', /^The lead couldn’t fix the checks on the merge\. The checks failed on it: test\./)
      // Each failure run again once first, then asked once to fix them; spent, nothing more.
      yield* Effect.sleep('800 millis')
      assert.strictEqual((yield* given(threadId)).filter((body) => body.startsWith('Checks failed')).length, 1)
      assert.lengthOf(yield* rounds(taskId), 1)
      assert.strictEqual(github.reruns.length, 2)
    }).pipe(Effect.provide(runtimeWith({ github })))
  })
})
