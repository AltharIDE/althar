import { createContext, useContext } from 'react'

import type { ThreadSnapshot } from '@althar/contracts'

/* Which direction a window shows: today is the app as it is. */
export type Direction = 'today' | 'a' | 'b' | 'c' | 'd' | 'e'

export const DirectionContext = createContext<Direction>('today')
export const useDirection = () => useContext(DirectionContext)

export const directions: ReadonlyArray<{ readonly key: Exclude<Direction, 'today'>; readonly name: string; readonly gist: string }> = [
  {
    key: 'a',
    name: 'A · One primary action',
    gist: 'The card’s one primary button is Push 3 commits while anything is left to push, and becomes Accept and merge once everything is up. Until then Accept is there but held, and says why.',
  },
  {
    key: 'b',
    name: 'B · A pinned “Not on the PR yet” bar',
    gist: 'The commits not on the pull request sit pinned above the composer, and over the outputs, with Push, until they are up. The thread keeps only the record.',
  },
  {
    key: 'c',
    name: 'C · Said on the board and home',
    gist: 'The task’s card on the board, its line on the home and the dock say “3 commits not pushed”, with Push, so it shows without opening the task.',
  },
  {
    key: 'd',
    name: 'D · Push folded into accept',
    gist: 'Accepting pushes first: one “Push 3 commits and merge”, with the commits listed for a last look. Push only stays, quiet, for sharing without merging.',
  },
  {
    key: 'e',
    name: 'E · Quieter: inline push and a count',
    gist: 'The lead’s own message ends with a one-line push, and the header carries a small “3 to push” count you can press from either face.',
  },
]

/** What the task has to push now, as its pull requests say: how many, whether one is on its way, whether it can't go, whether it just went. */
export const pushOf = (snapshot: ThreadSnapshot) => {
  const open = snapshot.task.changes.filter((one) => one.state === 'open')
  const unpushed = open.reduce((n, one) => n + (one.diverged === null && one.localHead !== null ? one.unpushed : 0), 0)
  const blocked = open.some((one) => one.diverged !== null)
  const request = snapshot.items.findLast((item) => item.kind === 'push_request')
  const settled = request?.kind === 'push_request' ? request.content.settledAt : null
  const justPushed =
    request?.kind === 'push_request' &&
    request.content.state === 'pushed' &&
    settled !== null &&
    Date.now() - new Date(settled).getTime() < 5 * 60_000
  const asked = request?.kind === 'push_request' ? request.content : null
  return { unpushed, blocked, justPushed, asked, first: open[0] }
}

export const commitsWord = (n: number) => (n === 1 ? '1 commit' : `${n} commits`)
