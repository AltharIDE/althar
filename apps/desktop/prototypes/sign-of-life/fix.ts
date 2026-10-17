// Scrappy: which turn runs, as the thread reads it. Today, the last turn, even when the person spoke after it: so in the gap the previous reply looks at work again. In every direction, only a turn after the last thing the person said.
import { get } from './store'

export const liveTurn = (blocks: ReadonlyArray<{ readonly kind: string }>): number => {
  const turn = blocks.findLastIndex((block) => block.kind === 'turn')
  if (get().d === 'T') return turn
  const you = blocks.findLastIndex((block) => block.kind === 'you')
  return turn > you ? turn : -1
}
