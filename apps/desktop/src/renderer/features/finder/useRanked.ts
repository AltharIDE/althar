import { useEffect, useMemo, useRef, useState } from 'react'
import { allOf, changesTo, type EntryChanges, type Held, nothingHeld, withChanges } from './held'
import { type Ask, type Context, type Entry, type Found } from './model'

/** What the worker is to hold of the entries, from the entries given: what changed last, and a version that moves only then. */
interface Given {
  readonly entries: ReadonlyArray<Entry>
  readonly held: Held
  readonly changes: EntryChanges | null
  readonly version: number
}

const given = (from: Given, entries: ReadonlyArray<Entry>): Given => {
  const changes = changesTo(from.held, entries)
  return changes === null ? { ...from, entries } : { entries, held: withChanges(from.held, changes), changes, version: from.version + 1 }
}

/** Ranking runs off the UI thread. Keep the last rows during the next query,
 * discard stale replies, and expose pending so Enter cannot open an old hit.
 * The worker is sent only the entries that changed, and only when some did:
 * the catalog is read again on every change, its entries made afresh, and
 * most of them the same (held.ts). */
export const useRanked = (entries: ReadonlyArray<Entry>, query: string, context: Context, ask: Ask) => {
  const worker = useRef<Worker | null>(null)
  const [held, setHeld] = useState(() => given({ entries: [], held: nothingHeld, changes: null, version: 0 }, entries))
  // Entries made again, alike or not: what the worker is to hold moves on only where they say something new.
  if (held.entries !== entries) setHeld(given(held, entries))
  // The last of that, for a worker started again; and the version the worker holds, so it is sent each change once.
  const latest = useRef(held)
  const has = useRef(0)
  const requested = useRef({ id: 0, key: '', query: '', version: 0 })
  const [answer, setAnswer] = useState<{ key: string; query: string; version: number; results: ReadonlyArray<Found> } | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, retry] = useState(0)
  const askKey = JSON.stringify(ask)
  const options = useMemo(() => ask, [askKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const key = `${query}|${askKey}|${context.project}|${context.task}`
  useEffect(() => {
    latest.current = held
  }, [held])
  useEffect(() => {
    let one: Worker
    try {
      one = new Worker(new URL('./rank.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      queueMicrotask(() => setFailed(true))
      return
    }
    worker.current = one
    one.onerror = () => setFailed(true)
    one.onmessage = (event: MessageEvent<{ id: number; results: ReadonlyArray<Found> }>) => {
      const current = requested.current
      if (event.data.id !== current.id) return
      setFailed(false)
      setAnswer({ key: current.key, query: current.query, version: current.version, results: event.data.results })
    }
    // A worker started holds nothing yet: it is sent all there is.
    if (latest.current.held.order.length > 0) one.postMessage({ type: 'entries', changes: allOf(latest.current.held) })
    has.current = latest.current.version
    return () => {
      worker.current = null
      one.terminate()
    }
  }, [attempt])
  useEffect(() => {
    if (held.changes === null || held.version <= has.current) return
    worker.current?.postMessage({ type: 'entries', changes: held.changes })
    has.current = held.version
  }, [held])
  useEffect(() => {
    const id = requested.current.id + 1
    requested.current = { id, key, query, version: held.version }
    worker.current?.postMessage({ type: 'query', id, query, context, ask: options })
  }, [held.version, query, context, options, key, attempt])
  return {
    results: answer?.results ?? [],
    /** The words the shown results answer: the selection starts over when they change, not as entries refresh. */
    shown: answer?.key ?? '',
    /** The words the shown results were for. */
    query: answer?.query ?? '',
    pending: answer?.key !== key || answer.version !== held.version,
    failed,
    again: () => retry((now) => now + 1),
  }
}
