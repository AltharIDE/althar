import type { BoardCall, BoardTask, ChangeSummary } from '@althar/contracts'
import { TaskStatus, type StartedTone } from '@althar/ui'

import { callKindOf } from '../../shared/calls'
import { factsOf } from '../../shared/standing'
import { readyCardOf, runningCardOf, stoppedCardOf, text } from './BoardView'

/*
 * Where a task stands as its parent's thread says it, in the board's own
 * words: the word its card carries, the colour of the lane it is in, and in a
 * few more words what the board says under it: how long it waits to start, why it
 * needs you, its pull request and how its checks went. A lead that
 * started the task sees the same on the chip in its thread and in its parts, as
 * the board moves; nothing here is stored.
 */

export interface Stands {
  readonly tone: StartedTone
  readonly word: string
  readonly detail?: string
}

export const startedText = {
  drafting: 'Drafting',
  /** A held plan starts only when the person says. */
  held: 'Held',
  heldWhy: 'Starts when you say',
  needsYou: 'Needs you',
  merged: 'Merged',
  kept: 'Kept for later',
  /** A task that settled, which the board's page doesn't hold any more. */
  settled: 'Settled',
}

/** A pull request by name, with how it stands: #812 · All 4 checks passed. */
const changeWords = (change: ChangeSummary): string => {
  const name = `${change.prefix}${change.number}`
  if (change.state !== 'open') return name
  const [first] = factsOf(change)
  return first === undefined ? name : `${name} · ${first.words}`
}

/** What the board says of a task: the word on its card, its colour, and what more it says under it. */
export const standsOf = (work: BoardTask, call: BoardCall | undefined, now: string, name: (id: string | null) => string): Stands => {
  const open = work.change?.state === 'open' ? work.change : null
  switch (work.phase) {
    case 'drafting':
      return { tone: TaskStatus.Queued, word: startedText.drafting }
    case 'planned': {
      const startsAt = work.plan?.startsAt ?? null
      return {
        tone: TaskStatus.Queued,
        word: text.planned,
        detail:
          startsAt === null
            ? startedText.heldWhy
            : text.startsIn(Math.max(0, Math.ceil((new Date(startsAt).getTime() - new Date(now).getTime()) / 1000))),
      }
    }
    case 'held':
      return { tone: TaskStatus.Stopped, word: startedText.held, detail: startedText.heldWhy }
    case 'running': {
      const card = runningCardOf(work, now, name)
      return {
        tone: card.status ?? TaskStatus.Running,
        word: card.word,
        ...(open === null ? {} : { detail: changeWords(open) }),
      }
    }
    case 'waiting':
      return { tone: TaskStatus.Yours, word: startedText.needsYou, ...(call === undefined ? {} : { detail: callKindOf(call) }) }
    case 'ready': {
      const card = readyCardOf(work)
      return { tone: TaskStatus.Yours, word: card.word, ...(work.change === null ? {} : { detail: changeWords(work.change) }) }
    }
    case 'kept':
      return { tone: TaskStatus.Done, word: startedText.kept }
    case 'stopped': {
      const card = stoppedCardOf(work, now)
      return { tone: TaskStatus.Stopped, word: card.word, ...(card.why === undefined ? {} : { detail: card.why }) }
    }
    case 'settled':
      return work.change?.state === 'merged'
        ? { tone: 'merged', word: startedText.merged, detail: changeWords(work.change) }
        : work.state === 'abandoned'
          ? { tone: 'abandoned', word: text.abandoned }
          : { tone: TaskStatus.Done, word: text.status[TaskStatus.Done] }
    default:
      return { tone: TaskStatus.Done, word: startedText.settled }
  }
}
