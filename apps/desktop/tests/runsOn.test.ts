import { describe, expect, it } from 'vitest'

import type { PlanStep, ProjectWorker } from '@althar/contracts'

import { ANY, HOME, placementOf, runsOnText } from '../src/renderer/features/project/runsOn'

const id = (tail: string) => 'wrk_' + tail.repeat(32 / tail.length)
const lead: PlanStep = { key: 'implement', agentId: 'claude-code', model: null, skipped: false }
const capacity = { platform: 'linux', architecture: 'x64', cpuCores: 8, freeMemoryMib: 12_288, freeDiskMib: 81_920 } as const
const free: ProjectWorker = { workerId: id('a'), providers: ['claude-code'], busy: false, capacity }
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
      { workerId: id('b'), providers: ['claude-code'], busy: true },
      { workerId: id('c'), providers: ['claude-code'], busy: false, capacity: { ...capacity, freeDiskMib: 0 } },
      { workerId: id('d'), providers: ['codex'], busy: false, capacity: { ...capacity, freeMemoryMib: 512 } },
      { workerId: id('e'), providers: ['claude-code'], busy: false },
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
