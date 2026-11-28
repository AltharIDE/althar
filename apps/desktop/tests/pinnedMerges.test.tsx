import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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
    // The runtime keeps a card current in place: the same item, all in now.
    const moving = card('checks')
    const { rerender } = render(<Edge thread={[moving]} />)
    rerender(<Edge thread={[{ ...card('merged'), id: moving.id }]} />)
    expect(pill()?.getAttribute('aria-label')).toBe('Merging: #1224 merged, #1226 merged')
    act(() => void vi.advanceTimersByTime(1800))
    expect(pill()).toBeTruthy()
    act(() => void vi.advanceTimersByTime(200))
    expect(pill()).toBeNull()
  })

  it('starts a fresh card on the same branch as a pill of its own: folded, and not going with the last one', () => {
    vi.useFakeTimers()
    const first = card('checks')
    const { rerender } = render(<Edge thread={[first]} />)
    // Opened while it moved, then all in: held, open.
    fireEvent.click(pill()!)
    const done = { ...card('merged'), id: first.id }
    rerender(<Edge thread={[done]} />)
    expect(opened()).toBeTruthy()
    // A fresh card on the same branch, while the last one holds.
    act(() => void vi.advanceTimersByTime(900))
    const fresh = items.mergeLine({ rows: [{ number: 1230, title: 'Next', url: `${PULL}1230`, state: 'checks' }] })
    rerender(<Edge thread={[done, fresh]} />)
    expect(opened()).toBeNull()
    expect(pill()?.getAttribute('aria-label')).toBe('Merging: #1230 checks running')
    act(() => void vi.advanceTimersByTime(3000))
    expect(pill()?.className).not.toMatch(/going/)
    expect(opened()).toBeNull()
  })

  it('shows nothing for a thread opened once its merges were in', () => {
    render(<Edge thread={[items.says('All in.'), card('merged')]} />)
    expect(pill()).toBeNull()
  })
})

describe('what the pill and its card say', () => {
  it('names each by its number, folded, and opens to a row for each linked with where it stands', () => {
    render(<Edge thread={[items.mergeLine()]} />)
    for (const number of ['#778', '#783', '#773', '#779']) expect(pill()?.textContent).toContain(number)
    // Folded, it is one line: the rows wait behind it.
    expect(screen.queryByRole('link', { name: /#783/ })).toBeNull()
    fireEvent.click(pill()!)
    expect(opened()?.querySelectorAll('li')).toHaveLength(4)
    expect(screen.getByRole('link', { name: /#783/ }).getAttribute('href')).toBe('https://github.com/meridian/api/pull/783')
    for (const word of ['Merged', 'In the queue', 'Checks running', 'Waiting']) expect(screen.getAllByText(word).length).toBeGreaterThan(0)
    // Nothing of the internal name, the repository or a number said twice.
    expect(screen.queryByText(/merge line,|AltharIDE|of meridian/i)).toBeNull()
  })

  it('stands by its task’s name, then by its number in place, and says why it came back', () => {
    const URL = `${PULL}1231`
    const errand = (title: string, merges: ReadonlyArray<{ label: string; url: string | null }>) =>
      items.notice(
        {
          title,
          source: 'runtime',
          errand: { id: 'e1', quiet: true, merges: merges.map((merge) => ({ ...merge, task: 'task_workers', once: '' })) },
        },
        null,
      )
    const one = (state: 'checks' | 'sent_back', reason?: string) => ({
      ...items.mergeLine({
        rows: [{ number: 1231, title: 'A worker says when it’s ready', url: URL, state, ...(reason === undefined ? {} : { reason }) }],
      }),
      id: 'card',
    })
    const kept = errand('Kept your errand: merge the workers readiness pull request', [{ label: 'Workers readiness', url: null }])
    const bound = errand('Its task’s pull request is #1231', [{ label: '#1231', url: URL }])

    // Kept, with no pull request yet: by its task's name.
    render(<Edge thread={[kept]} />)
    expect(pill()?.textContent).toContain('Workers readiness')
    cleanup()

    // Its pull request opens and goes on the card: one row, by its number, not the task's name beside it.
    render(<Edge thread={[kept, bound, one('checks')]} />)
    expect(pill()?.textContent).toContain('#1231')
    expect(pill()?.textContent).not.toContain('Workers readiness')
    cleanup()

    // The queue sends it back: why stands on the notice line, and under its row once opened.
    render(<Edge thread={[kept, bound, one('sent_back', 'The queue’s end-to-end checks failed.')]} />)
    expect(screen.getByRole('note').textContent).toBe('#1231 sent back. The queue’s end-to-end checks failed.')
    fireEvent.click(pill()!)
    expect(screen.getByText('Sent back', { selector: 'li span' })).toBeTruthy()
    expect(opened()?.textContent).toContain('The queue’s end-to-end checks failed.')
  })
})
