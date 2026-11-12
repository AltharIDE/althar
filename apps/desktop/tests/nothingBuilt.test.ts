import { describe, expect, it } from 'vitest'

import { askOf, isSettleable, kindWords, takesDone } from '../src/renderer/shared/calls'
import { readyText, readyWordOf } from '../src/renderer/shared/standing'

describe('a change its lead built nothing for', () => {
  const empty = { kind: 'change', phase: 'ready', nothingBuilt: true, change: null } as const

  it('is Nothing built, not Ready to accept', () => {
    expect(readyWordOf(empty)).toBe(kindWords.nothingBuilt)
    expect(readyWordOf({ kind: 'change', change: null })).toBe(kindWords.ready)
  })

  it('is a merge conflict where its lead handed it back, as its card says', () => {
    expect(readyWordOf({ ...empty, handedBack: 'a conflict' })).toBe(readyText.mergeConflict)
  })

  it('reads the same in the header and the board card', () => {
    expect(readyWordOf({ nothingBuilt: true })).toBe(kindWords.nothingBuilt)
    expect(readyWordOf({})).toBe(kindWords.ready)
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
