import { describe, expect, it } from 'vitest'

import { task } from '../src/client/demo/builders'
import { scenario } from '../src/client/demo/scenario'
import { callKindOf, readyKindOf, standingCalls } from '../src/model/calls'
import { atWorkOf, needsCount, needsOf, stepWords, trackOf, upNextOf, workerOf } from '../src/model/home'
import { connectionWords, duration, since, whoWorks } from '../src/model/words'
import { DEMO_MAC } from '../src/client/demo/DemoClient'

const NOW = Date.parse('2026-10-21T15:00:00.000Z')

const homeOf = (now: number) => {
  const state = scenario(now)
  return {
    cursor: 0,
    looked: state.looked,
    since: state.looked,
    tasks: state.tasks,
    calls: state.calls,
    events: state.events,
    projects: state.projects,
  }
}

describe('what needs you', () => {
  it('puts permissions first, then questions, then stuck steps, then ready work, newest first', () => {
    const needs = needsOf(homeOf(NOW))
    expect(needs.map((need) => need.word)).toEqual(['Permission', 'Question', 'Stuck', 'Review drafted', 'Finished', 'Ready to accept'])
  })

  it('counts a task with two calls once', () => {
    const home = homeOf(NOW)
    const first = home.calls[0]
    if (first === undefined) throw new Error('no call')
    const second = { ...first, id: 'att_second', createdAt: new Date(NOW).toISOString() }
    expect(standingCalls(home.tasks, [first, second])).toEqual([first])
    expect(needsCount({ ...home, calls: [...home.calls, second] })).toBe(needsCount(home))
  })

  it('names each kind of work ready as the desktop does', () => {
    const base = { projectId: 'p', taskId: 't', title: 'T', phase: 'ready' as const }
    expect(readyKindOf(task({ ...base }))).toBe('Ready to accept')
    expect(readyKindOf(task({ ...base, kind: 'plain' }))).toBe('Finished')
    expect(readyKindOf(task({ ...base, handedBack: 'Conflicts with main' }))).toBe('Stuck')
    expect(readyKindOf(task({ ...base, unshipped: { commits: 2, add: 4, del: 1 } }))).toBe('Ready for a new pull request')
  })

  it('names a usage limit apart from other stuck steps', () => {
    const stuck = { step: 'review' as const, why: 'usage_limit' as const, detail: null, agentId: null, round: 0, open: 0 }
    expect(callKindOf({ kind: 'stuck', stuck })).toBe('Out of usage')
    expect(callKindOf({ kind: 'stuck', stuck: { ...stuck, why: 'round_limit' } })).toBe('Stuck')
  })
})

describe('what is at work', () => {
  it('lists running work newest first and what is next by its place', () => {
    const home = homeOf(NOW)
    expect(atWorkOf(home).map((one) => one.title)).toEqual(['Backfill invoice totals for 2024', 'Dark mode for the docs pages'])
    expect(upNextOf(home).map((one) => one.title)).toEqual(['Per-customer rate limits on /charges', 'Rotate the webhook signing secret'])
  })

  it('says the step and who is on it: the reviewer while it reviews', () => {
    const docs = homeOf(NOW).tasks.find((one) => one.taskId === 'task_dark_docs')
    if (docs === undefined) throw new Error('no task')
    expect(stepWords(docs, NOW)).toBe('Reviewing')
    expect(workerOf(docs)).toBe('GPT-5.5')
    expect(trackOf(docs).map((step) => `${step.label}:${step.state}`)).toEqual(['Implement:done', 'Review:now', 'Pull request:next'])
  })

  it('counts a plan down to its start, and says when it’s held', () => {
    const secret = homeOf(NOW).tasks.find((one) => one.taskId === 'task_secret')
    if (secret?.plan == null) throw new Error('no plan')
    expect(stepWords(secret, NOW)).toBe('Starts in 2m')
    expect(stepWords({ ...secret, plan: { ...secret.plan, startsAt: null } }, NOW)).toBe('Held: starts when you say')
  })

  it('says how a task ended in its header, and who is on it while it works', async () => {
    const { standingWords } = await import('../src/model/home')
    const tasks = homeOf(NOW).tasks
    const stripe = tasks.find((one) => one.taskId === 'task_stripe')
    const backfill = tasks.find((one) => one.taskId === 'task_backfill')
    if (stripe?.change == null || backfill === undefined) throw new Error('no task')
    expect(standingWords({ ...stripe, phase: 'settled', change: { ...stripe.change, state: 'merged' } }, NOW)).toBe('Merged')
    expect(standingWords({ ...stripe, phase: 'settled', change: null }, NOW)).toBe('Settled')
    expect(standingWords(stripe, NOW)).toBe('Ready to accept')
    expect(standingWords(backfill, NOW)).toBe('Implementing · Opus 5 · 12m')
  })

  it('says where a task waits in line', () => {
    const next = homeOf(NOW).tasks.find((one) => one.phase === 'planned')
    if (next === undefined) throw new Error('no task')
    expect(stepWords(next, NOW)).toBe('Next in line')
  })
})

describe('words', () => {
  it('says durations and times past', () => {
    expect(duration(30_000)).toBe('now')
    expect(duration(12 * 60_000)).toBe('12m')
    expect(duration(64 * 60_000)).toBe('1h 4m')
    expect(duration(120 * 60_000)).toBe('2h')
    expect(duration(50 * 3_600_000)).toBe('2d')
    expect(since(new Date(NOW - 4 * 60_000).toISOString(), NOW)).toBe('4m ago')
  })

  it('names who works by model', () => {
    expect(whoWorks('claude-code', 'claude-opus-5')).toBe('Opus 5')
    expect(whoWorks('codex', null)).toBe('Codex')
  })

  it('says nothing while online, and how things stood while the Mac is away', () => {
    expect(connectionWords({ state: 'online', mac: DEMO_MAC }, NOW)).toBeNull()
    const away = connectionWords({ state: 'away', mac: DEMO_MAC, lastSeen: new Date(NOW - 7 * 60_000).toISOString() }, NOW)
    expect(away?.title).toBe('Sam’s MacBook Pro is away')
    expect(away?.detail).toContain('7m ago')
  })

  it('says which side needs updating when the two speak different versions', () => {
    expect(connectionWords({ state: 'outdated', mac: DEMO_MAC, ours: 1, theirs: 2 }, NOW)?.title).toBe('Update Althar on this phone')
    expect(connectionWords({ state: 'outdated', mac: DEMO_MAC, ours: 2, theirs: 1 }, NOW)?.title).toBe('Update Althar on Sam’s MacBook Pro')
  })
})

describe('a thread, as rounds', () => {
  it('folds the lead’s tools into one line a round, still working at the end', async () => {
    const { blocksOf } = await import('../src/model/thread')
    const state = scenario(NOW)
    const backfill = state.threads.get('thr_task_backfill')
    if (backfill === undefined) throw new Error('no thread')
    const blocks = blocksOf(backfill.items, NOW)
    expect(blocks.map((block) => (block.kind === 'work' ? block.words : block.item.kind))).toEqual([
      'user_message',
      'notice',
      'agent_message',
      'Worked 8m · edited 1 file, ran 1 command',
      'agent_message',
      'Working 1m · ran 1 command',
    ])
  })
})

describe('a diff line, cut', () => {
  it('marks the stretches that changed, and leaves the rest', async () => {
    const { pieces } = await import('../src/model/diff')
    expect(pieces("export const API_VERSION = '2026-09-30'", ['export ', "'2026-09-30'"])).toEqual([
      { text: 'export ', changed: true },
      { text: 'const API_VERSION = ', changed: false },
      { text: "'2026-09-30'", changed: true },
    ])
    expect(pieces('unchanged', undefined)).toEqual([{ text: 'unchanged', changed: false }])
    expect(pieces('a b', ['zzz'])).toEqual([{ text: 'a b', changed: false }])
  })
})

describe('files viewed', () => {
  it('toggles a file for a task, and keeps tasks apart', async () => {
    const { viewedFiles } = await import('../src/model/viewed')
    viewedFiles.reset()
    viewedFiles.toggle('task_a', 'src/a.ts')
    expect([...viewedFiles.of('task_a')]).toEqual(['src/a.ts'])
    expect(viewedFiles.of('task_b').size).toBe(0)
    viewedFiles.toggle('task_a', 'src/a.ts')
    expect(viewedFiles.of('task_a').size).toBe(0)
  })
})

describe('settling a finished task', () => {
  it('lets a plain task be done, and a review only once answered', async () => {
    const { isSettleable, takesDone } = await import('../src/model/calls')
    const base = { projectId: 'p', taskId: 't', title: 'T', phase: 'ready' as const }
    expect(isSettleable(task({ ...base, kind: 'plain' })) && takesDone(task({ ...base, kind: 'plain' }))).toBe(true)
    expect(isSettleable(task({ ...base }))).toBe(false)
    const drafted = task({ ...base, kind: 'review', reviewing: null })
    expect(isSettleable(drafted) && takesDone(drafted)).toBe(false)
  })
})
