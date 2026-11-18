import { BoardLane, boardText } from '@althar/ui'

import { text as boardViewText } from '../../src/renderer/features/board/BoardView'

/*
 * Maya's change, as her task's copy of the app runs it: the board's four
 * empty lanes in warmer words, each saying what will be there and how it
 * gets there. The preview's `&after` runs the app with it in.
 */

export const BEFORE = {
  next: { ...boardViewText.upNextEmpty },
  running: { ...boardText.empty[BoardLane.Running] },
  yours: { ...boardText.empty[BoardLane.Yours] },
  settled: { ...boardText.empty[BoardLane.Settled] },
}

export const AFTER = {
  next: {
    title: 'Nothing lined up yet',
    how: 'Tell the coordinator what you’d like done, in your own words. What it plans waits here.',
    talk: 'Talk to the coordinator',
  },
  running: { title: 'Quiet for now', how: 'When an agent starts on something, you’ll see it here.' },
  yours: { title: 'You’re all caught up', how: 'Questions for you, and work ready to look at, come here.' },
  settled: { title: 'Nothing finished yet', how: 'What’s merged or done is kept here.' },
}

const put = <T extends object>(into: T, from: Partial<T>) => Object.assign(into, from)

/** Runs the app with Maya's change in. */
export const warmer = () => {
  put(boardViewText.upNextEmpty, AFTER.next)
  put(boardText.empty[BoardLane.Running], AFTER.running)
  put(boardText.empty[BoardLane.Yours], AFTER.yours)
  put(boardText.empty[BoardLane.Settled], AFTER.settled)
}
