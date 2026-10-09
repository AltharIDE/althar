import { useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { type AppPreferences, DEFAULT_PREFERENCES, type PreferenceKey } from '../../main/appPreferences'
import { useServices } from '../data/services'

/*
 * The app's own preferences (main/appPreferences), as Settings changes them
 * and the window uses them, such as the editor files open in. One read for
 * the window, kept until a change. A change shows at once; if the main
 * process can't keep it, and nothing was changed since, what it last kept
 * comes back and `failed` says so.
 */

const KEY = ['preferences'] as const

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
  // Changes in the order they were made: only the latest puts back what was kept when it fails.
  const made = useRef(0)

  const set = <K extends PreferenceKey>(key: K, value: AppPreferences[K]) => {
    const at = ++made.current
    setFailed(false)
    cache.setQueryData<AppPreferences>(KEY, (now) => ({ ...(now ?? DEFAULT_PREFERENCES), [key]: value }))
    host.setPreference(key, value).then(
      (kept) => {
        if (at === made.current) cache.setQueryData(KEY, kept)
      },
      () => {
        if (at !== made.current) return
        setFailed(true)
        void cache.invalidateQueries({ queryKey: KEY })
      },
    )
  }

  return { preferences: read.data ?? DEFAULT_PREFERENCES, read: read.data !== undefined, failed, set }
}
