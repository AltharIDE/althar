import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SizeMotion } from '../src/lib/SizeMotion'
import { MOTION } from '../src/lib/motion'

/*
 * What holds content that changes size: its height glides from the old to
 * the new, and a new step fades in. jsdom lays nothing out and has no
 * ResizeObserver, so each test says how tall the content is and tells the
 * observer when it changed.
 */

let told: (() => void)[] = []
let tall = 100
let animate: ReturnType<typeof vi.fn>
let reduced = false

beforeEach(() => {
  told = []
  tall = 100
  reduced = false
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        told.push(cb)
      }
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal('matchMedia', () => ({ matches: reduced }))
  animate = vi.fn(() => {
    const run = new EventTarget() as EventTarget & { cancel: () => void }
    run.cancel = () => run.dispatchEvent(new Event('cancel'))
    return run
  })
  Object.defineProperty(Element.prototype, 'animate', { value: animate, configurable: true, writable: true })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => tall })
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (Element.prototype as unknown as Record<string, unknown>).animate
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight
})

const resized = (to: number) => {
  tall = to
  told.forEach((tell) => tell())
}

describe('what holds content that changes size', () => {
  it('glides its height from the old to the new on the move spring, clipped while it does', () => {
    const { container } = render(
      <SizeMotion>
        <p>Rows</p>
      </SizeMotion>,
    )
    const box = container.firstElementChild as HTMLElement
    // First told: nothing was there before.
    resized(100)
    expect(animate).not.toHaveBeenCalled()
    resized(240)
    expect(animate).toHaveBeenCalledWith([{ height: '100px' }, { height: '240px' }], MOTION.move)
    expect(box.style.overflow).toBe('clip')
    // Changed again mid-glide: from where it is drawn now, and the clip stays until the last glide ends.
    Object.defineProperty(box, 'offsetHeight', { configurable: true, get: () => 170 })
    resized(180)
    expect(animate).toHaveBeenLastCalledWith([{ height: '170px' }, { height: '180px' }], MOTION.move)
    expect(box.style.overflow).toBe('clip')
    const last = animate.mock.results.at(-1)?.value as EventTarget
    last.dispatchEvent(new Event('finish'))
    expect(box.style.overflow).toBe('')
  })

  it('does nothing for a change of under a pixel, or with reduced motion', () => {
    render(
      <SizeMotion>
        <p>Rows</p>
      </SizeMotion>,
    )
    resized(100)
    resized(100.4)
    reduced = true
    resized(300)
    expect(animate).not.toHaveBeenCalled()
  })

  it('fades a new step in, and not the one it opened on', () => {
    const { container, rerender } = render(
      <SizeMotion step="rows">
        <p>Rows</p>
      </SizeMotion>,
    )
    expect(animate).not.toHaveBeenCalled()
    rerender(
      <SizeMotion step="walk">
        <p>Walk</p>
      </SizeMotion>,
    )
    expect(animate).toHaveBeenCalledTimes(1)
    expect(animate.mock.contexts[0]).toBe(container.firstElementChild?.firstElementChild)
    expect(animate.mock.calls[0]?.[1]).toBe(MOTION.enter)
    rerender(
      <SizeMotion step="walk">
        <p>Walk, a step on</p>
      </SizeMotion>,
    )
    expect(animate).toHaveBeenCalledTimes(1)
  })
})
