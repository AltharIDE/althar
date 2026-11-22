import type { PlanStep, ProjectWorker, WorkerPlanRequirements, WorksIn } from './Api'

type Lead = Pick<PlanStep, 'key' | 'agentId' | 'skipped'>

const noLead = 'Choose a lead to run on a worker.'
const workerLead = (steps: ReadonlyArray<Lead>) => steps.find((step) => step.key === 'implement' && !step.skipped)

export const workerRepositoryProblem = (count: number) => (count === 1 ? undefined : 'A worker needs a task with one repository.')

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

export const workerProblem = (worker: ProjectWorker | undefined, steps: ReadonlyArray<Lead>): string | undefined => {
  if (worker === undefined) return 'This worker is unavailable for this project.'
  if (worker.busy) return 'This worker is already running a task.'
  const lead = workerLead(steps)
  if (lead === undefined) return noLead
  if (!worker.providers.includes(lead.agentId)) return 'This worker does not have the lead’s agent.'
}
