import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { onPhone } from '../src/client/relay/scheduler'

/*
 * React Native's `setImmediate` is a microtask, so Effect's own yields let
 * nothing else run while a fiber is busy (docs/hermes-spike.md). The same
 * shim here: on the phone's scheduler, a timer still gets its turn.
 */

const busy = Effect.gen(function* () {
  let steps = 0
  for (let i = 0; i < 20_000; i++) {
    yield* Effect.sync(() => steps++)
  }
  return steps
})

/** When a 0 ms timer set before a busy fiber gets to run: before the fiber ends, or only after. */
const timerRuns = async (run: (effect: typeof busy) => typeof busy) => {
  const global = globalThis as { setImmediate?: unknown }
  const original = global.setImmediate
  global.setImmediate = (fn: () => void) => queueMicrotask(fn)
  try {
    let ended = false
    let timerFirst = false
    setTimeout(() => {
      timerFirst = !ended
    }, 0)
    await Effect.runPromise(run(busy))
    ended = true
    await new Promise((resolve) => setTimeout(resolve, 5))
    return timerFirst ? 'before the fiber ends' : 'only after'
  } finally {
    global.setImmediate = original
  }
}

describe('the phone’s scheduler', () => {
  it('lets a timer run while a fiber is busy, though setImmediate is a microtask', async () => {
    expect(await timerRuns(onPhone)).toBe('before the fiber ends')
  })

  it('is needed: on Effect’s own, the timer waits for the whole fiber', async () => {
    expect(await timerRuns((effect) => effect)).toBe('only after')
  })
})
