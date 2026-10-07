import { hashKey, type QueryClient, type QueryKey } from '@tanstack/react-query'

import type { CoordinatorSnapshot, WatchEvent } from '@althar/contracts'

import type { Client } from './client'
import { keys } from './reads'

/*
 * The window's one watch on the runtime's change feed. Every change it hears
 * ends the reads it touches, so the cache never shows what the runtime has
 * moved past:
 *
 * - a whole read (the projects, the home, a board, the connections) is read
 *   again, gathered a moment so a burst of changes reads once; on screen or
 *   not, so whichever the person goes to next is already right;
 * - a thread (a task's, or a project's coordinator) is only marked out of
 *   date. The screen showing it reads what changed item by item, as it hears
 *   the same change; one that isn't showing is read again when it is next
 *   opened.
 *
 * A read that was under way when a change touched it may not hold it, so
 * it is read once more. Screens hear every change through `listen`, from
 * the moment they listen, and nothing in between is missed: what they show
 * was read after the last change that touched it.
 */

/** How long changes are gathered before what they touched is read again. */
export const GATHER = 60

/**
 * What changes what a board shows: a task, its plan, run, steps and
 * sessions, an agent's turn starting or ending, a call, a pull request, a
 * worktree. Not what is said in a thread, which changes far more often and
 * none of this.
 */
export const BOARD = new Set([
  'task',
  'task_plan',
  'run',
  'node_attempt',
  'provider_session',
  'turn_delivery',
  'attention_request',
  'external_link',
  'workspace',
])

/** What changes the home: what changes a board, and the projects themselves. */
export const HOME = new Set([...BOARD, 'project', 'decision'])

/** What changes the projects as listed: a name, their tasks and runs, who is working, what waits on you. */
export const PROJECTS = new Set(['project', 'task', 'run', 'provider_session', 'attention_request'])

/** Changes elsewhere in a project that move what a card in its coordinator's thread shows. */
export const CARDS = new Set(['provider_session', 'attention_request', 'task_plan', 'run', 'task', 'workspace'])

export interface Feed {
  /** Calls `listener` with every change from now on, until the returned function is called. */
  readonly listen: (listener: (event: WatchEvent) => void) => () => void
  readonly stop: () => void
}

type Changed = Extract<WatchEvent, { _tag: 'Changed' }>

/** The whole reads a change ends. */
const wholeReads = (event: Changed): ReadonlyArray<QueryKey> => [
  ...(PROJECTS.has(event.aggregateType) ? [keys.projects] : []),
  ...(HOME.has(event.aggregateType) ? [keys.home] : []),
  ...(event.projectId !== null && BOARD.has(event.aggregateType) ? [keys.board(event.projectId)] : []),
  ...(event.aggregateType === 'connection' ? [keys.connections] : []),
]

/** The threads in the cache a change moves: its own, and a coordinator's whose cards or head it changes. */
const threadReads = (cache: QueryClient, event: Changed): ReadonlyArray<QueryKey> => {
  const coordinators = cache
    .getQueryCache()
    .findAll({ queryKey: ['coordinator'] })
    .filter((query) => {
      const data = query.state.data as CoordinatorSnapshot | undefined
      return (
        data?.threadId === event.threadId ||
        event.aggregateType === 'connection' ||
        (event.projectId === query.queryKey[1] && CARDS.has(event.aggregateType))
      )
    })
    .map((query) => query.queryKey)
  return [...(event.threadId === null ? [] : [keys.thread(event.threadId)]), ...coordinators]
}

const isThread = (key: QueryKey) => key[0] === 'thread' || key[0] === 'coordinator'

/** Starts watching the runtime's changes after `since` (or from now), keeping `cache` up to date, until `stop`. */
export const follow = (client: Client, cache: QueryClient, since?: number): Feed => {
  const listeners = new Set<(event: WatchEvent) => void>()
  // Changes heard so far; for each read, by its key's hash, how many had been heard when a change last touched it, and when it last began.
  let heardSoFar = 0
  const touched = new Map<string, number>()
  const begun = new Map<string, number>()
  const due = new Map<string, QueryKey>()
  let timer: ReturnType<typeof setTimeout> | undefined

  const readDue = () => {
    timer = undefined
    const keysDue = [...due.values()]
    due.clear()
    for (const queryKey of keysDue) void cache.invalidateQueries({ queryKey, exact: true, refetchType: 'all' })
  }

  // A read under way when a change touched it is read once more; one begun after the change holds it.
  const unsubscribe = cache.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated') return
    const { queryHash, queryKey } = event.query
    if (event.action.type === 'fetch') return void begun.set(queryHash, heardSoFar)
    if (event.action.type !== 'success' || event.action.manual === true) return
    const last = touched.get(queryHash)
    const began = begun.get(queryHash)
    if (last === undefined || began === undefined || last <= began) return
    begun.set(queryHash, heardSoFar)
    // Read now, so not again when the gathered changes are read.
    due.delete(queryHash)
    void cache.invalidateQueries({ queryKey, exact: true, refetchType: isThread(queryKey) ? 'active' : 'all' })
  })

  const heard = (event: WatchEvent) => {
    if (event._tag === 'Changed') {
      heardSoFar += 1
      for (const key of wholeReads(event)) {
        touched.set(hashKey(key), heardSoFar)
        due.set(hashKey(key), key)
      }
      if (due.size > 0) timer ??= setTimeout(readDue, GATHER)
      for (const queryKey of threadReads(cache, event)) {
        if (cache.getQueryState(queryKey) === undefined) continue
        touched.set(hashKey(queryKey), heardSoFar)
        void cache.invalidateQueries({ queryKey, exact: true, refetchType: 'none' })
      }
    }
    for (const listener of listeners) listener(event)
  }

  const unwatch = client.watch(heard, since)
  return {
    listen: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    stop: () => {
      unwatch()
      unsubscribe()
      clearTimeout(timer)
      listeners.clear()
    },
  }
}
