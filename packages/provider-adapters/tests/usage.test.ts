import { describe, expect, it } from 'vitest'

import { type AgentDefinition, agents } from '../src/registry'
import { codexUsage, nextWarning, readAgentUsage, type WarningState, windowKind } from '../src/usage'

const NOW = new Date('2026-10-15T12:00:00.000Z')

/** What Codex's `account/rateLimits/read` answers: the ordinary bucket, and another for a model. */
const SNAPSHOT = {
  rateLimits: { limitId: 'codex', planType: 'plus', primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 1_760_540_400 } },
  rateLimitsByLimitId: {
    codex: {
      limitId: 'codex',
      limitName: null,
      planType: 'plus',
      primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 1_760_540_400 },
      secondary: { usedPercent: 12, windowDurationMins: 10_080, resetsAt: 1_761_000_000 },
    },
    codex_spark: {
      limitId: 'codex_spark',
      limitName: 'Spark',
      primary: { usedPercent: 3, windowDurationMins: 300, resetsAt: 1_760_540_400 },
    },
  },
}

describe('the length of a plan window', () => {
  it('tells five hours, a week and a month apart by their length', () => {
    expect(windowKind(300)).toBe('five_hour')
    expect(windowKind(10_080)).toBe('weekly')
    expect(windowKind(43_200)).toBe('monthly')
    expect(windowKind(31 * 24 * 60)).toBe('monthly')
  })

  it('calls anything else, or no length, other', () => {
    expect(windowKind(60)).toBe('other')
    expect(windowKind(null)).toBe('other')
    expect(windowKind(undefined)).toBe('other')
    expect(windowKind(Number.NaN)).toBe('other')
  })
})

describe('Codex’s rate limits as an account’s usage', () => {
  it('reads each bucket’s windows by length, naming the ones that are not the ordinary limit', () => {
    const usage = codexUsage(SNAPSHOT, NOW)
    expect(usage).toEqual({
      source: 'agent',
      observedAt: '2026-10-15T12:00:00.000Z',
      plan: 'plus',
      windows: [
        { kind: 'five_hour', minutes: 300, usedPercent: 40, resetsAt: new Date(1_760_540_400_000).toISOString() },
        { kind: 'weekly', minutes: 10_080, usedPercent: 12, resetsAt: new Date(1_761_000_000_000).toISOString() },
        { kind: 'five_hour', label: 'Spark', minutes: 300, usedPercent: 3, resetsAt: new Date(1_760_540_400_000).toISOString() },
      ],
    })
  })

  it('classifies a weekly window that arrives as primary', () => {
    const usage = codexUsage({ rateLimits: { primary: { usedPercent: 80, windowDurationMins: 10_080, resetsAt: 1_761_000_000 } } }, NOW)
    expect(usage?.windows.map((w) => w.kind)).toEqual(['weekly'])
  })

  it('keeps a window without a length or a reset, as other', () => {
    const usage = codexUsage({ rateLimits: { primary: { usedPercent: 10 } } }, NOW)
    expect(usage?.windows).toEqual([{ kind: 'other', usedPercent: 10 }])
  })

  it('reads a spend limit as a window of no stated length', () => {
    const usage = codexUsage(
      { rateLimits: { individualLimit: { limit: '100', used: '70', remainingPercent: 30, resetsAt: 1_761_000_000 } } },
      NOW,
    )
    expect(usage?.windows).toEqual([
      { kind: 'other', label: 'Spend limit', usedPercent: 70, resetsAt: new Date(1_761_000_000_000).toISOString() },
    ])
  })

  it('has nothing for an answer without a window, or a shape it does not know', () => {
    expect(codexUsage({ rateLimits: { credits: { hasCredits: true, unlimited: false, balance: '5' } } }, NOW)).toBeNull()
    expect(codexUsage(null, NOW)).toBeNull()
    expect(codexUsage('nope', NOW)).toBeNull()
    expect(codexUsage({ rateLimits: { primary: { usedPercent: 'a lot' } } }, NOW)).toBeNull()
  })
})

describe('warning as a plan runs out', () => {
  const RESET = '2026-10-15T17:00:00.000Z'
  const step = (used: number, before?: WarningState, resetsAt: string | undefined = RESET) => nextWarning(used, resetsAt, before)

  it('says nothing while more than half is left', () => {
    expect(step(49).warn).toBeUndefined()
  })

  it('warns at 50, 25, 10 and 5 percent left, each once', () => {
    let state: WarningState | undefined
    const warned: number[] = []
    for (const used of [30, 50, 55, 75, 76, 90, 91, 95, 99]) {
      const next = step(used, state)
      state = next.state
      if (next.warn !== undefined) warned.push(next.warn)
    }
    expect(warned).toEqual([50, 25, 10, 5])
  })

  it('tells only the lowest threshold a reading skips to', () => {
    expect(step(92).warn).toBe(10)
    expect(step(100).warn).toBe(5)
  })

  it('does not tell a threshold again when use dips and rises in the same period', () => {
    const first = step(80)
    expect(first.warn).toBe(25)
    const dipped = step(60, first.state)
    expect(dipped.warn).toBeUndefined()
    expect(step(80, dipped.state).warn).toBeUndefined()
  })

  it('tells the next threshold after a dip', () => {
    const first = step(80)
    const dipped = step(60, first.state)
    expect(step(91, dipped.state).warn).toBe(10)
  })

  it('arms again when the window resets', () => {
    const first = step(96)
    expect(first.warn).toBe(5)
    const later = step(96, first.state, '2026-10-15T22:00:00.000Z')
    expect(later.warn).toBe(5)
  })

  it('warns once for a window that gives no reset time', () => {
    const first = nextWarning(80, undefined, undefined)
    expect(first.warn).toBe(25)
    expect(nextWarning(80, undefined, first.state).warn).toBeUndefined()
  })

  it('keeps a state that survives being stored as JSON', () => {
    const state = step(10).state
    expect(JSON.parse(JSON.stringify(state))).toEqual(state)
  })
})

/** A stand-in for Codex’s app-server: initialize, then rate limits (or a refusal, or nothing). */
const SERVER = (mode: 'answer' | 'refuse' | 'silent' | 'exit') => `
let buffer = ''
const say = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
process.stdin.on('data', (data) => {
  buffer += data
  for (let at = buffer.indexOf('\\n'); at >= 0; at = buffer.indexOf('\\n')) {
    const message = JSON.parse(buffer.slice(0, at))
    buffer = buffer.slice(at + 1)
    if (message.method === 'initialize') say({ id: message.id, result: {} })
    if (message.method === 'account/rateLimits/read') {
      if (${JSON.stringify(mode)} === 'answer') say({ id: message.id, result: ${JSON.stringify(SNAPSHOT)} })
      if (${JSON.stringify(mode)} === 'refuse') say({ id: message.id, error: { message: 'Not signed in with ChatGPT.' } })
      if (${JSON.stringify(mode)} === 'exit') process.exit(1)
    }
  }
})`

const codex = (mode: 'answer' | 'refuse' | 'silent' | 'exit'): AgentDefinition => ({
  ...agents.codex,
  usage: { run: () => ({ command: 'bun', args: ['-e', SERVER(mode)] }) },
})

describe('asking Codex’s app-server', () => {
  it('reads the account’s windows', async () => {
    const read = await readAgentUsage(codex('answer'), { now: () => NOW })
    expect(read.kind).toBe('usage')
    if (read.kind === 'usage') {
      expect(read.usage.windows).toHaveLength(3)
      expect(read.usage.source).toBe('agent')
    }
  })

  it('says why when the agent refuses', async () => {
    expect(await readAgentUsage(codex('refuse'))).toEqual({ kind: 'failed', message: 'Not signed in with ChatGPT.' })
  })

  it('says so when the agent stops before it answers', async () => {
    const read = await readAgentUsage(codex('exit'))
    expect(read.kind).toBe('failed')
  })

  it('gives up on an agent that never answers', async () => {
    const read = await readAgentUsage(codex('silent'), { timeout: 300 })
    expect(read).toEqual({ kind: 'failed', message: 'Codex didn’t answer in time.' })
  })

  it('points the agent at the account’s home', async () => {
    const agent: AgentDefinition = {
      ...agents.codex,
      usage: {
        run: () => ({
          command: 'bun',
          args: [
            '-e',
            `process.stdin.on('data', (d) => { const m = JSON.parse(String(d).split('\\n')[0]); process.stdout.write(JSON.stringify({ id: m.id, error: { message: process.env.CODEX_HOME } }) + '\\n') })`,
          ],
        }),
      },
    }
    expect(await readAgentUsage(agent, { home: { CODEX_HOME: '/accounts/work' } })).toEqual({ kind: 'failed', message: '/accounts/work' })
  })

  it('is not asked of an agent with no usage channel', async () => {
    const read = await readAgentUsage(agents.opencode)
    expect(read).toEqual({ kind: 'failed', message: 'OpenCode has no usage channel.' })
  })
})
