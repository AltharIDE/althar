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
 * (`HomeWorker.update`), as the kit says it (`WorkerUpdateView`). Asking
 * shows at once, the worker's update asked; where the home refuses, that
 * worker's update says why, with Try again, until it's asked again.
 */

export const updateText = {
  noneNewer: 'It found no newer release it trusts. It checks again within the hour.',
  refused: 'Couldn’t ask it to update.',
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

/* ---- refusals, kept here until asked again ------------------------------------------------- */

let refusals: ReadonlyMap<string, string> = new Map()
const listeners = new Set<() => void>()
const setRefusals = (next: ReadonlyMap<string, string>) => {
  refusals = next
  for (const listener of listeners) listener()
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}
/** Why the home refused to ask each worker, by its id, as it said. */
export const useRefusals = () => useSyncExternalStore(subscribe, () => refusals)

/**
 * Where a worker's update stands, as the window shows it: none where it runs the newest and none was asked for, or
 * neither its release nor the newest is known.
 */
export const workerUpdateOf = (worker: HomeWorker, newest: string | null, refused?: string): WorkerUpdateView | undefined => {
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
          : { state: 'running', to, step: 'getting' }
    case 'started':
      // Its updater restarts it: gone from its home meanwhile.
      return { state: 'running', to, step: worker.connected ? 'getting' : 'restarting' }
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
export const updatingWorkersOf = (
  workers: HomeWorkers | null,
  newest: string | null,
  refused: ReadonlyMap<string, string>,
): UpdatingWorker[] =>
  (workers?.workers ?? []).map((worker) => ({
    id: worker.workerId,
    name: workerName(worker),
    task: worker.task === null ? null : { title: worker.task.title },
    update: workerUpdateOf(worker, newest, refused.get(worker.workerId)),
  }))

/** Whether any worker's update is asked for or under way: its home is read more often then. */
export const updating = (workers: HomeWorkers | null | undefined) =>
  (workers?.workers ?? []).some((one) => one.update?.state === 'asked' || one.update?.state === 'started')

export interface WorkerUpdatesModel {
  /** Asks these workers to update: each shows asked at once; one the home refuses says why. */
  readonly update: (workerIds: readonly string[]) => void
  /** Takes back an update asked of a worker that hasn't started: at once, back with why where the home refuses. */
  readonly cancel: (workerId: string) => void
}

export const useWorkerUpdates = (): WorkerUpdatesModel => {
  const { client, cache } = useServices()
  const patch = useCallback(
    (ids: ReadonlySet<string>, update: HomeWorker['update']) => {
      void cache.cancelQueries({ queryKey: keys.workers })
      cache.setQueryData<HomeWorkers>(keys.workers, (was) =>
        was === undefined
          ? was
          : {
              ...was,
              workers: was.workers.map((one) => {
                if (!ids.has(one.workerId)) return one
                const { update: _, ...rest } = one
                return update === undefined ? rest : { ...rest, update }
              }),
            },
      )
    },
    [cache],
  )
  const update = useCallback(
    (workerIds: readonly string[]) => {
      if (workerIds.length === 0) return
      const next = new Map(refusals)
      for (const id of workerIds) next.delete(id)
      setRefusals(next)
      patch(new Set(workerIds), { state: 'asked' })
      for (const workerId of workerIds)
        client.updateWorker(workerId).then(
          () => undefined,
          (error: unknown) => {
            setRefusals(new Map(refusals).set(workerId, error instanceof Error ? error.message : updateText.refused))
            void cache.refetchQueries({ queryKey: keys.workers })
          },
        )
    },
    [cache, client, patch],
  )
  const cancel = useCallback(
    (workerId: string) => {
      patch(new Set([workerId]), undefined)
      client.cancelWorkerUpdate(workerId).then(
        () => undefined,
        () => void cache.refetchQueries({ queryKey: keys.workers }),
      )
    },
    [cache, client, patch],
  )
  return { update, cancel }
}
