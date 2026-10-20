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
    const streaming = new Map([[said.id, { kind: 'agent_message' as const, agentId: 'claude-code', text: 'Do', at: at(1) }]])
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
