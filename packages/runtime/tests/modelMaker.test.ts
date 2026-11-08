import type { ModelFact } from '../src/ModelFacts'
import { makerOf } from '../src/modelMaker'
import { assert, describe, it } from '@effect/vitest'

const fact = (slug: string): ModelFact => ({ slug }) as ModelFact

describe('who makes a model', () => {
  it('knows an agent’s own maker, a model’s name, and the list’s prefixes, known or not', () => {
    // The agent's own maker, for a model the list doesn't know.
    assert.strictEqual(makerOf(null, 'claude-code'), 'Anthropic')
    assert.strictEqual(makerOf(null, 'codex'), 'OpenAI')
    // A model's name, where its agent has no maker of its own.
    for (const [id, maker] of [
      ['claude-sonnet-5', 'Anthropic'],
      ['gpt-6.1', 'OpenAI'],
      ['codex-mini', 'OpenAI'],
      ['o3', 'OpenAI'],
      ['gemini-3', 'Google'],
      ['deepseek-v4', 'DeepSeek'],
      ['glm-5', 'Z.ai'],
      ['kimi-k3', 'Moonshot'],
      ['qwen3', null],
    ] as const)
      assert.strictEqual(makerOf(null, 'opencode', { id, name: id }), maker, id)
    // The list's prefix, known or not, and its empty case.
    assert.strictEqual(makerOf(fact('anthropic/claude-sonnet-5'), 'opencode'), 'Anthropic')
    assert.strictEqual(makerOf(fact('acme/rocket-1'), 'opencode'), 'Acme')
    assert.strictEqual(makerOf(fact('/no-prefix'), 'opencode'), null)
  })
})
