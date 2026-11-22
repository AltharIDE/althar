import { describe, expect, it } from 'vitest'

import { goalCommand } from '../src/goals'

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
