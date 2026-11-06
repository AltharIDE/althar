import { describe, expect, it } from 'vitest'

import { plannedSmall } from '../src/quickLane'

/* Which plans are small, for the quick lane: no review, and a lead at a light effort (quickLane.ts). */

const plan = (steps: ReadonlyArray<Record<string, unknown>>) => JSON.stringify({ steps, reason: null, end: 'ready' })
const lead = (effort?: string | null, skipped = false) => ({ key: 'implement', agentId: 'claude-code', model: 'sonnet', effort, skipped })
const review = (skipped: boolean) => ({ key: 'review', agentId: 'codex', model: null, effort: 'low', skipped })

describe('A plan planned small', () => {
  it('is one with its lead at a light effort and no review', () => {
    expect(plannedSmall(plan([lead('low')]))).toBe(true)
    expect(plannedSmall(plan([lead('minimal')]))).toBe(true)
  })

  it('is one whose every review is skipped', () => {
    expect(plannedSmall(plan([lead('low'), review(true)]))).toBe(true)
  })

  it('is not one with a review to do', () => {
    expect(plannedSmall(plan([lead('low'), review(false)]))).toBe(false)
    expect(plannedSmall(plan([lead('low'), review(true), review(false)]))).toBe(false)
  })

  it('is not one whose lead works harder, or at its agent’s own default', () => {
    for (const effort of ['medium', 'high', 'xhigh', 'max', null, undefined]) expect(plannedSmall(plan([lead(effort)]))).toBe(false)
  })

  it('is not one with no lead, a lead skipped, or two', () => {
    expect(plannedSmall(plan([]))).toBe(false)
    expect(plannedSmall(plan([review(true)]))).toBe(false)
    expect(plannedSmall(plan([lead('low', true)]))).toBe(false)
    expect(plannedSmall(plan([lead('low'), lead('low')]))).toBe(false)
  })

  it('is not anything it cannot read', () => {
    for (const parameters of [null, undefined, '', '{', 'null', '[]', '{}', '{"steps":{}}', '{"steps":[null,1,"implement"]}'])
      expect(plannedSmall(parameters)).toBe(false)
  })
})
