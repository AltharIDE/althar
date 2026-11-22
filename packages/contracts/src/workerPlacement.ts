import type { PlanStep, ProjectWorker, WorkerPlanRequirements, WorksIn } from './Api'

type Lead = Pick<PlanStep, 'key' | 'agentId' | 'skipped'>

const workerLead = (steps: ReadonlyArray<Lead>) => steps.find((step) => step.key === 'implement' && !step.skipped)

const repositoryLimit = 8

export const workerRepositoryLimit = (worker: ProjectWorker | undefined, steps: ReadonlyArray<Lead>): number => {
  const lead = workerLead(steps)
  return lead !== undefined && worker?.multiRepoProviders?.includes(lead.agentId) === true ? repositoryLimit : 1
}

/** A worker as the window names it: by its system and the end of its id, Linux worker 3f9a2c. Linux where it hasn't said. */
export const workerNameOf = (workerId: string, platform?: NonNullable<ProjectWorker['capacity']>['platform']) =>
  (platform === 'macos' ? 'Mac worker' : platform === 'windows' ? 'Windows worker' : 'Linux worker') + ' ' + workerId.slice(-6)

export const workerName = (worker: Pick<ProjectWorker, 'workerId' | 'capacity'>) => workerNameOf(worker.workerId, worker.capacity?.platform)

/** Why no worker can take a task, whichever worker: what the plan is, not what any worker has. */
export type PlanUnfit =
  /** The home's runtime is older than the window's, and says nothing of where a task can run. */
  | { readonly kind: 'unknown' }
  /** It stays where it was asked, such as a quick task from this computer. */
  | { readonly kind: 'home' }
  /** A review of a pull request: it only reads, on the home. */
  | { readonly kind: 'review' }
  /** It works Local, in the person's own checkout. */
  | { readonly kind: 'local' }
  | { readonly kind: 'repositories'; readonly count: number; readonly limit: number }
  | { readonly kind: 'lead' }

/** Why one worker can't take a task now. */
export type WorkerUnfit =
  /** Not connected, or no longer granted this project. */
  | { readonly kind: 'gone' }
  | { readonly kind: 'busy' }
  /** Out of workspace disk or memory. */
  | { readonly kind: 'full' }
  | { readonly kind: 'lead' }
  /** It hasn't the lead's agent. */
  | { readonly kind: 'agent'; readonly agentId: string }
  | { readonly kind: 'repositories'; readonly count: number; readonly limit: number }

const repositoriesUnfit = (count: number, limit = repositoryLimit) =>
  count === 0 || count > limit ? ({ kind: 'repositories', count, limit } as const) : undefined

export const workerPlanUnfit = (
  requirements: WorkerPlanRequirements | undefined,
  workspace: WorksIn | undefined,
  steps: ReadonlyArray<Lead>,
): PlanUnfit | undefined => {
  if (requirements === undefined) return { kind: 'unknown' }
  if (requirements.homeOnly) return { kind: 'home' }
  if (requirements.readOnly) return { kind: 'review' }
  if (workspace === 'checkout') return { kind: 'local' }
  return repositoriesUnfit(requirements.repositoryCount) ?? (workerLead(steps) === undefined ? { kind: 'lead' } : undefined)
}

export const workerUnfit = (worker: ProjectWorker | undefined, steps: ReadonlyArray<Lead>, repositories = 1): WorkerUnfit | undefined => {
  if (worker === undefined) return { kind: 'gone' }
  if (worker.busy) return { kind: 'busy' }
  if (worker.capacity?.freeDiskMib === 0 || worker.capacity?.freeMemoryMib === 0) return { kind: 'full' }
  const lead = workerLead(steps)
  if (lead === undefined) return { kind: 'lead' }
  if (!worker.providers.includes(lead.agentId)) return { kind: 'agent', agentId: lead.agentId }
  return repositoriesUnfit(repositories, workerRepositoryLimit(worker, steps))
}

const chooseLead = 'Choose a lead to run it on a worker.'

/** How many repositories a worker takes, said where a task has more, or none. */
const repositoriesWords = (who: string, { count, limit }: { readonly count: number; readonly limit: number }) =>
  count === 0
    ? `${who} needs a repository to work in.`
    : limit === 1
      ? `${who} takes one repository at a time.`
      : `${who} takes up to ${limit} repositories at a time.`

export const workerRepositoryProblem = (count: number, maximum = repositoryLimit): string | undefined => {
  const unfit = repositoriesUnfit(count, maximum)
  return unfit === undefined ? undefined : repositoriesWords('A worker', unfit)
}

/** Why no worker can take it, in a sentence: an answer the runtime gives, and the line the window shows. */
export const planUnfitWords = (unfit: PlanUnfit, home = 'the home'): string => {
  switch (unfit.kind) {
    case 'unknown':
      return 'Update the home to run this task on a worker.'
    case 'home':
      return `This task runs on ${home}.`
    case 'review':
      return `Reviews of pull requests run on ${home}.`
    case 'local':
      return 'Choose Worktree to run it on a worker.'
    case 'repositories':
      return repositoriesWords('A worker', unfit)
    case 'lead':
      return chooseLead
  }
}

/** Why this worker can't take it, in a sentence, by its name. */
export const workerUnfitWords = (unfit: WorkerUnfit, name: string): string => {
  switch (unfit.kind) {
    case 'gone':
      return `${name} isn’t connected to this project now.`
    case 'busy':
      return `${name} is at work on another task.`
    case 'full':
      return `${name} is out of disk space or memory.`
    case 'lead':
      return chooseLead
    case 'agent':
      return `${name} doesn’t have the lead’s agent.`
    case 'repositories':
      return repositoriesWords(name, unfit)
  }
}

export const workerPlanProblem = (
  requirements: WorkerPlanRequirements | undefined,
  workspace: WorksIn | undefined,
  steps: ReadonlyArray<Lead>,
): string | undefined => {
  const unfit = workerPlanUnfit(requirements, workspace, steps)
  return unfit === undefined ? undefined : planUnfitWords(unfit)
}

export const workerProblem = (worker: ProjectWorker | undefined, steps: ReadonlyArray<Lead>, repositories = 1): string | undefined => {
  const unfit = workerUnfit(worker, steps, repositories)
  return unfit === undefined ? undefined : workerUnfitWords(unfit, worker === undefined ? 'That worker' : workerName(worker))
}

/** Prefer a current resource report, then spare memory, disk and CPU. A stable ID breaks ties. */
export const automaticWorker = (
  workers: ReadonlyArray<ProjectWorker>,
  steps: ReadonlyArray<Lead>,
  repositories = 1,
): ProjectWorker | undefined =>
  workers
    .filter((worker) => workerProblem(worker, steps, repositories) === undefined)
    .toSorted((left, right) => {
      const a = left.capacity
      const b = right.capacity
      return (
        (b?.freeMemoryMib ?? -1) - (a?.freeMemoryMib ?? -1) ||
        (b?.freeDiskMib ?? -1) - (a?.freeDiskMib ?? -1) ||
        (b?.cpuCores ?? -1) - (a?.cpuCores ?? -1) ||
        left.workerId.localeCompare(right.workerId)
      )
    })[0]

export const automaticWorkerUnavailable = 'No worker is free for this task now.'
