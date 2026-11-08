import { describe, expect, it } from 'vitest'

import { latestReport, outcomeOf, reviewsIn } from '../src/renderer/features/task/reviewOutcomes'
import { items } from './fixtures'

/* What became of a review's findings, in words, for its line in the task's thread. */

describe('a review’s findings, settled', () => {
  const states = (...all: ReadonlyArray<'open' | 'fixed' | 'set_aside'>) => all.map((state) => ({ state }))

  it('says what became of each once the lead settled one, and what is left open', () => {
    expect(outcomeOf(states('fixed', 'fixed', 'set_aside'))).toBe('2 fixed, 1 declined')
    expect(outcomeOf(states('fixed'))).toBe('1 fixed')
    expect(outcomeOf(states('set_aside', 'open'))).toBe('1 declined, 1 open')
  })

  it('says nothing while none is settled', () => {
    expect(outcomeOf(states('open', 'open'))).toBeUndefined()
    expect(outcomeOf([])).toBeUndefined()
  })

  it('reads the reviews that found something, and the latest report, from the thread', () => {
    const finding = { severity: 'nit' as const, file: null, line: null, claim: 'A typo.' }
    const found = items.step({ step: 'review', verdict: 'changes_requested', findings: [finding] })
    const clean = items.step({ step: 'review', verdict: 'pass' })
    const settled = items.step({ step: 'settle' })
    const thread = [items.you('Go'), found, clean, settled, items.says('Done.')]
    expect(reviewsIn(thread)).toEqual([found.id])
    expect(latestReport(thread)).toBe(settled.id)
    expect(latestReport([])).toBe('')
  })
})
