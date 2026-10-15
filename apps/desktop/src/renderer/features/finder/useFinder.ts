import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'

import type { FoundTask, ProjectSummary } from '@althar/contracts'
import { FoundState, type FoundRow } from '@althar/ui'

import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { refOf } from '../home/HomeView'

/*
 * Finding a task (⌘K): in the project whose tab has the window, or, on the
 * home, in every project. The words are searched once typing pauses, and
 * what was found for the last words stays until the next answer comes, so
 * nothing empties and fills again between keys. With no words, the tasks
 * changed last. Choosing one opens it, as its card on the board does.
 */

/** How long typing pauses before the words are searched. */
export const PAUSE_MS = 120

/** Where a found task stands, as the finder says it in a word. */
export const stateOf = (task: FoundTask): FoundState => {
  switch (task.phase) {
    case 'planned':
    case 'held':
      return FoundState.Planned
    case 'running':
      return FoundState.Running
    case 'waiting':
      return FoundState.Yours
    case 'ready':
      return FoundState.Ready
    case 'stopped':
      return FoundState.Stopped
    case 'settled':
      if (task.state === 'abandoned') return FoundState.Abandoned
      return task.pullRequest === null ? FoundState.Done : FoundState.Merged
  }
}

/** A found task as the finder lists it, by its thread, which opens it; with its project where the search crosses projects. */
export const rowOf = (task: FoundTask, project: ProjectSummary | undefined): FoundRow => ({
  id: task.threadId,
  title: task.title,
  state: stateOf(task),
  ...(project === undefined ? {} : { project: refOf(project) }),
  ...(task.pullRequest === null ? {} : { pullRequest: task.pullRequest }),
  ...(task.matched === null ? {} : { matched: task.matched }),
})

export interface FinderModel {
  readonly query: string
  readonly setQuery: (query: string) => void
  /** What was found for the words last searched; null before the first answer. */
  readonly rows: ReadonlyArray<FoundRow> | null
  /** Newer words wait to be searched, or their answer is on its way. */
  readonly searching: boolean
  /** The project it searches; null for every project. */
  readonly project: ProjectSummary | null
  /** Opens a found task, by its thread. */
  readonly open: (threadId: string) => void
}

export const useFinder = (projectId: string | null, onOpened: () => void): FinderModel => {
  const { client } = useServices()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [asked, setAsked] = useState('')
  useEffect(() => {
    if (query === asked) return
    // Cleared, the tasks changed last come at once.
    const pause = setTimeout(() => setAsked(query), query.trim() === '' ? 0 : PAUSE_MS)
    return () => clearTimeout(pause)
  }, [query, asked])
  const found = useQuery({ ...reads(client).search(projectId, asked.trim()), placeholderData: keepPreviousData })
  const projects = useQuery(reads(client).projects()).data?.projects
  const rows = useMemo(
    () =>
      found.data?.tasks.map((task) => rowOf(task, projectId === null ? projects?.find((one) => one.id === task.projectId) : undefined)) ??
      null,
    [found.data, projects, projectId],
  )
  return {
    query,
    setQuery,
    rows,
    searching: query !== asked || found.isPlaceholderData,
    project: projectId === null ? null : (projects?.find((one) => one.id === projectId) ?? null),
    open: (threadId) => {
      onOpened()
      void navigate({ to: '/threads/$threadId', params: { threadId } })
    },
  }
}
