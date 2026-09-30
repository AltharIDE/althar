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

/** Changes that move what the start screen shows: a project's name, its tasks, who is working, what waits on you. */
const SHOWN = new Set(['project', 'task', 'provider_session', 'attention_request'])

export const useStart = (): StartModel => {
  const { client, host } = useServices()
  const [status, setStatus] = useState<Status | null>(null)
  const [projects, setProjects] = useState<ReadonlyArray<ProjectSummary> | null>(null)
  const [since, setSince] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)

  const loadProjects = useCallback(() => {
    client.listProjects().then(
      (list) => {
        setProjects(list.projects)
        setSince((first) => first ?? list.cursor)
      },
      (failure: unknown) => setError(messageOf(failure)),
    )
  }, [client])

  useEffect(() => {
    loadProjects()
    // This is where sign-in shows, so each agent is asked again. That takes a moment; the projects don't wait for it.
    client.status({ recheck: true }).then(setStatus, (failure: unknown) => setError(messageOf(failure)))
  }, [client, loadProjects])

  useWatch((event) => {
    if (event._tag === 'Changed' && SHOWN.has(event.aggregateType)) loadProjects()
  }, since)

  const open = useCallback(
    async (grant: string | null) => {
      if (grant === null) return null
      setError(null)
      setOpening(true)
      try {
        return await client.openProject(grant)
      } catch (failure) {
        setError(messageOf(failure))
        return null
      } finally {
        setOpening(false)
      }
    },
    [client],
  )

  const openFolder = useCallback(async () => open(await host.pickFolder()), [host, open])
  const openDropped = useCallback(async (file: File) => open(await host.grantDropped(file)), [host, open])

  return { status, projects, error, opening, openFolder, openDropped }
}
