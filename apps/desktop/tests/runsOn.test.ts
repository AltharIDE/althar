import { describe, expect, it } from 'vitest'

import type { PlanStep, ProjectWorker } from '@althar/contracts'

import { ANY, HOME, placementOf, runsOnText } from '../src/renderer/features/project/runsOn'

const id = (tail: string) => 'wrk_' + tail.repeat(32 / tail.length)
const lead: PlanStep = { key: 'implement', agentId: 'claude-code', model: null, skipped: false }
const capacity = { platform: 'linux', architecture: 'x64', cpuCores: 8, freeMemoryMib: 12_288, freeDiskMib: 81_920 } as const
/** What a worker's own check found where it can take a task: its sandbox starts, it has git, and Claude Code started there. */
const passed = {
  sandbox: { starts: true as const },
  tools: [{ name: 'git', version: '2.43.0' }],
  models: [],
  agents: [{ providerId: 'claude-code', starts: true }],
}
const free: ProjectWorker = { workerId: id('a'), providers: ['claude-code'], busy: false, capacity, readiness: passed }
const requirements = { repositoryCount: 1, homeOnly: false, readOnly: false }
const base = {
  workers: [free],
  selected: HOME,
  steps: [lead],
  requirements,
  worksIn: 'worktree' as const,
  home: 'This Mac',
  agentName: (agent: string) => (agent === 'claude-code' ? 'Claude Code' : agent),
}
const hints = (placement: ReturnType<typeof placementOf>) =>
  placement.places.map((place) => [place.label, place.hint ?? null, place.disabled === true] as const)

describe('where a held plan runs', () => {
  it('offers the home, any free worker and each worker with how it stands', () => {
    const workers: ReadonlyArray<ProjectWorker> = [
      free,
      { workerId: id('b'), providers: ['claude-code'], busy: true, readiness: passed },
      { workerId: id('c'), providers: ['claude-code'], busy: false, capacity: { ...capacity, freeDiskMib: 0 }, readiness: passed },
      { workerId: id('d'), providers: ['codex'], busy: false, capacity: { ...capacity, freeMemoryMib: 512 }, readiness: passed },
      { workerId: id('e'), providers: ['claude-code'], busy: false, readiness: passed },
    ]
    const placement = placementOf({ ...base, workers, requirements: { ...requirements, repositoryCount: 2 } })
    expect(placement.shown).toBe(true)
    expect(placement.problem).toBeUndefined()
    expect(placement.note).toBe('The setup and lead run on the worker, the review on This Mac.')
    expect(hints(placement)).toEqual([
      ['This Mac', null, false],
      ['Any free worker', runsOnText.noneFree, true],
      ['Linux worker aaaaaa', 'One repository', true],
      ['Linux worker bbbbbb', 'At work', true],
      ['Linux worker cccccc', 'Full', true],
      ['Linux worker dddddd', 'No Claude Code', true],
      ['Linux worker eeeeee', 'One repository', true],
    ])
    expect(hints(placementOf(base))[2]).toEqual(['Linux worker aaaaaa', '12 GB free', false])
    const small = { ...free, capacity: { ...capacity, freeMemoryMib: 512 } }
    expect(hints(placementOf({ ...base, workers: [small] }))[2]?.[1]).toBe('512 MB free')
    // A worker that hasn't said how much it has: free, and no Any free worker, which picks by what each has.
    expect(hints(placementOf({ ...base, workers: [{ ...free, capacity: undefined } as ProjectWorker] }))).toEqual([
      ['This Mac', null, false],
      ['Linux worker aaaaaa', 'Free', false],
    ])
  })

  it('says once, at the menu’s foot, why no worker can take a plan, and has nothing to offer where none ever can', () => {
    const local = placementOf({ ...base, worksIn: 'checkout' })
    expect(local.shown).toBe(true)
    expect(local.note).toBe('Choose Worktree to run it on a worker.')
    expect(hints(local).slice(1)).toEqual([
      ['Any free worker', null, true],
      ['Linux worker aaaaaa', null, true],
    ])
    expect(placementOf({ ...base, requirements: { ...requirements, repositoryCount: 0 } }).note).toBe(
      'A worker needs a repository to work in.',
    )
    expect(placementOf({ ...base, steps: [{ ...lead, skipped: true }] }).note).toBe('Choose a lead to run it on a worker.')
    for (const never of [undefined, { ...requirements, homeOnly: true }, { ...requirements, readOnly: true }])
      expect(placementOf({ ...base, requirements: never }).shown).toBe(false)
    expect(placementOf({ ...base, workers: [] }).shown).toBe(false)
  })

  it('says what keeps it from starting where it is set to run, by the worker’s name', () => {
    expect(placementOf({ ...base, selected: free.workerId }).problem).toBeUndefined()
    expect(placementOf({ ...base, selected: ANY }).problem).toBeUndefined()
    expect(placementOf({ ...base, selected: ANY, workers: [{ ...free, busy: true }] }).problem).toBe('No worker is free for this task now.')
    expect(placementOf({ ...base, selected: free.workerId, workers: [{ ...free, busy: true }] }).problem).toBe(
      'Linux worker aaaaaa is at work on another task.',
    )
    expect(placementOf({ ...base, selected: free.workerId, worksIn: 'checkout' }).problem).toBe('Choose Worktree to run it on a worker.')
    expect(placementOf({ ...base, selected: free.workerId, requirements: { ...requirements, readOnly: true } }).problem).toBe(
      'Reviews of pull requests run on This Mac.',
    )
    // One chosen that has gone since: still there by its name, greyed, and named in the problem; the plan shows it even with none left.
    const gone = placementOf({ ...base, selected: id('f'), workers: [] })
    expect(gone.shown).toBe(true)
    expect(gone.problem).toBe('Linux worker ffffff isn’t connected to this project now.')
    expect(hints(gone).at(-1)).toEqual(['Linux worker ffffff', runsOnText.gone, true])
  })
})

describe('a worker’s own check, in Runs on (ADR-103)', () => {
  const ready = passed
  const checked = (change: Partial<ProjectWorker> = {}): ProjectWorker => ({
    ...free,
    signedIn: ['claude-code'],
    readiness: ready,
    ...change,
  })

  it('greys out a worker that isn’t ready, with why, and says why it can’t start there', () => {
    const workers: ReadonlyArray<ProjectWorker> = [
      checked({ readiness: { ...ready, sandbox: { starts: false, problem: 'NoUserNamespaces', fix: 'sudo sh -c x' } } }),
      checked({ workerId: id('b'), signedIn: [] }),
      checked({ workerId: id('c'), capacity: { ...capacity, freeDiskMib: 1_200 } }),
      checked({ workerId: id('d'), readiness: { ...ready, tools: [] } }),
    ]
    expect(hints(placementOf({ ...base, workers })).slice(2)).toEqual([
      ['Linux worker aaaaaa', 'Sandbox can’t start', true],
      ['Linux worker bbbbbb', 'Claude Code signed out', true],
      ['Linux worker cccccc', 'Only 1.2 GB free', true],
      ['Linux worker dddddd', 'No git', true],
    ])
    expect(placementOf({ ...base, workers, selected: id('a') }).problem).toBe(
      'Linux worker aaaaaa can’t start its agents’ sandbox until its administrator allows it once: Settings › Computers has the command.',
    )
  })

  it('says a worker that hasn’t checked itself yet, and an agent that won’t start or wasn’t tried there', () => {
    const workers: ReadonlyArray<ProjectWorker> = [
      checked({ readiness: undefined }),
      checked({
        workerId: id('b'),
        readiness: { ...ready, agents: [{ providerId: 'claude-code', starts: false, problem: 'Not signed in.' }] },
      }),
      checked({ workerId: id('c'), readiness: { ...ready, agents: [] } }),
    ]
    expect(hints(placementOf({ ...base, workers })).slice(2)).toEqual([
      ['Linux worker aaaaaa', 'Not checked yet', true],
      ['Linux worker bbbbbb', 'Claude Code won’t start', true],
      ['Linux worker cccccc', 'Claude Code not tried yet', true],
    ])
  })

  it('says what a ready worker installs first for the project, or leaves to its lead', () => {
    const needs = [
      { name: 'bun', version: '1.3.5', why: 'bun.lock', installs: true },
      { name: 'cargo', why: 'Cargo.toml', installs: false },
    ]
    expect(hints(placementOf({ ...base, workers: [checked({ needs })] }))[2]).toEqual([
      'Linux worker aaaaaa',
      '12 GB free · Installs Bun first',
      false,
    ])
    expect(hints(placementOf({ ...base, workers: [checked({ needs: [needs[1]!] })] }))[2]?.[1]).toBe('12 GB free · Needs cargo')
  })

  it('takes a worker whose agent doesn’t offer the lead’s model, and says to pick one it has', () => {
    const worker = checked({
      readiness: { ...ready, models: [{ providerId: 'claude-code', models: [{ id: 'sonnet', name: 'Claude Sonnet 5.5' }] }] },
    })
    const placement = placementOf({
      ...base,
      workers: [worker],
      selected: worker.workerId,
      steps: [{ ...lead, model: 'opus' }],
      modelName: (_agent, model) => (model === 'opus' ? 'Claude Opus 5.5' : model),
    })
    expect(hints(placement)[2]?.[2]).toBe(false)
    expect(placement.problem).toBe('Linux worker aaaaaa doesn’t offer Claude Opus 5.5. Pick a model it has.')
    expect(
      placementOf({ ...base, workers: [worker], selected: worker.workerId, steps: [{ ...lead, model: 'sonnet' }] }).problem,
    ).toBeUndefined()
  })
})
