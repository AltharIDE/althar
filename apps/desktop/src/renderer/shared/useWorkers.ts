import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

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
  const reading = useWorkersRead(shown)
  return shown ? (reading.data ?? null) : null
}

/** The read of the home's workers itself: what it gave, whether it failed, and reading again, where that matters. */
export const useWorkersRead = (shown: boolean) => {
  const { client } = useServices()
  return useQuery({
    queryKey: keys.workers,
    queryFn: () => client.getWorkers(),
    enabled: shown,
    refetchInterval: EVERY,
    refetchIntervalInBackground: false,
    staleTime: 0,
    retry: false,
  })
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
    ...(unreadyOf(worker) === undefined ? {} : { unready: unreadyOf(worker) }),
  }
}

/**
 * What a worker's own check found that stops a task there (ADR-103), in words, with the command its administrator runs:
 * its agents' sandbox, which Runs on greys it out for. None where it starts, or the worker hasn't checked.
 */
export const unreadyOf = (worker: Pick<HomeWorker, 'readiness'>): ComputerWorker['unready'] => {
  const sandbox = worker.readiness?.sandbox
  if (sandbox === undefined || sandbox.starts) return undefined
  if (sandbox.problem === 'NoUserNamespaces')
    return sandbox.fix === undefined
      ? {
          title: 'Its agents’ sandbox can’t start.',
          body: 'This Linux keeps user namespaces off, which it needs. Have its administrator turn them on.',
        }
      : {
          title: 'Its agents’ sandbox can’t start.',
          body: 'This Linux lets only programs it names make the namespaces it needs. Have its administrator run this once there:',
          command: sandbox.fix,
        }
  if (sandbox.problem === 'NoBubblewrap' || sandbox.problem === 'NoSocat')
    return {
      title: 'Its agents’ sandbox can’t start.',
      body: 'Its release lacks what the sandbox needs: add it again to install it afresh.',
    }
  return { title: 'Its agents’ sandbox can’t start.', body: 'Its check found bubblewrap couldn’t make a sandbox there.' }
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

/** A worker's check run from here, by Check again: under way, what it found, or that it couldn't run. */
export type WorkerCheckView =
  | { readonly kind: 'checking' }
  | { readonly kind: 'checked'; readonly sandbox: NonNullable<HomeWorker['readiness']>['sandbox'] }
  | { readonly kind: 'failed' }

export const checkText = {
  stillFails: 'Checked again: it still can’t start.',
  failed: (name: string) => `Couldn’t check ${name} over SSH. Althar’s log says why.`,
}

export interface WorkerCheckModel {
  /** Each worker checked from here, by its id: held over the home's reads until one says what it found. */
  readonly checks: ReadonlyMap<string, WorkerCheckView>
  readonly check: (worker: HomeWorker) => void
  /** Lets go of each check a read of the home now says too. */
  readonly confirmed: (workers: ReadonlyArray<HomeWorker>) => void
}

/**
 * Check again on a worker's sandbox problem: the worker's whole check, run now over the SSH address it was set up at, as
 * after a sign-in. What it found shows at once, over the home's reads, until the worker's next heartbeats tell its home
 * the same: a sandbox an administrator let start clears within seconds of the press, not at the next hourly check.
 */
export const useWorkerCheck = (): WorkerCheckModel => {
  const { host } = useServices()
  const bridge = host.workers
  const [checks, setChecks] = useState<ReadonlyMap<string, WorkerCheckView>>(new Map())
  const check = useCallback(
    (worker: HomeWorker) => {
      const ssh = worker.ssh
      if (bridge === undefined || ssh === undefined) return
      const id = worker.workerId
      const settle = (view: WorkerCheckView) =>
        setChecks((before) => (before.get(id)?.kind === 'checking' ? new Map(before).set(id, view) : before))
      setChecks((before) => new Map(before).set(id, { kind: 'checking' }))
      bridge.check(ssh).then(
        (found) => {
          // A release that doesn't say its check: the home's reads stand.
          if (found === null)
            return setChecks((before) => {
              const next = new Map(before)
              next.delete(id)
              return next
            })
          settle({
            kind: 'checked',
            sandbox: found.sandbox.starts
              ? { starts: true }
              : { starts: false, problem: found.sandbox.problem, ...(found.sandbox.fix === undefined ? {} : { fix: found.sandbox.fix }) },
          })
        },
        () => settle({ kind: 'failed' }),
      )
    },
    [bridge],
  )
  // A sandbox that starts now is let go once the home says so too; one that still fails keeps its line until the next press,
  // or until the home says it starts after all.
  const confirmed = useCallback(
    (workers: ReadonlyArray<HomeWorker>) =>
      setChecks((before) => {
        const still = [...before].filter(([id, view]) => {
          const sandbox = workers.find((one) => one.workerId === id)?.readiness?.sandbox
          return sandbox === undefined || view.kind === 'checking' || !sandbox.starts
        })
        return still.length === before.size ? before : new Map(still)
      }),
    [],
  )
  return { checks, check, confirmed }
}

/** A worker as Check again found it: its sandbox, as the check said, over the home's read. */
export const checkedWorker = (worker: HomeWorker, view: WorkerCheckView | undefined): HomeWorker =>
  view?.kind !== 'checked' || worker.readiness === undefined
    ? worker
    : { ...worker, readiness: { ...worker.readiness, sandbox: view.sandbox } }

/** Its problem, with Check again's press as it stands: under way, or what it found where that is no change. */
export const checkedUnready = (
  unready: ComputerWorker['unready'],
  view: WorkerCheckView | undefined,
  name: string,
): ComputerWorker['unready'] =>
  unready === undefined || view === undefined
    ? unready
    : view.kind === 'checking'
      ? { ...unready, checking: true }
      : { ...unready, note: view.kind === 'failed' ? checkText.failed(name) : checkText.stillFails }

export interface WorkerSignInModel {
  readonly signingIn: WorkerSignInView | null
  /** Who is signed in on a worker, as a sign-in that ended here showed it, until a read of the home says so too. */
  readonly held: ReadonlyMap<string, ReadonlyArray<string>>
  readonly confirmed: (workers: ReadonlyArray<HomeWorker>) => void
  readonly start: (worker: HomeWorker, agent: string) => void
  readonly paste: (code: string) => void
  /** Reads who is signed in on the worker again, for a sign-in run in a terminal there. */
  readonly check: () => void
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
  // The worker a sign-in is under way on, by its SSH address, for Check; and the sign-in as it stands, for its answer.
  const address = useRef<string | undefined>(undefined)
  const signingInRef = useRef<WorkerSignInView | null>(null)
  signingInRef.current = signingIn
  const [held, setHeld] = useState<ReadonlyMap<string, ReadonlyArray<string>>>(new Map())
  useEffect(
    () =>
      bridge?.onSignIn((event: WorkerSignInEvent) =>
        setSigningIn((was) => {
          if (was === null) return was
          switch (event.kind) {
            case 'getting':
              return {
                ...was,
                step: {
                  kind: 'getting',
                  percent:
                    event.totalBytes !== undefined && event.totalBytes > 0
                      ? Math.min(100, Math.floor((event.bytes / event.totalBytes) * 100))
                      : 0,
                },
              }
            case 'terminal':
              return { ...was, step: { kind: 'terminal', command: event.command } }
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
              // A sign-in run in a terminal stays, its line and Check, until it is done there.
              return was.step.kind === 'terminal' && !signedIn.includes(was.agent) ? was : null
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
      address.current = worker.ssh
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
    check: () => {
      const ssh = address.current
      const at = signingInRef.current
      if (bridge === undefined || ssh === undefined || at === null) return
      setSigningIn((was) => (was?.step.kind === 'terminal' ? { ...was, step: { ...was.step, checking: true, notYet: false } } : was))
      // Its answer, for the sign-in it was asked for, as long as that is still the one under way.
      const settle = (signedIn: boolean | undefined, ids: ReadonlyArray<string>) => {
        if (signedIn === true) setHeld((before) => new Map(before).set(at.workerId, ids))
        setSigningIn((was) =>
          was === null || was.workerId !== at.workerId || was.agent !== at.agent || was.step.kind !== 'terminal'
            ? was
            : signedIn === true
              ? null
              : { ...was, step: { ...was.step, checking: false, notYet: signedIn === false } },
        )
      }
      bridge.agents(ssh).then(
        (agents) => {
          const ids = agents.filter((one) => one.signedIn).map((one) => one.id)
          settle(ids.includes(at.agent), ids)
        },
        () => settle(undefined, []),
      )
    },
    cancel: () => {
      setSigningIn(null)
      void bridge?.signInAct({ cancel: true })
    },
  }
}
