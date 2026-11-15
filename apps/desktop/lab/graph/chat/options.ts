import type { Option } from '../state'

/* Where the plan lives while the person and the coordinator talk it over, and what it becomes once launched. */
export const CHAT_OPTIONS: ReadonlyArray<Option> = [
  {
    key: 'a',
    name: 'The card moves',
    line: 'One card, at the coordinator’s latest answer: each version takes its place there and the one before folds to a line. Launched, it runs there.',
  },
  {
    key: 'b',
    name: 'Written out',
    line: 'The coordinator writes the plan out, wave by wave, why on every step, edited in place; each later answer shows only what changed. Launched, it ticks off.',
  },
  {
    key: 'c',
    name: 'Over the composer',
    line: 'The plan sits over the composer through the whole talk and never scrolls away; folded, it’s one line. Launched, the line follows the run.',
  },
  {
    key: 'd',
    name: 'Beside the talk',
    line: 'While it’s planned, the plan takes the board’s half, room for every step to say what and why. Launched, the board comes back.',
  },
]
