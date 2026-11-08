import type { PlanStep } from '../src/Runs'
import { teamChanges, teamLine } from '../src/teamWords'
import { assert, describe, it } from '@effect/vitest'

const step = (over: Partial<PlanStep> = {}): PlanStep => ({
  key: 'implement',
  agentId: 'claude-code',
  model: 'large',
  effort: null,
  skipped: false,
  ...over,
})
const named = (choice: PlanStep) => `${choice.agentId}/${choice.model ?? 'own'}`

describe('what a change of a task’s team says', () => {
  it('names an effort-only move, a lead from its next turn, a review removed, and one from the next round', () => {
    const effort = teamChanges({ lead: { step: step({ effort: 'high' }), was: step({ effort: null }), when: 'now' } }, named)
    assert.deepStrictEqual(effort, [{ verb: 'changed', thing: 'the lead’s effort to high' }])
    assert.strictEqual(teamLine(effort[0]!), 'changed the lead’s effort to high')

    const defaultEffort = teamChanges(
      { lead: { step: step({ model: 'small', effort: null }), was: step({ model: 'large', effort: 'high' }), when: 'next_turn' } },
      named,
    )
    assert.deepStrictEqual(defaultEffort, [
      { verb: 'changed', thing: 'the lead to claude-code/small', note: 'It takes over from its next turn.' },
    ])
    assert.strictEqual(teamLine(defaultEffort[0]!), 'changed the lead to claude-code/small. It takes over from its next turn.')

    assert.deepStrictEqual(teamChanges({ review: { step: null, was: step({ key: 'review' }), when: 'now' } }, named), [
      { verb: 'removed', thing: 'the review' },
    ])

    const nextRound = teamChanges(
      { review: { step: step({ key: 'review', model: 'small' }), was: step({ key: 'review' }), when: 'next_round' } },
      named,
    )
    assert.deepStrictEqual(nextRound, [
      { verb: 'changed', thing: 'the review to claude-code/small', note: 'It starts from the next round.' },
    ])
    assert.strictEqual(teamLine(nextRound[0]!), 'changed the review to claude-code/small. It starts from the next round.')
  })
})
