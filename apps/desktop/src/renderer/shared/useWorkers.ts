import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'

import { type HomeWorker, type HomeWorkers, type WorkerCapacity, workerName } from '@althar/contracts'
import type { ComputerWorker, LoadWorker, WorkerSignInView, WorkerState } from '@althar/ui'

import type { WorkerSignInEvent } from '../../workers'

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
  offlineDuring: (title: string) => `Went offline during ${title}`,
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
export const computerWorkerOf = (worker: HomeWorker, agentName: (id: string) => string, reachable = false): ComputerWorker => {
  const { capacity, task, signedIn } = worker
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
      return {
        id,
        name: agentName(id),
        ...(mark === undefined ? {} : { mark }),
        ...(signedIn === undefined ? {} : { signedIn: signedIn.includes(id) }),
      }
    }),
    projects: worker.projects.map(({ name }) => name),
    projectIds: worker.projects.map(({ id }) => id),
    managed: worker.anyProject === true,
    // Its agents sign in over the SSH address it was set up at, from a window that can reach it.
    reachable: reachable && worker.ssh !== undefined,
    // Offline, yet holding a task's workspace: it went offline during that task, and keeps it until it says it stopped.
    stranded: !worker.connected && worker.busy,
  }
}

/** A worker as the load popover lists it, under the home's readings: where it stands, and the task it runs or what it has free. */
export const loadWorkerOf = (worker: HomeWorker): LoadWorker => {
  const state = workerStateOf(worker)
  const detail =
    state === 'offline'
      ? worker.busy && worker.task !== null
        ? text.offlineDuring(worker.task.title)
        : text.notConnected
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

export interface WorkerProjectsModel {
  /** Picks the projects a worker works on: shown at once, taken back with a line where the home refuses. */
  readonly set: (workerId: string, projects: ReadonlyArray<{ readonly id: string; readonly name: string }>) => void
  readonly failed: string | null
}

export const useWorkerProjects = (): WorkerProjectsModel => {
  const { client, cache } = useServices()
  const [failed, setFailed] = useState<string | null>(null)
  const set = useCallback(
    (workerId: string, projects: ReadonlyArray<{ readonly id: string; readonly name: string }>) => {
      setFailed(null)
      void cache.cancelQueries({ queryKey: keys.workers })
      cache.setQueryData<HomeWorkers>(keys.workers, (was) =>
        was === undefined
          ? was
          : { ...was, workers: was.workers.map((one) => (one.workerId === workerId ? { ...one, projects: [...projects] } : one)) },
      )
      client
        .setWorkerProjects(
          workerId,
          projects.map(({ id }) => id),
        )
        .catch((error: unknown) => {
          void cache.refetchQueries({ queryKey: keys.workers })
          setFailed(error instanceof Error ? error.message : 'Couldn’t change its projects.')
        })
    },
    [cache, client],
  )
  return { set, failed }
}

export interface WorkerSignInModel {
  readonly signingIn: WorkerSignInView | null
  /** Who is signed in on a worker, as a sign-in that ended here showed it, until a read of the home says so too. */
  readonly held: ReadonlyMap<string, ReadonlyArray<string>>
  readonly confirmed: (workers: ReadonlyArray<HomeWorker>) => void
  readonly start: (worker: HomeWorker, agent: string) => void
  readonly paste: (code: string) => void
  readonly cancel: () => void
}

/**
 * An agent's sign-in on a worker, over the SSH address it was set up at (main's `workerSetups`): its steps as the
 * agent's own sign-in says them; once over, the worker says again who is signed in, and the list is read again.
 */
export const useWorkerSignIn = (): WorkerSignInModel => {
  const { host } = useServices()
  const bridge = host.workers
  const [signingIn, setSigningIn] = useState<WorkerSignInView | null>(null)
  const [held, setHeld] = useState<ReadonlyMap<string, ReadonlyArray<string>>>(new Map())
  useEffect(
    () =>
      bridge?.onSignIn((event: WorkerSignInEvent) =>
        setSigningIn((was) => {
          if (was === null) return was
          switch (event.kind) {
            case 'device':
              return { ...was, step: { kind: 'code', code: event.code, page: event.page } }
            case 'browser':
              return { ...was, step: { kind: 'browser', link: event.link, paste: event.paste } }
            case 'refused':
              return was.step.kind === 'browser' ? { ...was, step: { ...was.step, refused: event.message } } : was
            case 'failed':
              return { ...was, step: { kind: 'failed', message: event.message } }
            case 'agents': {
              // Signed in there: shown at once, and held until a read of the home says so too (its worker says it with its
              // next heartbeats), so an older read never takes it back.
              const signedIn = event.agents.filter((agent) => agent.signedIn).map((agent) => agent.id)
              setHeld((before) => new Map(before).set(was.workerId, signedIn))
              return null
            }
            default:
              return was
          }
        }),
      ),
    [bridge],
  )
  // Let go of each a read now says as it was shown.
  const confirmed = useCallback(
    (workers: ReadonlyArray<HomeWorker>) =>
      setHeld((before) => {
        const same = (one: ReadonlyArray<string>, other: ReadonlyArray<string>) =>
          one.length === other.length && one.every((id) => other.includes(id))
        const still = [...before].filter(
          ([workerId, signedIn]) => !workers.some((worker) => worker.workerId === workerId && same(worker.signedIn ?? [], signedIn)),
        )
        return still.length === before.size ? before : new Map(still)
      }),
    [],
  )
  return {
    signingIn,
    held,
    confirmed,
    start: (worker, agent) => {
      if (bridge === undefined || worker.ssh === undefined) return
      setSigningIn({ workerId: worker.workerId, agent, step: { kind: 'starting' } })
      // Codex signs in with a one-time code on another device; Claude Code's page shows a code to paste back.
      bridge.signIn(worker.ssh, agent, agent === 'codex' ? 'device' : 'browser').catch((error: unknown) =>
        setSigningIn({
          workerId: worker.workerId,
          agent,
          step: { kind: 'failed', message: error instanceof Error ? error.message : 'The sign-in couldn’t start.' },
        }),
      )
    },
    paste: (code) => {
      void bridge?.signInAct({ paste: code })
    },
    cancel: () => {
      setSigningIn(null)
      void bridge?.signInAct({ cancel: true })
    },
  }
}
