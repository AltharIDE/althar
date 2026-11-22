import type { PlanStep, ProjectWorker, WorkerPlanRequirements, WorksIn } from './Api'

type Lead = Pick<PlanStep, 'key' | 'agentId' | 'skipped'>

const noLead = 'Choose a lead to run on a worker.'
const workerLead = (steps: ReadonlyArray<Lead>) => steps.find((step) => step.key === 'implement' && !step.skipped)

const repositoryLimit = 8

export const workerRepositoryLimit = (worker: ProjectWorker | undefined, steps: ReadonlyArray<Lead>): number => {
  const lead = workerLead(steps)
  return lead !== undefined && worker?.multiRepoProviders?.includes(lead.agentId) === true ? repositoryLimit : 1
}

export const workerRepositoryProblem = (count: number, maximum = repositoryLimit): string | undefined => {
  if (count === 0) return 'A worker needs a task with a repository.'
  if (count > maximum)
    return maximum === 1 ? 'A worker needs a task with one repository.' : `A worker can run up to ${maximum} repositories in one task.`
}

export const workerPlanProblem = (
  requirements: WorkerPlanRequirements | undefined,
  workspace: WorksIn | undefined,
  steps: ReadonlyArray<Lead>,
): string | undefined => {
  if (requirements === undefined) return 'Update this home to check where this task can run.'
  if (requirements.homeOnly) return 'This task stays on its home.'
  if (requirements.readOnly) return 'Reviews of pull requests run on the home.'
  if (workspace === 'checkout') return 'Use a separate worktree to run on a worker.'
  return workerRepositoryProblem(requirements.repositoryCount) ?? (workerLead(steps) === undefined ? noLead : undefined)
}

export const workerProblem = (worker: ProjectWorker | undefined, steps: ReadonlyArray<Lead>, repositories = 1): string | undefined => {
  if (worker === undefined) return 'This worker is unavailable for this project.'
  if (worker.busy) return 'This worker is already running a task.'
  if (worker.capacity?.freeDiskMib === 0 || worker.capacity?.freeMemoryMib === 0)
    return 'This worker has run out of workspace disk space or available memory.'
  const lead = workerLead(steps)
  if (lead === undefined) return noLead
  if (!worker.providers.includes(lead.agentId)) return 'This worker does not have the lead’s agent.'
  return workerRepositoryProblem(repositories, workerRepositoryLimit(worker, steps))
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

export const automaticWorkerUnavailable = 'No available worker can run this task. Choose a worker again when one is free.'

export const workerName = (worker: ProjectWorker) => {
  const platform = worker.capacity?.platform
  return (
    (platform === 'macos' ? 'Mac worker' : platform === 'windows' ? 'Windows worker' : 'Linux worker') + ' ' + worker.workerId.slice(-6)
  )
}
