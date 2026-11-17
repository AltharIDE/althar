import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Fact, FactLine } from '../src/board/BoardCard/Chips'

/*
 * FactLine switches from one line to a list by measuring: jsdom has no layout,
 * so what it measures is said here, and the observer is driven by hand.
 */

describe('FactLine', () => {
  let notify: () => void = () => {}
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const measure = (sizes: { scroll: number; room: number }) => {
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
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => sizes.scroll)
    // The line fills the room it is in, as a block does.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => sizes.room)
  }

  it('becomes a list where its facts overflow, and a line again once there is room', () => {
    const sizes = { scroll: 300, room: 200 }
    measure(sizes)
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
