import { queryOptions, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import type { HomeCall, HomeSnapshot, ProjectSummary } from '@althar/contracts'
import type { IslandSaying } from '@althar/ui'

import type { Client } from '../../data/client'
import { HOME, HOME_SHOWN } from '../../data/feed'
import { reads } from '../../data/reads'
import { useServices, useWatch } from '../../data/services'
import { kindWords } from '../../shared/calls'
import { useWorkActions } from '../board/useWorkActions'

/*
 * The edge's view model: across every project, what waits on the person and
 * what is in progress, as the home reads it, read again whenever something
 * it shows changes. Not a permission the rules answered, which comes with
 * every edit an agent makes and changes nothing here. A call that comes in
 * while the edge is up is said for a moment (`SAY_FOR`); the ones there when
 * it opened are not.
 */

/** How long a call that just came in is said beside the notch, and rings quicker. */
export const SAY_FOR = 4_200
/** How long changes are gathered before the edge reads again. */
const GATHER = 120

export const edgeKey = ['edge'] as const
export const edgeRead = (client: Client) => queryOptions({ queryKey: edgeKey, queryFn: () => client.getHome() })

/** A call the person answered from the edge, folded to a line for a moment. */
export interface EdgeAnswered {
  readonly id: string
  readonly said: string
  readonly denied: boolean
  readonly project: string
}

export interface EdgeModel {
  readonly home: HomeSnapshot | null
  /** The agents on this Mac, for their names. */
  readonly agents: ReadonlyArray<{ readonly id: string; readonly name: string }>
  /** The call or ready task that has just come in. */
  readonly fresh: string | null
  readonly saying: IslandSaying | null
  readonly answered: ReadonlyArray<EdgeAnswered>
  readonly answer: (call: HomeCall, decision: 'allow' | 'reject', said: string) => void
  readonly error: string | null
}

/** What waits on the person, by id: the calls, and the tasks ready to accept. */
const needIds = (home: HomeSnapshot) => [
  ...home.calls.map((call) => call.id),
  ...home.tasks.filter((task) => task.phase === 'ready').map((task) => task.taskId),
]

/** A need, as the island says it: whose, and what kind. */
const sayingOf = (home: HomeSnapshot, id: string, projects: ReadonlyMap<string, ProjectSummary>): IslandSaying | null => {
  const call = home.calls.find((one) => one.id === id)
  const task = home.tasks.find((one) => one.taskId === id)
  const projectId = call?.projectId ?? task?.projectId
  const project = projectId === undefined ? undefined : projects.get(projectId)
  if (project === undefined) return null
  const kind = call === undefined ? kindWords.ready : call.stuck === null ? kindWords.permission : kindWords.stuck
  return { project: project.name, kind }
}

export const useEdge = (): EdgeModel => {
  const { client, cache } = useServices()
  const actions = useWorkActions()
  const read = useQuery(edgeRead(client))
  const status = useQuery(reads(client).status())
  const home = read.data ?? null
  const [fresh, setFresh] = useState<string | null>(null)
  const [saying, setSaying] = useState<IslandSaying | null>(null)
  const [answered, setAnswered] = useState<ReadonlyArray<EdgeAnswered>>([])

  // Read again when what it shows changes, a burst of changes once.
  const gathering = useRef<ReturnType<typeof setTimeout>>(undefined)
  useWatch((event) => {
    if (event._tag !== 'Changed' || !HOME.has(event.aggregateType) || HOME_SHOWN.has(event.aggregateType)) return
    gathering.current ??= setTimeout(() => {
      gathering.current = undefined
      void cache.invalidateQueries({ queryKey: edgeKey })
    }, GATHER)
  })
  useEffect(() => () => clearTimeout(gathering.current), [])

  // What came in since the last read, said for a moment, whatever is read meanwhile; what was there when the edge opened, not.
  const seen = useRef<ReadonlySet<string> | null>(null)
  const said = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    if (home === null) return
    const ids = needIds(home)
    const before = seen.current
    seen.current = new Set(ids)
    const came = before === null ? undefined : ids.find((id) => !before.has(id))
    if (came === undefined) return
    setFresh(came)
    setSaying(sayingOf(home, came, new Map(home.projects.map((project) => [project.id, project]))))
    clearTimeout(said.current)
    said.current = setTimeout(() => {
      setFresh(null)
      setSaying(null)
    }, SAY_FOR)
  }, [home])
  useEffect(() => () => clearTimeout(said.current), [])

  const answer = (call: HomeCall, decision: 'allow' | 'reject', said: string) => {
    const project = home?.projects.find((one) => one.id === call.projectId)?.name ?? ''
    setAnswered((now) => [...now, { id: call.id, said, denied: decision === 'reject', project }])
    setTimeout(() => setAnswered((now) => now.filter((one) => one.id !== call.id)), SAY_FOR)
    void actions.answer(call.id, decision)
  }

  return {
    home,
    agents: status.data?.agents ?? [],
    fresh,
    saying,
    answered,
    answer,
    error: actions.error,
  }
}
