import { assert, describe, it } from '@effect/vitest'

import { routeWords } from '../src/Limits'
import { forTask, type SameModel, type StandIn } from '../src/standIn'

/** Two choices are the same model where their ids match without a provider. */
const same: SameModel = (a, b) => a.model?.split('/').at(-1) === b.model?.split('/').at(-1)

const kept: StandIn = {
  agentId: 'opencode',
  model: 'opencode-go/kimi',
  effort: 'high',
  accountId: 'acc_go',
  // Only kept, never read here: any time does.
  until: '2020-01-01T00:00:00.000Z',
  why: 'low',
}
const lead = { agentId: 'opencode', model: 'opencode-go/sol', effort: 'medium' }

describe('a stand-in read against the task’s lead', () => {
  it('stays as kept where the task has no lead, or none on a model', () => {
    assert.strictEqual(forTask(kept, { agentId: 'codex', model: 'sol' }, undefined, same), kept)
    assert.strictEqual(forTask(kept, { agentId: 'codex', model: 'sol' }, { ...lead, model: null }, same), kept)
  })

  it('isn’t one on the task’s own model, through another agent', () => {
    assert.isUndefined(forTask(kept, { agentId: 'codex', model: 'sol' }, lead, same))
  })

  it('stays as kept where it stands in for the task’s own model, its own on another or none', () => {
    const forLead = { ...kept, model: 'opencode-go/sol' }
    assert.strictEqual(forTask(forLead, { agentId: 'claude-code', model: 'opus' }, lead, same), forLead)
    assert.strictEqual(forTask(forLead, { agentId: 'claude-code', model: null }, lead, same), forLead)
  })

  it('stands in for the task’s lead where kept for another model, back once that lead has usage', () => {
    const expected: StandIn = {
      agentId: 'opencode',
      model: 'opencode-go/sol',
      effort: 'medium',
      accountId: null,
      until: null,
      why: 'limit',
    }
    assert.deepStrictEqual(forTask(kept, { agentId: 'claude-code', model: 'opus' }, lead, same), expected)
    // Kept for no model in particular, the same.
    assert.deepStrictEqual(forTask({ ...kept, model: null }, { agentId: 'claude-code', model: 'opus' }, lead, same), expected)
  })
})

describe('what a thread says of a model turned off for its agent', () => {
  const from = { agent: 'OpenCode', model: 'GPT-6.2 Sol' }

  it('says it carries on through another agent that has it', () => {
    assert.strictEqual(
      routeWords({ from, to: { agent: 'Codex', model: 'GPT-6.2 Sol' } }),
      'GPT-6.2 Sol is turned off for OpenCode: it carries on through Codex.',
    )
  })

  it('says plainly where a different model takes it over, or none can', () => {
    assert.strictEqual(
      routeWords({ from, to: { agent: 'OpenCode', model: 'Kimi K3.1 Pro', otherModel: true } }),
      'GPT-6.2 Sol is turned off for OpenCode, and no other agent with room offers it, so Kimi K3.1 Pro on OpenCode, a different model, takes the work over.',
    )
    assert.strictEqual(
      routeWords({ from: { agent: 'Codex', model: null } }),
      'Its model is turned off for Codex, and no other agent with room offers it.',
    )
  })
})
