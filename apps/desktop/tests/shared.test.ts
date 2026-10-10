import { Brand } from '@althar/ui'
import { describe, expect, it } from 'vitest'

import { agentLineOf, brandOf } from '../src/renderer/shared/agents'
import { knownModelName, standsFor } from '@althar/contracts'
import { isSending, mergeItems, newestReads, queueShown, sending, unsent, waiting } from '../src/renderer/shared/items'
import { items } from './fixtures'
import { ago, clock, took } from '../src/renderer/shared/time'

describe('agents', () => {
  it('draws each agent with its maker’s mark, when it has one', () => {
    expect(brandOf('claude-code')).toBe(Brand.Anthropic)
    expect(brandOf('codex')).toBe(Brand.OpenAI)
    expect(brandOf('opencode')).toBe(Brand.OpenCode)
    expect(brandOf('aider')).toBeUndefined()
  })

  it('says who makes an agent and its version, under its name', () => {
    expect(agentLineOf({ id: 'claude-code', version: '2.1.263' })).toBe('Anthropic · 2.1.263')
    expect(agentLineOf({ id: 'opencode', version: '1.18.31' })).toBe('1.18.31')
    expect(agentLineOf({ id: 'opencode', version: null })).toBeUndefined()
  })
})

describe('models as people know them', () => {
  const claude = { id: 'claude-code', name: 'Claude Code' }
  it('puts back the family an agent leaves out', () => {
    expect(knownModelName(claude, { id: 'sonnet', name: 'Sonnet 5.5' })).toBe('Claude Sonnet 5.5')
    expect(knownModelName(claude, { id: 'x', name: 'Claude Opus 5' })).toBe('Claude Opus 5')
    expect(knownModelName({ id: 'codex', name: 'Codex' }, { id: 'gpt-6-astra', name: '6 Astra' })).toBe('GPT-6 Astra')
    expect(knownModelName({ id: 'opencode', name: 'OpenCode' }, { id: 'opencode-go/glm-5.3', name: 'OpenCode Go/GLM-5.3' })).toBe('GLM-5.3')
  })

  it('takes an agent’s own default for the model its line names', () => {
    const models = [
      { id: 'default', name: 'Default (recommended)', description: 'Opus 5.5' },
      { id: 'opus', name: 'Opus 5.5', description: 'For complex work' },
      { id: 'odd', name: 'Default', description: 'Nothing' },
    ]
    expect([standsFor(models, 'default'), standsFor(models, 'opus'), standsFor(models, 'odd'), standsFor(models, null)]).toEqual([
      'opus',
      'opus',
      null,
      null,
    ])
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

describe('reads that come back out of order', () => {
  it('keep only the newest answer for each thing read', async () => {
    const newest = newestReads()
    const kept: Array<string> = []
    const failed: Array<unknown> = []
    let answerFirst: (value: string) => void = () => undefined
    const first = newest(
      'card',
      new Promise<string>((resolve) => (answerFirst = resolve)),
      (value) => kept.push(value),
      (e) => failed.push(e),
    )
    // A later read of the same card answers first; one of another thing is its own.
    await newest(
      'card',
      Promise.resolve('ready'),
      (value) => kept.push(value),
      (e) => failed.push(e),
    )
    await newest(
      'head',
      Promise.resolve('head'),
      (value) => kept.push(value),
      (e) => failed.push(e),
    )
    answerFirst('running')
    await first
    expect(kept).toEqual(['ready', 'head'])
    await newest(
      'card',
      Promise.reject(new Error('The port closed')),
      () => undefined,
      (e) => failed.push(e),
    )
    expect(failed).toHaveLength(1)
  })
})

describe('a clock', () => {
  it('says the time today, and the day as well otherwise', () => {
    const now = new Date('2026-10-03T12:00:00')
    const later = new Date('2026-10-03T15:40:00')
    expect(clock(later.toISOString(), now)).toBe(later.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }))
    const monday = new Date('2026-10-05T09:00:00')
    expect(clock(monday.toISOString(), now)).toBe(
      `${monday.toLocaleDateString(undefined, { weekday: 'short' })} ${monday.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`,
    )
    const november = new Date('2026-11-20T09:00:00')
    expect(clock(november.toISOString(), now)).toContain(november.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))
  })
})

describe('what the person sends', () => {
  it('shows at once as the window’s copy, after what is there, until the store’s copy of it arrives, or the send fails', () => {
    const held = [{ ...items.you('Add a retry'), sequence: 4 }]
    const first = sending(held, { text: 'Use the helper', queued: false, interrupting: false })
    expect(isSending(first.id)).toBe(true)
    expect(first.items.at(-1)).toMatchObject({
      kind: 'user_message',
      sequence: 4.5,
      content: { text: 'Use the helper' },
      input: { state: 'delivered' },
    })
    // Behind a turn running it waits its turn, or interrupts it.
    const second = sending(first.items, { text: 'Stop', queued: true, interrupting: true })
    expect(second.items.at(-1)).toMatchObject({ input: { state: 'queued', interrupting: true } })
    // The store's copy takes the place of the window's, by its words; another message leaves it.
    const stored = { ...items.you('Use the helper'), id: 'i5', sequence: 5 }
    const merged = mergeItems(second.items, [stored, { ...items.you('Something else'), id: 'i6', sequence: 6 }])
    expect(merged.map((item) => item.id)).toEqual([held[0]?.id, second.id, 'i5', 'i6'])
    expect(merged.some((item) => item.id === first.id)).toBe(false)
    // A send that failed takes its copy with it.
    expect(unsent(merged, second.id, 'Stop').some((item) => item.id === second.id)).toBe(false)
  })

  it('never asks Althar for a copy, and keeps copies straight when two say the same', () => {
    const queued = sending([{ ...items.you('Add a retry'), sequence: 4 }], { text: 'Retry', queued: true, interrupting: false })
    expect(waiting(queued.items)).toEqual([])
    // Two the same: the store's copy of the second arrives first, then the first fails; one copy of each stays shown, and no more.
    const one = sending(queued.items, { text: 'Again', queued: false, interrupting: false })
    const two = sending(one.items, { text: 'Again', queued: false, interrupting: false })
    const stored = mergeItems(two.items, [{ ...items.you('Again'), id: 'i9', sequence: 9 }])
    const left = unsent(stored, one.id, 'Again')
    expect(left.filter((item) => item.kind === 'user_message' && item.content.text === 'Again').map((item) => item.id)).toEqual(['i9'])
    // An older page read in doesn't take the place of what is on its way.
    const older = mergeItems(two.items, [{ ...items.you('Again'), id: 'i1', sequence: 1 }])
    expect(older.some((item) => item.id === one.id)).toBe(true)
  })
})

describe('the composer queue', () => {
  it('shows behind a turn running, or with no agent to take what waits, but not while the person is sending', () => {
    expect(queueShown({ turnRunning: true }, false)).toBe(true)
    expect(queueShown({ turnRunning: false }, false)).toBe(false)
    expect(queueShown(null, false)).toBe(true)
    expect(queueShown(null, true)).toBe(false)
  })
})
