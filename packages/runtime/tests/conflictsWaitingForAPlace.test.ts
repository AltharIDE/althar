import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect, Layer } from 'effect'

import type { ProjectId } from '@althar/domain'

import { Instance } from '../src/Instance'
import { Plans } from '../src/Plans'
import { Projects } from '../src/Projects'
import { Queries } from '../src/Queries'
import * as Runtime from '../src/Runtime'
import { Tasks } from '../src/Tasks'
import { fakeConnectors, hosted, notices, runtime } from './support'
import {
  type Checks,
  FAILED,
  PASSED,
  RUNNING,
  holdsFix,
  holdsMain,
  hostOf,
  moveHostMainOn,
  opened,
  rounds,
  titled,
} from './conflictsSupport'

/*
 * A round on a pull request whose checks fail on the merge Althar pushed,
 * while every place among the agents at work on this machine is taken: the
 * lead is asked to fix them once one frees, and the fix goes up as ever.
 */

/** One agent at once (2.5 cores and 3 GB, and 4 GB kept), listening often, and a lead done a moment after it goes quiet. */
const oneAtOnce = (github: ReturnType<typeof hostOf>) =>
  Queries.layer.pipe(
    Layer.provideMerge(
      runtime(
        ':memory:',
        {},
        {
          connectors: fakeConnectors({ github }),
          listenEvery: Duration.millis(100),
          idle: { quiet: Duration.millis(300) },
          busy: { machine: { cores: 3, memory: 7 * 1024 ** 3 } },
        },
      ),
    ),
  )

describe('checks that fail on the merge Althar pushed, with no place for the lead', () => {
  it.live('wait for a place, then are fixed by the lead and the fix pushed', () => {
    const { working, bare } = hosted()
    // The merge's checks run until the test says, then fail; the lead's fix passes.
    let failing = false
    const checks = (sha: string): Checks => (holdsMain(bare, sha) ? (holdsFix(bare, sha) ? PASSED : failing ? FAILED : RUNNING) : PASSED)
    const github = hostOf(bare, checks)
    return Effect.gen(function* () {
      const { projectId, taskId, threadId } = yield* opened(working, '[lead:resolve] [lead:fix]')
      moveHostMainOn(working, bare)
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt, and pushed the merge to PR #1.')
      // Another task takes the one place: its lead works on until it is stopped.
      const busy = yield* (yield* Projects).createTask({
        envelope: yield* Runtime.envelope('task.create', {}),
        projectId,
        title: 'Work on',
        description: 'Work on it. [lead:wait]',
        draft: true,
      })
      const plans = yield* Plans
      const actorId = (yield* Instance).personId
      const planId = yield* plans.propose({
        projectId: projectId as ProjectId,
        taskId: busy.taskId,
        steps: [{ key: 'implement', agentId: 'codex', model: null, skipped: false }],
        reason: null,
        actorId,
        end: null,
        held: true,
      })
      assert.strictEqual(yield* plans.start(planId, actorId), 'running')
      failing = true
      yield* titled(threadId, 'test failed on PR #1.')
      const said = (yield* notices(threadId)).find((notice) => notice.title === 'test failed on PR #1.')
      assert.strictEqual(said?.description, 'The lead fixes them once an agent is free.')
      assert.deepStrictEqual(
        (yield* rounds(taskId)).map((round) => [round.state, round.attempt]),
        [['resolving', 1]],
      )
      // The other task is stopped: its place goes to the round, whose lead fixes the checks, and Althar pushes the fix.
      yield* (yield* Tasks).stop({ envelope: yield* Runtime.envelope('task.stop', {}), taskId: busy.taskId })
      yield* titled(threadId, 'The lead fixed the checks on the merge, and pushed the fix to PR #1.')
      assert.isTrue(holdsFix(bare, 'althar/add-a-retry'))
    }).pipe(Effect.provide(oneAtOnce(github)))
  })
})
