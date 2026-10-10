import { queryOptions, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import type { QueryClient } from '@tanstack/react-query'

import type { HomeCall, HomeSnapshot, ProjectSummary } from '@althar/contracts'
import type { IslandSaying } from '@althar/ui'

import { type Client, messageOf } from '../../data/client'
import { type Feed, HOME, HOME_SHOWN } from '../../data/feed'
import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { kindWords } from '../../shared/calls'
import { refOf } from '../home/HomeView'
import type { AnsweredCall } from '../home/needs'

/*
 * The edge's view model: across every project, what waits on the person and
 * what is in progress, as the home reads it, read again whenever something
 * it shows changes (`followEdge`). A call that comes in while the edge is up
 * is said for a moment (`SAY_FOR`); the ones there when it opened are not.
 * A call answered here folds to a line until the edge closes, as on the
 * home; one whose answer didn't go through comes back, with what went wrong.
 */

/** How long a call that just came in is said beside the notch. */
export const SAY_FOR = 4_200
/** How long changes are gathered before the edge reads again. */
const GATHER = 120

export const edgeKey = ['edge'] as const
export const edgeRead = (client: Client) => queryOptions({ queryKey: edgeKey, queryFn: () => client.getHome() })

/**
 * Reads the edge again when what it shows changes, a burst of changes once:
 * not a permission the rules answered, which comes with every edit an agent
 * makes and changes nothing here. Listened from the moment the feed starts,
 * before anything is drawn, so a change heard on the way isn't missed.
 */
export const followEdge = (feed: Feed, cache: QueryClient) => {
  let gathering: ReturnType<typeof setTimeout> | undefined
  return feed.listen((event) => {
    if (event._tag !== 'Changed' || !HOME.has(event.aggregateType) || HOME_SHOWN.has(event.aggregateType)) return
    gathering ??= setTimeout(() => {
      gathering = undefined
      void cache.invalidateQueries({ queryKey: edgeKey })
    }, GATHER)
  })
}

/** A call the person answered from the edge, its line kept where it was, quiet, until the edge closes. */
export type EdgeAnswered = AnsweredCall

export interface EdgeModel {
  readonly home: HomeSnapshot | null
  /** The agents on this Mac, for their names. */
  readonly agents: ReadonlyArray<{ readonly id: string; readonly name: string }>
  readonly saying: IslandSaying | null
  readonly answered: ReadonlyArray<EdgeAnswered>
  readonly answer: (call: HomeCall, decision: 'allow' | 'reject') => void
  /** The edge closed: the answered lines go. */
  readonly closed: () => void
  /** Why the last answer didn't go through. */
  readonly error: string | null
}

/** What waits on the person, by id: the calls, and the tasks ready to accept. */
const needIds = (home: HomeSnapshot) => [
  ...home.calls.map((call) => call.id),
  ...home.tasks.filter((task) => task.phase === 'ready').map((task) => task.taskId),
]

/** A need, as the island says it: whose, by its project's mark, and what kind. */
const sayingOf = (home: HomeSnapshot, id: string, projects: ReadonlyMap<string, ProjectSummary>): IslandSaying | null => {
  const call = home.calls.find((one) => one.id === id)
  const task = home.tasks.find((one) => one.taskId === id)
  const projectId = call?.projectId ?? task?.projectId
  const project = projectId === undefined ? undefined : projects.get(projectId)
  if (project === undefined) return null
  const kind = call === undefined ? kindWords.ready : call.stuck === null ? kindWords.permission : kindWords.stuck
  return { project: refOf(project), kind }
}

export const useEdge = (): EdgeModel => {
  const { client } = useServices()
  const read = useQuery(edgeRead(client))
  const status = useQuery(reads(client).status())
  const home = read.data ?? null
  const [saying, setSaying] = useState<IslandSaying | null>(null)
  const [answered, setAnswered] = useState<ReadonlyArray<EdgeAnswered>>([])
  const [error, setError] = useState<string | null>(null)

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
    setSaying(sayingOf(home, came, new Map(home.projects.map((project) => [project.id, project]))))
    clearTimeout(said.current)
    said.current = setTimeout(() => setSaying(null), SAY_FOR)
  }, [home])
  useEffect(() => () => clearTimeout(said.current), [])

  const answer = (call: HomeCall, decision: 'allow' | 'reject') => {
    setError(null)
    setAnswered((now) => [...now, { call, reply: { decision } }])
    client.answer({ attentionId: call.id, decision }).catch((failure: unknown) => {
      // It still waits: it comes back, and the edge says why.
      setAnswered((now) => now.filter((one) => one.call.id !== call.id))
      setError(messageOf(failure))
    })
  }

  return {
    home,
    agents: status.data?.agents ?? [],
    saying,
    answered,
    answer,
    closed: () => {
      setAnswered([])
      setError(null)
    },
    error,
  }
}
