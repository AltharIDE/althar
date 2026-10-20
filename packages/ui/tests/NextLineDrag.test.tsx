import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from 'storybook/test'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NextLine, SETTLE } from '../src/board/NextLine/NextLine'

/*
 * Up next's rows dragged by their grips. jsdom lays nothing out, so each row
 * is given a box here: 40 pixels tall, one under the other, in the order
 * they are drawn.
 */
const HEIGHT = 40

const row = (id: string) => ({ id, title: `Task ${id}` })
const draw = (ids: ReadonlyArray<string>, onMove?: (id: string, to: number) => void | Promise<unknown>) => (
  <NextLine rows={ids.map(row)} render={(id, place) => <p>{`${place}: Task ${id}`}</p>} {...(onMove ? { onMove } : {})} />
)
const shown = () => screen.getAllByRole('listitem').map((item) => item.querySelector('p')?.textContent)
const grip = (id: string) => screen.getByRole('button', { name: `Move Task ${id} in the line` })
const lifted = () => screen.getAllByRole('listitem').filter((item) => item.className.includes('lifted'))

const layOut = () =>
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.tagName === 'LI' ? Array.from(this.parentElement!.children).indexOf(this) * HEIGHT : 0
    return { top, bottom: top + HEIGHT, height: HEIGHT, left: 0, right: 300, width: 300, x: 0, y: top, toJSON: () => ({}) } as DOMRect
  })

/* The grip pressed, the pointer then followed on the window, as a browser sends it. */
const press = (id: string, clientY: number, more: Partial<PointerEventInit> = {}) =>
  fireEvent.pointerDown(grip(id), { pointerId: 1, isPrimary: true, button: 0, buttons: 1, clientY, ...more })
const move = (clientY: number, more: Partial<PointerEventInit> = {}) =>
  fireEvent.pointerMove(window, { pointerId: 1, isPrimary: true, buttons: 1, clientY, ...more })
const release = (clientY: number, more: Partial<PointerEventInit> = {}) =>
  fireEvent.pointerUp(window, { pointerId: 1, isPrimary: true, button: 0, buttons: 0, clientY, ...more })
const cancel = () => fireEvent.pointerCancel(window, { pointerId: 1, isPrimary: true })

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('dragging a row up next by its grip', () => {
  it('lifts the row, the others making room and each place saying where it would be, and keeps the order where it is let go', () => {
    layOut()
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c', 'd'], onMove))
    press('a', 20)
    move(110)
    // Past the middles of b and c: it would be third.
    expect(shown()).toEqual(['1: Task b', '2: Task c', '3: Task a', '4: Task d'])
    expect(lifted().map((item) => item.querySelector('p')?.textContent)).toEqual(['3: Task a'])
    move(10)
    expect(shown()).toEqual(['1: Task a', '2: Task b', '3: Task c', '4: Task d'])
    move(150)
    expect(shown()).toEqual(['1: Task b', '2: Task c', '3: Task d', '4: Task a'])
    release(150)
    expect(onMove).toHaveBeenCalledExactlyOnceWith('a', 3)
    expect(shown()).toEqual(['1: Task b', '2: Task c', '3: Task d', '4: Task a'])
    expect(lifted()).toHaveLength(0)
    // Nothing follows the pointer once it is let go.
    move(10)
    expect(shown()).toEqual(['1: Task b', '2: Task c', '3: Task d', '4: Task a'])
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('moves nothing where the row is let go at its own place', () => {
    layOut()
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c'], onMove))
    press('b', 60)
    move(70)
    expect(lifted()).toHaveLength(1)
    release(70)
    expect(onMove).not.toHaveBeenCalled()
    expect(shown()).toEqual(['1: Task a', '2: Task b', '3: Task c'])
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens the moves as a menu where the grip is pressed and let go without dragging', async () => {
    layOut()
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c'], onMove))
    press('c', 100)
    // A few pixels is still a press.
    move(102)
    expect(lifted()).toHaveLength(0)
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.pointerUp(grip('c'), { pointerId: 1, isPrimary: true, button: 0, buttons: 0, clientY: 102 })
    const menu = within(await screen.findByRole('menu', { name: 'Move in the line' }))
    // The last row can go up, not down.
    expect(menu.getByRole('menuitem', { name: 'Move down' })).toHaveAttribute('aria-disabled', 'true')
    expect(menu.getByRole('menuitem', { name: 'Move to the back of the line' })).toHaveAttribute('aria-disabled', 'true')
    expect(menu.getByRole('menuitem', { name: 'Move up' })).not.toHaveAttribute('aria-disabled')
    expect(onMove).not.toHaveBeenCalled()
  })

  it('puts the row back on Escape, and its release then moves nothing and opens no menu', () => {
    layOut()
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c'], onMove))
    press('a', 20)
    move(110)
    expect(shown()).toEqual(['1: Task b', '2: Task c', '3: Task a'])
    // Another key leaves the drag be.
    fireEvent.keyDown(grip('a'), { key: 'Tab' })
    expect(lifted()).toHaveLength(1)
    fireEvent.keyDown(grip('a'), { key: 'Escape' })
    expect(shown()).toEqual(['1: Task a', '2: Task b', '3: Task c'])
    expect(lifted()).toHaveLength(0)
    release(110)
    expect(onMove).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('puts the row back where the press is cancelled', () => {
    layOut()
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c'], onMove))
    press('a', 20)
    move(110)
    cancel()
    expect(shown()).toEqual(['1: Task a', '2: Task b', '3: Task c'])
    release(110)
    expect(onMove).not.toHaveBeenCalled()
  })

  it('takes a move with no button down as hover after a missed release, and puts the row back', () => {
    layOut()
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c'], onMove))
    press('a', 20)
    move(110)
    move(115, { buttons: 0 })
    expect(shown()).toEqual(['1: Task a', '2: Task b', '3: Task c'])
    expect(lifted()).toHaveLength(0)
    release(115)
    expect(onMove).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('follows only the pointer that pressed', () => {
    layOut()
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c'], onMove))
    press('a', 20)
    move(110, { pointerId: 2 })
    release(110, { pointerId: 2 })
    fireEvent.pointerCancel(window, { pointerId: 2 })
    expect(lifted()).toHaveLength(0)
    move(110)
    expect(shown()).toEqual(['1: Task b', '2: Task c', '3: Task a'])
    release(110)
    expect(onMove).toHaveBeenCalledExactlyOnceWith('a', 2)
  })

  it('lets a new press take over from one whose release was missed', () => {
    layOut()
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c'], onMove))
    press('a', 20)
    press('c', 100, { pointerId: 2 })
    // The first pointer is no longer followed.
    move(110)
    expect(lifted()).toHaveLength(0)
    move(10, { pointerId: 2 })
    expect(shown()).toEqual(['1: Task c', '2: Task a', '3: Task b'])
    release(10, { pointerId: 2 })
    expect(onMove).toHaveBeenCalledExactlyOnceWith('c', 0)
  })

  it.each([
    ['another button', { button: 2 }],
    ['a second finger', { isPrimary: false }],
  ])('doesn’t drag on a press with %s', (_, more) => {
    layOut()
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c'], onMove))
    press('a', 20, more)
    move(110)
    release(110)
    expect(shown()).toEqual(['1: Task a', '2: Task b', '3: Task c'])
    expect(onMove).not.toHaveBeenCalled()
  })

  it('draws no row that left the line while another was dragged', () => {
    layOut()
    const onMove = vi.fn()
    const { rerender } = render(draw(['a', 'b', 'c'], onMove))
    press('a', 20)
    move(110)
    expect(shown()).toEqual(['1: Task b', '2: Task c', '3: Task a'])
    // b starts while a is held.
    rerender(draw(['a', 'c'], onMove))
    expect(screen.getAllByRole('listitem').map((item) => item.querySelector('p')?.textContent?.split(': ')[1])).toEqual([
      'Task c',
      'Task a',
    ])
    release(110)
    expect(onMove).toHaveBeenCalledExactlyOnceWith('a', 1)
    expect(shown()).toEqual(['1: Task c', '2: Task a'])
  })

  it('stops following the pointer once the line is gone', () => {
    layOut()
    const onMove = vi.fn()
    const { unmount } = render(draw(['a', 'b', 'c'], onMove))
    press('a', 20)
    move(110)
    unmount()
    move(150)
    release(150)
    expect(onMove).not.toHaveBeenCalled()
  })

  it('shows no grip with one row in line, or without a way to move them', () => {
    const { rerender } = render(draw(['a'], vi.fn()))
    expect(screen.queryByRole('button')).toBeNull()
    rerender(draw(['a', 'b']))
    expect(screen.queryByRole('button')).toBeNull()
    expect(shown()).toEqual(['1: Task a', '2: Task b'])
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

  const moveFromMenu = async (id: string, to: string) => {
    grip(id).focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.click(within(await screen.findByRole('menu', { name: 'Move in the line' })).getByRole('menuitem', { name: to }))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  }

  it('keeps a later move, whatever the runtime says of an earlier one', async () => {
    const move = answers()
    render(draw(['a', 'b', 'c'], move.onMove))
    await moveFromMenu('c', 'Move to the front of the line')
    await moveFromMenu('a', 'Move down')
    expect(shown()).toEqual(['1: Task c', '2: Task b', '3: Task a'])
    await move.acknowledge(0)
    expect(shown()).toEqual(['1: Task c', '2: Task b', '3: Task a'])
    await move.refuse(1)
    expect(shown()).toEqual(['1: Task a', '2: Task b', '3: Task c'])
  })

  it('keeps a later move where the runtime refuses an earlier one', async () => {
    const move = answers()
    render(draw(['a', 'b', 'c'], move.onMove))
    await moveFromMenu('c', 'Move up')
    await moveFromMenu('a', 'Move down')
    expect(shown()).toEqual(['1: Task c', '2: Task a', '3: Task b'])
    await move.refuse(0)
    expect(shown()).toEqual(['1: Task c', '2: Task a', '3: Task b'])
  })

  it('shows a move with no promise at once, and the line given again shortly after, should it never say the move', () => {
    vi.useFakeTimers()
    layOut()
    const onMove = vi.fn()
    render(draw(['a', 'b', 'c'], onMove))
    press('c', 100)
    move(10)
    release(10)
    expect(onMove).toHaveBeenCalledExactlyOnceWith('c', 0)
    expect(shown()).toEqual(['1: Task c', '2: Task a', '3: Task b'])
    act(() => void vi.advanceTimersByTime(SETTLE - 1))
    expect(shown()).toEqual(['1: Task c', '2: Task a', '3: Task b'])
    act(() => void vi.advanceTimersByTime(1))
    expect(shown()).toEqual(['1: Task a', '2: Task b', '3: Task c'])
  })
})
