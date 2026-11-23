import { describe, expect, it } from 'vitest'

import { GOAL_ROUNDS, goalCommand, nextGoal, type ThreadGoal } from '../src/goals'

describe('goal commands', () => {
  it('recognizes the whole command, with an optional multiline objective', () => {
    expect(goalCommand('   /GOAL ')).toEqual({ action: 'show' })
    expect(goalCommand('/goal\nrun the checkout tests\nunder Chromium.')).toEqual({
      action: 'set',
      objective: 'run the checkout tests\nunder Chromium.',
    })
    expect(goalCommand('/goal EDIT\tImprove the error message.')).toEqual({
      action: 'edit',
      objective: 'Improve the error message.',
    })
    expect(goalCommand('/goal pause')).toEqual({ action: 'pause' })
    expect(goalCommand('/goal resume')).toEqual({ action: 'resume' })
    expect(goalCommand('/goal clear')).toEqual({ action: 'clear' })
  })

  it('keeps similar commands and command words within an objective intact', () => {
    expect(goalCommand('please explain /goal')).toBeUndefined()
    expect(goalCommand('/goals')).toBeUndefined()
    expect(goalCommand('/goal editor starts')).toEqual({ action: 'set', objective: 'editor starts' })
    expect(goalCommand('/goal clear the test backlog')).toEqual({ action: 'set', objective: 'clear the test backlog' })
    expect(goalCommand('/goal edit' + ' '.repeat(100_000))).toEqual({ action: 'set', objective: 'edit' })
  })
})

const active: ThreadGoal = {
  revision: 4,
  objective: 'Run the checkout tests',
  status: 'active',
  rounds: 3,
  roundLimit: GOAL_ROUNDS,
  progress: 'Unit tests passed',
  detail: 'Waiting for the browser',
  waiting: true,
}

describe('goal transitions shared by the window and the runtime', () => {
  it('starts a trimmed objective with a fresh round budget and advances an existing revision', () => {
    const command = { action: 'set', objective: '  Verify refunds  ' } as const
    expect(nextGoal(null, command)).toEqual({
      revision: 1,
      objective: 'Verify refunds',
      status: 'active',
      rounds: 0,
      roundLimit: GOAL_ROUNDS,
      progress: null,
      detail: null,
      waiting: false,
    })
    expect(nextGoal(active, command)).toEqual({ ...nextGoal(null, command), revision: 5 })
    expect(nextGoal(active, { action: 'clear' })).toBeNull()
  })

  it('refreshes progress when the objective changes and keeps an inactive goal paused after editing', () => {
    expect(nextGoal(null, { action: 'edit', objective: 'Verify refunds' })).toBeNull()
    expect(nextGoal(active, { action: 'edit', objective: ` ${active.objective} ` })).toBe(active)

    for (const status of ['active', 'blocked', 'complete', 'limited', 'paused'] as const) {
      const current: ThreadGoal = { ...active, status }
      expect(nextGoal(current, { action: 'edit', objective: ' Verify refunds ' })).toEqual({
        ...current,
        revision: 5,
        objective: 'Verify refunds',
        status: status === 'active' ? 'active' : 'paused',
        rounds: 0,
        progress: null,
        detail: null,
        waiting: false,
      })
    }
  })

  it('pauses active work and resumes only goals that can take another round', () => {
    expect(nextGoal(null, { action: 'pause' })).toBeNull()
    expect(nextGoal(null, { action: 'resume' })).toBeNull()
    const complete: ThreadGoal = { ...active, status: 'complete' }
    expect(nextGoal(complete, { action: 'pause' })).toBe(complete)
    expect(nextGoal(complete, { action: 'resume' })).toBe(complete)
    expect(nextGoal(active, { action: 'resume' })).toBe(active)

    const paused: ThreadGoal = { ...active, status: 'paused', revision: 5, detail: null, waiting: false }
    expect(nextGoal(active, { action: 'pause' })).toEqual(paused)
    expect(nextGoal(paused, { action: 'resume' })).toEqual({ ...paused, status: 'active', revision: 6 })
    const exhausted: ThreadGoal = { ...paused, status: 'limited', rounds: paused.roundLimit }
    expect(nextGoal(exhausted, { action: 'resume' })).toEqual({ ...paused, status: 'active', revision: 6, rounds: 0 })
  })
})
