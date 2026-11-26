import type { PlanStep, ProjectWorker, ToolNeed, WorkerPlanRequirements, WorksIn } from './Api'

type Lead = Pick<PlanStep, 'key' | 'agentId' | 'skipped'> & Partial<Pick<PlanStep, 'model'>>

const workerLead = (steps: ReadonlyArray<Lead>) => steps.find((step) => step.key === 'implement' && !step.skipped)

const repositoryLimit = 8

export const workerRepositoryLimit = (worker: ProjectWorker | undefined, steps: ReadonlyArray<Lead>): number => {
  const lead = workerLead(steps)
  return lead !== undefined && worker?.multiRepoProviders?.includes(lead.agentId) === true ? repositoryLimit : 1
}

/** A worker as the window names it: by its system and the end of its id, Linux worker 3f9a2c. Linux where it hasn't said. */
export const workerNameOf = (workerId: string, platform?: NonNullable<ProjectWorker['capacity']>['platform']) =>
  (platform === 'macos' ? 'Mac worker' : platform === 'windows' ? 'Windows worker' : 'Linux worker') + ' ' + workerId.slice(-6)

/** A worker as the window names it: as the person added it, where they did; else by its system and the end of its id. */
export const workerName = (worker: Pick<ProjectWorker, 'workerId' | 'capacity' | 'name'>) =>
  worker.name ?? workerNameOf(worker.workerId, worker.capacity?.platform)

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
  /** Its own check found its agents' sandbox can't start there: why, and what lets it where something would. */
  | { readonly kind: 'sandbox'; readonly problem: string; readonly fix?: string }
  /** Too little disk left for a task's checkout and its setup. */
  | { readonly kind: 'disk'; readonly freeMib: number }
  /** It has no git, which a task's checkout needs. */
  | { readonly kind: 'git' }
  | { readonly kind: 'lead' }
  /** It hasn't the lead's agent. */
  | { readonly kind: 'agent'; readonly agentId: string }
  /** It has the lead's agent, not signed in there. */
  | { readonly kind: 'signedOut'; readonly agentId: string }
  | { readonly kind: 'repositories'; readonly count: number; readonly limit: number }

/** Less free disk than this, and a task's checkout and setup may not fit. */
export const WORKER_DISK_MIB = 2_048

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
  // What its own check found; a worker from before it checked itself says nothing, and is taken at its word.
  const sandbox = worker.readiness?.sandbox
  if (sandbox !== undefined && !sandbox.starts)
    return { kind: 'sandbox', problem: sandbox.problem, ...(sandbox.fix === undefined ? {} : { fix: sandbox.fix }) }
  if (worker.capacity !== undefined && worker.capacity.freeDiskMib < WORKER_DISK_MIB)
    return { kind: 'disk', freeMib: worker.capacity.freeDiskMib }
  if (worker.readiness !== undefined && !worker.readiness.tools.some((tool) => tool.name === 'git')) return { kind: 'git' }
  const lead = workerLead(steps)
  if (lead === undefined) return { kind: 'lead' }
  if (!worker.providers.includes(lead.agentId)) return { kind: 'agent', agentId: lead.agentId }
  if (worker.signedIn !== undefined && !worker.signedIn.includes(lead.agentId)) return { kind: 'signedOut', agentId: lead.agentId }
  return repositoriesUnfit(repositories, workerRepositoryLimit(worker, steps))
}

/** The models a worker's agent offers there, as its check found them; none where it hasn't said. */
export const workerModels = (worker: Pick<ProjectWorker, 'readiness'> | undefined, agentId: string) => {
  const models = worker?.readiness?.models.find((entry) => entry.providerId === agentId)?.models
  return models === undefined || models.length === 0 ? undefined : models
}

/**
 * Whether a model is one a worker's agent offers there, by its id, or by its id and name as a plan may keep it
 * (`gpt-6.2-sol GPT-6.2 Sol`). A worker that hasn't said takes any.
 */
export const workerOffersModel = (worker: Pick<ProjectWorker, 'readiness'> | undefined, agentId: string, model: string | null) => {
  const models = workerModels(worker, agentId)
  return model === null || models === undefined || models.some((one) => model === one.id || model.startsWith(`${one.id} `))
}

/** The lead's model, where the worker's agent doesn't offer it there: the person picks one it does. */
export const workerModelUnfit = (worker: ProjectWorker | undefined, steps: ReadonlyArray<Lead>) => {
  const lead = workerLead(steps)
  if (lead === undefined || worker === undefined) return undefined
  const model = lead.model ?? null
  return workerOffersModel(worker, lead.agentId, model) ? undefined : { kind: 'model' as const, agentId: lead.agentId, model: model ?? '' }
}

/** Where a worker's agent doesn't offer the lead's model there, in a sentence, by the worker's name and the model's. */
export const workerModelWords = (name: string, model: string) => `${name} doesn’t offer ${model}. Pick a model it has.`

/** What a worker lacks for a task, in a line: Installs Bun 1.3.5 first; Needs cargo (Cargo.toml): its lead sets it up. */
export const workerNeedsWords = (needs: ReadonlyArray<ToolNeed> | undefined): string | undefined => {
  if (needs === undefined || needs.length === 0) return undefined
  const named = (need: ToolNeed) => `${TOOL_NAMES[need.name] ?? need.name}${need.version === undefined ? '' : ` ${need.version}`}`
  const installs = needs.filter((need) => need.installs)
  const lead = needs.filter((need) => !need.installs)
  return [
    ...(installs.length === 0 ? [] : [`Installs ${installs.map(named).join(', ')} first`]),
    ...(lead.length === 0 ? [] : [`Needs ${lead.map((need) => `${named(need)} (${need.why})`).join(', ')}: its lead sets it up`]),
  ].join('; ')
}

const TOOL_NAMES: Readonly<Record<string, string>> = { bun: 'Bun', node: 'Node', python3: 'Python', ruby: 'Ruby', java: 'Java', go: 'Go' }

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
    case 'signedOut':
      return `The lead’s agent isn’t signed in on ${name}. Sign it in from its sheet in Settings › Computers.`
    case 'sandbox':
      return unfit.problem === 'NoUserNamespaces'
        ? `${name} can’t start its agents’ sandbox until its administrator allows it once: Settings › Computers has the command.`
        : `${name} can’t start its agents’ sandbox. Settings › Computers says what it found.`
    case 'disk':
      return `${name} has only ${(unfit.freeMib / 1024).toFixed(1)} GB free, too little for a task.`
    case 'git':
      return `${name} has no git, which a task’s checkout needs.`
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
