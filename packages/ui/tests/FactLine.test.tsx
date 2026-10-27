import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Fact, FactLine } from '../src/board/BoardCard/Chips'

/*
 * FactLine switches from one line to a list by measuring: jsdom has no layout,
 * so what it measures is said here, and the observer is driven by hand.
 */

describe('FactLine', () => {
  const sizes = { line: { scroll: 300, client: 200 }, room: 200 }
  let notify: () => void = () => {}
  afterEach(() => vi.unstubAllGlobals())

  const measure = () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(fn: () => void) {
          notify = fn
        }
        observe() {}
        disconnect() {}
      },
    )
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => sizes.line.scroll })
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.parentElement?.tagName === 'DIV' && this.dataset.room === undefined ? sizes.line.client : sizes.room
      },
    })
  }

  it('becomes a list where its facts overflow, and a line again once there is room', () => {
    measure()
    const { container } = render(
      <div data-room="">
        <FactLine>
          <Fact key="a" icon="up" tone="warm">
            The push should resolve the conflict with main
          </Fact>
          <Fact key="b" tone="live">
            Checks running, 11 of 12 passed
          </Fact>
        </FactLine>
      </div>,
    )
    const line = container.querySelector('[class*="factLine"]') as HTMLElement
    expect(line.hasAttribute('data-stacked')).toBe(true)
    expect(container.textContent).not.toContain('·')
    sizes.room = 400
    act(() => notify())
    expect(line.hasAttribute('data-stacked')).toBe(false)
    expect(container.textContent).toContain('·')
  })
})
