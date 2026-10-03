import { describe, expect, it } from 'vitest'

import { agentDefaultName, modelName } from '../src/models'

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
