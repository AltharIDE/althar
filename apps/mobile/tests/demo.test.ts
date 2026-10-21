import type { WatchEvent } from '@althar/contracts'
import { describe, expect, it, vi } from 'vitest'

import { DemoClient } from '../src/client/demo/DemoClient'
import { needsCount } from '../src/model/home'

const client = () => new DemoClient({ latency: 0, now: () => Date.parse('2026-10-21T15:00:00.000Z') })

describe('the demo client', () => {
  it('sends the task back to work once its permission is answered, and says so in its thread', async () => {
    const demo = client()
    const events: Array<WatchEvent> = []
    demo.watch((event) => events.push(event))
    const before = await demo.home()

    await demo.answer({ attentionId: 'att_migrate', decision: 'allow' })

    const after = await demo.home()
    expect(after.calls.map((one) => one.id)).not.toContain('att_migrate')
    expect(after.tasks.find((one) => one.taskId === 'task_webhooks')?.phase).toBe('running')
    expect(needsCount(after)).toBe(needsCount(before) - 1)
    const thread = await demo.thread('thr_task_webhooks')
    expect(thread.attention).toEqual([])
    expect(thread.items.at(-1)).toMatchObject({ kind: 'notice', content: { title: 'You allowed it, from your phone' } })
    expect(events.some((event) => event._tag === 'Changed' && event.aggregateId === 'task_webhooks')).toBe(true)
  })

  it('refuses a call answered twice', async () => {
    const demo = client()
    await demo.answer({ attentionId: 'att_migrate', decision: 'reject', reason: 'Not on staging today' })
    await expect(demo.answer({ attentionId: 'att_migrate', decision: 'allow' })).rejects.toThrow('already answered')
  })

  it('takes an answer to a question, and settles a stuck task abandoned', async () => {
    const demo = client()
    await demo.answerQuestion({ attentionId: 'att_breakpoint', answers: { breakpoint: { values: ['640'] } } })
    await demo.answerStuck({ attentionId: 'att_rounds', answer: { kind: 'abandon' } })
    const home = await demo.home()
    expect(home.tasks.find((one) => one.taskId === 'task_shifts')?.phase).toBe('running')
    expect(home.tasks.find((one) => one.taskId === 'task_cron')?.phase).toBe('settled')
  })

  it('merges only the head the person saw', async () => {
    const demo = client()
    await expect(demo.merge({ taskId: 'task_stripe', head: 'deadbee' })).rejects.toThrow('changed since you looked')
    await demo.merge({ taskId: 'task_stripe', head: '9f3c2ab' })
    const home = await demo.home()
    expect(home.tasks.find((one) => one.taskId === 'task_stripe')).toMatchObject({ phase: 'settled', change: { state: 'merged' } })
  })

  it('puts a new task in line, with what the person asked as its thread’s start', async () => {
    const demo = client()
    const made = await demo.createTask({ projectId: 'proj_site', title: 'Add an RSS feed', description: 'Add an RSS feed for the shifts.' })
    const home = await demo.home()
    expect(home.tasks.find((one) => one.taskId === made.id)).toMatchObject({ phase: 'planned', inLine: true })
    const thread = await demo.thread(made.threadId)
    expect(thread.items[0]).toMatchObject({ kind: 'user_message', content: { text: 'Add an RSS feed for the shifts.' } })
  })

  it('finds tasks by their title and by what their lead said, with what matched marked', async () => {
    const demo = client()
    const byTitle = await demo.searchTasks({ text: 'stripe' })
    expect(byTitle.tasks.map((one) => one.title)).toEqual(['Upgrade the Stripe SDK to v19'])
    const bySaid = await demo.searchTasks({ text: 'batch' })
    expect(bySaid.tasks[0]?.title).toBe('Backfill invoice totals for 2024')
    expect(bySaid.tasks[0]?.matched?.some((part) => part.hit && part.text === 'batch')).toBe(true)
    expect((await demo.searchTasks({ text: '', projectId: 'proj_site' })).tasks.every((one) => one.projectId === 'proj_site')).toBe(true)
  })

  it('starts a plan now, or holds its countdown', async () => {
    const demo = client()
    await demo.holdPlan('plan_secret')
    expect((await demo.home()).tasks.find((one) => one.taskId === 'task_secret')).toMatchObject({
      phase: 'planned',
      plan: { startsAt: null },
    })
    await demo.startPlan('plan_secret')
    expect((await demo.home()).tasks.find((one) => one.taskId === 'task_secret')).toMatchObject({
      phase: 'running',
      step: 'implement',
      lead: 'claude-code',
    })
    await expect(demo.startPlan('plan_secret')).rejects.toThrow('already started')
  })

  it('has the coordinator plan what it is told, as a task counting down', async () => {
    vi.useFakeTimers()
    const demo = new DemoClient({ latency: 0, now: () => Date.parse('2026-10-21T15:00:00.000Z') })
    const before = await demo.coordinator('proj_site')
    expect(before.items).toEqual([])
    await demo.send({ threadId: before.threadId, body: 'Add an RSS feed for the shifts. Keep it under 50 items.' })
    vi.advanceTimersByTime(10)
    const after = await demo.coordinator('proj_site')
    expect(after.items.map((item) => item.kind)).toEqual(['user_message', 'agent_message', 'task'])
    const posted = after.items[2]
    expect(posted?.kind === 'task' ? posted.content : null).toMatchObject({ title: 'Add an RSS feed for the shifts', phase: 'planned' })
    expect((await demo.home()).tasks.some((one) => one.title === 'Add an RSS feed for the shifts')).toBe(true)
    vi.useRealTimers()
  })

  it('shows a task the coordinator posted as it stands now', async () => {
    const demo = client()
    await demo.startPlan('plan_secret')
    const posted = (await demo.coordinator('proj_meridian')).items.find((item) => item.kind === 'task')
    expect(posted?.kind === 'task' ? posted.content.phase : null).toBe('running')
  })

  it('streams the lead’s words and brings a new call in, live', async () => {
    vi.useFakeTimers()
    const demo = new DemoClient({ latency: 0, live: true })
    const events: Array<WatchEvent> = []
    demo.watch((event) => events.push(event))
    vi.advanceTimersByTime(30_000)
    expect(events.filter((event) => event._tag === 'Streaming')).toHaveLength(3)
    expect((await demo.home()).calls.map((one) => one.id)).toContain('att_legacy_css')
    demo.dispose()
    vi.useRealTimers()
  })

  it('pairs through connecting to online', () => {
    vi.useFakeTimers()
    const demo = new DemoClient({ latency: 0, connection: 'unpaired' })
    const states: Array<string> = []
    demo.onConnection((connection) => states.push(connection.state))
    void demo.pair('althar-pair:demo')
    vi.advanceTimersByTime(1_000)
    expect(states).toEqual(['connecting', 'online'])
    vi.useRealTimers()
  })
})
