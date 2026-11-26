import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'

import type { Release } from '@althar/site/changelog'
import { compareVersions } from '@althar/ui/screens'

import { useServices } from '../../data/services'
import { useAppVersion } from '../../shared/appVersion'
import { releaseFor } from './notes'
import { newsStoreOf } from './store'

/*
 * Althar's news, for its tab and its page: the release this Althar is, and
 * whether it's news to the person. An update is news until they look at it
 * or close its tab, and only where the release has notes of its own. Their
 * first launch with this has none: what runs is what they've seen. Closed,
 * the tab stays closed until the next update brings news.
 */

export interface NewsModel {
  /** The version running; none until read. */
  readonly version?: string
  readonly release: Release | undefined
  /** An update with notes the person hasn't looked at: the tab's dot. */
  readonly unseen: boolean
  /** The version they updated from, where they updated. */
  readonly from?: string
  /** Althar's tab is in the window's bar. */
  readonly tab: boolean
  /** They looked: it isn't news any more, and the tab is open. */
  readonly look: () => void
  /** They closed the tab: it isn't news any more either. */
  readonly close: () => void
}

export const useNews = (): NewsModel => {
  const { client } = useServices()
  const store = newsStoreOf(client)
  const state = useSyncExternalStore(store.subscribe, store.get)
  // This app's, on whichever home the window is: a home's runtime says its own release.
  const version = useAppVersion()
  const { release, own } = useMemo(() => releaseFor(version), [version])

  // The first launch with this, on whatever version: nothing is news yet.
  useEffect(() => {
    if (version !== undefined && store.get().seen === undefined) store.set({ ...store.get(), seen: version })
  }, [store, version])

  const { seen } = state
  const unseen = version !== undefined && own && seen !== undefined && compareVersions(version, seen) > 0
  const kept = state.from !== undefined && version !== undefined && compareVersions(state.from, version) < 0 ? state.from : undefined
  const from = unseen ? seen : kept

  // Looked at or closed: an update's news becomes what was seen, the version before it where they came from.
  const settle = useCallback(
    (closed: boolean) => {
      const { closed: _was, ...now } = store.get()
      const news = version !== undefined && now.seen !== undefined && compareVersions(version, now.seen) > 0
      const next = news && version !== undefined ? { seen: version, ...(now.seen === undefined ? {} : { from: now.seen }) } : now
      store.set(closed ? { ...next, closed: true } : next)
    },
    [store, version],
  )
  const look = useCallback(() => {
    const now = store.get()
    if (now.closed === true || (version !== undefined && now.seen !== undefined && compareVersions(version, now.seen) > 0)) settle(false)
  }, [store, version, settle])
  const close = useCallback(() => settle(true), [settle])

  return {
    ...(version === undefined ? {} : { version }),
    release,
    unseen,
    ...(from === undefined ? {} : { from }),
    tab: state.closed !== true || unseen,
    look,
    close,
  }
}
