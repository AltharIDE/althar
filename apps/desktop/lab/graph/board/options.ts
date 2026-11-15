import type { Option } from '../state'

/* The ways the board keeps a launched request in sight while it runs. */
export const BOARD_OPTIONS: ReadonlyArray<Option> = [
  { key: 'a', name: 'As it is', line: 'The board as today: each task of the request a card in its lane.' },
  { key: 'b', name: 'As it is', line: 'The board as today: each task of the request a card in its lane.' },
  { key: 'c', name: 'As it is', line: 'The board as today: each task of the request a card in its lane.' },
  { key: 'd', name: 'As it is', line: 'The board as today: each task of the request a card in its lane.' },
]
