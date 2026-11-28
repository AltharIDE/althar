import { Schema } from 'effect'
import { assert, describe, it } from '@effect/vitest'

import { ProjectWorker, WorkerSelection, type PlanStep } from '../src/Api'
import {
  automaticWorker,
  planUnfitWords,
  workerName,
  workerNameOf,
  workerPlanProblem,
  workerPlanUnfit,
  workerProblem,
  workerRepositoryLimit,
  workerUnfit,
} from '../src/workerPlacement'

const lead = { key: 'implement', agentId: 'codex', model: null, skipped: false } satisfies PlanStep
/** What a worker's own check found: its sandbox starts, it has git, and its lead's agent started there. */
const ready = {
  sandbox: { starts: true as const },
  tools: [{ name: 'git', version: '2.43.0' }],
  models: [],
  agents: [{ providerId: 'codex', starts: true }],
}
const worker = { workerId: `wrk_${'1'.repeat(32)}`, providers: ['codex'], busy: false, readiness: ready } satisfies ProjectWorker
const modern = { ...worker, multiRepoProviders: ['codex'] }
const capacity = { platform: 'linux', architecture: 'arm64', freeMemoryMib: 4096, freeDiskMib: 4096, cpuCores: 4 } as const
const requirements = { repositoryCount: 1, homeOnly: false, readOnly: false }

describe('worker placement', () => {
  it('keeps home-only, review and direct-checkout tasks at home', () => {
    assert.strictEqual(workerPlanProblem(undefined, undefined, [lead]), 'Update the home to run this task on a worker.')
    assert.strictEqual(workerPlanProblem({ ...requirements, homeOnly: true }, undefined, [lead]), 'This task runs on the home.')
    assert.strictEqual(
      workerPlanProblem({ ...requirements, readOnly: true }, undefined, [lead]),
      'Reviews of pull requests run on the home.',
    )
    assert.strictEqual(workerPlanProblem(requirements, 'checkout', [lead]), 'Choose Worktree to run it on a worker.')
    // The window says the home by its name.
    assert.strictEqual(planUnfitWords({ kind: 'review' }, 'This Mac'), 'Reviews of pull requests run on This Mac.')
    assert.deepStrictEqual(workerPlanUnfit(requirements, 'checkout', [lead]), { kind: 'local' })
    assert.strictEqual(workerPlanProblem(requirements, undefined, [lead]), undefined)
  })

  it('requires a working lead and bounds repository counts to the selected worker and provider', () => {
    const noLead = [
      { ...lead, key: 'review' },
      { ...lead, skipped: true },
    ] satisfies ReadonlyArray<PlanStep>
    assert.strictEqual(workerPlanProblem(requirements, undefined, noLead), 'Choose a lead to run it on a worker.')
    assert.strictEqual(
      workerPlanProblem({ ...requirements, repositoryCount: 0 }, undefined, [lead]),
      'A worker needs a repository to work in.',
    )
    assert.strictEqual(workerProblem(worker, [lead], 2), 'Linux worker 111111 takes one repository at a time.')
    assert.strictEqual(workerProblem(modern, [lead], 8), undefined)
    assert.strictEqual(workerProblem(modern, [lead], 9), 'Linux worker 111111 takes up to 8 repositories at a time.')
    assert.strictEqual(workerRepositoryLimit(undefined, [lead]), 1)
    assert.strictEqual(workerRepositoryLimit(modern, noLead), 1)
    assert.strictEqual(workerRepositoryLimit({ ...modern, multiRepoProviders: ['claude-code'] }, [lead]), 1)
  })

  it('rejects disappeared, busy, exhausted and incompatible workers', () => {
    assert.strictEqual(workerProblem(undefined, [lead]), 'That worker isn’t connected to this project now.')
    assert.strictEqual(workerProblem({ ...worker, busy: true }, [lead]), 'Linux worker 111111 is at work on another task.')
    // Picked by name, one at work on another task takes it anyway: the task waits for it.
    assert.isUndefined(workerProblem({ ...worker, busy: true }, [lead], 1, true))
    for (const limit of ['freeDiskMib', 'freeMemoryMib'] as const)
      assert.strictEqual(
        workerProblem({ ...worker, capacity: { ...capacity, [limit]: 0 } }, [lead]),
        'Linux worker 111111 is out of disk space or memory.',
      )
    assert.strictEqual(workerProblem(worker, []), 'Choose a lead to run it on a worker.')
    assert.strictEqual(
      workerProblem({ ...worker, providers: ['claude-code'] }, [lead]),
      'Linux worker 111111 doesn’t have the lead’s agent.',
    )
    assert.deepStrictEqual(workerUnfit({ ...worker, providers: ['claude-code'] }, [lead]), { kind: 'agent', agentId: 'codex' })
    assert.strictEqual(automaticWorker([{ ...worker, busy: true }, worker], [lead], 2), undefined)
  })

  it('takes work only where the worker’s own check found its sandbox starts and the lead’s agent started there', () => {
    const { readiness: _none, ...unchecked } = worker
    assert.deepStrictEqual(workerUnfit(unchecked, [lead]), { kind: 'unchecked' })
    assert.strictEqual(
      workerProblem(unchecked, [lead]),
      'Linux worker 111111 hasn’t checked it can run a task yet. A worker checks itself as it starts, and an older one updates itself within the hour.',
    )
    assert.deepStrictEqual(
      workerUnfit({ ...worker, readiness: { ...ready, sandbox: { starts: false, problem: 'NoUserNamespaces', fix: 'sudo x' } } }, [lead]),
      { kind: 'sandbox', problem: 'NoUserNamespaces', fix: 'sudo x' },
    )
    assert.deepStrictEqual(workerUnfit({ ...worker, readiness: { ...ready, tools: [] } }, [lead]), { kind: 'git' })
    assert.deepStrictEqual(workerUnfit({ ...worker, capacity: { ...capacity, freeDiskMib: 1024 } }, [lead]), {
      kind: 'disk',
      freeMib: 1024,
    })
    assert.deepStrictEqual(workerUnfit({ ...worker, signedIn: [] }, [lead]), { kind: 'signedOut', agentId: 'codex' })
    // Signed in, its sandbox fine, yet the agent itself couldn't start there: why, in its own words.
    const failing = { ...worker, readiness: { ...ready, agents: [{ providerId: 'codex', starts: false, problem: 'Not logged in.' }] } }
    assert.strictEqual(workerProblem(failing, [lead]), 'The lead’s agent couldn’t start on Linux worker 111111: Not logged in.')
    assert.deepStrictEqual(workerUnfit({ ...worker, readiness: { ...ready, agents: [] } }, [lead]), {
      kind: 'agentStarts',
      agentId: 'codex',
    })
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
    assert.strictEqual(workerNameOf(worker.workerId), 'Linux worker 111111')
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
