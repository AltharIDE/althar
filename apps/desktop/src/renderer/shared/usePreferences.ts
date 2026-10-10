import { type QueryClient, useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { type AppPreferences, DEFAULT_PREFERENCES, type PreferenceKey } from '../../main/appPreferences'
import { useServices } from '../data/services'

/*
 * The app's own preferences (main/appPreferences), as Settings changes them
 * and the window uses them, such as the editor files open in. One read for
 * the window, kept until a change. A change shows at once, and a read
 * still on its way is dropped so it can't put back what was there before.
 * Changes are ordered across the window, wherever they were made: only the
 * latest one's answer is shown. Any change the main process can't keep is
 * said by `failed`, and what it kept is read again.
 */

const KEY = ['preferences'] as const

/* Changes made in a window, by its cache, in the order they were made. */
const made = new WeakMap<QueryClient, number>()

export interface PreferencesModel {
  /** As kept, or where each starts until the main process says. */
  readonly preferences: AppPreferences
  /** Whether the main process has said yet. */
  readonly read: boolean
  /** The last change couldn't be kept. */
  readonly failed: boolean
  readonly set: <K extends PreferenceKey>(key: K, value: AppPreferences[K]) => void
}

export const usePreferences = (): PreferencesModel => {
  const { host, cache } = useServices()
  const read = useQuery({ queryKey: KEY, queryFn: () => host.preferences(), staleTime: Number.POSITIVE_INFINITY })
  const [failed, setFailed] = useState(false)

  const set = <K extends PreferenceKey>(key: K, value: AppPreferences[K]) => {
    const at = (made.get(cache) ?? 0) + 1
    made.set(cache, at)
    const latest = () => made.get(cache) === at
    setFailed(false)
    // A read on its way is dropped first, as its answer would be older than this.
    void cache.cancelQueries({ queryKey: KEY }).then(() => {
      cache.setQueryData<AppPreferences>(KEY, (now) => ({ ...(now ?? DEFAULT_PREFERENCES), [key]: value }))
      host.setPreference(key, value).then(
        (kept) => {
          if (latest()) cache.setQueryData(KEY, kept)
        },
        () => {
          setFailed(true)
          void cache.invalidateQueries({ queryKey: KEY })
        },
      )
    })
  }

  return { preferences: read.data ?? DEFAULT_PREFERENCES, read: read.data !== undefined, failed, set }
}
