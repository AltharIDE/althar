import type { Option } from '../state'

/* The ways the board keeps a launched mission in sight while it runs (index.tsx). */
export const BOARD_OPTIONS: ReadonlyArray<Option> = [
  {
    key: 'a',
    name: 'One card',
    line: 'One card for the mission, in the lane of its loudest task, folding its tasks in: only what needs you shows on its own. Bets on the board staying as light as it is.',
  },
  {
    key: 'b',
    name: 'Its own row',
    line: 'A row across the lanes, under their heads: the mission’s cards in their lanes within it, everything else below. Bets on reading the mission across, as the board is read.',
  },
  {
    key: 'c',
    name: 'Marked cards',
    line: 'The cards stay where they are, each of the mission’s marked with its name and place; pointing at one steps the rest back and opens its graph. Bets on the board already saying where each stands.',
  },
  {
    key: 'd',
    name: 'Its own lane',
    line: 'A lane before Up next: the mission top to bottom as a line of stops. Bets on the order being what the person wants to see.',
  },
]
