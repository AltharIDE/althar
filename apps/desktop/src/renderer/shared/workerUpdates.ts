import { useQuery } from '@tanstack/react-query'
import { useCallback, useSyncExternalStore } from 'react'

import { type HomeWorker, type HomeWorkers, workerName } from '@althar/contracts'
import type { UpdatingWorker, WorkerUpdateView } from '@althar/ui'

import { newer } from '../../homes'
import { keys } from '../data/reads'
import { useServices } from '../data/services'

/*
 * A worker's update, as the window offers and runs it: the newest worker
 * release (main reads it, as Add a worker does), each worker's release
 * against it, and what its home says of an update asked for
 * (`HomeWorker.update`), as the kit says it (`WorkerUpdateView`).
 *
 * What the person pressed shows at once and holds, by worker, until a read
 * the home answered after taking it says so: a read that left before it
 * (the poll, a refresh, another view's) can't put Update or Cancel back
 * meanwhile. Where the home refuses an update, that worker's update says
 * why, with Try again, until it's asked again; a Cancel too late says so on
 * the update under way.
 */

export const updateText = {
  noneNewer: 'It found no newer release it trusts. It checks again within the hour.',
  refused: 'Couldn’t ask it to update.',
  cancelRefused: 'It had started already, so it goes on.',
}

/** The newest worker release published, where main can find it: null where none is, or it can't be found out. */
export const useNewestWorkerRelease = (enabled = true): string | null => {
  const { host } = useServices()
  const release = host.workers?.release
  return (
    useQuery({
      queryKey: ['workers', 'release'],
      queryFn: async () => {
        const found = await release!(false)
        return found.kind === 'ready' ? found.version : null
      },
      enabled: enabled && release !== undefined,
      staleTime: 10 * 60_000,
      refetchInterval: 30 * 60_000,
      retry: false,
    }).data ?? null
  )
}

/* ---- what was pressed, and what the home refused, by worker ----------------------------------- */

/** An update asked, or taken back, by worker: held until a read the home answered after taking it. */
export type Intent = 'update' | 'cancel'

interface Pressed {
  /** Pressed, and not yet confirmed by a fresh read. */
  readonly intents: ReadonlyMap<string, Intent>
  /** Why the home refused to ask a worker, as it said: until it's asked again. */
  readonly refused: ReadonlyMap<string, string>
  /** A Cancel the home refused, as the update had started: said on it until it ends, or the next press. */
  readonly cancelRefused: ReadonlyMap<string, string>
}

let pressed: Pressed = { intents: new Map(), refused: new Map(), cancelRefused: new Map() }
const listeners = new Set<() => void>()
const change = (next: (was: Pressed) => Partial<Pressed>) => {
  pressed = { ...pressed, ...next(pressed) }
  for (const listener of listeners) listener()
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}
const without = <V>(map: ReadonlyMap<string, V>, id: string) => {
  const next = new Map(map)
  next.delete(id)
  return next
}
/** Each worker's last press, by a number of its own: a confirmation for an earlier one lets nothing go. */
const presses = new Map<string, number>()
let pressCount = 0
const press = (workerId: string): number => {
  pressCount += 1
  presses.set(workerId, pressCount)
  return pressCount
}
/** How soon a confirming read that failed is tried again, doubling up to the last. */
export const confirmTiming = { firstMs: 1_000, maxMs: 30_000 }

/** What was pressed and not yet confirmed, and what the home refused, by worker. */
export const usePressed = (): Pressed => useSyncExternalStore(subscribe, () => pressed)

/**
 * The workers as a read says them, with what was pressed and not yet confirmed laid over: an update asked shows asked
 * where the read doesn't yet say it's under way; one taken back shows none where the read still has it asked.
 */
export const withIntents = (workers: HomeWorkers | null, intents: ReadonlyMap<string, Intent>): HomeWorkers | null =>
  workers === null || intents.size === 0
    ? workers
    : {
        ...workers,
        workers: workers.workers.map((one) => {
          const intent = intents.get(one.workerId)
          const state = one.update?.state
          const going = state === 'asked' || state === 'started' || state === 'waiting'
          if (intent === 'update' && !going) return { ...one, update: { state: 'asked' } }
          if (intent === 'cancel' && (state === 'asked' || state === 'waiting')) {
            const { update: _, ...rest } = one
            return rest
          }
          return one
        }),
      }

/**
 * Where a worker's update stands, as the window shows it: none where it runs the newest and none was asked for, or
 * neither its release nor the newest is known.
 */
export const workerUpdateOf = (
  worker: HomeWorker,
  newest: string | null,
  refused?: string,
  cancelRefused?: string,
): WorkerUpdateView | undefined => {
  const behind = worker.release !== undefined && newest !== null && newer(newest, worker.release)
  const to = newest ?? worker.release ?? ''
  if (refused !== undefined) return { state: 'failed', to, message: refused }
  const update = worker.update
  switch (update?.state) {
    case 'asked':
      // Not yet between runs: after its task; away: once it connects; else its home is asking it now.
      return !worker.connected
        ? { state: 'whenOnline', to }
        : worker.task !== null
          ? { state: 'afterTask', to }
          : { state: 'running', to, step: 'getting', ...(cancelRefused === undefined ? {} : { note: cancelRefused }) }
    case 'waiting':
      // Something of its own runs there: its home asks it again before long.
      return worker.connected ? { state: 'afterTask', to } : { state: 'whenOnline', to }
    case 'started':
      // Its updater restarts it: gone from its home meanwhile.
      return {
        state: 'running',
        to,
        step: worker.connected ? 'getting' : 'restarting',
        ...(cancelRefused === undefined ? {} : { note: cancelRefused }),
      }
    case 'done':
      return { state: 'done', version: update.version }
    case 'failed':
      return { state: 'failed', to, message: update.message }
    case 'current':
      return behind ? { state: 'failed', to, message: updateText.noneNewer } : undefined
    case undefined:
      if (!behind || newest === null) return undefined
      return worker.updatesOnRequest === true
        ? { state: 'offer', to: newest, ...(worker.release === undefined ? {} : { from: worker.release }) }
        : { state: 'byItself', to: newest }
  }
}

/** The home's workers as their updates need them, for the kit's `fleetUpdate`. */
export const updatingWorkersOf = (workers: HomeWorkers | null, newest: string | null, said: Pressed): UpdatingWorker[] =>
  (withIntents(workers, said.intents)?.workers ?? []).map((worker) => ({
    id: worker.workerId,
    name: workerName(worker),
    task: worker.task === null ? null : { title: worker.task.title },
    update: workerUpdateOf(worker, newest, said.refused.get(worker.workerId), said.cancelRefused.get(worker.workerId)),
  }))

/** Whether any worker's update is asked for or under way: its home is read more often then. */
export const updating = (workers: HomeWorkers | null | undefined) =>
  (workers?.workers ?? []).some(
    (one) => one.update?.state === 'asked' || one.update?.state === 'started' || one.update?.state === 'waiting',
  )

export interface WorkerUpdatesModel {
  /** Asks these workers to update: each shows asked at once; one the home refuses says why. */
  readonly update: (workerIds: readonly string[]) => void
  /** Takes back an update asked of a worker that hasn't started: at once, back with why where the home refuses. */
  readonly cancel: (workerId: string) => void
}

export const useWorkerUpdates = (): WorkerUpdatesModel => {
  const { client, cache } = useServices()
  /**
   * The home took it, or refused it: a read sent from now on (any read still out is let go) says it, and once that's in,
   * what was pressed is let go too.
   */
  const settle = useCallback(
    (workerId: string, press: number, attempt = 0): void => {
      // Pressed again since: that press settles itself.
      if (presses.get(workerId) !== press) return
      // A read of its own, sent now (any read still out is let go): only its answer, in the cache, lets the press go.
      void cache
        .cancelQueries({ queryKey: keys.workers })
        .then(() => cache.fetchQuery({ queryKey: keys.workers, queryFn: () => client.getWorkers(), staleTime: 0, retry: false }))
        .then(
          () => {
            if (presses.get(workerId) === press) change((was) => ({ intents: without(was.intents, workerId) }))
          },
          () => {
            // Not read: the press holds, and it's read again before long, more slowly each time.
            setTimeout(() => settle(workerId, press, attempt + 1), Math.min(confirmTiming.maxMs, confirmTiming.firstMs * 2 ** attempt))
          },
        )
    },
    [cache, client],
  )
  const update = useCallback(
    (workerIds: readonly string[]) => {
      if (workerIds.length === 0) return
      void cache.cancelQueries({ queryKey: keys.workers })
      change((was) => {
        const intents = new Map(was.intents)
        const refused = new Map(was.refused)
        const cancelRefused = new Map(was.cancelRefused)
        for (const id of workerIds) {
          intents.set(id, 'update')
          refused.delete(id)
          cancelRefused.delete(id)
        }
        return { intents, refused, cancelRefused }
      })
      for (const workerId of workerIds) {
        const pressed = press(workerId)
        client.updateWorker(workerId).then(
          () => settle(workerId, pressed),
          (error: unknown) => {
            change((was) => ({ refused: new Map(was.refused).set(workerId, error instanceof Error ? error.message : updateText.refused) }))
            settle(workerId, pressed)
          },
        )
      }
    },
    [cache, client, settle],
  )
  const cancel = useCallback(
    (workerId: string) => {
      void cache.cancelQueries({ queryKey: keys.workers })
      change((was) => ({ intents: new Map(was.intents).set(workerId, 'cancel'), cancelRefused: without(was.cancelRefused, workerId) }))
      const pressed = press(workerId)
      client.cancelWorkerUpdate(workerId).then(
        () => settle(workerId, pressed),
        () => {
          // Told already: it goes on, and says so where Cancel was pressed.
          change((was) => ({
            intents: without(was.intents, workerId),
            cancelRefused: new Map(was.cancelRefused).set(workerId, updateText.cancelRefused),
          }))
          settle(workerId, pressed)
        },
      )
    },
    [cache, client, settle],
  )
  return { update, cancel }
}

/** For tests: forgets what was pressed. */
export const forgetPressed = () => {
  presses.clear()
  change(() => ({ intents: new Map(), refused: new Map(), cancelRefused: new Map() }))
}
