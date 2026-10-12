import { useQuery } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'

import type { AppSettings } from '@althar/contracts'

import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * Whether Althar is co-author of the commits and pull requests it sends, as
 * Settings shows and changes it. A change shows at once; if the runtime
 * can't keep it, and it is still the latest, the view reads again what the
 * runtime kept, and says so.
 */

export interface CoAuthorModel {
  readonly on: boolean
  /** The trailer each commit gets while it is on. */
  readonly line: string
  /** The last change couldn't be kept. */
  readonly failed: boolean
  readonly set: (on: boolean) => void
}

/** Null until the settings are read. */
export const useCoAuthor = (): CoAuthorModel | null => {
  const { client, cache } = useServices()
  const settings = useQuery(reads(client).settings()).data
  const [failed, setFailed] = useState(false)
  // Changes in the order they were made: only the latest failing reads again.
  const made = useRef(0)

  const set = useCallback(
    (on: boolean) => {
      const at = ++made.current
      cache.setQueryData<AppSettings>(keys.settings, (was) => (was === undefined ? was : { ...was, coAuthor: { ...was.coAuthor, on } }))
      setFailed(false)
      client.setCoAuthor(on).then(
        () => undefined,
        () => {
          if (at !== made.current) return
          // Not the opposite of what was asked: what the runtime kept, as it says.
          void cache.refetchQueries({ queryKey: keys.settings })
          setFailed(true)
        },
      )
    },
    [cache, client],
  )

  return settings === undefined ? null : { on: settings.coAuthor.on, line: settings.coAuthor.line, failed, set }
}
