import type { ThreadItem } from '@althar/contracts'
import { describe, expect, it } from 'vitest'

import { isFinished } from '../src/renderer/shared/calls'
import { queuedOf, sending, settled, unsent } from '../src/renderer/shared/items'
import { type Block, blocksOf } from '../src/renderer/shared/thread'
import { card, items } from './fixtures'

/*
 * A thread's items as the window holds them: which can't change any more (so
 * they aren't read again), the person's own sends and what waits its turn,
 * and a tool call as a turn draws it.
 */

const turnOf = (thread: ReadonlyArray<ThreadItem>): Extract<Block, { kind: 'turn' }> | undefined =>
  blocksOf({ items: thread, turnRunning: false, worktree: '/w/meridian' }, new Map(), () => 'just now').find(
    (block): block is Extract<Block, { kind: 'turn' }> => block.kind === 'turn',
  )

describe('what can’t change any more', () => {
  it('settles a task card once its task settled', () => {
    expect(settled(items.card(card({ phase: 'running' })))).toBe(false)
    expect(settled(items.card(card({ phase: 'settled' })))).toBe(true)
  })

  it('settles a question once it is answered or withdrawn', () => {
    expect(settled(items.question())).toBe(false)
    expect(settled(items.question({ state: 'answered' }))).toBe(true)
    expect(settled(items.question({ state: 'withdrawn' }))).toBe(true)
  })

  it('settles a run or a setup once it ended', () => {
    const ended = { at: '2026-09-29T12:05:00.000Z', code: 0, stopped: false, last: null }
    expect(settled(items.run())).toBe(false)
    expect(settled(items.run({ ended }))).toBe(true)
    expect(settled(items.setup())).toBe(false)
    expect(settled(items.setup({ ended: { ...ended, timedOut: false } }))).toBe(true)
  })

  it('settles a push the lead asked for once it is no longer open', () => {
    expect(settled(items.push())).toBe(false)
    expect(settled(items.push({ state: 'pushed' }))).toBe(true)
  })

  it('settles drafts once filed, posted or discarded, and what was said once written', () => {
    expect(settled(items.draft())).toBe(false)
    expect(settled(items.draft({ state: 'filed' }))).toBe(true)
    expect(settled(items.review())).toBe(false)
    expect(settled(items.review({ state: 'posted' }))).toBe(true)
    for (const said of [items.says('Done.'), items.thinks('Hm.'), items.notice({ title: 'Compacted' }), items.step(), items.arrival()])
      expect(settled(said)).toBe(true)
  })
})

describe('what the person sent', () => {
  it('keeps that some of a message’s words were dictated, on its copy and in the queue', () => {
    const sent = sending([items.says('Ready.')], { text: 'Use the helper', queued: true, interrupting: false, dictated: true })
    const copy = sent.items.at(-1)
    expect(copy?.kind === 'user_message' && copy.input).toEqual({ state: 'queued', interrupting: false, dictated: true })
    expect(queuedOf(sent.items, true)).toEqual([{ id: sent.id, text: 'Use the helper', pictures: [], files: [], dictated: true }])
    // Typed, it says nothing of it.
    const typed = sending([], { text: 'Typed', queued: true, interrupting: false })
    expect(queuedOf(typed.items, true)[0]).not.toHaveProperty('dictated')
  })

  it('leaves the thread as it is when a send that failed has no copy to take away', () => {
    const thread = [items.you('Add a retry'), items.says('On it.')]
    expect(unsent(thread, 'sending:gone', 'Something else')).toBe(thread)
  })
})

describe('a task finished, waiting in Needs you', () => {
  it('counts a plain task that is ready, and a review only once its review was answered', () => {
    expect(isFinished({ kind: 'plain', phase: 'ready' })).toBe(true)
    expect(isFinished({ kind: 'plain', phase: 'running' })).toBe(false)
    expect(isFinished({ kind: 'review', phase: 'ready', reviewing: { posted: { at: 'then' }, waiting: false } })).toBe(true)
    // Its draft still waits to be posted.
    expect(isFinished({ kind: 'review', phase: 'ready', reviewing: { posted: { at: 'then' }, waiting: true } })).toBe(false)
    expect(isFinished({ kind: 'review', phase: 'ready', reviewing: null })).toBe(false)
    expect(isFinished({ kind: 'change', phase: 'ready' })).toBe(false)
  })
})

describe('a tool call in a turn', () => {
  it('shows a command as it reads at a glance, where it was said shorter', () => {
    const long = 'cd /w/meridian && bun install --frozen-lockfile && bun run test -- --reporter=dot'
    const turn = turnOf([items.you('Test it'), items.tool({ title: long, toolKind: 'execute', command: long, label: 'bun run test' })])
    expect(turn?.parts.find((part) => part.kind === 'tool')).toMatchObject({ command: long, label: 'bun run test' })
  })

  it('leaves out a tool call that asks the person something: its question stands in its place', () => {
    const turn = turnOf([
      items.you('Pick one'),
      items.tool({ title: 'AskUserQuestion', toolKind: 'other', asks: true }),
      items.says('I asked which database.'),
    ])
    expect(turn?.parts.map((part) => part.kind)).toEqual(['message'])
  })
})
