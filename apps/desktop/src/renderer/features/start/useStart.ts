import { useCallback, useEffect, useState } from 'react'

import type { ProjectSummary, Status } from '@charrette/contracts'

import { messageOf } from '../../data/client'
import { useServices, useWatch } from '../../data/services'

/*
 * The start screen's view model: the agents on this Mac and how each is
 * signed in, the projects, and opening a folder as a new one.
 */

export interface StartModel {
  readonly status: Status | null
  readonly projects: ReadonlyArray<ProjectSummary> | null
  readonly error: string | null
  readonly opening: boolean
  /** Asks for a folder and opens it as a project; the project, or null when the person cancelled. */
  readonly openFolder: () => Promise<ProjectSummary | null>
  /** Opens a folder dropped on the window as a project; null when it couldn't. */
  readonly openDropped: (file: File) => Promise<ProjectSummary | null>
}

export const useStart = (): StartModel => {
  const { client, host } = useServices()
  const [status, setStatus] = useState<Status | null>(null)
  const [projects, setProjects] = useState<ReadonlyArray<ProjectSummary> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)

  const loadProjects = useCallback(() => {
    client.listProjects().then(setProjects, (failure: unknown) => setError(messageOf(failure)))
  }, [client])

  useEffect(() => {
    loadProjects()
    // Sign-in checks ask each agent, which takes a moment; the projects don't wait for them.
    client.status().then(setStatus, (failure: unknown) => setError(messageOf(failure)))
  }, [client, loadProjects])

  useWatch((event) => {
    if (
      event._tag === 'Changed' &&
      (event.aggregateType === 'project' || event.aggregateType === 'task' || event.aggregateType === 'provider_session')
    )
      loadProjects()
  })

  const openPath = useCallback(
    async (path: string) => {
      setError(null)
      setOpening(true)
      try {
        return await client.openProject(path)
      } catch (failure) {
        setError(messageOf(failure))
        return null
      } finally {
        setOpening(false)
      }
    },
    [client],
  )

  const openFolder = useCallback(async () => {
    const path = await host.pickFolder()
    return path === null ? null : openPath(path)
  }, [host, openPath])

  const openDropped = useCallback(
    (file: File) => {
      const path = host.pathOf(file)
      return path === '' ? Promise.resolve(null) : openPath(path)
    },
    [host, openPath],
  )

  return { status, projects, error, opening, openFolder, openDropped }
}
