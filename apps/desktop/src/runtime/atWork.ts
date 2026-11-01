import { Busy, Launches, Sessions } from '@althar/runtime'
import { Effect, Option } from 'effect'

import type { Work } from '../main/quitWork'

/*
 * What Quit would stop (DEV-118), for the main process, which asks before it
 * lets the runtime shut down: the leads and reviewers at work, as Busy counts
 * them (in a step or a turn, or starting one, not only waiting for a place),
 * the project runs still going, and what agents left running in the
 * background. Counts alone, never what anyone wrote. The coordinator and the
 * permission judge are not counted: they hold no work of a task's to lose.
 */
export const runtimeWork = Effect.gen(function* () {
  const busy = yield* Busy
  const sessions = yield* Sessions
  const launches = yield* Launches
  // A task kept at work only by what its agents left running is counted below, as what they left running.
  const holders = (yield* busy.now).holders.filter((holder) => !holder.kept)
  const reviews = holders.filter((holder) => holder.review === true).length
  const leads = holders.length - reviews
  let left = 0
  for (const session of yield* sessions.onTasks) {
    if (!session.background) continue
    const running = yield* sessions.running(session.threadId)
    left += Option.match(running, {
      onNone: () => 0,
      onSome: (found) => found.background.filter((thing) => thing.ended === null).length,
    })
  }
  const runs = (yield* launches.processes()).length
  return { leads, reviews, runs, left } satisfies Work
})
