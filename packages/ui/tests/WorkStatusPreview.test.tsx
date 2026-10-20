import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type WorkNeed, WorkStatus } from '../src/chrome/WorkStatus/WorkStatus'

const need = (id: string, title: string, more: Partial<WorkNeed> = {}): WorkNeed => ({
  id,
  kind: 'Permission',
  title,
  onOpen: vi.fn(),
  ...more,
})
const NEEDS = [
  need('a', 'Run the migration', { at: '4m ago', meta: 'Add a retry to checkout' }),
  need('b', 'Push to main'),
  need('c', 'Accept the change', { kind: 'Ready to accept', at: '' }),
]

const count = () => screen.getByRole('button', { name: /need you/ })
const rows = () => within(screen.getByRole('list', { name: 'What needs you' })).getAllByRole('button')

afterEach(() => vi.useRealTimers())

describe('the count of what needs you', () => {
  it('is words, not a way in, without somewhere to go', () => {
    render(<WorkStatus running={2} yours={3} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('3 need you')).toBeInTheDocument()
    expect(screen.getByText('2 running')).toBeInTheDocument()
  })

  it('says when nothing here needs you', () => {
    render(<WorkStatus yours={0} onYours={vi.fn()} needs={NEEDS} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('Nothing here needs you')).toBeInTheDocument()
  })

  it('opens the first without a preview where it is given none of them', () => {
    const onYours = vi.fn()
    render(<WorkStatus yours={2} onYours={onYours} needs={[]} />)
    fireEvent.click(count())
    expect(onYours).toHaveBeenCalledOnce()
    expect(count()).not.toHaveAttribute('aria-expanded')
  })
})

describe('the preview of what needs you, by keyboard', () => {
  it('opens on ArrowDown with the focus on its first row, which the arrows, Home and End move along', async () => {
    render(<WorkStatus yours={3} onYours={vi.fn()} needs={NEEDS} />)
    count().focus()
    // Other keys leave it shut.
    fireEvent.keyDown(count(), { key: 'ArrowUp' })
    expect(screen.queryByRole('list')).toBeNull()
    fireEvent.keyDown(count(), { key: 'ArrowDown' })
    await act(async () => {})
    const [first, second, third] = rows()
    expect(first).toHaveFocus()
    expect(count()).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(first!, { key: 'ArrowDown' })
    expect(second).toHaveFocus()
    fireEvent.keyDown(second!, { key: 'End' })
    expect(third).toHaveFocus()
    fireEvent.keyDown(third!, { key: 'ArrowDown' })
    expect(first).toHaveFocus()
    fireEvent.keyDown(first!, { key: 'ArrowUp' })
    expect(third).toHaveFocus()
    fireEvent.keyDown(third!, { key: 'Home' })
    expect(first).toHaveFocus()
    expect(fireEvent.keyDown(first!, { key: 'x' })).toBe(true)
    expect(first).toHaveFocus()
  })

  it('goes back to the count on Escape', async () => {
    render(<WorkStatus yours={3} onYours={vi.fn()} needs={NEEDS} />)
    count().focus()
    fireEvent.keyDown(count(), { key: 'ArrowDown' })
    await act(async () => {})
    fireEvent.keyDown(rows()[1]!, { key: 'Escape' })
    expect(screen.queryByRole('list')).toBeNull()
    await waitFor(() => expect(count()).toHaveFocus())
  })

  it('lists each with its kind, how long it has waited and where it comes from, and opens the one chosen', async () => {
    render(<WorkStatus yours={3} onYours={vi.fn()} needs={NEEDS} />)
    count().focus()
    fireEvent.keyDown(count(), { key: 'ArrowDown' })
    await act(async () => {})
    expect(rows().map((row) => row.textContent)).toEqual([
      'Permission4m agoRun the migrationAdd a retry to checkout',
      'PermissionPush to main',
      'Ready to acceptAccept the change',
    ])
    fireEvent.click(rows()[1]!)
    expect(NEEDS[1]!.onOpen).toHaveBeenCalledOnce()
    expect(screen.queryByRole('list')).toBeNull()
  })
})

describe('the preview of what needs you, pointed at', () => {
  it('opens once the pointer rests on the count, leaving the focus, and takes ArrowDown to its first row', async () => {
    vi.useFakeTimers()
    render(
      <>
        <input aria-label="Message" />
        <WorkStatus yours={3} onYours={vi.fn()} needs={[...NEEDS, need('d', 'This one', { here: true })]} />
      </>,
    )
    screen.getByRole('textbox', { name: 'Message' }).focus()
    fireEvent.pointerEnter(count())
    act(() => void vi.advanceTimersByTime(180))
    expect(screen.getByRole('list', { name: 'What needs you' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus()
    // The one already on screen is listed, but isn't a way in.
    expect(rows()).toHaveLength(3)
    expect(screen.getByText('This one').closest('div')).toHaveTextContent('PermissionThis taskThis one')
    count().focus()
    fireEvent.keyDown(count(), { key: 'ArrowDown' })
    expect(rows()[0]).toHaveFocus()
  })

  it('stays while the pointer goes from the count onto it, or presses the count, and goes once the pointer leaves', () => {
    vi.useFakeTimers()
    const onYours = vi.fn()
    render(<WorkStatus yours={3} onYours={onYours} needs={NEEDS} />)
    fireEvent.pointerEnter(count())
    act(() => void vi.advanceTimersByTime(180))
    const list = screen.getByRole('list', { name: 'What needs you' })
    fireEvent.pointerLeave(count())
    fireEvent.pointerEnter(list.parentElement!)
    act(() => void vi.advanceTimersByTime(500))
    expect(screen.getByRole('list', { name: 'What needs you' })).toBeInTheDocument()
    // Pressing the count is not pressing outside it.
    fireEvent.pointerDown(count())
    fireEvent.click(count())
    expect(onYours).toHaveBeenCalledOnce()
    expect(screen.getByRole('list', { name: 'What needs you' })).toBeInTheDocument()
    fireEvent.pointerLeave(list.parentElement!)
    act(() => void vi.advanceTimersByTime(160))
    expect(screen.queryByRole('list')).toBeNull()
  })
})
