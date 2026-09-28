import { assert, describe, it } from '@effect/vitest'
import { Effect, Exit } from 'effect'

import {
  canTransition,
  InvalidTransition,
  isTerminal,
  type Lifecycle,
  NodeAttemptState,
  nodeAttemptLifecycle,
  ProviderSessionState,
  providerSessionLifecycle,
  transition,
} from '../src/lifecycles'

const lifecycles = [
  { lifecycle: nodeAttemptLifecycle as Lifecycle<string>, states: NodeAttemptState.literals as ReadonlyArray<string> },
  { lifecycle: providerSessionLifecycle as Lifecycle<string>, states: ProviderSessionState.literals as ReadonlyArray<string> },
]

describe('lifecycles', () => {
  for (const { lifecycle, states } of lifecycles) {
    describe(lifecycle.name, () => {
      it('lists every state once, and moves only to states it knows', () => {
        assert.deepStrictEqual(Object.keys(lifecycle.edges).toSorted(), [...states].toSorted())
        for (const targets of Object.values(lifecycle.edges)) {
          for (const target of targets) assert.include(states, target)
          assert.strictEqual(new Set(targets).size, targets.length)
        }
      })

      it('can reach every state from its first', () => {
        const [first] = states
        const seen = new Set([first])
        const queue = [first]
        while (queue.length > 0) {
          const state = queue.shift() as string
          for (const next of lifecycle.edges[state] ?? []) {
            if (!seen.has(next)) {
              seen.add(next)
              queue.push(next)
            }
          }
        }
        assert.deepStrictEqual(seen, new Set(states))
      })

      it('never leaves a terminal state', () => {
        for (const state of states) {
          if (isTerminal(lifecycle, state)) {
            for (const other of states) assert.isFalse(canTransition(lifecycle, state, other))
          }
        }
      })
    })
  }

  it('ends a node attempt that another agent takes over as superseded', () => {
    assert.isTrue(canTransition(nodeAttemptLifecycle, 'running', 'superseded'))
    assert.isTrue(isTerminal(nodeAttemptLifecycle, 'superseded'))
    assert.isTrue(canTransition(providerSessionLifecycle, 'active', 'superseded'))
  })

  it('holds an attempt without a person, and lets it run again or pass to another agent', () => {
    assert.isTrue(canTransition(nodeAttemptLifecycle, 'running', 'held'))
    assert.isTrue(canTransition(nodeAttemptLifecycle, 'held', 'running'))
    assert.isTrue(canTransition(nodeAttemptLifecycle, 'held', 'superseded'))
    assert.isFalse(canTransition(nodeAttemptLifecycle, 'held', 'succeeded'))
  })

  it('reconciles an uncertain attempt before deciding its outcome', () => {
    assert.isFalse(canTransition(nodeAttemptLifecycle, 'uncertain', 'succeeded'))
    assert.isTrue(canTransition(nodeAttemptLifecycle, 'uncertain', 'reconciling'))
    assert.isTrue(canTransition(nodeAttemptLifecycle, 'reconciling', 'succeeded'))
  })

  it.effect('transition succeeds along an edge', () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* transition(nodeAttemptLifecycle, 'admitted', 'running'), 'running')
    }),
  )

  it.effect('transition fails with InvalidTransition off an edge', () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(transition(nodeAttemptLifecycle, 'succeeded', 'running'))
      assert.isTrue(Exit.isFailure(exit))
      const error = yield* Effect.flip(transition(providerSessionLifecycle, 'completed', 'active'))
      assert.instanceOf(error, InvalidTransition)
      assert.deepStrictEqual([error.lifecycle, error.from, error.to], ['provider session', 'completed', 'active'])
    }),
  )
})
