import { describe, expect, it } from 'vitest'

import { scenario } from '../src/client/demo/scenario'
import { awayNotice, callNotice, CATEGORIES, newCalls, readyNotice, responseTo } from '../src/notify/notices'

const NOW = Date.parse('2026-10-21T15:00:00.000Z')
const state = scenario(NOW)
const call = (id: string) => {
  const found = state.calls.find((one) => one.id === id)
  if (found === undefined) throw new Error(`no call ${id}`)
  return found
}

describe('notices', () => {
  it('puts a permission’s command in its body, and Deny and Allow on it', () => {
    const notice = callNotice(call('att_migrate'), 'meridian')
    expect(notice).toMatchObject({
      category: 'althar.permission',
      group: 'needs',
      title: 'Permission · meridian · Retry webhook deliveries with backoff',
      body: 'Run the database migration on staging\nbun run db:migrate --env staging',
      thread: 'thr_task_webhooks',
    })
    expect(CATEGORIES.permission.actions.map((action) => [action.title, action.opens])).toEqual([
      ['Deny', false],
      ['Allow once…', true],
    ])
  })

  it('says who asks a question, and what', () => {
    expect(callNotice(call('att_breakpoint'), 'althar-site').body).toBe('Opus 5: Where should the table fold into cards?')
  })

  it('tells of work ready quietly, with its checks', () => {
    const stripe = state.tasks.find((one) => one.taskId === 'task_stripe')
    if (stripe === undefined) throw new Error('no task')
    expect(readyNotice(stripe, 'billing-api')).toMatchObject({
      group: 'fyi',
      title: 'Ready to accept · billing-api',
      body: 'Upgrade the Stripe SDK to v19: checks 14/14, +312 −198',
    })
  })

  it('says how many calls wait on a Mac gone away', () => {
    expect(awayNotice('Balazs’s MacBook Pro', 2).body).toBe('2 calls wait there. Wake it to answer.')
  })
})

describe('responses', () => {
  const permission = { kind: 'call', callKind: 'permission', attentionId: 'att_migrate', threadId: 'thr_task_webhooks' } as const

  it('denies from the notification, without opening the app', () => {
    expect(responseTo('deny', permission)).toEqual({ kind: 'deny', attentionId: 'att_migrate' })
  })

  it('opens the call to allow, so Face ID can ask', () => {
    expect(responseTo('allow', permission)).toEqual({ kind: 'open', href: '/call/att_migrate?allow=1' })
    expect(responseTo('com.apple.UNNotificationDefaultActionIdentifier', permission)).toEqual({ kind: 'open', href: '/call/att_migrate' })
  })

  it('opens a question where it was asked, and ready work at its task', () => {
    expect(responseTo('open', { kind: 'call', callKind: 'question', attentionId: 'att_breakpoint', threadId: 'thr_task_shifts' })).toEqual({
      kind: 'open',
      href: '/task/thr_task_shifts',
    })
    expect(responseTo('open', { kind: 'ready', threadId: 'thr_task_stripe' })).toEqual({ kind: 'open', href: '/task/thr_task_stripe' })
  })

  it('finds the calls a new home brings', () => {
    const [first, ...rest] = state.calls
    if (first === undefined) throw new Error('no calls')
    expect(newCalls(rest, state.calls)).toEqual([first])
    expect(newCalls(state.calls, rest)).toEqual([])
  })
})
