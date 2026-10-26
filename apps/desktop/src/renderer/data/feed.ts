import { hashKey, type QueryClient, type QueryKey } from '@tanstack/react-query'

import type { AutomationSnapshot, CoordinatorSnapshot, ThreadSnapshot, WatchEvent } from '@althar/contracts'

import type { Client } from './client'
import { keys } from './reads'

/*
 * The window's one watch on the runtime's change feed. Every change it hears
 * ends the reads it touches, so the cache never shows what the runtime has
 * moved past:
 *
 * - a whole read (the projects, the home, a board, the connections) is read
 *   again, gathered a moment so a burst of changes reads once; on screen or
 *   not, so whichever the person goes to next is already right. Only a
 *   permission the rules answered, which moves nothing but the home's count
 *   of them and comes with every edit an agent makes, reads the home again
 *   only while it shows; off screen it is marked, for its next visit;
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

/** What changes the home: what changes a board, the projects themselves, and a permission the rules answered. */
export const HOME = new Set([...BOARD, 'project', 'decision'])

/** What changes the home only while it shows: the count of permissions the rules answered. */
export const HOME_SHOWN = new Set(['decision'])

/** What changes the projects as listed: a name, their tasks and runs, who is working, what waits on you. */
export const PROJECTS = new Set(['project', 'task', 'run', 'provider_session', 'attention_request'])

/** What changes a project's repositories as listed: the project itself, and its tasks, which count the ones they change; and, for every project, a connection. */
export const REPOSITORIES = new Set(['project', 'task'])

/** What changes the connections as listed: a connection, and a project, by whose repositories and name they say where its code is. */
export const CONNECTIONS = new Set(['connection', 'project'])

/** Changes elsewhere in a project that move what a card in its coordinator's thread shows. */
export const CARDS = new Set(['provider_session', 'attention_request', 'task_plan', 'run', 'task', 'workspace'])

/**
 * What changes a project's automations: one of them, or one of its runs.
 * Each moves the Automations tab, the page of the automation it is of, and
 * the automation's cards in the coordinator's thread, which say where it stands.
 */
export const AUTOMATIONS = new Set(['automation', 'automation_occurrence'])

export interface Feed {
  /** Calls `listener` with every change from now on, until the returned function is called. */
  readonly listen: (listener: (event: WatchEvent) => void) => () => void
  /**
   * Calls `listener` each time the watch starts listening, as it does again
   * after it broke, until the returned function is called: what streams only
   * to those listening, such as a command's output, may have been missed.
   */
  readonly rewatched: (listener: () => void) => () => void
  readonly stop: () => void
}

type Changed = Extract<WatchEvent, { _tag: 'Changed' }>

/** A whole read a change ends, and whether it is read again off screen too. */
interface Due {
  readonly key: QueryKey
  readonly offScreen: boolean
}

/** The whole reads a change ends. */
const wholeReads = (cache: QueryClient, event: Changed): ReadonlyArray<Due> => [
  ...(PROJECTS.has(event.aggregateType) ? [{ key: keys.projects, offScreen: true }] : []),
  ...(HOME.has(event.aggregateType) ? [{ key: keys.home, offScreen: !HOME_SHOWN.has(event.aggregateType) }] : []),
  ...(event.projectId !== null && BOARD.has(event.aggregateType) ? [{ key: keys.board(event.projectId), offScreen: true }] : []),
  // The connections, which say where each project's code is: a connection, or a project's repositories, name or removal.
  ...(CONNECTIONS.has(event.aggregateType) ? [{ key: keys.connections, offScreen: true }] : []),
  // Its repositories, and how many tasks under way change each, only while they show.
  ...(event.projectId !== null && REPOSITORIES.has(event.aggregateType)
    ? [{ key: keys.repositories(event.projectId), offScreen: false }]
    : []),
  // Every project's repositories that show, when a code host is connected or its sign-in stops working: where their work goes.
  ...(event.aggregateType === 'connection'
    ? cache
        .getQueryCache()
        .findAll({ queryKey: ['repositories'] })
        .map((query) => ({ key: query.queryKey, offScreen: false }))
    : []),
  // Its tracker (ADR-059), which follows a connection disconnected or made again, only while it shows.
  ...(event.projectId !== null && event.aggregateType === 'project'
    ? [{ key: keys.projectTracker(event.projectId), offScreen: false }]
    : []),
  ...(event.aggregateType === 'connection'
    ? cache
        .getQueryCache()
        .findAll({ queryKey: ['projectTracker'] })
        .map((query) => ({ key: query.queryKey, offScreen: false }))
    : []),
  // Its rules, which an answer can change too (Allow always, Deny always), only while they show.
  ...(event.projectId !== null && event.aggregateType === 'policy' ? [{ key: keys.rules(event.projectId), offScreen: false }] : []),
  // Its notes, which the coordinator keeps as the person decides, only while they show.
  ...(event.projectId !== null && event.aggregateType === 'project_note' ? [{ key: keys.notes(event.projectId), offScreen: false }] : []),
  // Its automations, and the page of the one that changed or ran, only while they show: what doesn't is read as it next opens.
  ...(event.projectId !== null && AUTOMATIONS.has(event.aggregateType)
    ? [{ key: keys.automations(event.projectId), offScreen: false }, ...automationReads(cache, event)]
    : []),
  // Finished tasks' folders, which go and come back with their worktrees and with tasks settling, only while they show (ADR-056).
  ...(event.aggregateType === 'workspace' || event.aggregateType === 'task' ? [{ key: keys.folders, offScreen: false }] : []),
]

/** The automations' pages a change moves: the one it is, or, for a run, every one of its project's, as a run names its occurrence. */
const automationReads = (cache: QueryClient, event: Changed): ReadonlyArray<Due> =>
  event.aggregateType === 'automation'
    ? [{ key: keys.automation(event.aggregateId), offScreen: false }]
    : cache
        .getQueryCache()
        .findAll({ queryKey: ['automation'] })
        .filter((query) => (query.state.data as AutomationSnapshot | undefined)?.automation.projectId === event.projectId)
        .map((query) => ({ key: query.queryKey, offScreen: false }))

/**
 * The threads in the cache a change moves: its own, a coordinator's whose
 * cards or head it changes, and every one of its project's when it is
 * renamed or its rules change, by whose switch a task allows everything.
 */
const threadReads = (cache: QueryClient, event: Changed): ReadonlyArray<QueryKey> => {
  const renamed =
    event.aggregateType === 'project' || event.aggregateType === 'policy'
      ? cache
          .getQueryCache()
          .findAll({ queryKey: ['thread'] })
          .filter((query) => (query.state.data as ThreadSnapshot | undefined)?.project.id === event.projectId)
          .map((query) => query.queryKey)
      : []
  const coordinators = cache
    .getQueryCache()
    .findAll({ queryKey: ['coordinator'] })
    .filter((query) => {
      const data = query.state.data as CoordinatorSnapshot | undefined
      return (
        data?.threadId === event.threadId ||
        event.aggregateType === 'connection' ||
        (event.projectId === query.queryKey[1] &&
          (CARDS.has(event.aggregateType) || AUTOMATIONS.has(event.aggregateType) || event.aggregateType === 'project'))
      )
    })
    .map((query) => query.queryKey)
  return [...(event.threadId === null ? [] : [keys.thread(event.threadId)]), ...coordinators, ...renamed]
}

const isThread = (key: QueryKey) => key[0] === 'thread' || key[0] === 'coordinator'

/** Starts watching the runtime's changes after `since` (or from now), keeping `cache` up to date, until `stop`. */
export const follow = (client: Client, cache: QueryClient, since?: number): Feed => {
  const listeners = new Set<(event: WatchEvent) => void>()
  const rewatching = new Set<() => void>()
  // Changes heard so far; for each read, by its key's hash, how many had been heard when a change last touched it, and when it last began.
  let heardSoFar = 0
  const touched = new Map<string, number>()
  const begun = new Map<string, number>()
  const due = new Map<string, Due>()
  let timer: ReturnType<typeof setTimeout> | undefined

  const readDue = () => {
    timer = undefined
    const reads = [...due.values()]
    due.clear()
    for (const { key, offScreen } of reads)
      void cache.invalidateQueries({ queryKey: key, exact: true, refetchType: offScreen ? 'all' : 'active' })
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
      for (const read of wholeReads(cache, event)) {
        const hash = hashKey(read.key)
        touched.set(hash, heardSoFar)
        // Off screen if any change gathered with it says so.
        due.set(hash, { key: read.key, offScreen: read.offScreen || (due.get(hash)?.offScreen ?? false) })
      }
      if (due.size > 0) timer ??= setTimeout(readDue, GATHER)
      // A thread on screen reads its own changes item by item, and its head as its project's rules change; a project's new name it reads again whole, at once.
      const renamed = event.aggregateType === 'project'
      for (const queryKey of threadReads(cache, event)) {
        if (cache.getQueryState(queryKey) === undefined) continue
        touched.set(hashKey(queryKey), heardSoFar)
        void cache.invalidateQueries({ queryKey, exact: true, refetchType: renamed ? 'active' : 'none' })
      }
    }
    for (const listener of listeners) listener(event)
  }

  const unwatch = client.watch(heard, since, () => {
    for (const listener of rewatching) listener()
  })
  return {
    listen: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    rewatched: (listener) => {
      rewatching.add(listener)
      return () => void rewatching.delete(listener)
    },
    stop: () => {
      unwatch()
      unsubscribe()
      clearTimeout(timer)
      listeners.clear()
      rewatching.clear()
    },
  }
}
