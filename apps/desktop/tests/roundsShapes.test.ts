import type { Picture, ThreadItem } from '@althar/contracts'
import { describe, expect, it } from 'vitest'

import { type Round, type RoundBlock, roundsOf, shorter, withoutShotList } from '../src/renderer/shared/rounds'
import { items } from './fixtures'

/*
 * A task's thread in rounds (ADR-042), in shapes its screen's tests don't
 * make: reports one after another with nothing between, what the
 * coordinator passed on with no words of its own apart, setup that went
 * through mid-round, and what a lead looked at.
 */

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 15, 12, minutes)).toISOString()
const when = (item: ThreadItem, minutes: number): ThreadItem => ({ ...item, createdAt: at(minutes) })
const read = (blocks: ReadonlyArray<ThreadItem>, running = false, now = at(60)) =>
  roundsOf({ items: blocks, turnRunning: running, worktree: '/w/meridian' }, new Map(), () => 'just now', now)
const rounds = (blocks: ReadonlyArray<RoundBlock>) => blocks.filter((block): block is Round => block.kind === 'round')

const shot: Picture = {
  digest: 'c'.repeat(64),
  mediaType: 'image/png',
  bytes: 1201,
  width: 1440,
  height: 900,
  name: 'home.png',
  unkept: null,
}

describe('a task’s rounds', () => {
  it('counts the screenshots its lead looked at apart from the files it read', () => {
    const [round] = rounds(
      read([
        items.you('Check the page'),
        when(items.tool({ title: 'Read home.png', locations: [{ path: '/w/meridian/home.png' }], pictures: [shot] }), 1),
        when(items.tool({ title: 'Read app.ts', locations: [{ path: '/w/meridian/src/app.ts' }] }), 2),
        when(items.says('It looks right.'), 3),
      ]),
    )
    expect(round?.work?.counts).toBe('read 1 file, looked at 1 screenshot')
  })

  it('closes a round at each report that follows another with nothing between, so none is lost', () => {
    const first = items.step({ summary: 'First.' })
    const second = items.step({ summary: 'Second.' })
    const third = items.step({ summary: 'Third.' })
    const shown = rounds(read([items.you('Go'), when(items.says('Done.'), 1), when(first, 2), when(second, 3), when(third, 4)]))
    expect(shown.map((round) => round.report?.result.summary)).toEqual(['First.', 'Second.', 'Third.'])
    // The rounds after the first did nothing of their own: they stand by their reports.
    expect(shown.slice(1).map((round) => [round.id, round.work])).toEqual([
      [second.id, null],
      [third.id, null],
    ])
  })

  it('places what the coordinator passed on by its title alone, where it has no words apart', () => {
    const blocks = read([
      items.notice({ source: 'runtime', title: 'From the coordinator: Also cover the refunds.', description: null, role: 'relayed' }, null),
    ])
    expect(blocks[0]).toMatchObject({ kind: 'relayed', title: null, body: 'Also cover the refunds.' })
  })

  it('keeps a setup that went through in the middle of a round with that round’s work', () => {
    const done = { at: at(2), code: 0, timedOut: false, stopped: false, last: null }
    const [round] = rounds(
      read([items.you('Go'), when(items.tool({}), 1), when(items.setup({ ended: done }), 2), when(items.says('Done.'), 3)]),
    )
    expect(round?.work?.steps.map((step) => step.kind)).toEqual(['tool', 'aside'])
    expect(round?.work?.steps.at(-1)).toMatchObject({ text: 'Installed dependencies in meridian' })
  })

  it('reads streamed text the store holds already from the store, not from when it streamed', () => {
    const said = when(items.says('Done.'), 5)
    const streaming = new Map([[said.id, { kind: 'agent_message' as const, agentId: 'claude-code', text: 'Do', sequence: 1, at: at(1) }]])
    const [round] = rounds(
      roundsOf(
        { items: [items.you('Go'), when(items.tool({}), 0), said], turnRunning: false, worktree: '/w/meridian' },
        streaming,
        () => 'just now',
        at(60),
      ),
    )
    expect(round?.work?.took).toBe('5m 0s')
  })
})

describe('reviews, and the lead settling them', () => {
  const findings = [{ severity: 'major' as const, file: null, line: null, claim: 'The retry never stops.' }]
  const review = (round: number, minutes: number) =>
    when(items.step({ step: 'review', round, verdict: 'changes_requested', agentId: 'codex', findings }), minutes)
  const settle = (round: number, minutes: number, words: string) => [
    when(items.tool({ title: 'Edit retry.ts', toolKind: 'edit' }), minutes),
    when(items.step({ step: 'settle', round, summary: words }), minutes + 1),
    when(items.says(words), minutes + 1),
  ]
  const thread = [
    items.you('Add a retry'),
    when(items.tool({}), 1),
    when(items.step({ step: 'implement', summary: 'Added it.' }), 2),
    when(items.says('Added it.'), 2),
    review(0, 5),
    ...settle(0, 6, 'Capped it.'),
    review(1, 10),
    ...settle(1, 11, 'Named it better.'),
  ]

  it('folds the round that settled a review into the review’s line once a later round handed over, and keeps the latest open', () => {
    const blocks = read(thread)
    expect(blocks.map((block) => block.kind)).toEqual(['you', 'round', 'verdict', 'verdict', 'round'])
    const [first, second] = blocks.filter((block) => block.kind === 'verdict')
    expect(first).toMatchObject({ settle: { kind: 'round', result: { text: 'Capped it.' } } })
    expect(second).toMatchObject({ settle: null })
    expect(rounds(blocks).at(-1)).toMatchObject({ result: { text: 'Named it better.' } })
  })

  it('folds a settling round its session said what it could see before, keeping that line after the review’s', () => {
    const seen = when(
      items.notice(
        {
          source: 'runtime',
          title: 'Codex could see a skill',
          role: 'skills',
          skills: [{ name: 'mine', path: '/h/mine/SKILL.md', from: 'person' }],
        },
        null,
      ),
      6,
    )
    const blocks = read([...thread.slice(0, 5), seen, ...thread.slice(5)])
    expect(blocks.map((block) => block.kind)).toEqual(['you', 'round', 'verdict', 'skills', 'verdict', 'round'])
    expect(blocks[2]).toMatchObject({ settle: { kind: 'round', result: { text: 'Capped it.' } } })
  })

  it('leaves a review with no round settling it after it, or one still at work, as it is', () => {
    expect(read(thread.slice(0, 5)).filter((block) => block.kind === 'verdict')).toMatchObject([{ settle: null }])
    // The lead still settling the second review: the first's settling folds, the round at work stands open.
    const working = [...thread.slice(0, 10), when(items.tool({ status: 'in_progress' }), 11)]
    const blocks = read(working, true)
    expect(blocks.filter((block) => block.kind === 'verdict').map((block) => block.kind === 'verdict' && block.settle !== null)).toEqual([
      false,
      false,
    ])
    expect(rounds(blocks).at(-1)).toMatchObject({ live: true })
  })
})

describe('what Althar says, said shorter', () => {
  it('counts a list of files that ends mid-sentence', () => {
    expect(shorter('It conflicts, in a/b.ts, c/d.ts and more')).toBe('It conflicts, in 2 files and more')
  })

  it('drops a table of shots that opens a message, or that a line ending in a colon brings in', () => {
    // As the message reads: what follows the table, and nothing of it.
    expect(withoutShotList('| A1 | x |\n|---|---|\n| A1 | y |\n\nTry it.', new Set(['A1'])).trim()).toBe('Try it.')
    expect(withoutShotList('Done.\n\nHere they are:\n\n| A1 | x |\n|---|---|\n| A1 | y |\n\nTry it.', new Set(['A1']))).toBe(
      'Done.\n\nTry it.',
    )
  })
})
