import { useEffect, useMemo, useRef, useState } from 'react'
import { type Ask, type Context, type Entry, type Found } from './model'

/** Ranking runs off the UI thread. Keep the last rows during the next query,
 * discard stale replies, and expose pending so Enter cannot open an old hit. */
export const useRanked = (entries: ReadonlyArray<Entry>, query: string, context: Context, ask: Ask) => {
  const worker = useRef<Worker | null>(null)
  const requested = useRef({ id: 0, key: '', query: '', entries })
  const [answer, setAnswer] = useState<{ key: string; query: string; entries: ReadonlyArray<Entry>; results: ReadonlyArray<Found> } | null>(
    null,
  )
  const [failed, setFailed] = useState(false)
  const [attempt, retry] = useState(0)
  const askKey = JSON.stringify(ask)
  const options = useMemo(() => ask, [askKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const key = `${query}|${askKey}|${context.project}|${context.task}`
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
      setAnswer({ key: current.key, query: current.query, entries: current.entries, results: event.data.results })
    }
    return () => {
      worker.current = null
      one.terminate()
    }
  }, [attempt])
  useEffect(() => {
    worker.current?.postMessage({ type: 'entries', entries })
  }, [entries, attempt])
  useEffect(() => {
    const id = requested.current.id + 1
    requested.current = { id, key, query, entries }
    worker.current?.postMessage({ type: 'query', id, query, context, ask: options })
  }, [entries, query, context, options, key, attempt])
  return {
    results: answer?.results ?? [],
    /** The words the shown results answer: the selection starts over when they change, not as entries refresh. */
    shown: answer?.key ?? '',
    /** The words the shown results were for. */
    query: answer?.query ?? '',
    pending: answer?.key !== key || answer.entries !== entries,
    failed,
    again: () => retry((now) => now + 1),
  }
}
