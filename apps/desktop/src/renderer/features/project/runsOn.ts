import {
  automaticWorker,
  automaticWorkerUnavailable,
  type PlanStep,
  planUnfitWords,
  type ProjectWorker,
  type WorkerPlanRequirements,
  type WorkerUnfit,
  type WorksIn,
  workerName,
  workerNameOf,
  workerPlanUnfit,
  workerModelUnfit,
  workerModelWords,
  workerUnfit,
  workerUnfitWords,
} from '@althar/contracts'
import type { LaunchPlace } from '@althar/ui'

/*
 * Where a held plan runs (ADR-103), as its card offers it: the home, any free
 * worker, or one of the home's workers, each with where it stands; and what
 * keeps it from starting where it is set to run. The runtime checks the same
 * rules (`@althar/contracts`, workerPlacement) as it starts it.
 */

/** Whichever worker is free, picked as it starts; the home is its own value. */
export const HOME = 'home'
export const ANY = 'auto'

const memoryOf = (mib: number) => (mib >= 1024 ? `${Math.round(mib / 1024)} GB` : `${mib} MB`)

export const runsOnText = {
  any: 'Any free worker',
  noneFree: 'None free',
  gone: 'Not connected',
  free: (memoryMib: number | undefined) => (memoryMib === undefined ? 'Free' : `${memoryOf(memoryMib)} free`),
  /** A worker's state, as Settings › Computers says it: At work, Full; and what it lacks for this task. */
  unfit: (unfit: WorkerUnfit, agentName: (id: string) => string): string | undefined => {
    switch (unfit.kind) {
      case 'gone':
        return runsOnText.gone
      case 'busy':
        return 'At work'
      case 'full':
        return 'Full'
      case 'lead':
        return undefined
      case 'agent':
        return `No ${agentName(unfit.agentId)}`
      case 'signedOut':
        return `${agentName(unfit.agentId)} signed out`
      case 'sandbox':
        return 'Sandbox can’t start'
      case 'disk':
        return `Only ${(unfit.freeMib / 1024).toFixed(1)} GB free`
      case 'git':
        return 'No git'
      case 'repositories':
        return unfit.count === 0 ? 'No repository' : unfit.limit === 1 ? 'One repository' : `Up to ${unfit.limit} repositories`
    }
  },
  /** What a ready worker does first for this project's files: installs what it installs itself, or leaves the rest to the lead. */
  needs: (worker: ProjectWorker) => {
    const needs = worker.needs ?? []
    const named = (name: string) => ({ bun: 'Bun', node: 'Node', python3: 'Python', go: 'Go' })[name] ?? name
    const installs = needs.filter((need) => need.installs).map((need) => named(need.name))
    const lead = needs.filter((need) => !need.installs).map((need) => named(need.name))
    return installs.length > 0 ? `Installs ${installs.join(', ')} first` : lead.length > 0 ? `Needs ${lead.join(', ')}` : undefined
  },
  note: (home: string) => `The setup and lead run on the worker, the review on ${home}.`,
  /** The home, until the window has read which it is: a remote window mustn't say This Mac meanwhile. */
  home: 'This home',
  homeSaid: 'this home',
  useHome: 'Use this home',
}

export interface Placement {
  /** There is something to choose: the home has workers, and the task may run on one. */
  readonly shown: boolean
  readonly places: ReadonlyArray<LaunchPlace>
  readonly note: string
  /** What keeps it from starting where it is set to run, in a sentence. */
  readonly problem: string | undefined
}

export const placementOf = ({
  workers,
  selected,
  steps,
  requirements,
  worksIn,
  home,
  agentName,
  modelName = (_agentId, model) => model,
}: {
  readonly workers: ReadonlyArray<ProjectWorker>
  /** HOME, ANY, or a worker's id. */
  readonly selected: string
  readonly steps: ReadonlyArray<PlanStep>
  readonly requirements: WorkerPlanRequirements | undefined
  readonly worksIn: WorksIn | undefined
  /** The home, as the window names it: This Mac, or the home's own name; null until the window knows which. */
  readonly home: string | null
  readonly agentName: (id: string) => string
  /** A model by the name people know it by: claude-opus-5-5 Claude Opus 5.5. */
  readonly modelName?: (agentId: string, model: string) => string
}): Placement => {
  const label = home ?? runsOnText.home
  const said = home ?? runsOnText.homeSaid
  const repositories = requirements?.repositoryCount
  const best = automaticWorker(workers, steps, repositories)
  const chosen = workers.find((worker) => worker.workerId === selected)
  const plan = workerPlanUnfit(requirements, worksIn, steps)
  const problem = (() => {
    if (selected === HOME) return undefined
    if (plan !== undefined) return planUnfitWords(plan, said)
    if (selected === ANY) return best === undefined ? automaticWorkerUnavailable : undefined
    const unfit = workerUnfit(chosen, steps, repositories)
    if (unfit !== undefined) return workerUnfitWords(unfit, chosen === undefined ? workerNameOf(selected) : workerName(chosen))
    // Its agent there doesn't offer the lead's model: the picker offers what it does.
    const model = workerModelUnfit(chosen, steps)
    return model === undefined || chosen === undefined
      ? undefined
      : workerModelWords(workerName(chosen), modelName(model.agentId, model.model))
  })()
  // A task no worker can ever take (one that stays on the home, a review, or a home too old to say) has nothing to choose.
  const never = plan !== undefined && (plan.kind === 'unknown' || plan.kind === 'home' || plan.kind === 'review')
  const shown = selected !== HOME || (workers.length > 0 && !never)
  const reports = selected === ANY || workers.some((worker) => worker.capacity !== undefined)
  const places: Array<LaunchPlace> = [
    { value: HOME, label, kind: 'home' },
    ...(reports
      ? [
          {
            value: ANY,
            label: runsOnText.any,
            kind: 'any' as const,
            ...(plan !== undefined ? { disabled: true } : best === undefined ? { disabled: true, hint: runsOnText.noneFree } : {}),
          },
        ]
      : []),
    ...workers.map((worker): LaunchPlace => {
      const unfit = plan === undefined ? workerUnfit(worker, steps, repositories) : undefined
      const needs = runsOnText.needs(worker)
      const hint =
        unfit === undefined
          ? [runsOnText.free(worker.capacity?.freeMemoryMib), ...(needs === undefined ? [] : [needs])].join(' · ')
          : runsOnText.unfit(unfit, agentName)
      return {
        value: worker.workerId,
        label: workerName(worker),
        kind: 'worker',
        // Where the plan itself keeps every worker out, the note says why once, and no row says how it stands.
        ...(plan !== undefined
          ? { disabled: true }
          : unfit === undefined
            ? { hint }
            : { disabled: true, ...(hint === undefined ? {} : { hint }) }),
      }
    }),
    // A worker chosen that has gone since: still named, so the button and its problem say which.
    ...(selected !== HOME && selected !== ANY && chosen === undefined
      ? [{ value: selected, label: workerNameOf(selected), kind: 'worker' as const, disabled: true, hint: runsOnText.gone }]
      : []),
  ]
  return { shown, places, note: plan === undefined ? runsOnText.note(said) : planUnfitWords(plan, said), problem }
}
