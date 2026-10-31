import { useQuery } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'

import type { AppSettings, NewProjectDefaults, NewProjectDefaultsChange } from '@althar/contracts'

import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * What the rules of a project start with when it is made, as Settings shows
 * and changes it. A change shows at once and holds for projects made from
 * then on; one made earlier keeps its own rules. If it can't be kept, and it
 * is still the latest, the view reads again what the runtime kept, and says
 * so.
 */

export interface NewProjectDefaultsModel {
  readonly value: NewProjectDefaults
  /** The last change couldn't be kept. */
  readonly failed: boolean
  readonly set: (change: NewProjectDefaultsChange) => void
}

/** Null until the settings are read. */
export const useNewProjectDefaults = (): NewProjectDefaultsModel | null => {
  const { client, cache } = useServices()
  const settings = useQuery(reads(client).settings()).data
  const [failed, setFailed] = useState(false)
  // Changes in the order they were made: only the latest failing reads again.
  const made = useRef(0)

  const set = useCallback(
    (change: NewProjectDefaultsChange) => {
      const at = ++made.current
      const given = Object.fromEntries(Object.entries(change).filter(([, value]) => value !== undefined))
      cache.setQueryData<AppSettings>(keys.settings, (was) =>
        was === undefined ? was : { ...was, newProjects: { ...was.newProjects, ...given } },
      )
      setFailed(false)
      client.setNewProjectDefaults(change).then(
        () => undefined,
        () => {
          if (at !== made.current) return
          void cache.refetchQueries({ queryKey: keys.settings })
          setFailed(true)
        },
      )
    },
    [cache, client],
  )

  return settings === undefined ? null : { value: settings.newProjects, failed, set }
}
