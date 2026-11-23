import { createContext, useContext } from 'react'

import type { World, Why } from './data'

/*
 * What the wrapped components read: which direction shows, the scene as it
 * stands, and what a press does. Null outside the lab's page.
 */

export const DIRECTIONS = [
  { key: '0', label: 'As built', idea: 'Today: Up next says Next in line, the header 1 agent busy' },
  { key: 'a', label: 'A · Rows', idea: 'Each held row says so and until when, Start anyway in its line; the task says the same' },
  {
    key: 'b',
    label: 'B · Group',
    idea: 'A divider names the held rows, as Planned does: until when, and how many at a time of your number',
  },
  { key: 'c', label: 'C · Room', idea: 'Running ends with the room held back, and who would take it' },
  { key: 'd', label: 'D · Heading', idea: 'Up next’s heading says how many at a time, and opens This Mac’s readings with what is held' },
] as const
export type Direction = (typeof DIRECTIONS)[number]['key']

export interface Lab {
  direction: Direction
  world: World
  /** Starts a held task now, past the number for now: the person's own start, which never waits. */
  startAnyway: (id: string) => void
  /** Opens This Mac's popover from the bar. */
  showMac: () => void
  open: (id: string) => void
}

export const LabContext = createContext<Lab | null>(null)
export const useLab = () => useContext(LabContext)

/* ---- words ---- */

/** Until what frees up: the words the slider and This Mac already use. */
export const until = (why: Why) => `until ${why === 'memory' ? 'memory' : 'the CPU'} frees up`

export const words = {
  heldLine: (why: Why) => `Held back ${until(why)}`,
  held: 'Held back',
  startAnyway: 'Start anyway',
  /** How many may work for now, of the person's number. */
  atOnce: (atOnce: number, configured: number) => `${atOnce} at a time, of your ${configured}`,
  atOnceShort: (atOnce: number, configured: number) => `${atOnce} of ${configured} at a time`,
  /** What the held ones do once it frees up. */
  then: (n: number) => (n === 1 ? 'The next task here starts then.' : `The next ${n} here start then.`),
  showMac: 'This Mac',
  room: (n: number) => (n === 1 ? 'Room for 1 more agent' : `Room for ${n} more agents`),
  next: 'Next',
  headerWhy: (atOnce: number, configured: number, why: Why) =>
    `This Mac lets ${atOnce} ${atOnce === 1 ? 'agent' : 'agents'} work at a time, of your ${configured}, ${until(why)}.`,
  waitingFor: 'Waiting for room',
  /** Over the rows past those held back: they would wait with the person's number too. */
  after: 'Waiting for an agent to finish',
}
