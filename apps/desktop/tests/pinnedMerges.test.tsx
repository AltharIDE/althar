import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ThreadItem } from '@althar/contracts'

import { useEdge, usePinnedMerges } from '../src/renderer/shared/PinnedMerges'
import { items } from './fixtures'

/*
 * What is on its way into a branch, pinned on the composer's edge: one thing
 * open there at a time, why one came back on the notice line while its pill
 * is folded, and a pill that saw its merges in showing them so for a moment
 * before it goes.
 */

const PULL = 'https://github.com/meridian/api/pull/'
const card = (state: 'checks' | 'merged', reason?: string) =>
  items.mergeLine({
    rows: [
      { number: 1224, title: 'Plan card offers Runs on', url: `${PULL}1224`, state: 'merged' },
      {
        number: 1226,
        title: 'Keep for later shelves a task',
        url: `${PULL}1226`,
        state: reason === undefined ? state : 'sent_back',
        ...(reason === undefined ? {} : { reason }),
      },
    ],
  })

/** A composer's edge: the run chip's list, the pills, and the notice line. */
function Edge({ thread }: { thread: ReadonlyArray<ThreadItem> }) {
  const { edge, opens } = useEdge()
  const { pills, back } = usePinnedMerges(thread, edge, opens)
  return (
    <>
      <button type="button" aria-expanded={edge === 'runs'} onClick={() => opens('runs')(edge !== 'runs')}>
        Runs
      </button>
      {pills}
      <div role="note">{back}</div>
    </>
  )
}

const pill = () => screen.queryByRole('button', { name: /^Merging:/ })
const opened = () => screen.queryByRole('region', { name: 'Merging' })
const runs = () => screen.getByRole('button', { name: 'Runs' })

afterEach(() => {
  vi.useRealTimers()
})

describe('the merging pill on the composer’s edge', () => {
  it('opens one thing there at a time: the run chip’s list folds the card, and the pill closes the list', () => {
    render(<Edge thread={[items.says('Queuing them.'), card('checks')]} />)
    fireEvent.click(pill()!)
    expect(opened()).toBeTruthy()
    fireEvent.click(runs())
    expect(opened()).toBeNull()
    expect(runs().getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(pill()!)
    expect(opened()).toBeTruthy()
    expect(runs().getAttribute('aria-expanded')).toBe('false')
  })

  it('says why one came back on the notice line while folded, and under its row once opened', () => {
    render(<Edge thread={[card('checks', 'its checks failed')]} />)
    expect(screen.getByRole('note').textContent).toBe('#1226 sent back. Its checks failed')
    fireEvent.click(pill()!)
    expect(screen.getByRole('note').textContent).toBe('')
    expect(opened()?.textContent).toContain('Its checks failed')
  })

  it('shows all in for a moment once it saw them move, then goes', () => {
    vi.useFakeTimers()
    const { rerender } = render(<Edge thread={[card('checks')]} />)
    rerender(<Edge thread={[card('merged')]} />)
    expect(pill()?.getAttribute('aria-label')).toBe('Merging: #1224 merged, #1226 merged')
    act(() => void vi.advanceTimersByTime(1800))
    expect(pill()).toBeTruthy()
    act(() => void vi.advanceTimersByTime(200))
    expect(pill()).toBeNull()
  })

  it('shows nothing for a thread opened once its merges were in', () => {
    render(<Edge thread={[items.says('All in.'), card('merged')]} />)
    expect(pill()).toBeNull()
  })
})
