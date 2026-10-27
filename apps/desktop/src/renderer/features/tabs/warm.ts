import { QueryObserver } from '@tanstack/react-query'
import { useCallback, useEffect, useRef } from 'react'

import { projectReads, type Read, readAhead, type Reads, reads, threadReads } from '../../data/reads'
import { useServices } from '../../data/services'
import type { Place } from './tabs'

/*
 * The open tabs, kept warm: what each tab's place shows stays in the
 * window's cache while the tab is open, never dropped for being out of sight,
 * and the feed keeps it up to date (`feed.ts`), or marks it out of date to be
 * read behind the screen as it shows. Each tab is read ahead once the window
 * is idle, as the window starts or the tab opens, and again as the person
 * points at it, so going to it never waits on the runtime.
 */

/** What a tab's place shows: its project's screen, and the task it was last on, if it was. */
const readsOf = (read: Reads, projectId: string, place: Place | undefined): ReadonlyArray<Read> => [
  ...projectReads(read, projectId),
  ...(place?.kind === 'thread' ? threadReads(read, place.threadId) : []),
]

/** Runs `then` once the window has nothing else to do, or soon where it can't say. */
const whenIdle = (then: () => void): (() => void) => {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(then, { timeout: 2_000 })
    return () => window.cancelIdleCallback(id)
  }
  const id = setTimeout(then, 0)
  return () => clearTimeout(id)
}

/** Keeps the open tabs warm; returns the way to read one ahead, as it is pointed at. */
export const useWarmTabs = (open: ReadonlyArray<string>, places: Readonly<Record<string, Place>>): ((projectId: string) => void) => {
  const { client, cache } = useServices()
  const tabs = JSON.stringify(open.map((id) => [id, places[id] ?? null]))
  const latest = useRef(places)
  latest.current = places

  // Each read held by a watcher that never reads itself: the cache keeps it as long as its tab is open.
  useEffect(() => {
    const read = reads(client)
    const holding = open.flatMap((id) =>
      readsOf(read, id, places[id]).map((options) => new QueryObserver(cache, { ...options, enabled: false }).subscribe(() => undefined)),
    )
    return () => holding.forEach((stop) => stop())
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `tabs` says what `open` and `places` hold
  }, [client, cache, tabs])

  // Read ahead once, as the window starts with them or a tab opens, when the window is idle.
  const ahead = useRef(new Set<string>())
  useEffect(() => {
    const fresh = open.filter((id) => !ahead.current.has(id))
    if (fresh.length === 0) return
    return whenIdle(() => {
      const read = reads(client)
      for (const id of fresh) {
        ahead.current.add(id)
        readAhead(cache, readsOf(read, id, latest.current[id]))
      }
    })
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `tabs` says what `open` holds
  }, [client, cache, tabs])

  return useCallback((projectId: string) => readAhead(cache, readsOf(reads(client), projectId, latest.current[projectId])), [client, cache])
}
