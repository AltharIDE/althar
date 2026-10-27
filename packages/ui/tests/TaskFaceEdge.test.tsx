import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Composer } from '../src/composer/Composer/Composer'
import { TaskFace } from '../src/thread/TaskFace/TaskFace'

/* A resize observer that can be told what changed, and remembers what it watches. */
const watchers: { callback: () => void; seen: Set<Element> }[] = []
class Watching {
  readonly seen = new Set<Element>()
  constructor(readonly callback: () => void) {
    watchers.push(this)
  }
  observe(el: Element) {
    this.seen.add(el)
  }
  unobserve() {}
  disconnect() {
    this.seen.clear()
  }
}

afterEach(() => {
  watchers.length = 0
  vi.unstubAllGlobals()
})

describe('the end of a thread beside what floats on the composer', () => {
  it('follows the bottom when the floating edge grows, and leaves a reader who scrolled away', () => {
    vi.stubGlobal('ResizeObserver', Watching)
    const { container } = render(
      <TaskFace
        composer={
          <Composer value="" onChange={() => {}} onSubmit={() => {}} placeholder="Tell the lead" notice="Takes over when you send." />
        }
      >
        <p>last message</p>
      </TaskFace>,
    )
    const scroller = container.querySelector<HTMLElement>('[class*="scroll"]:not([class*="scrollArea"])')!
    const clear = scroller.querySelector('[class*="clear"]')!
    // The spacer is a child of the scroller, so growing it is watched like the thread growing.
    expect(watchers.some((w) => w.seen.has(clear))).toBe(true)

    let height = 500
    Object.defineProperty(scroller, 'scrollHeight', { get: () => height, configurable: true })
    const grow = () => act(() => watchers.filter((w) => w.seen.has(clear)).forEach((w) => w.callback()))

    // At the bottom, the edge grows: the reader stays at the bottom.
    height = 600
    grow()
    expect(scroller.scrollTop).toBe(600)

    // Scrolled up, away from the bottom: the place is kept.
    scroller.scrollTop = 100
    act(() => {
      scroller.dispatchEvent(new Event('scroll'))
    })
    height = 700
    grow()
    expect(scroller.scrollTop).toBe(100)
  })
})
