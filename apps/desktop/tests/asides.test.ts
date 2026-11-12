import { describe, expect, it } from 'vitest'

import type { BoardTask } from '@althar/contracts'

import { asidesOf, asideTitle, asideWords } from '../src/renderer/features/project/Asides'

/*
 * Asides (docs/decisions/tasks.md, "Asides"): the pills' asides, those left a
 * week apart, and what a new one is titled and opens with.
 */

/** An aside on the board, as much of one as the pills read. */
const boardTask = (one: Partial<BoardTask>): BoardTask =>
  ({ threadId: `th-${one.taskId}`, phase: 'ready', scratch: true, createdAt: '2026-11-11T11:00:00.000Z', ...one }) as BoardTask

const NOW = Date.parse('2026-11-11T12:00:00Z')
const ago = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString()

describe('asides', () => {
  it('keeps the latest apart from those left a week, by their latest exchange or else when they began', () => {
    const { recent, older } = asidesOf(
      [
        boardTask({
          taskId: 'a1',
          title: 'Why does the retry back off twice?',
          phase: 'running',
          latest: { at: ago(0), by: 'lead', said: 'In two places.' },
        }),
        boardTask({ taskId: 'a2', title: 'Name for the export', createdAt: ago(2) }),
        boardTask({ taskId: 'a3', title: 'Is the webhook checked twice?', latest: { at: ago(9), by: 'person', said: 'Thanks.' } }),
      ],
      NOW,
    )
    expect(recent).toEqual([
      { id: 'a1', title: 'Why does the retry back off twice?', said: 'In two places.', running: true },
      { id: 'a2', title: 'Name for the export' },
    ])
    expect(older).toEqual([{ id: 'a3', title: 'Is the webhook checked twice?', said: 'Thanks.' }])
  })

  it('titles a new one by its first line, cut at a word, and opens it with what it quotes above the person’s words', () => {
    expect(asideTitle('Which file holds the retry?\nAnd why twice?')).toBe('Which file holds the retry?')
    const long = asideTitle(`${'word '.repeat(30)}end`)
    expect(long.length).toBeLessThanOrEqual(81)
    expect(long.endsWith('…')).toBe(true)
    expect(asideWords('Which is safe to drop?', 'It backs off in two places.\nThe client waits.')).toBe(
      '> It backs off in two places.\n> The client waits.\n\nWhich is safe to drop?',
    )
    expect(asideWords('Just this', null)).toBe('Just this')
  })
})
