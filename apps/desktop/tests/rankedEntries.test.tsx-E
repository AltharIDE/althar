import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { changesTo, entriesOf, type EntryChanges, type Held, nothingHeld, same, withChanges } from '../src/renderer/features/finder/held'
import { search, type Ask, type Context, type Entry } from '../src/renderer/features/finder/model'
import { useRanked } from '../src/renderer/features/finder/useRanked'

/*
 * The catalog is read again on every change, and its entries made afresh, most of them the same: the ranking worker is
 * sent only those that changed, and nothing where none did, so the window's thread doesn't copy every entry across each
 * time. A stand-in worker holds what it is sent as the real one does (held.ts) and ranks it at once.
 */

type Message = { type: 'entries'; changes: EntryChanges } | { type: 'query'; id: number; query: string; context: Context; ask: Ask }

class Ranker {
  static made: Ranker[] = []
  readonly sent: Message[] = []
  held: Held = nothingHeld
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  constructor() {
    Ranker.made.push(this)
  }
  postMessage(message: Message) {
    this.sent.push(message)
    if (message.type === 'entries') this.held = withChanges(this.held, message.changes)
    else {
      const results = search(entriesOf(this.held), message.query, message.context, message.ask)
      queueMicrotask(() => this.onmessage?.({ data: { id: message.id, results } } as MessageEvent))
    }
  }
  terminate() {}
  /** The entries it was sent, change by change. */
  entriesSent() {
    return this.sent.flatMap((one) => (one.type === 'entries' ? [one.changes] : []))
  }
}

const context: Context = { project: 'p1', task: null, projects: [], usage: {} }
const entry = (id: string, title: string, over: Partial<Entry> = {}): Entry => ({
  id,
  title,
  kind: 'task',
  icon: 'work',
  go: { to: 'task', slug: id },
  ...over,
})
const catalog = () => [
  entry('a', 'Retry checkout deliveries', {
    facts: ['#845'],
    acts: [{ id: 'open', title: 'Open', icon: 'arrow', go: { to: 'task', slug: 'a' } }],
  }),
  entry('b', 'Compact the database'),
  entry('c', 'Rate-limit refunds'),
]

beforeEach(() => {
  Ranker.made = []
  vi.stubGlobal('Worker', Ranker)
})

describe('ranking as the catalog is read again', () => {
  const ranked = (entries: ReadonlyArray<Entry>) =>
    renderHook(({ entries, query }) => useRanked(entries, query, context, {}), { initialProps: { entries, query: 'database' } })

  it('sends the entries once, and nothing again for a catalog read again unchanged', async () => {
    const { result, rerender } = ranked(catalog())
    await waitFor(() => expect(result.current.pending).toBe(false))
    expect(result.current.results.map((one) => one.entry.id)).toEqual(['b'])
    const worker = Ranker.made.at(-1) as Ranker
    expect(worker.entriesSent()).toEqual([{ put: catalog().map((one) => [one.id, one]), order: ['a', 'b', 'c'] }])
    const queries = worker.sent.length
    rerender({ entries: catalog(), query: 'database' })
    // Nothing to rank again: what shows stands, not pending.
    expect(result.current.pending).toBe(false)
    expect(worker.sent).toHaveLength(queries)
  })

  it('sends only an entry that changed, and ranks again', async () => {
    const { result, rerender } = ranked(catalog())
    await waitFor(() => expect(result.current.pending).toBe(false))
    const worker = Ranker.made.at(-1) as Ranker
    const changed = catalog().map((one) => (one.id === 'c' ? { ...one, title: 'Rate-limit the database' } : one))
    rerender({ entries: changed, query: 'database' })
    expect(result.current.pending).toBe(true)
    await waitFor(() => expect(result.current.pending).toBe(false))
    expect(worker.entriesSent().at(-1)).toEqual({ put: [['c', changed[2]]] })
    expect(result.current.results.map((one) => one.entry.id).sort()).toEqual(['b', 'c'])
  })

  it('sends the order where entries come, go or move, and the worker holds just those', async () => {
    const { result, rerender } = ranked(catalog())
    await waitFor(() => expect(result.current.pending).toBe(false))
    const worker = Ranker.made.at(-1) as Ranker
    const [a, b, c] = catalog() as [Entry, Entry, Entry]
    const d = entry('d', 'Database backups')
    rerender({ entries: [c, d, a], query: 'database' })
    await waitFor(() => expect(result.current.pending).toBe(false))
    expect(worker.entriesSent().at(-1)).toEqual({ put: [['d', d]], order: ['c', 'd', 'a'] })
    expect(entriesOf(worker.held)).toEqual([c, d, a])
    expect(result.current.results.map((one) => one.entry.id)).toEqual(['d'])
    rerender({ entries: [a, b], query: 'database' })
    await waitFor(() => expect(result.current.results.map((one) => one.entry.id)).toEqual(['b']))
    expect(entriesOf(worker.held)).toEqual([a, b])
  })

  it('sends a worker started again all that the last one held', async () => {
    const { result } = ranked(catalog())
    await waitFor(() => expect(result.current.pending).toBe(false))
    act(() => result.current.again())
    const [first, second] = Ranker.made.slice(-2) as [Ranker, Ranker]
    expect(second).not.toBe(first)
    expect(entriesOf(second.held)).toEqual(catalog())
    await waitFor(() => expect(result.current.results.map((one) => one.entry.id)).toEqual(['b']))
  })
})

describe('what changed in the entries', () => {
  it('tells entries that share an id apart, by which of them each is', () => {
    const one = entry('x', 'One')
    const two = entry('x', 'Two')
    const changes = changesTo(nothingHeld, [one, two])
    expect(changes?.order).toEqual(['x', 'x\u00001'])
    const held = withChanges(nothingHeld, changes as EntryChanges)
    expect(entriesOf(held)).toEqual([one, two])
    expect(changesTo(held, [entry('x', 'One'), entry('x', 'Two')])).toBeNull()
  })

  it('reads values alike all the way down, and tells apart any that differ', () => {
    expect(same({ a: [1, { b: 'c' }] }, { a: [1, { b: 'c' }] })).toBe(true)
    expect(same({ a: [1, { b: 'c' }] }, { a: [1, { b: 'd' }] })).toBe(false)
    expect(same({ a: 1 }, { a: 1, b: undefined })).toBe(false)
    expect(same({ a: 1, c: 2 }, { a: 1, b: 2 })).toBe(false)
    expect(same([1, 2], [1, 2, 3])).toBe(false)
    expect(same([1], { 0: 1 })).toBe(false)
    expect(same(null, {})).toBe(false)
    expect(same('a', 'a')).toBe(true)
  })
})
