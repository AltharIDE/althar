import { describe, expect, it } from 'vitest'

import { workerPlanProblem, workerProblem, workerRepositoryProblem } from '../src/workerPlacement'

const lead = { key: 'implement' as const, agentId: 'claude', skipped: false }
const review = { key: 'review' as const, agentId: 'codex', skipped: false }
const placeable = { repositoryCount: 1, homeOnly: false, readOnly: false }

describe('worker placement', () => {
  it('asks for a task with exactly one repository', () => {
    expect(workerRepositoryProblem(1)).toBeUndefined()
    expect(workerRepositoryProblem(0)).toBe('A worker needs a task with one repository.')
    expect(workerRepositoryProblem(2)).toBe('A worker needs a task with one repository.')
  })

  it('says why a plan cannot run on a worker, in the order the home checks', () => {
    expect(workerPlanProblem(undefined, 'worktree', [lead])).toBe('Update this home to check where this task can run.')
    expect(workerPlanProblem({ ...placeable, homeOnly: true, readOnly: true }, 'worktree', [lead])).toBe('This task stays on its home.')
    expect(workerPlanProblem({ ...placeable, readOnly: true }, 'worktree', [lead])).toBe('Reviews of pull requests run on the home.')
    expect(workerPlanProblem(placeable, 'checkout', [lead])).toBe('Use a separate worktree to run on a worker.')
    expect(workerPlanProblem({ ...placeable, repositoryCount: 2 }, 'worktree', [lead])).toBe('A worker needs a task with one repository.')
    expect(workerPlanProblem(placeable, 'worktree', [review])).toBe('Choose a lead to run on a worker.')
    expect(workerPlanProblem(placeable, 'worktree', [{ ...lead, skipped: true }, review])).toBe('Choose a lead to run on a worker.')
  })

  it('lets a plan with one repository and a lead run on a worker, in a worktree or with no workspace yet', () => {
    expect(workerPlanProblem(placeable, 'worktree', [lead, review])).toBeUndefined()
    expect(workerPlanProblem(placeable, undefined, [lead])).toBeUndefined()
  })

  it('says why a worker cannot take the lead', () => {
    const worker = { workerId: 'w1', providers: ['claude'], busy: false }
    expect(workerProblem(undefined, [lead])).toBe('This worker is unavailable for this project.')
    expect(workerProblem({ ...worker, busy: true }, [lead])).toBe('This worker is already running a task.')
    expect(workerProblem(worker, [review])).toBe('Choose a lead to run on a worker.')
    expect(workerProblem({ ...worker, providers: ['codex'] }, [lead])).toBe('This worker does not have the lead’s agent.')
    expect(workerProblem(worker, [lead, review])).toBeUndefined()
  })
})
