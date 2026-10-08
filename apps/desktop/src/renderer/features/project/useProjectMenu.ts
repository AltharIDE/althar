import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ProjectSummary } from '@althar/contracts'

import { messageOf } from '../../data/client'
import { keys, reads } from '../../data/reads'
import { useServices } from '../../data/services'

/*
 * A project's menu's view model: renaming it and removing it from Althar,
 * each asked in a dialog first. What changes reaches the tabs and the home
 * through the change feed; the list is read again at once as well, so the
 * new name, or the project gone, shows before the feed is heard.
 */

export type ProjectDialog = 'rename' | 'remove'

export interface ProjectMenuModel {
  readonly project: ProjectSummary | null
  /** The dialog open, if one is. */
  readonly dialog: ProjectDialog | null
  readonly ask: (dialog: ProjectDialog) => void
  readonly close: () => void
  /** A rename or a removal is on its way. */
  readonly busy: boolean
  readonly error: string | null
  readonly rename: (name: string) => Promise<void>
  /** Removes the project; `onRemoved` is called once it is gone, from here or from another window. */
  readonly remove: () => Promise<void>
}

export const useProjectMenu = (projectId: string, onRemoved: () => void): ProjectMenuModel => {
  const { client, cache } = useServices()
  const listed = useQuery(reads(client).projects()).data
  const project = listed?.projects.find((each) => each.id === projectId) ?? null
  const [dialog, setDialog] = useState<ProjectDialog | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ask = useCallback((next: ProjectDialog) => {
    setError(null)
    setDialog(next)
  }, [])
  const close = useCallback(() => {
    setError(null)
    setDialog(null)
  }, [])

  /** Does it, then reads the projects again: the dialog closes on success, and says why on failure. */
  const doing = useCallback(
    async (action: () => Promise<void>, after: () => void) => {
      setBusy(true)
      setError(null)
      try {
        await action()
        await cache.refetchQueries({ queryKey: keys.projects })
        setDialog(null)
        after()
      } catch (failure) {
        setError(messageOf(failure))
      } finally {
        setBusy(false)
      }
    },
    [cache],
  )

  const rename = useCallback(
    (name: string) =>
      doing(
        () => client.renameProject(projectId, name),
        () => undefined,
      ),
    [client, doing, projectId],
  )
  // Once it is read again without it, the watch below sends the window on.
  const remove = useCallback(
    () =>
      doing(
        () => client.removeProject(projectId),
        () => undefined,
      ),
    [client, doing, projectId],
  )

  // Removed from another window, or by this one: once listed and then gone, the window goes where `onRemoved` says.
  const seen = useRef(false)
  useEffect(() => {
    if (project !== null) seen.current = true
    else if (seen.current && listed !== undefined) {
      seen.current = false
      onRemoved()
    }
  }, [project, listed, onRemoved])

  return { project, dialog, ask, close, busy, error, rename, remove }
}
