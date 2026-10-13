import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { Finder, type FinderProps, type FoundRow } from '../src/chrome/Finder/Finder'
import { ACROSS, RECENT, RETRY } from '../src/fixtures/finder'

function open(props: Partial<FinderProps> = {}) {
  const handlers = { onOpen: vi.fn(), onClose: vi.fn(), onQueryChange: vi.fn() }
  const view = render(<Finder results={RECENT} {...handlers} {...props} />)
  const dialog = screen.getByRole('dialog')
  const field = within(dialog).getByRole('combobox')
  const options = () => within(dialog).queryAllByRole('option')
  const said = () => dialog.querySelector('[aria-live]')?.textContent ?? ''
  return { ...handlers, ...view, dialog, field, options, said }
}

/** A consumer that answers each change of words a moment later, keeping the last answer meanwhile. */
function Answering({ answer }: { answer: (query: string) => readonly FoundRow[] }) {
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState<{ query: string; rows: readonly FoundRow[] }>({ query: '', rows: answer('') })
  return (
    <Finder
      query={query}
      onQueryChange={(next) => {
        setQuery(next)
        setTimeout(() => setShown({ query: next, rows: answer(next) }), 100)
      }}
      results={shown.rows}
      searching={shown.query !== query}
      onOpen={() => {}}
      onClose={() => {}}
    />
  )
}

describe('Finder', () => {
  it('opens on the field, with the tasks changed last under it', () => {
    const { field, options, dialog } = open()
    expect(field).toHaveFocus()
    expect(within(dialog).getByRole('listbox', { name: 'Recent' })).toBeInTheDocument()
    expect(options()).toHaveLength(RECENT.length)
    expect(options()[0]).toHaveAttribute('aria-selected', 'true')
    expect(field).toHaveAttribute('aria-activedescendant', options()[0]?.id)
  })

  it('says where each task stands, its project and pull request, and what matched with the matched words marked', () => {
    const { options } = open({ defaultQuery: '1206', results: ACROSS })
    const [first, second, third] = options()
    expect(first).toHaveTextContent('Retry webhook deliveries with backoffRunning')
    expect(first).toHaveTextContent(/meridian/i)
    expect(second?.querySelector('mark')).toHaveTextContent('#1206')
    expect(second).toHaveTextContent('Needs you')
    expect(third).toHaveTextContent('!1206')
    expect(third).toHaveTextContent('Stopped')
  })

  it('hands every change of words to the consumer, and starts again from the best', () => {
    const { field, options, onQueryChange, rerender, onOpen, onClose } = open()
    fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(options()[1]).toHaveAttribute('aria-selected', 'true')
    fireEvent.change(field, { target: { value: 'retr' } })
    expect(onQueryChange).toHaveBeenLastCalledWith('retr')
    rerender(<Finder results={RETRY} onOpen={onOpen} onClose={onClose} onQueryChange={onQueryChange} />)
    expect(options()[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('moves only as far as there are tasks, and a pointer moves it too', () => {
    const { field, options, onOpen } = open({ results: RETRY })
    fireEvent.keyDown(field, { key: 'ArrowUp' })
    expect(options()[0]).toHaveAttribute('aria-selected', 'true')
    for (let n = 0; n < 10; n++) fireEvent.keyDown(field, { key: 'ArrowDown' })
    expect(options().at(-1)).toHaveAttribute('aria-selected', 'true')
    fireEvent.mouseMove(options()[1] as HTMLElement)
    expect(options()[1]).toHaveAttribute('aria-selected', 'true')
    // Other keys are the field's own.
    fireEvent.keyDown(field, { key: 'a' })
    expect(onOpen).not.toHaveBeenCalled()
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onOpen).toHaveBeenCalledWith('t414')
  })

  it('opens nothing on Enter with nothing found, or while a character is being composed', () => {
    const empty = open({ defaultQuery: 'pelican', results: [] })
    fireEvent.keyDown(empty.field, { key: 'Enter' })
    expect(empty.onOpen).not.toHaveBeenCalled()
    expect(empty.field).toHaveAttribute('aria-expanded', 'false')
    expect(empty.field).not.toHaveAttribute('aria-activedescendant')
    empty.unmount()
    const composing = open()
    fireEvent.keyDown(composing.field, { key: 'Enter', isComposing: true })
    expect(composing.onOpen).not.toHaveBeenCalled()
  })

  it('says what an answer found, once it comes, and nothing found only then', () => {
    vi.useFakeTimers()
    try {
      render(<Answering answer={(query) => (query === '' ? RECENT : RETRY.filter((row) => row.title.toLowerCase().includes(query)))} />)
      const dialog = screen.getByRole('dialog')
      const field = within(dialog).getByRole('combobox')
      const said = () => dialog.querySelector('[aria-live]')?.textContent ?? ''
      expect(said()).toBe('')
      fireEvent.change(field, { target: { value: 'retry' } })
      // The last answer stays while the next comes, and nothing is said of it.
      expect(within(dialog).getAllByRole('option')).toHaveLength(RECENT.length)
      expect(said()).toBe('')
      void act(() => vi.advanceTimersByTime(100))
      expect(within(dialog).getAllByRole('option')).toHaveLength(1)
      expect(said()).toBe('1 task')
      expect(within(dialog).queryByText('Recent')).toBeNull()
      fireEvent.change(field, { target: { value: 'pelican' } })
      expect(within(dialog).queryByText(/No tasks match/)).toBeNull()
      void act(() => vi.advanceTimersByTime(100))
      expect(within(dialog).getByText('No tasks match “pelican”', { selector: 'p' })).toBeInTheDocument()
      expect(said()).toBe('No tasks match “pelican”')
    } finally {
      vi.useRealTimers()
    }
  })

  it('counts what it found in words of the consumer’s', () => {
    const { said } = open({ defaultQuery: 'retr', results: RETRY, text: { count: (n) => `${n} gefunden` } })
    expect(said()).toBe(`${RETRY.length} gefunden`)
  })

  it('closes on Escape', () => {
    const { dialog, onClose } = open()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
