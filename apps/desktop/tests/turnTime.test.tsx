import type { ThreadItem, TurnTime } from '@althar/contracts'
import { WorkedFor } from '@althar/ui'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { blocksOf } from '../src/renderer/shared/thread'
import { duration, lineOf, mostOf, spentOf, spentOfTask, spentWords, turnsById, wentWords } from '../src/renderer/shared/turnTime'
import { items } from './fixtures'

/*
 * Where a turn's time went, as its line says it (a task is a conversation
 * plus parts): the total, the part that took most where it wasn't the
 * agent's own work, and every part once the line opens; a task's turns added
 * up for its Usage.
 */

const turn = (id: string, times: Partial<TurnTime> = {}): TurnTime => ({
  id,
  place: 0,
  session: 0,
  starting: null,
  work: 0,
  tools: 0,
  ...times,
})

const inTurn = <T extends ThreadItem>(item: T, id: string): T => ({ ...item, turn: id })

describe('where a turn’s time went', () => {
  it('adds up the turns a block holds, each once, and names nothing it doesn’t know', () => {
    const kept = turnsById([
      turn('t1', { place: 190_000, session: 8_000, starting: 'start', work: 42_000, tools: 12_000 }),
      turn('t2', { work: 5_000 }),
    ])
    expect(spentOf(['t1', 't1', 't2', 'unknown'], kept)).toEqual({
      total: 245_000,
      place: 190_000,
      session: 8_000,
      handover: false,
      work: 47_000,
      tools: 12_000,
      went: [],
    })
    expect(spentOf(['unknown'], kept)).toBeNull()
  })

  it('says where a turn’s commits went in a task of several changes, after the part that took most', () => {
    const kept = turnsById([
      turn('t1', { place: 190_000, work: 40_000, changes: [{ name: 'Lane heights', commits: 2 }] }),
      turn('t2', {
        work: 5_000,
        changes: [
          { name: 'Card sizes', commits: 1 },
          { name: 'Lane heights', commits: 1 },
        ],
      }),
    ])
    const one = spentOf(['t1'], kept)
    const both = spentOf(['t1', 't2'], kept)
    if (one === null || both === null) throw new Error('no time kept')
    expect(wentWords(one)).toBe('2 commits to Lane heights')
    expect(lineOf(one)).toBe('3m 10s waiting for a place · 2 commits to Lane heights')
    expect(wentWords(both)).toBe('3 commits to Lane heights, 1 to Card sizes')
    // One change, or none committed to: the line as it was.
    const plain = spentOf(['t3'], turnsById([turn('t3', { work: 5_000 })]))
    expect(plain === null ? 'none' : lineOf(plain)).toBeUndefined()
  })

  it('says each part of a second or more, and names the one that took most where it wasn’t the agent’s own work', () => {
    const waited = spentOf(
      ['t1'],
      turnsById([turn('t1', { place: 190_000, session: 8_000, starting: 'start', work: 42_000, tools: 12_000 })]),
    )
    expect(waited).not.toBeNull()
    if (waited === null) return
    expect(spentWords(waited)).toEqual(['3m 10s waiting for a place', '8s starting', '30s thinking and writing', '12s running tools'])
    expect(mostOf(waited)).toBe('3m 10s waiting for a place')
    // Its own work taking most is the line as it was; so is a part too small to name.
    const working = spentOf(['t2'], turnsById([turn('t2', { place: 4_000, work: 90_000, tools: 20_000 })]))
    expect(working === null ? 'none' : mostOf(working)).toBeUndefined()
    // A fresh session taking over says so.
    const handed = spentOf(['t3'], turnsById([turn('t3', { session: 40_000, starting: 'handover', work: 20_000 })]))
    expect(handed === null ? 'none' : mostOf(handed)).toBe('40s handing over')
    expect(duration(3_725_000)).toBe('1h 2m')
  })

  it('adds a task’s turns up for its Usage, and has nothing to say before any kept its time', () => {
    expect(spentOfTask(undefined)).toBeNull()
    expect(spentOfTask({ turns: 0, place: 0, session: 0, work: 0, tools: 0 })).toBeNull()
    expect(spentOfTask({ turns: 3, place: 60_000, session: 5_000, work: 120_000, tools: 30_000 })?.total).toBe(185_000)
  })

  it('gives a turn over the time its items’ turns kept, and none to one at work', () => {
    const thread = [
      items.you('Add a retry'),
      inTurn(items.thinks('Where is the call?'), 't1'),
      inTurn(items.says('Done: it retries.'), 't1'),
    ]
    const turns = turnsById([turn('t1', { place: 190_000, work: 40_000 })])
    const [, over] = blocksOf({ items: thread, turnRunning: false, worktree: null, turns }, new Map(), () => 'just now')
    expect(over).toMatchObject({ kind: 'turn', spent: { total: 230_000, place: 190_000 } })
    const [, working] = blocksOf({ items: thread, turnRunning: true, worktree: null, turns }, new Map(), () => 'just now')
    expect(working).toMatchObject({ kind: 'turn', spent: null })
  })

  it('names the part that took most on the line, and opens to every part', async () => {
    render(<WorkedFor took="4m" most="3m 10s waiting for a place" spent={['3m 10s waiting for a place', '50s thinking and writing']} />)
    const line = screen.getByRole('button', { name: /Worked for 4m\s*· 3m 10s waiting for a place/ })
    await userEvent.click(line)
    expect(screen.getByText('3m 10s waiting for a place · 50s thinking and writing')).toBeTruthy()
  })
})
