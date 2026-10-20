import { assert, describe, it } from '@effect/vitest'
import { Duration, Effect } from 'effect'

import * as Runtime from '../src/Runtime'
import { Sessions } from '../src/Sessions'
import { notices, repository, turns, until } from './support'
import { ask, cantOf, cards, mergedHere, mergeHere, moveMainOn, rounds, runtimeWith, titled } from './conflictsSupport'

/*
 * A lead resolving a conflict merging here, whose turn ends and that the
 * person speaks to, or stops, before Althar has looked at what it left: the
 * round is looked at once, when the lead is done or its session ends, and
 * settles as its branch says.
 */

describe('a conflict merging here, its lead spoken to as its turn ends', () => {
  it.live('is looked at once the lead is done, and resolved', () => {
    const working = repository()
    return Effect.gen(function* () {
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:resolve]',
        true,
      )
      const [task] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      const taskId = task?.taskId ?? ''
      const threadId = task?.threadId ?? ''
      moveMainOn(working)
      assert.strictEqual(cantOf(yield* Effect.flip(mergeHere(taskId)))[1], 'resolving')
      // The lead commits the merge, and its turn ends; the person thanks it at once, before Althar has looked.
      yield* mergedHere(taskId)
      const before = (yield* turns(threadId)).length
      yield* until(turns(threadId), (all) => all.length >= before && all.every((turn) => turn.state !== 'delivered'))
      const sessions = yield* Sessions
      yield* sessions.send({ envelope: yield* Runtime.envelope('thread.send', { threadId }), threadId, body: 'Thanks.' })
      yield* titled(threadId, 'The lead resolved the conflict with main, in change.txt')
      assert.deepStrictEqual(
        (yield* rounds(taskId)).map((round) => [round.state, round.attempt]),
        [['resolved', 1]],
      )
    }).pipe(Effect.provide(runtimeWith({}, { reports: Duration.seconds(3) })))
  })

  it.live('is looked at as its session ends where the lead is stopped before Althar has looked', () => {
    const working = repository()
    return Effect.gen(function* () {
      const projectId = yield* ask(
        working,
        'Add a retry. [coordinator:plan-no-review] [coordinator:plan] [lead:finish] [lead:edit] [lead:resolve]',
        true,
      )
      const [task] = yield* until(cards(projectId), (all) => all[0]?.phase === 'ready', Duration.seconds(20))
      const taskId = task?.taskId ?? ''
      const threadId = task?.threadId ?? ''
      moveMainOn(working)
      assert.strictEqual(cantOf(yield* Effect.flip(mergeHere(taskId)))[1], 'resolving')
      yield* mergedHere(taskId)
      yield* until(turns(threadId), (all) => all.every((turn) => turn.state !== 'delivered'))
      // Stopped while Althar waits to look: the round is looked at as the session ends, and the merge it committed stands.
      yield* (yield* Sessions).stop(threadId)
      const said = yield* until(
        notices(threadId),
        (all) => all.some((notice) => notice.title?.startsWith('The lead') === true && notice.title.includes('the conflict with main')),
        Duration.seconds(20),
      )
      assert.strictEqual(
        said.find((notice) => notice.title?.includes('the conflict with main') === true)?.title,
        'The lead resolved the conflict with main, in change.txt.',
      )
      assert.deepStrictEqual(
        (yield* rounds(taskId)).map((round) => round.state),
        ['resolved'],
      )
    }).pipe(Effect.provide(runtimeWith({}, { reports: Duration.seconds(3) })))
  })
})
