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
    // As long as a task's title may be, so naming it from its first words is never refused.
    const long = asideTitle(`${'word '.repeat(30)}end`)
    expect(long.length).toBeLessThanOrEqual(60)
    expect(long.endsWith('word…')).toBe(true)
    expect(asideWords('Which is safe to drop?', 'It backs off in two places.\nThe client waits.')).toBe(
      '> It backs off in two places.\n> The client waits.\n\nWhich is safe to drop?',
    )
    expect(asideWords('Just this', null)).toBe('Just this')
  })

  it('puts a new one first, by the id it keeps, before the board has it and after, and shows one left unsaid only while open', () => {
    const asides = [
      boardTask({ taskId: 'a1', title: 'Why does the retry back off twice?', latest: { at: ago(0), by: 'lead', said: 'Twice.' } }),
      // Opened with +, nothing said in it yet: its lead waits for the person's words, and isn't at work.
      boardTask({ taskId: 'a2', title: '', phase: 'running', unsaid: true }),
    ]
    // Not open, it takes no pill; + opens it again.
    expect(asidesOf(asides, NOW).recent.map((aside) => aside.id)).toEqual(['a1'])
    // Open, its one pill comes first, as it did before the board had it, untitled and not at work.
    expect(asidesOf(asides, NOW, { open: 'a2', first: 'a2' }).recent).toEqual([
      { id: 'a2', title: '' },
      { id: 'a1', title: 'Why does the retry back off twice?', said: 'Twice.' },
    ])
    expect(asidesOf([asides[0] as BoardTask], NOW, { open: 'a9', first: 'a9' }).recent.map((aside) => aside.id)).toEqual(['a9', 'a1'])
    // Its first words sent, a board read from before them still says it is unsaid: it keeps its pill, and its place.
    expect(asidesOf(asides, NOW, { open: 'a2', first: 'a2' }).recent.map((aside) => aside.id)).toEqual(['a2', 'a1'])
    expect(asidesOf(asides, NOW, { open: 'a1', first: 'a2' }).recent.map((aside) => aside.id)).toEqual(['a2', 'a1'])
  })
})
