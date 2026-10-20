import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AddRunnable, type AddRunnableProps, EditRunnable, type ListedRunnable, RunnableList } from '../src/setup/Runnables/Runnables'

/*
 * Adding something a project runs, changing one, and the edges of putting
 * the list in order: another pointer, other keys, the arrows on a grip.
 */

const add = (more: Partial<AddRunnableProps> = {}) => {
  const handlers = { onAdd: vi.fn(), onAddScripts: vi.fn(), onAsk: vi.fn(), onClose: vi.fn() }
  render(<AddRunnable way="type" repositories={['althar']} scripts={[]} {...handlers} {...more} />)
  return handlers
}
/* The dialog is the form itself. */
const form = () => screen.getByRole('dialog').closest('form')!

describe('adding something to run', () => {
  it('names it by its command when no name is typed, and runs it nowhere in particular in a project with no repository yet', () => {
    const { onAdd } = add({ repositories: [] })
    fireEvent.change(screen.getByRole('textbox', { name: /Command/ }), { target: { value: '  bun run dev  ' } })
    fireEvent.change(screen.getByRole('textbox', { name: /Name/ }), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onAdd).toHaveBeenCalledWith({ name: null, command: 'bun run dev', repository: null })
  })

  it('adds nothing before a command is typed', () => {
    const { onAdd } = add()
    fireEvent.submit(form())
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('adds nothing more while the last add is still going', () => {
    const { onAdd } = add({ busy: true })
    fireEvent.change(screen.getByRole('textbox', { name: /Command/ }), { target: { value: 'bun run dev' } })
    fireEvent.submit(form())
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('offers to find the one script there is', () => {
    add({ way: 'scripts', scripts: [{ id: 'storybook', command: 'bun --filter @althar/ui storybook', body: 'storybook dev --port 6006' }] })
    expect(screen.getByRole('textbox', { name: 'Find the script' })).toBeInTheDocument()
  })
})

describe('changing one', () => {
  const edit = (busy = false) => {
    const onSave = vi.fn()
    render(
      <EditRunnable
        name="Storybook"
        command="bun --filter @althar/ui storybook"
        own={false}
        from="person"
        repository="althar"
        repositories={['althar']}
        onSave={onSave}
        onRemove={() => {}}
        onClose={() => {}}
        busy={busy}
      />,
    )
    return onSave
  }

  it('saves nothing more while the last save is still going', () => {
    const onSave = edit(true)
    fireEvent.submit(form())
    expect(onSave).not.toHaveBeenCalled()
  })

  it('takes its name away when the name is emptied', () => {
    const onSave = edit()
    fireEvent.change(screen.getByRole('textbox', { name: /Name/ }), { target: { value: ' ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith({ name: null, command: 'bun --filter @althar/ui storybook', repository: 'althar' })
  })
})

const LISTED: ListedRunnable[] = [
  { id: 'dev', command: 'bun run dev', about: 'althar · Worked out from the repository' },
  { id: 'storybook', name: 'Storybook', command: 'bun --filter @althar/ui storybook', about: 'althar · Added by you' },
]

/* The rows 50 px high, one under the other, as a browser lays them out. */
function laidOut() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const at = this.tagName === 'LI' ? [...(this.parentElement?.children ?? [])].indexOf(this) : 0
    return { top: at * 50, bottom: at * 50 + 50, height: 50, left: 0, right: 600, width: 600, x: 0, y: at * 50 } as DOMRect
  })
}
const press = (target: Element | Window, kind: 'pointerDown' | 'pointerMove' | 'pointerUp', clientY: number, pointerId = 1) =>
  act(() => void fireEvent[kind](target, { pointerId, isPrimary: true, button: 0, clientY }))
const rows = () => screen.getAllByRole('listitem')

afterEach(() => vi.restoreAllMocks())

describe('the edges of putting the list in order', () => {
  const list = () => {
    const handlers = { onOrder: vi.fn(), onDefault: vi.fn(), onEdit: vi.fn(), onRemove: vi.fn() }
    render(<RunnableList runnables={LISTED} {...handlers} />)
    return handlers
  }

  it('follows only the pointer that picked a row up, and keeps the drag through other keys', () => {
    laidOut()
    const { onOrder } = list()
    press(screen.getByRole('button', { name: 'Drag to move bun run dev' }), 'pointerDown', 25)
    press(window, 'pointerMove', 90, 2)
    expect(rows().map((row) => row.style.transform)).toEqual(['', ''])
    press(window, 'pointerUp', 90, 2)
    act(() => void fireEvent.keyDown(window, { key: 'Shift' }))
    expect(onOrder).not.toHaveBeenCalled()
    press(window, 'pointerMove', 90)
    expect(rows()[1]?.style.transform).toBe('translateY(-50px)')
    press(window, 'pointerUp', 90)
    expect(onOrder).toHaveBeenCalledWith(['storybook', 'dev'])
  })

  it('moves a row down with the arrow on its grip, and leaves it for other keys', () => {
    const { onOrder } = list()
    const grip = screen.getByRole('button', { name: 'Drag to move bun run dev' })
    fireEvent.keyDown(grip, { key: 'Enter' })
    expect(onOrder).not.toHaveBeenCalled()
    fireEvent.keyDown(grip, { key: 'ArrowDown' })
    expect(onOrder).toHaveBeenCalledWith(['storybook', 'dev'])
  })
})
