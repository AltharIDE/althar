import { describe, expect, it, vi } from 'vitest'

import { MOST, type Observe, SENT_EVERY, SLOW_MS, type SlowFrames, slowOf, targetOf, watchFrames } from '../src/renderer/shared/frames'

/** The page's observers, as the test makes them: what each watches, and a way to hand it entries. */
const observers = (supported: ReadonlyArray<string>) => {
  const watching = new Map<string, { readonly options: Record<string, unknown>; readonly seen: Parameters<Observe>[2] }>()
  const stopped: Array<string> = []
  const observe: Observe = (type, options, seen) => {
    if (!supported.includes(type)) return null
    watching.set(type, { options, seen })
    return () => void stopped.push(type)
  }
  return {
    observe,
    watching,
    stopped,
    see: (type: string, entries: Parameters<Parameters<Observe>[2]>[0]) => watching.get(type)?.seen(entries),
  }
}

/** A timer the test runs by hand. */
const byHand = () => {
  const waiting: Array<{ readonly send: () => void; readonly ms: number; cancelled: boolean }> = []
  return {
    later: (send: () => void, ms: number) => {
      const one = { send, ms, cancelled: false }
      waiting.push(one)
      return () => {
        one.cancelled = true
      }
    },
    run: () => {
      for (const one of waiting.splice(0)) if (!one.cancelled) one.send()
    },
    waiting,
  }
}

const button = (html: string) => {
  document.body.innerHTML = html
  const found = document.body.querySelector('[data-pressed]')
  if (found === null) throw new Error('No element to press')
  return found
}

describe('what made the page slow', () => {
  it('says a long frame, how much of it held input back, and its longest script by its file’s name, never its path', () => {
    expect(
      slowOf({
        entryType: 'long-animation-frame',
        name: 'long-animation-frame',
        duration: 182.6,
        blockingDuration: 120.2,
        scripts: [
          {
            duration: 20,
            invoker: 'Window.requestAnimationFrame',
            sourceURL: 'file:///home/dana/Althar/assets/index-a1.js',
            sourceFunctionName: 'draw',
          },
          {
            duration: 150,
            invoker: 'BUTTON#send.onclick',
            sourceURL: 'file:///home/dana/Althar/assets/index-a1.js?v=2',
            sourceFunctionName: 'send',
          },
        ],
      }),
    ).toEqual({ kind: 'frame', ms: 183, blockingMs: 120, script: 'BUTTON#send.onclick:index-a1.js:send' })
    expect(slowOf({ entryType: 'long-animation-frame', name: 'x', duration: 140, scripts: [] })).toEqual({ kind: 'frame', ms: 140 })
    expect(slowOf({ entryType: 'long-animation-frame', name: 'x', duration: 140, scripts: [{ duration: 1 }] })).toEqual({
      kind: 'frame',
      ms: 140,
    })
    expect(slowOf({ entryType: 'longtask', name: 'self', duration: 120 })).toEqual({ kind: 'task', ms: 120 })
    // Under the threshold, nothing.
    expect(slowOf({ entryType: 'longtask', name: 'self', duration: SLOW_MS - 1 })).toBeUndefined()
  })

  it('says a slow press by its event and what it was on, and nothing of an event that was no interaction', () => {
    const target = button('<form><button data-pressed class="send_x7Yz1 wide_ab12c">Fix the login bug</button></form>')
    expect(slowOf({ entryType: 'event', name: 'click', duration: 240, interactionId: 7, target })).toEqual({
      kind: 'press',
      ms: 240,
      event: 'click',
      on: 'button.send',
      interaction: 7,
    })
    expect(slowOf({ entryType: 'event', name: 'pointerover', duration: 240, interactionId: 0, target })).toBeUndefined()
    expect(slowOf({ entryType: 'event', name: 'keydown', duration: 240, interactionId: 3, target: null })).toEqual({
      kind: 'press',
      ms: 240,
      event: 'keydown',
      interaction: 3,
    })
    expect(slowOf({ entryType: 'paint', name: 'first-paint', duration: 400 })).toBeUndefined()
  })

  it('names what a press was on by its test id, else its role and its kind, never its words', () => {
    expect(targetOf(button('<section data-testid="coordinator-column"><span data-pressed>meridian</span></section>'))).toBe(
      'testid:coordinator-column',
    )
    expect(targetOf(button('<div role="option" data-pressed class="row_Ab1-2">Dana’s refunds</div>'))).toBe('option.row')
    expect(targetOf(button('<textarea data-pressed>secret plans</textarea>'))).toBe('textbox')
    expect(targetOf(button('<li data-pressed>one</li>'))).toBe('li')
    // On a button's label or icon: the button.
    expect(targetOf(button('<button class="send_x7Yz1"><span data-pressed>Send</span></button>'))).toBe('button.send')
    // As a development build names its classes.
    expect(targetOf(button('<a href="#" data-pressed class="Composer-module__send__x1y2">go</a>'))).toBe('link.Composer-module__send')
    expect(targetOf('not an element')).toBeUndefined()
  })

  it('sends what took long a few at a time, after a while, counting the rest', () => {
    const sent: Array<SlowFrames> = []
    const page = observers(['long-animation-frame', 'longtask', 'event'])
    const timer = byHand()
    const stop = watchFrames({ logFrames: (frames) => sent.push(frames) }, { observe: page.observe, later: timer.later })
    // Long animation frames where Chromium has them, not long tasks beside them; presses over the threshold.
    expect([...page.watching.keys()]).toEqual(['long-animation-frame', 'event'])
    expect(page.watching.get('event')?.options).toEqual({ durationThreshold: SLOW_MS })
    page.see('long-animation-frame', [{ entryType: 'long-animation-frame', name: 'x', duration: 30 }])
    // Nothing long, nothing to send.
    expect(timer.waiting).toHaveLength(0)
    page.see(
      'long-animation-frame',
      Array.from({ length: MOST + 3 }, () => ({ entryType: 'long-animation-frame', name: 'x', duration: 150 })),
    )
    page.see('event', [{ entryType: 'event', name: 'click', duration: 300, interactionId: 1, target: null }])
    expect(timer.waiting.map((one) => one.ms)).toEqual([SENT_EVERY])
    expect(sent).toHaveLength(0)
    timer.run()
    expect(sent).toHaveLength(1)
    expect(sent[0]?.frames).toHaveLength(MOST)
    expect(sent[0]?.more).toBe(4)
    // A press's pointerdown, pointerup and click are one press, said once, at its longest.
    page.see('event', [
      { entryType: 'event', name: 'pointerdown', duration: 180, interactionId: 9, target: null },
      { entryType: 'event', name: 'pointerup', duration: 180, interactionId: 9, target: null },
      { entryType: 'event', name: 'click', duration: 176, interactionId: 9, target: null },
    ])
    timer.run()
    expect(sent[1]).toEqual({ frames: [{ kind: 'press', ms: 180, event: 'pointerup' }], more: 0 })
    // A later one waits for a timer of its own, and what is left goes as it stops.
    page.see('event', [{ entryType: 'event', name: 'keydown', duration: 200, interactionId: 2, target: null }])
    stop()
    expect(sent[2]).toEqual({ frames: [{ kind: 'press', ms: 200, event: 'keydown' }], more: 0 })
    expect(page.stopped).toEqual(['long-animation-frame', 'event'])
    timer.run()
    expect(sent).toHaveLength(3)
  })

  it('watches long tasks where Chromium has no long animation frames, and nothing where there is nowhere to send', () => {
    const page = observers(['longtask'])
    const stop = watchFrames({ logFrames: () => undefined }, { observe: page.observe, later: byHand().later })
    expect([...page.watching.keys()]).toEqual(['longtask'])
    stop()
    const none = observers(['longtask', 'event'])
    watchFrames({}, { observe: none.observe })()
    expect(none.watching.size).toBe(0)
  })

  it('watches the page’s own observer and timer by default', () => {
    // jsdom has no PerformanceObserver: nothing is watched, and nothing fails.
    const sent: Array<SlowFrames> = []
    watchFrames({ logFrames: (frames) => sent.push(frames) })()
    expect(sent).toHaveLength(0)
    // Chromium's, as the page has it: each kind it supports, buffered, sent on the page's own timer.
    const observed: Array<Record<string, unknown>> = []
    const made: Array<(list: { getEntries: () => ReadonlyArray<unknown> }) => void> = []
    class Observer {
      static readonly supportedEntryTypes = ['longtask', 'event']
      constructor(seen: (list: { getEntries: () => ReadonlyArray<unknown> }) => void) {
        made.push(seen)
      }
      observe(options: Record<string, unknown>) {
        observed.push(options)
      }
      disconnect() {}
    }
    vi.stubGlobal('PerformanceObserver', Observer)
    vi.useFakeTimers()
    try {
      const stop = watchFrames({ logFrames: (frames) => sent.push(frames) })
      expect(observed).toEqual([
        { type: 'longtask', buffered: true },
        { type: 'event', buffered: true, durationThreshold: SLOW_MS },
      ])
      made[0]?.({ getEntries: () => [{ entryType: 'longtask', name: 'self', duration: 210 }] })
      vi.advanceTimersByTime(SENT_EVERY)
      expect(sent).toEqual([{ frames: [{ kind: 'task', ms: 210 }], more: 0 }])
      made[0]?.({ getEntries: () => [{ entryType: 'longtask', name: 'self', duration: 220 }] })
      stop()
      vi.advanceTimersByTime(SENT_EVERY)
      expect(sent).toHaveLength(2)
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})
