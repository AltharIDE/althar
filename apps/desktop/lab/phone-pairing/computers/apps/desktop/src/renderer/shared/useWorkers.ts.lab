import { useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'

import { type HomeWorker, type HomeWorkers, type WorkerCapacity, workerName } from '@althar/contracts'
import type { ComputerWorker, LoadWorker, WorkerState } from '@althar/ui'

import { keys } from '../data/reads'
import { useServices } from '../data/services'
import { brandOf } from './agents'

/*
 * The home's workers (ADR-103), as Settings › Computers and the load
 * popover show them (`GetWorkers`): each worker it enrolled, whether it is
 * connected, the task it runs (one at a time), what it has free, the agents
 * it can run and the projects it may work on. Read every three seconds while
 * one of them shows and the window is in view, and never otherwise; each
 * shares the one reading. Removing one takes it off the list at once, before
 * the runtime says so, and puts it back if it can't be removed.
 */

/** How often they are read again while they show. */
const EVERY = 3_000

export const text = {
  notConnected: 'Not connected',
  readyForATask: 'Ready for a task',
  runningATask: 'Running a task',
  outOfRoom: 'Out of memory or disk space',
  free: (memory: string) => `${memory} memory free`,
  cores: (n: number) => (n === 1 ? '1 core' : `${n} cores`),
  platform: { linux: 'Linux', macos: 'macOS', windows: 'Windows' } as const,
}

/** Null while nothing shows them, before the first reading, or where the home can't say, as an older Althar can't. */
export const useWorkers = (shown: boolean): HomeWorkers | null => {
  const { client } = useServices()
  const reading = useQuery({
    queryKey: keys.workers,
    queryFn: () => client.getWorkers(),
    enabled: shown,
    refetchInterval: EVERY,
    refetchIntervalInBackground: false,
    staleTime: 0,
    retry: false,
  })
  return shown ? (reading.data ?? null) : null
}

export interface RemoveWorkerModel {
  readonly remove: (workerId: string) => void
  /** The last worker couldn't be removed: what the runtime said. */
  readonly failed: string | null
}

/** Takes a worker out of the home: off the list at once, back on it with why where the runtime refuses. */
export const useRemoveWorker = (): RemoveWorkerModel => {
  const { client, cache } = useServices()
  const [failed, setFailed] = useState<string | null>(null)
  const remove = useCallback(
    (workerId: string) => {
      setFailed(null)
      void cache.cancelQueries({ queryKey: keys.workers })
      cache.setQueryData<HomeWorkers>(keys.workers, (was) =>
        was === undefined ? was : { ...was, workers: was.workers.filter((one) => one.workerId !== workerId) },
      )
      client.removeWorker(workerId).then(
        () => undefined,
        (error: unknown) => {
          void cache.refetchQueries({ queryKey: keys.workers })
          setFailed(error instanceof Error ? error.message : 'Couldn’t remove the worker.')
        },
      )
    },
    [cache, client],
  )
  return { remove, failed }
}

/** Where a worker stands: offline; at work on a task; out of memory or disk; or free. */
export const workerStateOf = (worker: HomeWorker): WorkerState =>
  !worker.connected
    ? 'offline'
    : worker.busy
      ? 'working'
      : worker.capacity?.freeMemoryMib === 0 || worker.capacity?.freeDiskMib === 0
        ? 'full'
        : 'free'

const GIB = 1024

/** What a worker has free, from the MiB it reports, as the load meter says memory: 12.4 GB, 640 MB. */
export const mibOf = (mib: number): string => (mib >= GIB ? `${Number((mib / GIB).toFixed(1))} GB` : `${mib} MB`)

/** What a worker is, in a line: Linux · arm64 · 16 cores. */
export const workerKindOf = (capacity: WorkerCapacity): string =>
  `${text.platform[capacity.platform]} · ${capacity.architecture} · ${text.cores(capacity.cpuCores)}`

/** A worker as Settings › Computers has it; `agentName` names an agent by its id, as this home has it. */
export const computerWorkerOf = (worker: HomeWorker, agentName: (id: string) => string): ComputerWorker => {
  const { capacity, task } = worker
  return {
    id: worker.workerId,
    name: workerName(worker),
    kind: capacity === undefined ? null : workerKindOf(capacity),
    state: workerStateOf(worker),
    task: task === null ? null : { id: task.threadId, title: task.title, project: task.project },
    memoryFree: capacity === undefined ? null : mibOf(capacity.freeMemoryMib),
    diskFree: capacity === undefined ? null : mibOf(capacity.freeDiskMib),
    agents: worker.providers.map((id) => {
      const mark = brandOf(id)
      return { name: agentName(id), ...(mark === undefined ? {} : { mark }) }
    }),
    projects: worker.projects.map(({ name }) => name),
  }
}

/** A worker as the load popover lists it, under the home's readings: where it stands, and the task it runs or what it has free. */
export const loadWorkerOf = (worker: HomeWorker): LoadWorker => {
  const state = workerStateOf(worker)
  const detail =
    state === 'offline'
      ? text.notConnected
      : state === 'full'
        ? text.outOfRoom
        : state === 'working'
          ? worker.task === null
            ? text.runningATask
            : `${worker.task.title} · ${worker.task.project}`
          : worker.capacity === undefined
            ? text.readyForATask
            : text.free(mibOf(worker.capacity.freeMemoryMib))
  return { id: worker.workerId, name: workerName(worker), state, detail }
}
