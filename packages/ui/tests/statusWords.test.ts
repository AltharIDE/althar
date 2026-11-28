import { describe, expect, it } from 'vitest'

import { BoardLane, TaskStatus } from '../src/foundations/vocabulary'
import { boardLaneText, stoppedByYou, taskStatusText } from '../src/foundations/vocabularyText'

/* The words a task's status and the board's lanes are said in, every card's and every lane's (docs/glossary.md). */

/** The members a table has no word for, or a word for that isn't one. */
const unsaid = (members: ReadonlyArray<string>, words: Readonly<Record<string, string>>) => [
  ...members.filter((member) => (words[member] ?? '').trim() === ''),
  ...Object.keys(words).filter((member) => !members.includes(member)),
]

describe('the status words', () => {
  it('say every status in a word', () => {
    expect(unsaid(Object.values(TaskStatus), taskStatusText)).toEqual([])
  })

  it('name every lane', () => {
    expect(unsaid(Object.values(BoardLane), boardLaneText)).toEqual([])
  })

  it('say Needs you of a task that needs you, as its lane is named, never Waiting on you', () => {
    expect(taskStatusText[TaskStatus.Yours]).toBe('Needs you')
    expect(boardLaneText[BoardLane.Yours]).toBe('Needs you')
  })

  it('name the running lane by its tasks’ word, and say whose a stop was from Stopped', () => {
    expect(boardLaneText[BoardLane.Running]).toBe(taskStatusText[TaskStatus.Running])
    expect(stoppedByYou).toBe('Stopped by you')
  })
})
