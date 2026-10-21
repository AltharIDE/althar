import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Board, BoardColumn, BoardDivider, boardText } from '../src/board/Board/Board'
import { Icon } from '../src/foundations/Icon/Icon'
import { BoardLane } from '../src/foundations/vocabulary'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/* A board this wide, measured once. */
const measuredAt = (width: number) => vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)

describe('the board’s lanes', () => {
  it('lays out only its lanes, whatever else is among them', () => {
    render(
      <Board label="Meridian’s work">
        <BoardColumn lane={BoardLane.Next} count={1}>
          <p>Add a retry</p>
        </BoardColumn>
        {'between'}
        <aside>Not a lane</aside>
        <BoardColumn lane={BoardLane.Running} count={0} />
      </Board>,
    )
    const board = screen.getByRole('region', { name: 'Meridian’s work' })
    expect(board.style.gridTemplateColumns.split(') ').length).toBe(2)
    expect(within(board).getByText('Not a lane')).toBeInTheDocument()
  })

  it('sets no columns on a board without lanes', () => {
    render(
      <Board label="Meridian’s work">
        <p>Loading</p>
      </Board>,
    )
    expect(screen.getByRole('region', { name: 'Meridian’s work' }).getAttribute('style')).toBeNull()
  })

  it('shows what a lane holds where it says it is filled though it counts none, and says it is empty otherwise', () => {
    render(
      <Board label="Meridian’s work">
        <BoardColumn lane={BoardLane.Running} count={0}>
          <p>Hidden</p>
        </BoardColumn>
        <BoardColumn lane={BoardLane.Settled} count={0} filled>
          <p>Kept for later</p>
        </BoardColumn>
      </Board>,
    )
    expect(screen.getByText(boardText.empty[BoardLane.Running])).toBeInTheDocument()
    expect(screen.queryByText('Hidden')).toBeNull()
    expect(screen.getByText('Kept for later')).toBeInTheDocument()
    expect(screen.queryByText(boardText.empty[BoardLane.Settled])).toBeNull()
  })

  it('collapses nothing by itself where the board can’t be measured', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    measuredAt(300)
    render(
      <Board label="Meridian’s work">
        <BoardColumn lane={BoardLane.Next} count={2} />
        <BoardColumn lane={BoardLane.Settled} count={0} />
      </Board>,
    )
    expect(screen.queryByRole('button', { name: /^Expand/ })).toBeNull()
  })

  it('keeps Needs you open while something waits in it, its chevron saying so', () => {
    const onFoldsChange = vi.fn()
    render(
      <Board label="Meridian’s work" onFoldsChange={onFoldsChange}>
        <BoardColumn lane={BoardLane.Yours} count={2} />
      </Board>,
    )
    const chevron = screen.getByRole('button', { name: boardText.stays })
    expect(chevron).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(chevron)
    expect(onFoldsChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /^Expand Needs you/ })).toBeNull()
  })

  it('gives the focus to the rail where the person collapses a lane, and back to its chevron when they open it', () => {
    const onFoldsChange = vi.fn()
    render(
      <Board label="Meridian’s work" onFoldsChange={onFoldsChange}>
        <BoardColumn lane={BoardLane.Next} count={2} />
        <BoardColumn lane={BoardLane.Running} count={1} />
      </Board>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Up next' }))
    expect(onFoldsChange).toHaveBeenLastCalledWith({ collapsed: [BoardLane.Next], opened: [] })
    expect(screen.getByRole('button', { name: 'Expand Up next, 2' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Expand Up next, 2' }))
    expect(onFoldsChange).toHaveBeenLastCalledWith({ collapsed: [], opened: [BoardLane.Next] })
    expect(screen.getByRole('button', { name: 'Collapse Up next' })).toHaveFocus()
  })

  it('gives the focus to the rail of a lane it collapses by itself, though the focus moved within the lane first', () => {
    const observers: Array<() => void> = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly heard: () => void) {
          observers.push(heard)
        }
        observe() {}
        disconnect() {}
      },
    )
    let width = 1200
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
    render(
      <Board label="Meridian’s work">
        <BoardColumn lane={BoardLane.Next} count={2}>
          <button type="button">First</button>
          <button type="button">Second</button>
        </BoardColumn>
        <BoardColumn lane={BoardLane.Running} count={3} />
        <BoardColumn lane={BoardLane.Yours} count={1} />
        <BoardColumn lane={BoardLane.Settled} count={0} />
      </Board>,
    )
    screen.getByRole('button', { name: 'First' }).focus()
    screen.getByRole('button', { name: 'Second' }).focus()
    // Narrower: the empty Settled goes first, then Up next, from under the focus.
    width = 600
    act(() => observers.forEach((heard) => heard()))
    expect(screen.getByRole('button', { name: 'Expand Up next, 2' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Expand Settled, 0' })).toBeInTheDocument()
  })

  it('draws the shelf showing with its own glyph in the lane’s head', () => {
    const { container } = render(
      <BoardColumn
        lane={BoardLane.Settled}
        count={28}
        shelves={{
          label: 'Settled or kept for later',
          value: 'kept',
          onChange: vi.fn(),
          options: [
            { value: 'settled', label: 'Settled', count: 28 },
            { value: 'kept', label: 'Kept', count: 0, icon: 'pin' },
          ],
        }}
      />,
    )
    const pin = render(<Icon name="pin" size={11} />).container.querySelector('svg')!
    expect(container.querySelector('header > svg')?.innerHTML).toBe(pin.innerHTML)
    expect(screen.getByRole('button', { name: 'Kept 0', pressed: true })).toBeInTheDocument()
  })
})

describe('a divider in a lane', () => {
  it('names the group under it, with what to do with the group at its end', () => {
    const { container, rerender } = render(<BoardDivider end={<button type="button">Clear</button>}>When an agent is free</BoardDivider>)
    expect(container.querySelector('p')).toHaveTextContent('When an agent is freeClear')
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument()
    rerender(<BoardDivider end={null}>When an agent is free</BoardDivider>)
    expect(container.querySelector('p')?.children).toHaveLength(0)
  })
})
