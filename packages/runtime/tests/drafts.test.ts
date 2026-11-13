import { describe, expect, it } from 'vitest'

import { callBegan, callEnded, drafted, inputWritten, noDrafts, resolved, turnEnded } from '../src/drafts'

const OPUS = { agentId: 'claude-code', model: 'opus', effort: 'high' }
const CODEX = { agentId: 'codex', model: 'gpt', effort: null }

describe('a task followed as the coordinator drafts it', () => {
  it('shows from its first call, fills in field by field, and is planned once its plan goes through', () => {
    let state = callBegan(noDrafts, 'd1', 'draft_task')
    expect(state.drafts).toMatchObject([{ key: 'd1', title: null, brief: false, planning: false }])

    state = inputWritten(state, 'd1', { title: 'Fix the VAT rate' }).state
    expect(state.drafts[0]).toMatchObject({ title: 'Fix the VAT rate', brief: false })
    state = inputWritten(state, 'd1', { title: 'Fix the VAT rate', description: 'EU invoices…' }).state
    expect(state.drafts[0]?.brief).toBe(true)

    state = drafted(state, { taskId: 't1', slug: '812', title: 'Fix the VAT rate' })
    state = callEnded(state, 'd1', true)
    expect(state.drafts).toMatchObject([{ key: 'd1', taskId: 't1', slug: '812' }])

    // Its plan's call is its plan at once: the only draft waiting for one.
    state = callBegan(state, 'p1', 'propose_plan')
    expect(state.drafts[0]?.planning).toBe(true)
    const lead = inputWritten(state, 'p1', { task: '812', lead: { model: 'Opus 5.5', effort: 'high', reason: 'Knows the code.' } })
    expect(lead.lead).toEqual({ model: 'Opus 5.5', effort: 'high' })
    expect(lead.review).toBeUndefined()
    state = resolved(lead.state, 'p1', 'lead', OPUS)
    expect(state.drafts[0]).toMatchObject({ lead: OPUS, reason: 'Knows the code.' })

    const review = inputWritten(state, 'p1', {
      task: '812',
      lead: { model: 'Opus 5.5' },
      review: { model: 'GPT-6.1 Sol' },
      preset: 'Change',
    })
    expect(review.review).toEqual({ model: 'GPT-6.1 Sol' })
    state = resolved(review.state, 'p1', 'review', CODEX)
    state = callEnded(state, 'p1', true)
    expect(state.drafts[0]).toMatchObject({ review: CODEX, preset: 'Change', planned: true, planning: false })
    expect(state.calls.size).toBe(0)

    expect(turnEnded().drafts).toEqual([])
  })

  it('says a plan without a review', () => {
    let state = drafted(noDrafts, { taskId: 't1', slug: '812', title: 'A' })
    state = callBegan(state, 'p1', 'propose_plan')
    state = inputWritten(state, 'p1', { task: '812', lead: { agent: 'claude-code' }, review: null }).state
    expect(state.drafts[0]).toMatchObject({ noReview: true, review: null })
  })

  it('shows a draft whose calls never came as events, once its task is made', () => {
    const state = drafted(noDrafts, { taskId: 't9', slug: '900', title: 'Whole at once' })
    expect(state.drafts).toMatchObject([{ key: 'task:t9', title: 'Whole at once', brief: true, slug: '900' }])
  })

  it('matches several drafts to their plans by slug, whatever order they come in', () => {
    let state = callBegan(noDrafts, 'd1', 'draft_task')
    state = drafted(state, { taskId: 't1', slug: '1', title: 'One' })
    state = callBegan(state, 'd2', 'draft_task')
    state = drafted(state, { taskId: 't2', slug: '2', title: 'Two' })
    // Two drafts wait: the plan is neither's until it names its task.
    state = callBegan(state, 'p', 'propose_plan')
    expect(state.drafts.map((draft) => draft.planning)).toEqual([false, false])
    state = inputWritten(state, 'p', { task: '2' }).state
    expect(state.drafts.map((draft) => draft.planning)).toEqual([false, true])
  })

  it('leaves a draft waiting again when its plan fails, and drops one that never became a task', () => {
    let state = callBegan(noDrafts, 'd1', 'draft_task')
    state = drafted(state, { taskId: 't1', slug: '1', title: 'One' })
    state = callBegan(state, 'p', 'propose_plan')
    state = resolved(inputWritten(state, 'p', { task: '1', lead: { model: 'x' } }).state, 'p', 'lead', OPUS)
    state = callEnded(state, 'p', false)
    expect(state.drafts[0]).toMatchObject({ planning: false, lead: null, planned: false, slug: '1', title: 'One' })

    let refused = callBegan(noDrafts, 'd2', 'draft_task')
    refused = callEnded(inputWritten(refused, 'd2', { title: 'Too long' }).state, 'd2', false)
    expect(refused.drafts).toEqual([])
  })
})
