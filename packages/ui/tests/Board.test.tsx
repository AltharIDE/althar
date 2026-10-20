import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Board, BoardColumn, boardText, NO_FOLDS, RAIL, railsOf } from '../src/board/Board/Board'
import { BoardLane } from '../src/foundations/vocabulary'

/* Up next 2, Running 3, Needs you 1, Settled 40: an afternoon's board. */
const lanes = (counts: Partial<Record<BoardLane, number>> = {}) =>
  [BoardLane.Next, BoardLane.Running, BoardLane.Yours, BoardLane.Settled].map((lane) => ({
    lane,
    count: counts[lane] ?? { [BoardLane.Next]: 2, [BoardLane.Running]: 3, [BoardLane.Yours]: 1, [BoardLane.Settled]: 40 }[lane],
  }))

const sorted = (rails: ReadonlySet<BoardLane>) => [...rails].toSorted()

describe('which lanes the board collapses', () => {
  it('collapses nothing by itself where the four lanes fit', () => {
    expect(sorted(railsOf(lanes(), NO_FOLDS, 4 * 260, 260))).toEqual([])
  })

  it('collapses Settled first, then Up next, as the board narrows', () => {
    expect(sorted(railsOf(lanes(), NO_FOLDS, 1008, 260))).toEqual([BoardLane.Settled])
    expect(sorted(railsOf(lanes(), NO_FOLDS, 2 * 260 + 2 * RAIL, 260))).toEqual([BoardLane.Next, BoardLane.Settled].toSorted())
  })

  it('collapses an empty lane before any other', () => {
    expect(sorted(railsOf(lanes({ [BoardLane.Running]: 0 }), NO_FOLDS, 1008, 260))).toEqual([BoardLane.Running])
  })

  it('counts Settled with only what was kept for later as filled, not empty', () => {
    const kept = lanes({ [BoardLane.Running]: 0, [BoardLane.Settled]: 0 }).map((one) =>
      one.lane === BoardLane.Settled ? { ...one, filled: true } : one,
    )
    expect(sorted(railsOf(kept, NO_FOLDS, 1008, 260))).toEqual([BoardLane.Running])
  })

  it('never collapses Needs you while something waits in it, and lets the board scroll instead', () => {
    expect(sorted(railsOf(lanes(), NO_FOLDS, 200, 260))).toEqual([BoardLane.Next, BoardLane.Running, BoardLane.Settled].toSorted())
    expect(railsOf(lanes(), { collapsed: [BoardLane.Yours], opened: [] }, 4 * 260, 260).has(BoardLane.Yours)).toBe(false)
  })

  it('collapses Needs you, empty, like any lane', () => {
    expect(sorted(railsOf(lanes({ [BoardLane.Yours]: 0 }), NO_FOLDS, 1008, 260))).toEqual([BoardLane.Yours])
    expect(railsOf(lanes({ [BoardLane.Yours]: 0 }), { collapsed: [BoardLane.Yours], opened: [] }, 0, 260).has(BoardLane.Yours)).toBe(true)
  })

  it('keeps what the person collapsed collapsed, and counts its rail toward the fit', () => {
    expect(sorted(railsOf(lanes(), { collapsed: [BoardLane.Next], opened: [] }, 4 * 260, 260))).toEqual([BoardLane.Next])
    // Up next's rail leaves room for the other three.
    expect(sorted(railsOf(lanes(), { collapsed: [BoardLane.Next], opened: [] }, 3 * 260 + RAIL, 260))).toEqual([BoardLane.Next])
  })

  it('leaves a lane the person opened open, and collapses the next in line instead', () => {
    expect(sorted(railsOf(lanes(), { collapsed: [], opened: [BoardLane.Settled] }, 1008, 260))).toEqual([BoardLane.Next])
  })

  it('collapses nothing by itself before the board is measured', () => {
    expect(sorted(railsOf(lanes(), NO_FOLDS, 0, 260))).toEqual([])
  })

  it('narrows lanes to the narrowest the board is given, as beside the conversation', () => {
    expect(sorted(railsOf(lanes(), NO_FOLDS, 464, 186))).toEqual([BoardLane.Next, BoardLane.Settled].toSorted())
  })
})

describe('a board that measures itself', () => {
  const observers: Array<() => void> = []
  let width = 1008

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    observers.length = 0
  })

  const measured = () => {
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
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width)
  }

  const board = (onFoldsChange = vi.fn()) =>
    render(
      <Board label="Meridian’s work" onFoldsChange={onFoldsChange}>
        <BoardColumn lane={BoardLane.Next} count={2} />
        <BoardColumn lane={BoardLane.Running} count={3} />
        <BoardColumn lane={BoardLane.Yours} count={1} />
        <BoardColumn lane={BoardLane.Settled} count={40} />
      </Board>,
    )

  it('collapses Settled to a rail where four lanes don’t fit, and opens it again when the window widens', () => {
    width = 1008
    measured()
    board()
    expect(screen.getByRole('button', { name: 'Expand Settled, 40' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Meridian’s work' }).style.gridTemplateColumns).toBe(
      'minmax(var(--lane-min, 260px), 460px) minmax(var(--lane-min, 260px), 460px) minmax(var(--lane-min, 260px), 460px) minmax(40px, 40px)',
    )
    width = 1600
    act(() => observers.forEach((heard) => heard()))
    expect(screen.queryByRole('button', { name: 'Expand Settled, 40' })).not.toBeInTheDocument()
  })

  it('keeps Settled open once the person opens it from its rail, and collapses Up next instead', () => {
    width = 1008
    measured()
    const onFoldsChange = vi.fn()
    board(onFoldsChange)
    fireEvent.click(screen.getByRole('button', { name: 'Expand Settled, 40' }))
    expect(onFoldsChange).toHaveBeenCalledWith({ collapsed: [], opened: [BoardLane.Settled] })
    expect(screen.getByRole('button', { name: 'Expand Up next, 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse Settled' })).toHaveFocus()
  })

  /* 600 px: Up next and Running open, an empty Needs you and Settled as rails, until something waits on the person. */
  const afternoon = (waiting: number) => (
    <>
      <Board label="Meridian’s work">
        <BoardColumn lane={BoardLane.Next} count={2}>
          <button type="button">Add a retry to checkout</button>
        </BoardColumn>
        <BoardColumn lane={BoardLane.Running} count={3} />
        <BoardColumn lane={BoardLane.Yours} count={waiting}>
          {waiting > 0 && <button type="button">Ship it</button>}
        </BoardColumn>
        <BoardColumn lane={BoardLane.Settled} count={40} />
      </Board>
      <button type="button">Message the lead</button>
    </>
  )

  it('gives the focus to the rail of a lane it collapses from under it, when something arrives in Needs you', () => {
    width = 600
    measured()
    const { rerender } = render(afternoon(0))
    screen.getByRole('button', { name: 'Add a retry to checkout' }).focus()
    rerender(afternoon(1))
    expect(screen.getByRole('button', { name: 'Expand Up next, 2' })).toHaveFocus()
  })

  it('gives the focus to Needs you’s head when its rail opens by itself under it', () => {
    width = 600
    measured()
    const { rerender } = render(afternoon(0))
    screen.getByRole('button', { name: 'Expand Needs you, 0' }).focus()
    rerender(afternoon(1))
    expect(screen.getByRole('button', { name: boardText.stays })).toHaveFocus()
  })

  it('leaves the focus alone where it was elsewhere, or had left the lane before it collapsed', async () => {
    width = 600
    measured()
    const { rerender } = render(afternoon(0))
    screen.getByRole('button', { name: 'Message the lead' }).focus()
    rerender(afternoon(1))
    expect(screen.getByRole('button', { name: 'Message the lead' })).toHaveFocus()
    rerender(afternoon(0))
    const card = screen.getByRole('button', { name: 'Add a retry to checkout' })
    card.focus()
    act(() => card.blur())
    await act(async () => {})
    rerender(afternoon(1))
    expect(document.body).toHaveFocus()
  })
})

describe('a lane holding two things', () => {
  it('names both in its head, the one showing pressed, keeps its own name, and shows the other once pressed', () => {
    const onChange = vi.fn()
    render(
      <BoardColumn
        lane={BoardLane.Settled}
        count={28}
        shelves={{
          label: 'Settled or kept for later',
          value: 'settled',
          onChange,
          options: [
            { value: 'settled', label: 'Settled', count: 28 },
            { value: 'kept', label: 'Kept', count: 3, icon: 'pin' },
          ],
        }}
      >
        <p>The ledger</p>
      </BoardColumn>,
    )
    expect(screen.getByRole('region', { name: 'Settled' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Settled or kept for later' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Settled 28', pressed: true })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Kept 3', pressed: false }))
    expect(onChange).toHaveBeenCalledWith('kept')
  })
})
