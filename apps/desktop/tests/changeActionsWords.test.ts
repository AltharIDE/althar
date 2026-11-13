import { describe, expect, it } from 'vitest'

import { severalSaid } from '../src/renderer/features/board/BoardView'
import { doingWords, doneHere, labelWords, nextWords } from '../src/renderer/shared/standing'

describe('actions on commits held for Ship and findings after merge', () => {
  it('names Ship, including the retry and how many commits it sends, for sight and a screen reader', () => {
    const ship = { kind: 'ship', commits: 3 } as const
    expect(nextWords(ship)).toBe('Ship')
    expect(doingWords(ship)).toBe('Shipping')
    expect(labelWords(ship, 'PR #12')).toBe('Ship 3 commits')
    expect(labelWords(ship, 'PR #12', true)).toBe('Try shipping 3 commits again')
    expect(doneHere(ship)).toBe(true)
  })

  it('says Fix it acts on the findings after that merge, while resolving a conflict belongs in the task', () => {
    const fix = { kind: 'fix_after_merge', words: 'PR #12' } as const
    expect(nextWords(fix)).toBe('Fix it')
    expect(doingWords(fix)).toBe('Fixing')
    expect(labelWords(fix, 'PR #12')).toBe('The lead fixes them, and its fix goes up as a new pull request after PR #12')
    expect(doneHere(fix)).toBe(true)
    expect(doneHere({ kind: 'resolve' })).toBe(false)
    expect(doneHere({ kind: 'fix', failing: ['test'] })).toBe(false)
  })

  it('says nothing for no changes and counts several drafts as drafts', () => {
    expect(severalSaid([])).toBeNull()
    expect(
      severalSaid([
        { name: 'API', stands: 'draft' },
        { name: 'Web', stands: 'draft' },
      ]),
    ).toEqual({ words: 'Both drafts', stands: 'draft' })
    expect(
      severalSaid([
        { name: 'API', stands: 'draft' },
        { name: 'Web', stands: 'draft' },
        { name: 'Docs', stands: 'ready' },
      ]),
    ).toEqual({ words: '2 of 3 drafts', stands: 'draft' })
  })
})
