import { type ProjectWorker, workerName, workerNameOf } from '@althar/contracts'

import type { EnrolledWorkerState, WorkerExecutionPlatform } from './workerExecution'

/*
 * Where an agent says a task runs, as the person would say it: the home, any free worker, or one of the home's workers by
 * its id, its name, or the end of its id as the window names an unnamed one ("Linux worker 4476f5"). An exact id wins over
 * every other way of naming one, and a name or end of id that more than one worker answers to is refused with their ids,
 * so a placement never lands on a worker nobody meant. A worker the project may use and connected now is found among the
 * project's (`list`); one that isn't is looked for in the home's own ledger (`enrolled`), so the answer says why that one
 * can't be used (not connected, not granted this project) rather than that the project has none. Whether a worker may
 * work on the project is the home's grant (`projectIds`), whatever the worker says it runs (`anyProject`).
 */

export type Whereabouts =
  | { readonly kind: 'home' }
  | { readonly kind: 'any' }
  | { readonly kind: 'worker'; readonly worker: ProjectWorker }
  | { readonly kind: 'refused'; readonly message: string }

/** What names a worker: its id, the name the person gave it, and its system. */
interface Named {
  readonly workerId: string
  readonly name?: string | undefined
  readonly capacity?: ProjectWorker['capacity'] | undefined
}

/** A worker as the window names it (`workerName`), from what the home's ledger or the project's list has of it. */
const nameOf = (worker: Named) => worker.name ?? workerNameOf(worker.workerId, worker.capacity?.platform)

const HOME = new Set(['home', 'the home', 'this home', 'this mac', 'this computer', 'here', 'local', 'null'])
const ANY = new Set(['auto', 'any', 'any worker', 'any free worker', 'a free worker', 'whichever is free'])

const plain = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ')

/** Whether `wanted` names this worker other than by its id: its name, the window's name for it, or the end of its id. */
const aliases = (wanted: string, worker: Named) => {
  if (wanted === '') return false
  if (worker.name !== undefined && plain(worker.name) === wanted) return true
  if (plain(nameOf(worker)) === wanted || plain(workerNameOf(worker.workerId)) === wanted) return true
  // The end of its id, as the window shows an unnamed one's: six hex digits or more.
  return /^[0-9a-f]{6,}$/.test(wanted) && worker.workerId.toLowerCase().endsWith(wanted)
}

export const whereaboutsOf = (
  workers: WorkerExecutionPlatform | undefined,
  projectId: string,
  said: string,
  /** What a project is called, for the words: its name as the person knows it. */
  projectName: string,
): Whereabouts => {
  const wanted = plain(said)
  if (HOME.has(wanted)) return { kind: 'home' }
  if (ANY.has(wanted)) return { kind: 'any' }
  const usable = workers?.list(projectId) ?? []
  const enrolled = workers?.enrolled?.() ?? null
  // Every worker the home knows of, by id, as the project's list has it where it does, else as the ledger has it.
  const everyone = new Map<string, Named>([
    ...(enrolled ?? []).map((one) => [one.workerId, one] as const),
    ...usable.map((one) => [one.workerId, one] as const),
  ])
  const exact = [...everyone.keys()].filter((id) => id.toLowerCase() === wanted)
  const matched = exact.length > 0 ? exact : [...everyone.values()].filter((one) => aliases(wanted, one)).map((one) => one.workerId)
  if (matched.length > 1)
    return {
      kind: 'refused',
      message: `More than one worker answers to ${said.trim()}: ${matched
        .map((id) => `${nameOf(everyone.get(id) ?? { workerId: id })} (${id})`)
        .join(', ')}. Name the one you mean by its id.`,
    }
  const [id] = matched
  const found = usable.find((one) => one.workerId === id)
  if (found !== undefined) return { kind: 'worker', worker: found }
  const known = enrolled?.find((one) => one.workerId === id)
  if (known !== undefined) return { kind: 'refused', message: unusable(known, projectId, projectName) }
  // Nobody by that name: what there is, the project's own first, never "none" while one is connected.
  const others =
    enrolled === null
      ? usable.map((one) => workerName(one))
      : enrolled.map((one) => {
          const name = nameOf(one)
          if (usable.some((use) => use.workerId === one.workerId)) return name
          return !one.connected
            ? `${name} (not connected)`
            : !granted(one, projectId)
              ? `${name} (connected, not on ${projectName})`
              : `${name} (connected)`
        })
  return {
    kind: 'refused',
    message:
      others.length === 0
        ? `No worker is called ${said.trim()}: this home has no workers. Place it on the home, or add a worker in Settings › Computers.`
        : `No worker is called ${said.trim()}. This home’s workers: ${others.join(', ')}; or the home.`,
  }
}

/** Whether the home lets this worker work on the project: its grant, which the home checks again before any run there. */
const granted = (worker: EnrolledWorkerState, projectId: string) => worker.projectIds.includes(projectId)

/** Why a worker the home enrolled isn't among those the project may use now. */
const unusable = (known: EnrolledWorkerState, projectId: string, projectName: string) => {
  const name = nameOf(known)
  if (!known.connected)
    return `${name} isn’t connected to this home now. Once it is back (its card in Settings › Computers says so), try again; or place it on the home or another worker.`
  if (!granted(known, projectId))
    return `${name} is connected, but isn’t allowed to work on ${projectName}. The person ticks ${projectName} under its projects in Settings › Computers; then try again.`
  return `${name} is connected and may work on ${projectName}, but hasn’t offered any agent for it yet. Try again in a moment; where it stays so, restarting Althar’s worker on that box has it say again what it runs.`
}
