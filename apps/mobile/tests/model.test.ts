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
  return { cursor: 0, looked: state.looked, since: state.looked, tasks: state.tasks, calls: state.calls, events: state.events, projects: state.projects }
}

describe('what needs you', () => {
  it('puts permissions first, then questions, then stuck steps, then ready work, newest first', () => {
    const needs = needsOf(homeOf(NOW))
    expect(needs.map((need) => need.word)).toEqual([
      'Permission',
      'Question',
      'Stuck',
      'Review drafted',
      'Finished',
      'Ready to accept',
    ])
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
    expect(upNextOf(home).map((one) => one.title)).toEqual(['Per-customer rate limits on /charges'])
  })

  it('says the step and who is on it: the reviewer while it reviews', () => {
    const docs = homeOf(NOW).tasks.find((one) => one.taskId === 'task_dark_docs')
    if (docs === undefined) throw new Error('no task')
    expect(stepWords(docs, NOW)).toBe('Reviewing')
    expect(workerOf(docs)).toBe('GPT-5.5')
    expect(trackOf(docs).map((step) => `${step.label}:${step.state}`)).toEqual(['Implement:done', 'Review:now', 'Pull request:next'])
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
    expect(away?.title).toBe('Balazs’s MacBook Pro is away')
    expect(away?.detail).toContain('7m ago')
  })
})
