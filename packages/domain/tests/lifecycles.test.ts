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
  runLifecycle,
  taskLifecycle,
  transition,
} from '../src/lifecycles'
import { RunState, TaskState } from '../src/vocabulary'

const lifecycles = [
  { lifecycle: nodeAttemptLifecycle as Lifecycle<string>, states: NodeAttemptState.literals as ReadonlyArray<string> },
  { lifecycle: providerSessionLifecycle as Lifecycle<string>, states: ProviderSessionState.literals as ReadonlyArray<string> },
  { lifecycle: taskLifecycle as Lifecycle<string>, states: TaskState.literals as ReadonlyArray<string> },
  { lifecycle: runLifecycle as Lifecycle<string>, states: RunState.literals as ReadonlyArray<string> },
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

  it('reopens an abandoned task, and never a merged one', () => {
    assert.isTrue(canTransition(taskLifecycle, 'open', 'abandoned'))
    assert.isTrue(canTransition(taskLifecycle, 'abandoned', 'open'))
    // Its pull request merged on the host after all, it is done.
    assert.isTrue(canTransition(taskLifecycle, 'abandoned', 'done'))
    assert.isTrue(isTerminal(taskLifecycle, 'done'))
    assert.isFalse(canTransition(taskLifecycle, 'done', 'open'))
  })

  it('suspends a stopped run until it runs again or is cancelled', () => {
    assert.isTrue(canTransition(runLifecycle, 'running', 'suspended'))
    assert.isTrue(canTransition(runLifecycle, 'suspended', 'running'))
    assert.isFalse(canTransition(runLifecycle, 'suspended', 'succeeded'))
    assert.isFalse(canTransition(runLifecycle, 'cancelled', 'running'))
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
