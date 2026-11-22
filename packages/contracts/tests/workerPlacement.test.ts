import { Schema } from 'effect'
import { assert, describe, it } from '@effect/vitest'

import { ProjectWorker, WorkerSelection, type PlanStep } from '../src/Api'
import { automaticWorker, workerName, workerPlanProblem, workerProblem, workerRepositoryLimit } from '../src/workerPlacement'

const lead = { key: 'implement', agentId: 'codex', model: null, skipped: false } satisfies PlanStep
const worker = { workerId: `wrk_${'1'.repeat(32)}`, providers: ['codex'], busy: false } satisfies ProjectWorker
const modern = { ...worker, multiRepoProviders: ['codex'] }
const capacity = { platform: 'linux', architecture: 'arm64', freeMemoryMib: 4096, freeDiskMib: 1024, cpuCores: 4 } as const
const requirements = { repositoryCount: 1, homeOnly: false, readOnly: false }

describe('worker placement', () => {
  it('keeps home-only, review and direct-checkout tasks at home', () => {
    assert.strictEqual(workerPlanProblem(undefined, undefined, [lead]), 'Update this home to check where this task can run.')
    assert.strictEqual(workerPlanProblem({ ...requirements, homeOnly: true }, undefined, [lead]), 'This task stays on its home.')
    assert.strictEqual(
      workerPlanProblem({ ...requirements, readOnly: true }, undefined, [lead]),
      'Reviews of pull requests run on the home.',
    )
    assert.strictEqual(workerPlanProblem(requirements, 'checkout', [lead]), 'Use a separate worktree to run on a worker.')
    assert.strictEqual(workerPlanProblem(requirements, undefined, [lead]), undefined)
  })

  it('requires a working lead and bounds repository counts to the selected worker and provider', () => {
    const noLead = [
      { ...lead, key: 'review' },
      { ...lead, skipped: true },
    ] satisfies ReadonlyArray<PlanStep>
    assert.strictEqual(workerPlanProblem(requirements, undefined, noLead), 'Choose a lead to run on a worker.')
    assert.strictEqual(
      workerPlanProblem({ ...requirements, repositoryCount: 0 }, undefined, [lead]),
      'A worker needs a task with a repository.',
    )
    assert.strictEqual(workerProblem(worker, [lead], 2), 'A worker needs a task with one repository.')
    assert.strictEqual(workerProblem(modern, [lead], 8), undefined)
    assert.strictEqual(workerProblem(modern, [lead], 9), 'A worker can run up to 8 repositories in one task.')
    assert.strictEqual(workerRepositoryLimit(undefined, [lead]), 1)
    assert.strictEqual(workerRepositoryLimit(modern, noLead), 1)
    assert.strictEqual(workerRepositoryLimit({ ...modern, multiRepoProviders: ['claude-code'] }, [lead]), 1)
  })

  it('rejects disappeared, busy, exhausted and incompatible workers', () => {
    assert.strictEqual(workerProblem(undefined, [lead]), 'This worker is unavailable for this project.')
    assert.strictEqual(workerProblem({ ...worker, busy: true }, [lead]), 'This worker is already running a task.')
    for (const limit of ['freeDiskMib', 'freeMemoryMib'] as const)
      assert.strictEqual(
        workerProblem({ ...worker, capacity: { ...capacity, [limit]: 0 } }, [lead]),
        'This worker has run out of workspace disk space or available memory.',
      )
    assert.strictEqual(workerProblem(worker, []), 'Choose a lead to run on a worker.')
    assert.strictEqual(workerProblem({ ...worker, providers: ['claude-code'] }, [lead]), 'This worker does not have the lead’s agent.')
    assert.strictEqual(automaticWorker([{ ...worker, busy: true }, worker], [lead], 2), undefined)
  })

  it('chooses current capacity and breaks resource ties in a stable order', () => {
    const first = { ...modern, capacity }
    const next = { ...first, workerId: `wrk_${'2'.repeat(32)}` }
    const older = { ...modern, workerId: next.workerId }
    const choose = (a: ProjectWorker, b: ProjectWorker) => automaticWorker([b, a], [lead], 2)?.workerId

    assert.strictEqual(choose(first, older), first.workerId)
    assert.strictEqual(choose(modern, next), next.workerId)
    assert.strictEqual(choose(modern, older), modern.workerId)
    assert.strictEqual(choose(first, next), first.workerId)
    for (const metric of ['freeMemoryMib', 'freeDiskMib', 'cpuCores'] as const) {
      const larger = { ...next, capacity: { ...capacity, [metric]: capacity[metric] + 1 } }
      assert.strictEqual(choose(first, larger), larger.workerId, metric)
    }
    assert.strictEqual(automaticWorker([next, { ...first, busy: true }], [lead], 2)?.workerId, next.workerId)
  })

  it('keeps older worker reports usable and validates capacity and automatic selection on the wire', () => {
    const decodeWorker = Schema.decodeUnknownSync(ProjectWorker)
    const decodeSelection = Schema.decodeUnknownSync(WorkerSelection)
    assert.deepStrictEqual(decodeWorker(worker), worker)
    assert.strictEqual(workerName(worker), 'Linux worker 111111')
    assert.strictEqual(workerName(decodeWorker({ ...worker, capacity })), 'Linux worker 111111')
    assert.strictEqual(workerName(decodeWorker({ ...worker, capacity: { ...capacity, platform: 'macos' } })), 'Mac worker 111111')
    assert.strictEqual(workerName(decodeWorker({ ...worker, capacity: { ...capacity, platform: 'windows' } })), 'Windows worker 111111')
    assert.throws(() => decodeWorker({ ...worker, capacity: { ...capacity, freeDiskMib: -1 } }))
    assert.throws(() => decodeWorker({ ...worker, capacity: { ...capacity, cpuCores: 0 } }))
    assert.strictEqual(decodeSelection('auto'), 'auto')
    assert.strictEqual(decodeSelection(worker.workerId), worker.workerId)
    assert.throws(() => decodeSelection('wrk_next'))
  })
})
