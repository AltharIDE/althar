import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { Composer } from '../src/composer/Composer/Composer'
import { MergingBack, MergingPill, type MergingRow } from '../src/composer/MergingPill/MergingPill'

/*
 * What is on its way into a branch, as a pill on the composer's edge: read as
 * one line, opening into a card of a row for each, folding back by its head
 * or Escape; why one came back, on the notice line while it is folded.
 */

const PULL = 'https://github.com/meridian/api/pull/'
const ROWS: ReadonlyArray<MergingRow> = [
  { key: '1', label: '#1224', title: 'Plan card offers Runs on', url: `${PULL}1224`, state: 'merged' },
  {
    key: '2',
    label: '#1226',
    title: 'Keep for later shelves a task',
    url: `${PULL}1226`,
    state: 'sent_back',
    reason: 'its checks failed. Its lead is on it.',
  },
  { key: '3', label: 'Workers readiness', title: '', url: null, state: 'waiting', once: 'once its checks pass' },
]

const pill = () => screen.getByRole('button', { name: /^Merging:/ })

describe('MergingPill', () => {
  it('reads as one line: what it is, then each with where it stands', () => {
    render(<MergingPill rows={ROWS} />)
    expect(pill().getAttribute('aria-expanded')).toBe('false')
    expect(pill().getAttribute('aria-label')).toBe('Merging: #1224 merged, #1226 sent back, Workers readiness not in line yet')
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('opens into a row for each, with where each stands and why, and folds back by its head', () => {
    render(<MergingPill rows={ROWS} />)
    fireEvent.click(pill())
    const card = screen.getByRole('region', { name: 'Merging' })
    const rows = within(card).getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('#1224Plan card offers Runs onMerged'),
      expect.stringContaining('#1226Keep for later shelves a taskSent backIts checks failed. Its lead is on it.'),
      'Workers readinessNot in line yetOnce its checks pass',
    ])
    // A pull request opens where it is; what has none yet is no link.
    expect(within(rows[0]!).getByRole('link').getAttribute('href')).toBe(`${PULL}1224`)
    expect(within(rows[2]!).queryByRole('link')).toBeNull()
    fireEvent.click(within(card).getByRole('button', { name: 'Merging' }))
    expect(screen.queryByRole('region', { name: 'Merging' })).toBeNull()
    expect(pill()).toBeTruthy()
  })

  it('folds back on Escape, but not on a field’s own Escape', () => {
    render(
      <>
        <textarea aria-label="Say" />
        <MergingPill rows={ROWS} defaultOpen />
      </>,
    )
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Say' }), { key: 'Escape' })
    expect(screen.getByRole('region', { name: 'Merging' })).toBeTruthy()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Merging' })).toBeNull()
  })

  it('is driven by whoever holds what else opens on the edge', () => {
    const heard = vi.fn()
    function Edge() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(false)}>
            Runs
          </button>
          <MergingPill
            rows={ROWS}
            open={open}
            onOpenChange={(next) => {
              heard(next)
              setOpen(next)
            }}
          />
        </>
      )
    }
    render(<Edge />)
    fireEvent.click(pill())
    expect(heard).toHaveBeenLastCalledWith(true)
    expect(screen.getByRole('region', { name: 'Merging' })).toBeTruthy()
    // Something else opening there folds it.
    fireEvent.click(screen.getByRole('button', { name: 'Runs' }))
    expect(screen.queryByRole('region', { name: 'Merging' })).toBeNull()
  })

  it('leaves an Escape another already took, and keeps its shape through a press that changes nothing', () => {
    const { rerender } = render(<MergingPill rows={ROWS} open onOpenChange={() => {}} />)
    const taken = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    taken.preventDefault()
    document.body.dispatchEvent(taken)
    fireEvent.keyDown(document.body, { key: 'Enter' })
    rerender(<MergingPill rows={ROWS} open onOpenChange={() => {}} />)
    expect(screen.getByRole('region', { name: 'Merging' })).toBeTruthy()
  })

  it('goes, folded or open, once all are in', () => {
    const { rerender } = render(<MergingPill rows={ROWS} leaving />)
    expect(pill().className).toMatch(/going/)
    rerender(<MergingPill rows={ROWS} leaving defaultOpen />)
    fireEvent.click(pill())
    expect(screen.getByRole('region', { name: 'Merging' }).className).toMatch(/going/)
  })

  it('names the branch where it isn’t the default', () => {
    render(<MergingPill rows={ROWS.slice(0, 1)} branch="release/0.10" />)
    expect(screen.getByRole('button', { name: /^Merging into release\/0\.10:/ })).toBeTruthy()
  })

  it('draws nothing with nothing on its way', () => {
    const { container } = render(<MergingPill rows={[]} />)
    expect(container.textContent).toBe('')
  })

  it('sits on the composer’s edge beside what else floats there', () => {
    const { container } = render(
      <Composer
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        placeholder="Say"
        above={<MergingPill rows={ROWS} />}
        notice={<MergingBack rows={ROWS} />}
      />,
    )
    const edge = container.querySelector('[data-composer-floats]')
    expect(edge?.contains(pill())).toBe(true)
    expect(edge?.textContent).toContain('#1226 sent back. Its checks failed. Its lead is on it.')
  })
})

describe('MergingPill’s marks and words', () => {
  it('says each state its own way, a kept merge with a pull request already among those not in line yet', () => {
    const rows: ReadonlyArray<MergingRow> = [
      { key: 'a', label: '#1', title: 'A', url: `${PULL}1`, state: 'checks' },
      { key: 'b', label: '#2', title: 'B', url: `${PULL}2`, state: 'queued' },
      { key: 'c', label: '#3', title: 'C', url: `${PULL}3`, state: 'conflict', reason: 'it conflicts with main' },
      { key: 'd', label: '#4', title: '', url: `${PULL}4`, state: 'waiting', once: 'once it’s reviewed' },
      { key: 'e', label: '#5', title: 'E', url: `${PULL}5`, state: 'waiting' },
    ]
    render(<MergingPill rows={rows} defaultOpen />)
    const states = within(screen.getByRole('region', { name: 'Merging' }))
      .getAllByRole('listitem')
      .map((row) => row.textContent)
    expect(states).toEqual([
      expect.stringContaining('#1AChecks running'),
      expect.stringContaining('#2BIn the queue'),
      expect.stringContaining('#3CConflictIt conflicts with main'),
      expect.stringContaining('#4Not in line yetOnce it’s reviewed'),
      expect.stringContaining('#5EWaiting'),
    ])
  })

  it('says a conflict as one on the notice line, and words of its own where given', () => {
    const conflict: MergingRow = { key: 'c', label: '#3', title: 'C', url: `${PULL}3`, state: 'conflict', reason: 'it conflicts with main' }
    const { container } = render(<MergingBack rows={[conflict]} text={{ state: { conflict: 'Stuck' } as never }} />)
    expect(container.textContent).toBe('#3 stuck. It conflicts with main')
  })
})

describe('two pills on one edge, and a narrow one', () => {
  it('names each pill’s pieces its own, so one’s morph never takes the other’s place', () => {
    const { container } = render(
      <>
        <MergingPill rows={ROWS.slice(0, 1)} />
        <MergingPill rows={ROWS.slice(0, 1)} branch="release/0.10" />
      </>,
    )
    const boxes = [...container.querySelectorAll<HTMLElement>('[data-m-box]')].map((box) => box.dataset.mBox)
    expect(new Set(boxes).size).toBe(2)
    const names = [...container.querySelectorAll<HTMLElement>('[data-m$="name"]')].map((name) => name.dataset.m)
    expect(new Set(names).size).toBe(2)
  })

  it('keeps its tokens to one line, marking those with no room, and says there are more', () => {
    const top = vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
      return this.textContent?.startsWith('Workers') === true ? 18 : 0
    })
    const { container } = render(<MergingPill rows={ROWS} />)
    const tokens = [...container.querySelectorAll('[title]')]
    expect(tokens.map((token) => token.hasAttribute('data-cut'))).toEqual([false, false, true])
    expect(tokens[0]?.parentElement?.hasAttribute('data-cutting')).toBe(true)
    top.mockRestore()
  })
})

describe('the card’s room', () => {
  it('gives its rows only the room between its foot and the top of the conversation it floats over, at least a row', () => {
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.hasAttribute('data-floats-host')) return new DOMRect(0, 100, 600, 500)
      if (this.tagName === 'SECTION') return new DOMRect(0, 200, 600, 300)
      return new DOMRect()
    })
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(34)
    render(
      <div data-floats-host="">
        <MergingPill rows={ROWS} defaultOpen />
      </div>,
    )
    const card = screen.getByRole('region', { name: 'Merging' })
    // Its foot at 500, the conversation's top at 100: less 12 over it, its head's 34 and its foot's 4.
    expect(card.style.getPropertyValue('--rows-room')).toBe('350px')
    rect.mockImplementation(function (this: Element) {
      if (this.hasAttribute('data-floats-host')) return new DOMRect(0, 100, 600, 500)
      if (this.tagName === 'SECTION') return new DOMRect(0, 90, 600, 40)
      return new DOMRect()
    })
    // A composer grown nearly to the top: one row, which scrolls to the rest.
    fireEvent.click(within(card).getByRole('button', { name: 'Merging' }))
    fireEvent.click(pill())
    expect(screen.getByRole('region', { name: 'Merging' }).style.getPropertyValue('--rows-room')).toBe('30px')
    rect.mockRestore()
    height.mockRestore()
  })
})

describe('MergingBack', () => {
  it('says why the first one came back, and nothing where none did', () => {
    const { container, rerender } = render(<MergingBack rows={ROWS} />)
    expect(container.textContent).toBe('#1226 sent back. Its checks failed. Its lead is on it.')
    rerender(<MergingBack rows={ROWS.filter((row) => row.state !== 'sent_back')} />)
    expect(container.textContent).toBe('')
  })
})
