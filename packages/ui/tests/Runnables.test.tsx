import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type ListedRunnable, Runnables } from '../src/setup/Runnables/Runnables'

/*
 * The whole list of what a project runs, put in order by dragging (ADR-044):
 * a row picked up by its grip follows the pointer, those it passes make way,
 * and it lands where it is dropped.
 */

const LISTED: ListedRunnable[] = [
  { id: 'dev', command: 'bun run dev', about: 'althar · Worked out from the repository' },
  { id: 'storybook', name: 'Storybook', command: 'bun --filter @althar/ui storybook', about: 'althar · Added by you' },
  { id: 'desktop', name: 'Desktop app', command: 'bun --filter @althar/desktop dev', about: 'althar · Added by the coordinator' },
]

/* The rows 50 px high, one under the other, as a browser lays them out. */
function laidOut() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const at = this.tagName === 'LI' ? [...(this.parentElement?.children ?? [])].indexOf(this) : 0
    return { top: at * 50, bottom: at * 50 + 50, height: 50, left: 0, right: 600, width: 600, x: 0, y: at * 50 } as DOMRect
  })
}

const listed = () => {
  const handlers = { onOrder: vi.fn(), onDefault: vi.fn(), onEdit: vi.fn(), onRemove: vi.fn(), onAdd: vi.fn(), onClose: vi.fn() }
  const element = (more: Partial<Parameters<typeof Runnables>[0]> = {}) => (
    <Runnables project="althar" runnables={LISTED} {...handlers} {...more} />
  )
  const shown = render(element())
  return { ...handlers, again: (more: Partial<Parameters<typeof Runnables>[0]>) => shown.rerender(element(more)) }
}

const rows = () => screen.getAllByRole('listitem')
const names = () => rows().map((row) => row.querySelector('[class*="name"]')?.textContent)
const press = (target: Element | Window, kind: 'pointerDown' | 'pointerMove' | 'pointerUp', clientY: number) =>
  act(() => void fireEvent[kind](target, { pointerId: 1, isPrimary: true, button: 0, clientY }))

afterEach(() => vi.restoreAllMocks())

describe('putting what a project runs in order by dragging', () => {
  it('lands a row where it is dropped, the rest making way and the first the default', () => {
    laidOut()
    const { onOrder } = listed()
    press(screen.getByRole('button', { name: 'Drag to move bun run dev' }), 'pointerDown', 25)
    // Dragged past both, and further: it stays within the list, last.
    press(window, 'pointerMove', 400)
    expect(rows().map((row) => row.style.transform)).toEqual(['translateY(100px)', 'translateY(-50px)', 'translateY(-50px)'])
    expect(rows()[1]?.textContent).toMatch(/Default$/)
    press(window, 'pointerUp', 400)
    expect(onOrder).toHaveBeenCalledWith(['storybook', 'desktop', 'dev'])
    // It shows where it was put while the order is kept.
    expect(names()).toEqual(['Storybook', 'Desktop app', 'bun run dev'])
    expect(rows().map((row) => row.style.transform)).toEqual(['', '', ''])
  })

  it('has the next row make way once it is dragged half across it', () => {
    laidOut()
    listed()
    press(screen.getByRole('button', { name: 'Drag to move bun run dev' }), 'pointerDown', 25)
    press(window, 'pointerMove', 45)
    expect(rows()[1]?.style.transform).toBe('')
    press(window, 'pointerMove', 55)
    expect(rows()[1]?.style.transform).toBe('translateY(-50px)')
  })

  it('picks a row up by its words too, and up the list makes it the default', () => {
    laidOut()
    const { onOrder } = listed()
    press(screen.getByText('Desktop app'), 'pointerDown', 125)
    press(window, 'pointerMove', 20)
    press(window, 'pointerUp', 20)
    expect(onOrder).toHaveBeenCalledWith(['desktop', 'dev', 'storybook'])
  })

  it('takes a press for no move, and a press on its buttons for theirs', () => {
    laidOut()
    const { onOrder, onEdit } = listed()
    press(screen.getByRole('button', { name: 'Drag to move Storybook' }), 'pointerDown', 75)
    press(window, 'pointerMove', 77)
    press(window, 'pointerUp', 77)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Storybook' }))
    expect(onOrder).not.toHaveBeenCalled()
    expect(onEdit).toHaveBeenCalledWith('storybook')
  })

  it('opens with Done focused, not a grip, whose tooltip would cover the list', () => {
    listed()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Done' }))
  })

  it('puts it back on Escape, and leaves the dialog open', () => {
    laidOut()
    const { onOrder, onClose } = listed()
    press(screen.getByRole('button', { name: 'Drag to move bun run dev' }), 'pointerDown', 25)
    press(window, 'pointerMove', 90)
    act(() => void fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }))
    press(window, 'pointerUp', 90)
    expect(onOrder).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(names()).toEqual(['bun run dev', 'Storybook', 'Desktop app'])
  })

  it('shows the order it was given again once ordering went wrong', () => {
    laidOut()
    const { again } = listed()
    press(screen.getByRole('button', { name: 'Drag to move bun run dev' }), 'pointerDown', 25)
    press(window, 'pointerMove', 80)
    press(window, 'pointerUp', 80)
    expect(names()).toEqual(['Storybook', 'bun run dev', 'Desktop app'])
    again({ error: 'Could not keep the order.' })
    expect(names()).toEqual(['bun run dev', 'Storybook', 'Desktop app'])
  })
})
