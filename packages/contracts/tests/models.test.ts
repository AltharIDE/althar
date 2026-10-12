import { describe, expect, it } from 'vitest'

import { agentDefaultName, isAgentDefault, knownModelName, modelName, standsFor } from '../src/models'

describe('a model’s name among every agent’s models', () => {
  it('says whose an agent’s own default is', () => {
    expect(modelName('Claude Code', { id: 'default', name: 'Default (recommended)' })).toEqual({
      name: 'Claude Code default',
      provider: undefined,
    })
    expect(agentDefaultName('Codex')).toBe('Codex default')
  })

  it('keeps a provider apart, and puts back a family a name leaves out', () => {
    expect(modelName('OpenCode', { id: 'opencode/big-pickle', name: 'OpenCode Zen/Big Pickle' })).toEqual({
      name: 'Big Pickle',
      provider: 'OpenCode Zen',
    })
    expect(modelName('Codex', { id: 'gpt-6-sol', name: '6 Sol' }).name).toBe('GPT-6 Sol')
    expect(modelName('OpenCode', { id: 'google/gemini-3-pro', name: 'Google/3 Pro' })).toEqual({ name: 'Gemini 3 Pro', provider: 'Google' })
    // A name that says its family, or an id that doesn't, stays as it is.
    expect(modelName('Claude Code', { id: 'opus', name: 'Opus 5.5' }).name).toBe('Opus 5.5')
    expect(modelName('Local', { id: 'v2', name: '2' }).name).toBe('2')
  })
})

describe('a model as people know it', () => {
  const claude = { id: 'claude-code', name: 'Claude Code' }
  const opencode = { id: 'opencode', name: 'OpenCode' }

  it('has its family back where its agent leaves it out, and no provider', () => {
    expect(knownModelName(claude, { id: 'sonnet', name: 'Sonnet 5.5' })).toBe('Claude Sonnet 5.5')
    expect(knownModelName(claude, { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' })).toBe('Claude Haiku 5.5')
    expect(knownModelName({ id: 'codex', name: 'Codex' }, { id: 'gpt-6-astra', name: '6 Astra' })).toBe('GPT-6 Astra')
    expect(knownModelName(opencode, { id: 'opencode-go/glm-5.3', name: 'OpenCode Go/GLM-5.3' })).toBe('GLM-5.3')
  })

  it('stands for the model an agent’s own default names, or for none', () => {
    const models = [
      { id: 'default', name: 'Default (recommended)', description: 'Opus 5.5' },
      { id: 'opus', name: 'Opus 5.5', description: null },
      { id: 'sonnet', name: 'Sonnet 5.5', description: null },
    ]
    expect([isAgentDefault(models[0]!), isAgentDefault(models[1]!)]).toEqual([true, false])
    expect(standsFor(models, 'default')).toBe('opus')
    // Another model, one the agent doesn't list, and none at all stay as they are.
    expect([standsFor(models, 'sonnet'), standsFor(models, 'gone'), standsFor(models, null)]).toEqual(['sonnet', 'gone', null])
    // A default whose line names none of its models stands for nothing known.
    expect(standsFor([{ ...models[0]!, description: 'Whatever is best' }], 'default')).toBeNull()
  })
})
