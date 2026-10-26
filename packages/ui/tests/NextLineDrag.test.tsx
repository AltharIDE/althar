import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from 'storybook/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LAND, NextLine, SETTLE } from '../src/board/NextLine/NextLine'

/*
 * Up next's rows dragged by any part of them. jsdom lays nothing out, so the
 * lane is given a layout here: rows one under the other, each as tall as
 * `heights` says (40 by default), in a lane that shows `shown` pixels of
 * them and scrolls the rest.
 */
const HEIGHT = 40

const row = (id: string) => ({ id, title: `Task ${id}` })
const draw = (ids: ReadonlyArray<string>, onMove?: (id: string, to: number) => void | Promise<unknown>) => (
  <NextLine
    rows={ids.map(row)}
    render={(id, place) => (
      <article>
        <p>{`${place}: Task ${id}`}</p>
        <button type="button">{`Open ${id}`}</button>
      </article>
    )}
    {...(onMove ? { onMove } : {})}
  />
)
const shown = () => screen.getAllByRole('listitem').map((item) => item.querySelector('p')?.textContent)
const item = (id: string) => screen.getByText(`Task ${id}`, { exact: false }).closest('li')!
const grip = (id: string) => screen.getByRole('button', { name: `Move Task ${id} in the line` })
const list = () => screen.getByRole('list')
const shift = (id: string) => item(id).style.transform
const lifted = () => screen.getAllByRole('listitem').filter((one) => one.className.includes('lifted'))
const moving = () => list().querySelectorAll('li[style*="transform"]')

const rect = (top: number, height: number) =>
  ({ top, bottom: top + height, height, left: 0, right: 300, width: 300, x: 0, y: top, toJSON: () => ({}) }) as DOMRect

/* Lays out the lane: `visible` pixels tall, scrolled as far as it is. The rows are `heights` tall by place, 40 where not said. */
const layOut = (visible = 600, heights: ReadonlyArray<number> = []) => {
  const element = list()
  let scroll = 0
  const at = (index: number) =>
    heights.slice(0, index).reduce((sum, one) => sum + one, 0) + (heights.length < index ? (index - heights.length) * HEIGHT : 0)
  const total = () => at(element.children.length)
  Object.defineProperty(element, 'clientHeight', { configurable: true, get: () => visible })
  Object.defineProperty(element, 'scrollHeight', { configurable: true, get: total })
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => scroll,
    set: (to: number) => void (scroll = Math.max(0, Math.min(to, total() - visible))),
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this === element) return rect(0, visible)
    if (this.parentElement === element) {
      const index = Array.from(element.children).indexOf(this)
      return rect(at(index) - scroll, heights[index] ?? HEIGHT)
    }
    return rect(0, 0)
  })
}

/* A part of the row pressed, the pointer then followed on the row, as a browser sends it to the row that holds it. */
const pointer = (
  type: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel' | 'lostPointerCapture',
  id: string,
  clientY: number,
  more: Partial<PointerEventInit> = {},
) =>
  fireEvent[type](item(id).querySelector('p')!, {
    pointerId: 1,
    isPrimary: true,
    button: 0,
    buttons: type === 'pointerUp' ? 0 : 1,
    clientY,
    ...more,
  })
const settle = () => act(() => void vi.advanceTimersByTime(LAND))

beforeEach(() => void vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] }))
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('dragging a row up next', () => {
  it('lifts a row pressed by its grip though the pointer leaves the row before it has gone far enough to drag it', () => {
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c', 'd'], onMove))
    layOut()
    fireEvent.pointerDown(grip('d'), { pointerId: 1, isPrimary: true, button: 0, buttons: 1, clientY: 140 })
    // Up and off the row at once, into the lane's margin: none of the row's handlers hear it.
    fireEvent.pointerMove(document.body, { pointerId: 1, isPrimary: true, buttons: 1, clientY: 100 })
    expect(lifted()).toEqual([item('d')])
    // Dragged, the row holds the pointer, and the browser sends it the moves.
    pointer('pointerMove', 'd', 0)
    expect(shift('a')).toBe(`translateY(${HEIGHT}px)`)
    pointer('pointerUp', 'd', 0)
    settle()
    expect(onMove).toHaveBeenCalledWith('d', 0)
  })

  it('lifts the row with the pointer, the others giving way, and lands it where it is let go once it has settled', () => {
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c', 'd'], onMove))
    layOut()
    pointer('pointerDown', 'a', 20)
    pointer('pointerMove', 'a', 110)
    // The row follows the pointer; the document keeps its order, and only the transforms say where each would be.
    expect(shown()).toEqual(['1: Task a', '2: Task b', '3: Task c', '4: Task d'])
    expect(shift('a')).toBe('translateY(90px)')
    expect(lifted()).toEqual([item('a')])
    // Past the middles of b and c: they give way by a row.
    expect(shift('b')).toBe(`translateY(-${HEIGHT}px)`)
    expect(shift('c')).toBe(`translateY(-${HEIGHT}px)`)
    expect(shift('d')).toBe('')
    pointer('pointerMove', 'a', 5)
    expect(shift('a')).toBe('')
    expect(shift('b')).toBe('')
    pointer('pointerMove', 'a', 170)
    expect(shift('d')).toBe(`translateY(-${HEIGHT}px)`)
    pointer('pointerUp', 'a', 170)
    // Let go, it settles into the place it lands in, the others where they are, and the line is told after.
    expect(shift('a')).toBe(`translateY(${3 * HEIGHT}px)`)
    expect(item('a').className).toContain('settling')
    expect(onMove).not.toHaveBeenCalled()
    settle()
    expect(onMove).toHaveBeenCalledExactlyOnceWith('a', 3)
    expect(shown()).toEqual(['1: Task b', '2: Task c', '3: Task d', '4: Task a'])
    expect(moving()).toHaveLength(0)
    expect(lifted()).toHaveLength(0)
    // Nothing follows the pointer once it is let go.
    pointer('pointerMove', 'a', 10)
    expect(moving()).toHaveLength(0)
  })

  it('gives way by the height of the row held, and settles by the heights of those it passes, in rows of different heights', () => {
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c', 'd'], onMove))
    layOut(600, [40, 90, 60, 40])
    pointer('pointerDown', 'a', 20)
    // a's leading edge (40 tall) passes b's middle (40 + 45 = 85) but not c's (130 + 30 = 160... c starts at 130).
    pointer('pointerMove', 'a', 100)
    expect(shift('a')).toBe('translateY(80px)')
    expect(shift('b')).toBe('translateY(-40px)')
    expect(shift('c')).toBe('')
    pointer('pointerMove', 'a', 190)
    expect(shift('c')).toBe('translateY(-40px)')
    pointer('pointerUp', 'a', 190)
    // Its bottom edge ends where c's does: b and c, 150 pixels, above it.
    expect(shift('a')).toBe('translateY(150px)')
    settle()
    expect(onMove).toHaveBeenCalledExactlyOnceWith('a', 2)
    expect(shown()).toEqual(['1: Task b', '2: Task c', '3: Task a', '4: Task d'])

    // Back up, the row held goes to the top of the place it takes.
    pointer('pointerDown', 'd', 200)
    pointer('pointerMove', 'd', 10)
    expect(shift('d')).toBe('translateY(-190px)')
    expect(shift('b')).toBe('translateY(40px)')
    pointer('pointerUp', 'd', 10)
    expect(shift('d')).toBe('translateY(-190px)')
  })

  it('goes no further than the first place and the last, however far the pointer goes', () => {
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c'], onMove))
    layOut()
    pointer('pointerDown', 'b', 60)
    pointer('pointerMove', 'b', -500)
    expect(shift('b')).toBe(`translateY(-${HEIGHT}px)`)
    pointer('pointerMove', 'b', 2000)
    expect(shift('b')).toBe(`translateY(${HEIGHT}px)`)
    pointer('pointerUp', 'b', 2000)
    settle()
    expect(onMove).toHaveBeenCalledExactlyOnceWith('b', 2)
  })

  it('lets go where it was taken from without moving anything', () => {
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c'], onMove))
    layOut()
    pointer('pointerDown', 'b', 60)
    pointer('pointerMove', 'b', 70)
    expect(shift('b')).toBe('translateY(10px)')
    pointer('pointerUp', 'b', 70)
    // It settles back into its own place.
    expect(shift('b')).toBe('')
    settle()
    expect(onMove).not.toHaveBeenCalled()
    expect(moving()).toHaveLength(0)
    expect(shown()).toEqual(['1: Task a', '2: Task b', '3: Task c'])
  })

  it('takes a press that doesn’t move as a click, which reaches the button pressed', () => {
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c'], onMove))
    layOut()
    const open = screen.getByRole('button', { name: 'Open c' })
    const onClick = vi.fn()
    open.addEventListener('click', onClick)
    fireEvent.pointerDown(open, { pointerId: 1, isPrimary: true, button: 0, buttons: 1, clientY: 100 })
    // A few pixels is still a press.
    fireEvent.pointerMove(open, { pointerId: 1, isPrimary: true, buttons: 1, clientY: 102 })
    expect(moving()).toHaveLength(0)
    fireEvent.pointerUp(open, { pointerId: 1, isPrimary: true, button: 0, buttons: 0, clientY: 102 })
    fireEvent.click(open)
    expect(onClick).toHaveBeenCalledOnce()
    expect(onMove).not.toHaveBeenCalled()
  })

  it('can be taken by the button in the row, and the click that ends the drag reaches nothing, though the next one does', () => {
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c'], onMove))
    layOut()
    const open = screen.getByRole('button', { name: 'Open a' })
    const onClick = vi.fn()
    open.addEventListener('click', onClick)
    fireEvent.pointerDown(open, { pointerId: 1, isPrimary: true, button: 0, buttons: 1, clientY: 20 })
    fireEvent.pointerMove(open, { pointerId: 1, isPrimary: true, buttons: 1, clientY: 110 })
    expect(shift('a')).toBe('translateY(80px)')
    fireEvent.pointerUp(open, { pointerId: 1, isPrimary: true, button: 0, buttons: 0, clientY: 110 })
    fireEvent.click(open)
    expect(onClick).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(0))
    fireEvent.click(open)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('opens the moves as a menu where the grip is clicked, and not where it is dragged from', async () => {
    vi.useRealTimers()
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c'], onMove))
    layOut()
    fireEvent.pointerDown(grip('c'), { pointerId: 1, isPrimary: true, button: 0, buttons: 1, clientY: 100 })
    fireEvent.pointerUp(grip('c'), { pointerId: 1, isPrimary: true, button: 0, buttons: 0, clientY: 100 })
    fireEvent.click(grip('c'))
    const menu = within(await screen.findByRole('menu', { name: 'Move in the line' }))
    // The last row can go up, not down.
    expect(menu.getByRole('menuitem', { name: 'Move down' })).toHaveAttribute('aria-disabled', 'true')
    expect(menu.getByRole('menuitem', { name: 'Move to the back of the line' })).toHaveAttribute('aria-disabled', 'true')
    expect(menu.getByRole('menuitem', { name: 'Move up' })).not.toHaveAttribute('aria-disabled')
    expect(onMove).not.toHaveBeenCalled()
  })

  it('puts the row back on Escape, settling into its own place, and the release after it moves nothing', () => {
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c'], onMove))
    layOut()
    pointer('pointerDown', 'a', 20)
    pointer('pointerMove', 'a', 110)
    // Another key leaves the drag be.
    fireEvent.keyDown(grip('a'), { key: 'Tab' })
    expect(lifted()).toHaveLength(1)
    fireEvent.keyDown(grip('a'), { key: 'Escape' })
    expect(shift('a')).toBe('')
    expect(shift('b')).toBe('')
    settle()
    expect(lifted()).toHaveLength(0)
    expect(moving()).toHaveLength(0)
    pointer('pointerUp', 'a', 110)
    settle()
    expect(onMove).not.toHaveBeenCalled()
    expect(shown()).toEqual(['1: Task a', '2: Task b', '3: Task c'])
  })

  it.each([
    ['the press is cancelled', 'pointerCancel'],
    ['the row loses the pointer', 'lostPointerCapture'],
  ] as const)('puts the row back where %s', (_, type) => {
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c'], onMove))
    layOut()
    pointer('pointerDown', 'a', 20)
    pointer('pointerMove', 'a', 110)
    pointer(type, 'a', 110)
    settle()
    expect(moving()).toHaveLength(0)
    expect(onMove).not.toHaveBeenCalled()
    expect(shown()).toEqual(['1: Task a', '2: Task b', '3: Task c'])
  })

  it('takes a move with no button down as hover after a missed release, and puts the row back', () => {
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c'], onMove))
    layOut()
    pointer('pointerDown', 'a', 20)
    pointer('pointerMove', 'a', 110)
    pointer('pointerMove', 'a', 115, { buttons: 0 })
    settle()
    expect(moving()).toHaveLength(0)
    pointer('pointerUp', 'a', 115)
    expect(onMove).not.toHaveBeenCalled()
  })

  it('follows only the pointer that pressed', () => {
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c'], onMove))
    layOut()
    pointer('pointerDown', 'a', 20)
    pointer('pointerMove', 'a', 110, { pointerId: 2 })
    expect(moving()).toHaveLength(0)
    pointer('pointerUp', 'a', 110, { pointerId: 2 })
    pointer('pointerCancel', 'a', 110, { pointerId: 2 })
    expect(moving()).toHaveLength(0)
    pointer('pointerMove', 'a', 110)
    expect(shift('a')).toBe('translateY(80px)')
    pointer('pointerUp', 'a', 110)
    settle()
    expect(onMove).toHaveBeenCalledExactlyOnceWith('a', 2)
  })

  it('lets a new press take over from one whose release was missed', () => {
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c'], onMove))
    layOut()
    pointer('pointerDown', 'a', 20)
    pointer('pointerDown', 'c', 100, { pointerId: 2 })
    // The first pointer is no longer followed.
    pointer('pointerMove', 'a', 110)
    expect(moving()).toHaveLength(0)
    pointer('pointerMove', 'c', 10, { pointerId: 2 })
    expect(shift('c')).toBe(`translateY(-${2 * HEIGHT}px)`)
    pointer('pointerUp', 'c', 10, { pointerId: 2 })
    settle()
    expect(onMove).toHaveBeenCalledExactlyOnceWith('c', 0)
  })

  it('takes no new press while the row let go settles', () => {
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c'], onMove))
    layOut()
    pointer('pointerDown', 'a', 20)
    pointer('pointerMove', 'a', 110)
    pointer('pointerUp', 'a', 110)
    pointer('pointerDown', 'c', 100, { pointerId: 2 })
    pointer('pointerMove', 'c', 10, { pointerId: 2 })
    // c gives way to a, and is not itself lifted.
    expect(lifted()).toEqual([item('a')])
    expect(shift('c')).toBe(`translateY(-${HEIGHT}px)`)
    settle()
    expect(onMove).toHaveBeenCalledExactlyOnceWith('a', 2)
  })

  it.each([
    ['another button', { button: 2 }],
    ['a second finger', { isPrimary: false }],
  ])('doesn’t drag on a press with %s', (_, more) => {
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c'], onMove))
    layOut()
    pointer('pointerDown', 'a', 20, more)
    pointer('pointerMove', 'a', 110)
    pointer('pointerUp', 'a', 110)
    settle()
    expect(moving()).toHaveLength(0)
    expect(onMove).not.toHaveBeenCalled()
  })

  it('lands at once for someone who asked for less motion', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    )
    try {
      const onMove = vi.fn()
      render(draw(['a', 'b', 'c'], onMove))
      layOut()
      pointer('pointerDown', 'a', 20)
      pointer('pointerMove', 'a', 110)
      pointer('pointerUp', 'a', 110)
      expect(onMove).toHaveBeenCalledExactlyOnceWith('a', 2)
      expect(shown()).toEqual(['1: Task b', '2: Task c', '3: Task a'])
      expect(moving()).toHaveLength(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('stops the drag once a row joined or left under it', () => {
    const onMove = vi.fn()
    const { rerender } = render(draw(['a', 'b', 'c'], onMove))
    layOut()
    pointer('pointerDown', 'a', 20)
    pointer('pointerMove', 'a', 110)
    // b starts while a is held.
    rerender(draw(['a', 'c'], onMove))
    expect(shown()).toEqual(['1: Task a', '2: Task c'])
    expect(moving()).toHaveLength(0)
    pointer('pointerUp', 'a', 110)
    settle()
    expect(onMove).not.toHaveBeenCalled()
  })

  it('stops following the pointer once the line is gone', () => {
    const onMove = vi.fn()
    const { unmount } = render(draw(['a', 'b', 'c'], onMove))
    layOut()
    const first = item('a').querySelector('p')!
    pointer('pointerDown', 'a', 20)
    pointer('pointerMove', 'a', 110)
    unmount()
    fireEvent.pointerMove(first, { pointerId: 1, isPrimary: true, buttons: 1, clientY: 150 })
    fireEvent.pointerUp(first, { pointerId: 1, isPrimary: true, buttons: 0, clientY: 150 })
    act(() => void vi.advanceTimersByTime(LAND))
    expect(onMove).not.toHaveBeenCalled()
  })

  it('shows no grip with one row in line, or without a way to move them, and takes no drag', () => {
    const { rerender } = render(draw(['a'], vi.fn()))
    expect(screen.queryByRole('button', { name: /in the line$/ })).toBeNull()
    rerender(draw(['a', 'b']))
    layOut()
    expect(screen.queryByRole('button', { name: /in the line$/ })).toBeNull()
    pointer('pointerDown', 'a', 20)
    pointer('pointerMove', 'a', 110)
    expect(moving()).toHaveLength(0)
    expect(shown()).toEqual(['1: Task a', '2: Task b'])
  })
})

describe('scrolling the lane while a row is dragged', () => {
  it('scrolls while the pointer is held at an edge, the row going with it', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    render(draw(ids, vi.fn()))
    layOut(200)
    pointer('pointerDown', 'a', 20)
    pointer('pointerMove', 'a', 190)
    expect(shift('a')).toBe('translateY(170px)')
    act(() => void vi.advanceTimersToNextFrame())
    expect(list().scrollTop).toBe(10)
    expect(shift('a')).toBe('translateY(180px)')
    act(() => void vi.advanceTimersToNextFrame())
    expect(shift('a')).toBe('translateY(190px)')
    // Away from the edge, it stops.
    pointer('pointerMove', 'a', 100)
    act(() => void vi.advanceTimersToNextFrame())
    expect(list().scrollTop).toBe(20)
    // At the top's edge, back the other way, as far as the top.
    pointer('pointerMove', 'a', 10)
    for (let i = 0; i < 3; i++) act(() => void vi.advanceTimersToNextFrame())
    expect(list().scrollTop).toBe(0)
    expect(shift('a')).toBe('')
    pointer('pointerUp', 'a', 10)
    act(() => void vi.advanceTimersByTime(LAND))
    // Let go, it scrolls no more.
    pointer('pointerMove', 'a', 190, { buttons: 0 })
    act(() => void vi.advanceTimersToNextFrame())
    expect(list().scrollTop).toBe(0)
  })

  it('reaches the last place by scrolling to it', () => {
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], onMove))
    layOut(200)
    pointer('pointerDown', 'a', 20)
    pointer('pointerMove', 'a', 190)
    for (let i = 0; i < 40; i++) act(() => void vi.advanceTimersToNextFrame())
    expect(list().scrollTop).toBe(120)
    pointer('pointerUp', 'a', 190)
    settle()
    expect(onMove).toHaveBeenCalledExactlyOnceWith('a', 7)
  })
})

describe('moving a row up next by key', () => {
  const key = (id: string, key: string, more: Partial<KeyboardEventInit> = {}) =>
    fireEvent.keyDown(grip(id), { key, altKey: true, shiftKey: true, ...more })

  it('moves the focused row one place either way with ⌥⇧↑ and ⌥⇧↓, without opening its menu', () => {
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c'], onMove))
    expect(key('b', 'ArrowDown')).toBe(false)
    expect(onMove).toHaveBeenLastCalledWith('b', 2)
    expect(shown()).toEqual(['1: Task a', '2: Task c', '3: Task b'])
    expect(key('b', 'ArrowUp')).toBe(false)
    expect(onMove).toHaveBeenLastCalledWith('b', 1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('stops at either end, and leaves other keys and other modifiers alone', () => {
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c'], onMove))
    key('a', 'ArrowUp')
    key('c', 'ArrowDown')
    key('b', 'ArrowDown', { shiftKey: false })
    key('b', 'ArrowDown', { altKey: false })
    key('b', 'ArrowDown', { ctrlKey: true })
    key('b', 'ArrowLeft')
    expect(onMove).not.toHaveBeenCalled()
  })

  it('gives the grip the focus again once the row is put where it goes', () => {
    render(draw(['a', 'b', 'c'], vi.fn()))
    grip('c').focus()
    key('c', 'ArrowUp')
    expect(shown()).toEqual(['1: Task a', '2: Task c', '3: Task b'])
    expect(grip('c')).toHaveFocus()
  })
})

describe('a move the line given has yet to say', () => {
  /* Moves whose answers the test gives, in turn. */
  const answers = () => {
    const pending: Array<{ resolve: () => void; reject: () => void }> = []
    const onMove = vi.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          pending.push({ resolve, reject: () => reject(new Error('No')) })
        }),
    )
    return {
      onMove,
      acknowledge: (n: number) => act(async () => pending[n]!.resolve()),
      refuse: (n: number) => act(async () => pending[n]!.reject()),
    }
  }

  const drag = (id: string, from: number, to: number) => {
    pointer('pointerDown', id, from)
    pointer('pointerMove', id, to)
    pointer('pointerUp', id, to)
    settle()
  }

  it('keeps the order put after a drop until the runtime’s list says it, however long that takes', async () => {
    const move = answers()
    const { rerender } = render(draw(['a', 'b', 'c'], move.onMove))
    layOut()
    drag('c', 100, 10)
    expect(shown()).toEqual(['1: Task c', '2: Task a', '3: Task b'])
    await move.acknowledge(0)
    // The board's list hasn't caught up: the line stays as it was put.
    act(() => void vi.advanceTimersByTime(SETTLE - 1))
    expect(shown()).toEqual(['1: Task c', '2: Task a', '3: Task b'])
    rerender(draw(['c', 'a', 'b'], move.onMove))
    expect(shown()).toEqual(['1: Task c', '2: Task a', '3: Task b'])
    act(() => void vi.advanceTimersByTime(SETTLE))
    expect(shown()).toEqual(['1: Task c', '2: Task a', '3: Task b'])
  })

  it('keeps the order put while the runtime has yet to acknowledge it, however long that takes', () => {
    const move = answers()
    render(draw(['a', 'b', 'c'], move.onMove))
    layOut()
    drag('c', 100, 10)
    act(() => void vi.advanceTimersByTime(10 * SETTLE))
    expect(shown()).toEqual(['1: Task c', '2: Task a', '3: Task b'])
  })

  it('goes back where the runtime refuses the move', async () => {
    const move = answers()
    render(draw(['a', 'b', 'c'], move.onMove))
    layOut()
    drag('c', 100, 10)
    await move.refuse(0)
    expect(shown()).toEqual(['1: Task a', '2: Task b', '3: Task c'])
  })

  it('shows a move with no promise at once, and the line given again after a long while, should it never say the move', () => {
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c'], onMove))
    layOut()
    drag('c', 100, 10)
    expect(onMove).toHaveBeenCalledExactlyOnceWith('c', 0)
    expect(shown()).toEqual(['1: Task c', '2: Task a', '3: Task b'])
    act(() => void vi.advanceTimersByTime(SETTLE - 1))
    expect(shown()).toEqual(['1: Task c', '2: Task a', '3: Task b'])
    act(() => void vi.advanceTimersByTime(1))
    expect(shown()).toEqual(['1: Task a', '2: Task b', '3: Task c'])
  })

  it('lets the row fall in the document and its transform go in one render, so nothing flickers between', () => {
    const seen: Array<string> = []
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c'], onMove))
    layOut()
    const watch = new MutationObserver(() => seen.push(`${shown().join()}|${moving().length}`))
    watch.observe(list(), { subtree: true, childList: true, attributes: true })
    pointer('pointerDown', 'a', 20)
    pointer('pointerMove', 'a', 110)
    pointer('pointerUp', 'a', 110)
    settle()
    watch.disconnect()
    // Never the new order with a row still shifted, nor the old one with none.
    expect(seen.filter((state) => state.startsWith('1: Task b,2: Task c,3: Task a|') && !state.endsWith('|0'))).toHaveLength(0)
  })

  it('opens from the keyboard as before', async () => {
    vi.useRealTimers()
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c'], onMove))
    grip('c').focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.click(within(await screen.findByRole('menu', { name: 'Move in the line' })).getByRole('menuitem', { name: 'Move up' }))
    await waitFor(() => expect(onMove).toHaveBeenCalledWith('c', 1))
  })
})
