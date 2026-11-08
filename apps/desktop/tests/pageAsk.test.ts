// @vitest-environment node
import { Effect, Exit, Fiber } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import type { PageCall } from '@althar/runtime/pageBridge'

import { type PageAsked, pagesWith, WITHIN_SECONDS } from '../src/runtime/pages'

/*
 * What a lead or the coordinator asks of the page beside their conversation,
 * as the runtime carries it to the main process (pages.ts, answered by
 * main/browser/bridge.ts): one message out for each call, naming the
 * session's own owner, and the answer or the reason it can't be given back.
 */

const TASK = `task_${'a1'.repeat(16)}`
const click: PageCall = { op: 'click', target: { ref: 'e12' }, button: 'left', double: false }

describe('a call on a page the runtime asks the main process for', () => {
  it('posts the call for its owner, and takes back the answer, or why not', async () => {
    const posted: Array<PageAsked> = []
    const { ask, answer } = pagesWith((message) => posted.push(message))
    const clicking = Effect.runPromise(ask(TASK, click))
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ type: 'page', owner: TASK, call: click })
    answer(posted[0]?.requestId ?? '', { value: { text: 'Clicked “Save”.' } })
    expect(await clicking).toEqual({ text: 'Clicked “Save”.' })

    const failing = Effect.runPromiseExit(ask(TASK, { op: 'state' }))
    await vi.waitFor(() => expect(posted).toHaveLength(2))
    answer(posted[1]?.requestId ?? '', { error: 'Althar has no window open.' })
    const exit = await failing
    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain('Althar has no window open.')
    // Each call is its own request, so answers can’t cross.
    expect(posted[0]?.requestId).not.toBe(posted[1]?.requestId)
    // An answer for nothing asked, or asked twice, is let go.
    answer('gone', { value: { text: 'x' } })
    answer(posted[0]?.requestId ?? '', { value: { text: 'again' } })
  })

  it('tells main of a call the agent stopped before its answer came, and of none that was answered', async () => {
    const posted: Array<PageAsked> = []
    const { ask, answer } = pagesWith((message) => posted.push(message))
    const answeredOne = Effect.runPromise(ask(TASK, { op: 'state' }))
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    answer(posted[0]?.requestId ?? '', { value: { text: 'done' } })
    await answeredOne
    const stopped = Effect.runFork(ask(TASK, click))
    await vi.waitFor(() => expect(posted).toHaveLength(2))
    await Effect.runPromise(Fiber.interrupt(stopped))
    expect(posted).toEqual([
      expect.objectContaining({ type: 'page' }),
      expect.objectContaining({ type: 'page', call: click }),
      { type: 'page-cancel', requestId: posted[1]?.requestId },
    ])
  })

  it('brings a screenshot’s picture back whole', async () => {
    const posted: Array<{ readonly requestId: string }> = []
    const { ask, answer } = pagesWith((message) => posted.push(message))
    const taking = Effect.runPromise(ask(TASK, { op: 'screenshot', target: null, fullPage: false }))
    await vi.waitFor(() => expect(posted).toHaveLength(1))
    const value = { text: 'The page.', picture: { png: 'cG5n', width: 800, height: 600 } }
    answer(posted[0]?.requestId ?? '', { value })
    expect(await taking).toEqual(value)
  })

  it('without an answer for the longest a wait lasts and a page’s waking, says the window didn’t answer', async () => {
    vi.useFakeTimers()
    try {
      const posted: Array<unknown> = []
      const { ask } = pagesWith((message) => posted.push(message))
      const exit = Effect.runPromiseExit(ask(TASK, { op: 'state' }))
      await vi.advanceTimersByTimeAsync(WITHIN_SECONDS * 1000 + 1)
      const done = await exit
      expect(Exit.isFailure(done) && JSON.stringify(done.cause)).toContain('Althar’s window didn’t answer.')
      // Main hears it gave up, so the page isn't driven for nobody.
      expect(posted.at(-1)).toEqual({ type: 'page-cancel', requestId: (posted[0] as { requestId: string }).requestId })
      // Longer than a wait may last (a minute), with room for a page asleep to wake and load.
      expect(WITHIN_SECONDS).toBeGreaterThan(60 + 30)
    } finally {
      vi.useRealTimers()
    }
  })
})
