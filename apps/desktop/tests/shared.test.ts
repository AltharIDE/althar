import { act, renderHook } from '@testing-library/react'
import { Brand } from '@althar/ui'
import { describe, expect, it, vi } from 'vitest'

import { agentLineOf, brandOf } from '../src/renderer/shared/agents'
import { knownModelName, standsFor, type Unfurl } from '@althar/contracts'
import { isSending, mergeItems, newestReads, queueShown, readingNow, sending, unsent, waiting } from '../src/renderer/shared/items'
import { keyOf, pastedIn } from '../src/renderer/shared/pasted'
import { change, items } from './fixtures'
import { latestOf } from '../src/renderer/features/task/Outputs'
import { stepIndex, stepNames, trackFor } from '../src/renderer/shared/steps'
import { ago, clock, took, useNow } from '../src/renderer/shared/time'

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

describe('the time now', () => {
  it('moves on each second while it ticks, or as slowly as asked', () => {
    vi.useFakeTimers({ now: new Date('2026-10-03T12:00:00.000Z') })
    try {
      const seconds = renderHook(() => useNow(true))
      const minutes = renderHook(() => useNow(true, 60_000))
      const still = renderHook(() => useNow(false))
      act(() => {
        vi.advanceTimersByTime(30_000)
      })
      expect(seconds.result.current).toBe('2026-10-03T12:00:30.000Z')
      expect(minutes.result.current).toBe('2026-10-03T12:00:00.000Z')
      act(() => {
        vi.advanceTimersByTime(30_000)
      })
      expect(minutes.result.current).toBe('2026-10-03T12:01:00.000Z')
      expect(still.result.current).toBe('2026-10-03T12:00:00.000Z')
    } finally {
      vi.useRealTimers()
    }
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

  it('has what waits read now while the person sends, or the agent holds the thread or starts, but not behind a turn or a wait', () => {
    const idle = { turnRunning: false, held: true, state: 'active' }
    expect(readingNow(idle, false)).toBe(true)
    expect(readingNow({ ...idle, held: false, state: 'starting' }, false)).toBe(true)
    // The person's own send on its way starts an agent that isn't there, or one Althar no longer holds.
    expect(readingNow(null, true)).toBe(true)
    expect(readingNow({ ...idle, held: false }, true)).toBe(true)
    expect(readingNow(null, false)).toBe(false)
    expect(readingNow({ ...idle, held: false }, false)).toBe(false)
    // Behind a turn running it waits its turn; and where the task waits for a place, or its agent's usage, it waits too.
    expect(readingNow({ ...idle, turnRunning: true }, true)).toBe(false)
    expect(readingNow(idle, true, true)).toBe(false)
  })
})

describe('a task’s rounds of work after its plan (ADR-034)', () => {
  it('names its follow-up in place of Implement, and its track and step as they stand', () => {
    const steps = [
      { key: 'implement' as const, agentId: 'claude-code', model: null, skipped: false },
      { key: 'review' as const, agentId: 'codex', model: null, skipped: false },
    ]
    expect(stepNames(steps)).toEqual(['Implement', 'Review'])
    expect(stepNames(steps, true)).toEqual(['Follow-up', 'Review'])
    expect(stepIndex(stepNames(steps, true), 'implement')).toBe(0)
    expect(stepIndex(stepNames(steps, true), 'settle')).toBe(1)
    expect(trackFor(steps, 'review', false, true).map((step) => step.label)).toEqual(['Follow-up', 'Review'])
  })

  it('shows its latest pull request in each repository, and the earlier ones newest first', () => {
    const first = change({ number: 1, state: 'merged', url: 'https://github.test/meridian/api/pull/1' })
    const second = change({ number: 2, state: 'closed', url: 'https://github.test/meridian/api/pull/2' })
    const third = change({ number: 3, state: 'open', url: 'https://github.test/meridian/api/pull/3' })
    expect(latestOf([first, second, third])).toEqual({ latest: [third], earlier: [second, first] })
    // With none open, the newest is the latest.
    expect(latestOf([first, second])).toEqual({ latest: [second], earlier: [first] })
    // In a task of several repositories, each has its own.
    const web = change({ number: 7, slug: 'web', url: 'https://github.test/meridian/web/pull/7' })
    expect(latestOf([first, web]).latest).toEqual([first, web])
  })
})

describe('links the person pasted', () => {
  // The tracker gives its own address, with the title's slug; the runtime keeps the one pasted.
  const issue: Unfurl = {
    kind: 'issue',
    product: 'linear',
    key: 'MER-231',
    title: 'Rate-limit refunds',
    url: 'https://linear.app/m/issue/MER-231/rate-limit-refunds',
    pasted: 'https://linear.app/m/issue/MER-231',
    status: { name: 'Todo', category: 'todo' },
    priority: null,
    container: null,
  }
  // Unfurled before the runtime kept what was pasted: known by its own address.
  const pull: Unfurl = {
    kind: 'change',
    product: 'github',
    key: 'PR #1206',
    title: 'Rate-limit charges',
    url: 'https://github.com/m/a/pull/1206',
    state: 'merged',
    repository: 'm/a',
  }

  it('are found where they were pasted, without the punctuation after them', () => {
    expect(pastedIn('Do https://linear.app/m/issue/MER-231, like https://github.com/m/a/pull/1206.', [issue, pull])).toEqual([
      'Do ',
      issue,
      ', like ',
      pull,
      '.',
    ])
    expect(pastedIn('https://github.com/m/a/pull/1206', [pull])).toEqual([pull])
  })

  it('are found each time they were pasted', () => {
    expect(pastedIn('https://linear.app/m/issue/MER-231 again https://linear.app/m/issue/MER-231', [issue])).toEqual([
      issue,
      ' again ',
      issue,
    ])
  })

  it('leave an address that didn’t unfurl as it was written, even one that starts like one that did', () => {
    const said = 'Not https://linear.app/m/issue/MER-2310 or https://example.com/x, nor this.'
    expect(pastedIn(said, [issue])).toEqual([said])
    expect(pastedIn('Nothing linked', [])).toEqual(['Nothing linked'])
  })

  it('read as their key, a pull request’s as its number', () => {
    expect(keyOf(issue)).toBe('MER-231')
    expect(keyOf(pull)).toBe('#1206')
  })
})
