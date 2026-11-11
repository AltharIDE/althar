import { assert, describe, it } from '@effect/vitest'

import { presetModels } from '../src/presetModels'
import { BUILT_IN, describe as describePreset, planFromPreset, type PresetPlan } from '../src/presets'
import type { UsableModel } from '../src/usableModels'

/*
 * What a preset's plan takes of the models Althar can use: a model the preset names as its agent lists it, and a reviewer where
 * the preset needs one and names none, from another maker than the lead's, never the lead's own model.
 */

const model = (
  name: string,
  maker: string,
  intelligence: number,
  agentId: string,
  id: string,
  room: number | null = null,
): UsableModel => ({
  name,
  maker,
  fact: { slug: `${maker.toLowerCase()}/${id}`, intelligence, coding: null, agentic: null, price: null, context: null },
  routes: [
    {
      agentId,
      agentName: agentId,
      model: id,
      plan: true,
      efforts: [],
      effort: null,
      defaultEffort: null,
      room: room === null ? null : ({ agentId, accountId: 'a', leftPercent: room } as never),
    },
  ],
})

const OPUS = model('Claude Opus 5.5', 'Anthropic', 60, 'claude-code', 'claude-opus-5')
const SONNET = model('Claude Sonnet 5.5', 'Anthropic', 56, 'claude-code', 'claude-sonnet-5')
const SOL = model('GPT-6.1 Sol', 'OpenAI', 62, 'codex', 'gpt-6-1-sol')
const TERRA = model('GPT-6.1 Terra', 'OpenAI', 50, 'codex', 'gpt-6-1-terra')
const GLM = model('GLM-5.3', 'Z.ai', 44, 'opencode', 'opencode-go/glm-5.3')

const prototype = BUILT_IN.find((preset) => preset.name === 'Prototype')!.parts
const change = BUILT_IN.find((preset) => preset.name === 'Change')!.parts
const LEAD = { key: 'implement' as const, agentId: 'claude-code', model: 'claude-opus-5', skipped: false }
const proposed = (plan: PresetPlan): PresetPlan => plan

describe('the built-in Prototype preset', () => {
  it('has no review and ends with its branch, so a plan from it shows Implement and no review row', () => {
    assert.strictEqual(prototype.checked, 'none')
    assert.strictEqual(prototype.end, 'none')
    assert.strictEqual(prototype.reviewer, null)
    assert.include(describePreset(prototype), 'no review')
    // Its lead is named as people know the model, not by the id the preset was written with.
    assert.strictEqual(describePreset(prototype, presetModels([OPUS])), 'a worktree, no review, ends here, led by Claude Opus 5.5')
    const plan = planFromPreset(proposed({ steps: [LEAD], end: 'draft' }), prototype, presetModels([OPUS, SOL]))
    assert.deepStrictEqual(plan.steps, [LEAD])
    assert.strictEqual(plan.end, 'none')
    assert.isUndefined(plan.reviewAfterMerge)
  })

  it('names its lead as the agent lists the model: claude-opus-5-5 is the claude-opus-5 Claude Code offers', () => {
    const [step] = planFromPreset(
      proposed({ steps: [{ ...LEAD, agentId: 'codex', model: 'gpt-6-1-sol' }] }),
      prototype,
      presetModels([OPUS, SOL]),
    ).steps
    assert.deepInclude(step, { agentId: 'claude-code', model: 'claude-opus-5' })
    // One the agent doesn't list stays as the preset names it.
    const [kept] = planFromPreset(proposed({ steps: [LEAD] }), prototype, presetModels([SOL])).steps
    assert.deepInclude(kept, { agentId: 'claude-code', model: 'claude-opus-5-5' })
  })
})

describe('a reviewer a preset needs and doesn’t name', () => {
  const reviewerOf = (steps: PresetPlan['steps'], usable: ReadonlyArray<UsableModel>, parts = change) =>
    planFromPreset(proposed({ steps }), parts, presetModels(usable)).steps.find((step) => step.key === 'review')

  it('is the strongest model of another maker than the lead’s, never the lead’s own', () => {
    const review = reviewerOf([LEAD], [OPUS, SONNET, SOL, TERRA, GLM])
    assert.deepInclude(review, { agentId: 'codex', model: 'gpt-6-1-sol', skipped: false })
  })

  it('is read after the merge, skipped in the run, where the preset checks after', () => {
    const small = BUILT_IN.find((preset) => preset.name === 'Small change')!.parts
    assert.deepInclude(reviewerOf([LEAD], [OPUS, SOL], small), { agentId: 'codex', model: 'gpt-6-1-sol', skipped: true })
  })

  it('keeps the plan’s own where it is another maker’s than the lead’s, with its effort, and replaces one of the lead’s maker', () => {
    const own = { key: 'review' as const, agentId: 'opencode', model: 'opencode-go/glm-5.3', effort: 'high', skipped: false }
    assert.deepInclude(reviewerOf([LEAD, own], [OPUS, SOL, GLM]), { agentId: 'opencode', model: 'opencode-go/glm-5.3', effort: 'high' })
    const same = { key: 'review' as const, agentId: 'claude-code', model: 'claude-sonnet-5', effort: 'high', skipped: false }
    const replaced = reviewerOf([LEAD, same], [OPUS, SONNET, SOL])
    assert.deepInclude(replaced, { agentId: 'codex', model: 'gpt-6-1-sol' })
    assert.notProperty(replaced, 'effort')
  })

  it('goes to another model of the lead’s maker where it is the only one, and to nobody where only the lead’s can be used', () => {
    assert.deepInclude(reviewerOf([LEAD], [OPUS, SONNET]), { agentId: 'claude-code', model: 'claude-sonnet-5', skipped: false })
    assert.deepInclude(reviewerOf([LEAD], [OPUS]), { skipped: true })
  })

  it('goes elsewhere where the best is nearly out of usage, and a preset’s own reviewer wins', () => {
    assert.deepInclude(reviewerOf([LEAD], [OPUS, model('GPT-6.1 Sol', 'OpenAI', 62, 'codex', 'gpt-6-1-sol', 2), GLM]), {
      model: 'opencode-go/glm-5.3',
    })
    const named = { ...change, reviewer: 'codex/gpt-6-1-terra' }
    assert.deepInclude(reviewerOf([LEAD], [OPUS, SOL, TERRA], named), { agentId: 'codex', model: 'gpt-6-1-terra' })
  })
})
