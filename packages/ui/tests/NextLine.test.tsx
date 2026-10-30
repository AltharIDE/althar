import { act, render, screen, within } from '@testing-library/react'
import { userEvent } from 'storybook/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NextLine, SETTLE } from '../src/board/NextLine/NextLine'

const row = (id: string) => ({ id, title: `Task ${id}` })
const draw = (ids: ReadonlyArray<string>, onMove: (id: string, to: number) => void | Promise<unknown>) => (
  <NextLine rows={ids.map(row)} render={(id, place) => <p>{`${place}: Task ${id}`}</p>} onMove={onMove} />
)
const shown = () => screen.getAllByRole('listitem').map((item) => item.querySelector('p')?.textContent)

/** Moves a row from its grip's menu. */
const moveFromMenu = async (id: string, to: string) => {
  screen.getByRole('button', { name: `Move Task ${id} in the line` }).focus()
  await userEvent.keyboard('{Enter}')
  await userEvent.click(within(await screen.findByRole('menu', { name: 'Move in the line' })).getByRole('menuitem', { name: to }))
}

/** A move whose acknowledgement the test gives. */
const pending = () => {
  let acknowledge = () => {}
  let refuse = () => {}
  const onMove = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        acknowledge = resolve
        refuse = () => reject(new Error('No'))
      }),
  )
  return { onMove, acknowledge: () => act(async () => acknowledge()), refuse: () => act(async () => refuse()) }
}

describe('the line up next, put in the person’s order', () => {
  it('shows a move at once, and the runtime’s line once it says it', async () => {
    const move = pending()
    const { rerender } = render(draw(['a', 'b', 'c'], move.onMove))
    await moveFromMenu('c', 'Move to the front of the line')
    expect(move.onMove).toHaveBeenCalledWith('c', 0)
    expect(shown()).toEqual(['1: Task c', '2: Task a', '3: Task b'])
    await move.acknowledge()
    expect(shown()).toEqual(['1: Task c', '2: Task a', '3: Task b'])
    rerender(draw(['c', 'a', 'b'], move.onMove))
    // Then put back the oldest first, as the runtime says.
    rerender(draw(['a', 'b', 'c'], move.onMove))
    expect(shown()).toEqual(['1: Task a', '2: Task b', '3: Task c'])
  })

  it('goes back where the runtime refuses the move', async () => {
    const move = pending()
    render(draw(['a', 'b', 'c'], move.onMove))
    await moveFromMenu('c', 'Move up')
    expect(shown()).toEqual(['1: Task a', '2: Task c', '3: Task b'])
    await move.refuse()
    expect(shown()).toEqual(['1: Task a', '2: Task b', '3: Task c'])
  })

  it('follows the runtime once it acknowledged the move, though a task joined before it said the new order', async () => {
    const move = pending()
    const { rerender } = render(draw(['a', 'b', 'c'], move.onMove))
    await moveFromMenu('c', 'Move to the front of the line')
    // One joins before the runtime says the order put: it goes at the end, the order put kept.
    rerender(draw(['a', 'b', 'c', 'd'], move.onMove))
    expect(shown()).toEqual(['1: Task c', '2: Task a', '3: Task b', '4: Task d'])
    await move.acknowledge()
    expect(shown()).toEqual(['1: Task c', '2: Task a', '3: Task b', '4: Task d'])
    rerender(draw(['c', 'a', 'b', 'd'], move.onMove))
    // The runtime's line now rules: the person put it back to the oldest first.
    rerender(draw(['a', 'b', 'c', 'd'], move.onMove))
    expect(shown()).toEqual(['1: Task a', '2: Task b', '3: Task c', '4: Task d'])
  })

  it('follows the runtime shortly after it acknowledged the move, though its line never changed', async () => {
    const move = pending()
    const { rerender } = render(draw(['a', 'b', 'c'], move.onMove))
    await moveFromMenu('c', 'Move to the front of the line')
    rerender(draw(['a', 'b', 'c', 'd'], move.onMove))
    vi.useFakeTimers()
    try {
      await move.acknowledge()
      // The move and a reset to the oldest first came in one fetch: the line given is as it was at the acknowledgement.
      rerender(draw(['a', 'b', 'c', 'd'], move.onMove))
      expect(shown()).toEqual(['1: Task c', '2: Task a', '3: Task b', '4: Task d'])
      act(() => void vi.advanceTimersByTime(SETTLE))
      expect(shown()).toEqual(['1: Task a', '2: Task b', '3: Task c', '4: Task d'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('follows the runtime once it acknowledged the move, though one left before it said the new order', async () => {
    const move = pending()
    const { rerender } = render(draw(['a', 'b', 'c'], move.onMove))
    await moveFromMenu('c', 'Move to the front of the line')
    // The oldest starts before the runtime says the order put.
    rerender(draw(['b', 'c'], move.onMove))
    expect(shown()).toEqual(['1: Task c', '2: Task b'])
    await move.acknowledge()
    // The runtime's next word: the person moved b first from its own view.
    rerender(draw(['b', 'c', 'e'], move.onMove))
    expect(shown()).toEqual(['1: Task b', '2: Task c', '3: Task e'])
  })
})

describe('the line up next, moving as a whole', () => {
  // Each row stands where its place puts it, 50 px apart, and what the browser is asked to animate is kept.
  let played: Array<{ el: Element; keyframes: Keyframe[] }>
  beforeEach(() => {
    played = []
    Element.prototype.animate = function animate(this: Element, keyframes: Keyframe[] | PropertyIndexedKeyframes | null) {
      played.push({ el: this, keyframes: keyframes as Keyframe[] })
      return { cancel: vi.fn(), addEventListener: vi.fn() } as unknown as Animation
    }
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element) {
      const items = [...(this.parentElement?.children ?? [])]
      return this.tagName === 'LI' ? new DOMRect(0, items.indexOf(this) * 50, 280, 40) : new DOMRect(0, 0, 0, 0)
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    delete (Element.prototype as Partial<Element>).animate
  })
  const slid = (id: string) => played.filter((one) => (one.el as HTMLElement).dataset.row === id).map((one) => one.keyframes[0])

  it('slides a row moved by key to its place, and back where the move is refused', async () => {
    const move = pending()
    render(draw(['a', 'b', 'c'], move.onMove))
    screen.getByRole('button', { name: 'Move Task a in the line' }).focus()
    await userEvent.keyboard('{Alt>}{Shift>}{ArrowDown}{/Shift}{/Alt}')
    expect(shown()).toEqual(['1: Task b', '2: Task a', '3: Task c'])
    expect(slid('a')).toEqual([{ translate: '0px -50px' }])
    expect(slid('b')).toEqual([{ translate: '0px 50px' }])
    await move.refuse()
    expect(shown()).toEqual(['1: Task a', '2: Task b', '3: Task c'])
    expect(slid('a')).toEqual([{ translate: '0px -50px' }, { translate: '0px 50px' }])
  })
})
