import { Brand } from '@charrette/ui'
import { describe, expect, it } from 'vitest'

import { brandOf, modelInfo } from '../src/renderer/shared/agents'
import { ago, took } from '../src/renderer/shared/time'

describe('agents', () => {
  it('draws each agent with its maker’s mark, when it has one', () => {
    expect(brandOf('claude-code')).toBe(Brand.Anthropic)
    expect(brandOf('codex')).toBe(Brand.OpenAI)
    expect(brandOf('opencode')).toBeUndefined()
  })

  it('names the model with the agent', () => {
    expect(modelInfo({ id: 'claude-code', name: 'Claude Code' }, 'opus')).toMatchObject({
      id: 'opus',
      name: 'Claude Code · opus',
      short: 'Claude Code · opus',
      mark: Brand.Anthropic,
    })
    const bare = modelInfo({ id: 'opencode', name: 'OpenCode' }, null)
    expect(bare).toMatchObject({ id: 'opencode', name: 'OpenCode', short: 'OpenCode' })
    expect('mark' in bare).toBe(false)
  })
})

describe('times', () => {
  const now = new Date('2026-09-29T12:00:00Z')
  it('says how long ago, then the date', () => {
    expect(ago('2026-09-29T11:59:30Z', now)).toBe('just now')
    expect(ago('2026-09-29T12:00:30Z', now)).toBe('just now')
    expect(ago('2026-09-29T11:56:00Z', now)).toBe('4m ago')
    expect(ago('2026-09-29T10:00:00Z', now)).toBe('2h ago')
    expect(ago('2026-09-20T10:00:00Z', now)).toMatch(/20/)
    expect(ago(new Date().toISOString())).toBe('just now')
  })

  it('says how long something took', () => {
    expect(took('2026-09-29T12:00:00Z', '2026-09-29T12:00:12Z')).toBe('12s')
    expect(took('2026-09-29T12:00:00Z', '2026-09-29T12:03:05Z')).toBe('3m 5s')
    expect(took('2026-09-29T12:00:00Z', '2026-09-29T13:04:00Z')).toBe('1h 4m')
    expect(took('2026-09-29T12:00:00Z', '2026-09-29T11:00:00Z')).toBe('0s')
  })
})
