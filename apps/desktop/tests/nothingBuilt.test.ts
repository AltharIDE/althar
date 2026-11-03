import { describe, expect, it } from 'vitest'

import { askOf, isSettleable, kindWords, readyKindOf, takesDone } from '../src/renderer/shared/calls'
import { readyWordOf } from '../src/renderer/shared/standing'

describe('a change its lead built nothing for', () => {
  const empty = { kind: 'change', phase: 'ready', nothingBuilt: true, change: null } as const

  it('is Nothing built, not Ready to accept', () => {
    expect(readyKindOf(empty)).toBe(kindWords.nothingBuilt)
    expect(readyKindOf({ kind: 'change', change: null })).toBe(kindWords.ready)
  })

  it('stays Stuck where its lead handed it back', () => {
    expect(readyKindOf({ ...empty, handedBack: 'a conflict' })).toBe(kindWords.stuck)
  })

  it('reads the same in the header and the board card', () => {
    expect(readyWordOf({ nothingBuilt: true }, null)).toBe(kindWords.nothingBuilt)
    expect(readyWordOf({}, null)).toBe(kindWords.ready)
  })

  it('settles as Done, and a change with work on it does not', () => {
    expect(isSettleable(empty)).toBe(true)
    expect(takesDone(empty)).toBe(true)
    expect(isSettleable({ kind: 'change', phase: 'ready' })).toBe(false)
    expect(takesDone({ kind: 'change' })).toBe(false)
  })

  it('leads to what its lead leaves to the person: the last line that asks, else its last line', () => {
    expect(askOf('Zen has no balance API.\n\nWhich way do you want?\n1. Scrape the dashboard\n2. Ask for an API')).toBe(
      'Which way do you want?',
    )
    expect(askOf('Built nothing.\n- Waiting on a key\n- Needs a decision')).toBe('Needs a decision')
    expect(askOf('  \n')).toBeNull()
    expect(askOf(null)).toBeNull()
  })
})
