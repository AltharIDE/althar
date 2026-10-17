// Scrappy: the directions, and for each, when each thing it shows appears, counted from Enter. The bar's strip draws these.

export type Direction = 'T' | 'A' | 'B' | 'C' | 'D' | 'E'

/** The moments every direction keys on, in seconds from Enter. */
export const AT = {
  /** The runtime's copy of the message is in: it has it. */
  stored: 0.12,
  /** The runtime has handed it to the agent: its turn started. */
  handed: 0.35,
  /** Before this, nothing new shows: a quick answer never flashes a mark. */
  show: 0.4,
  /** The seconds join. */
  count: 3,
  /** It says this is longer than usual, and Stop is offered in its own words. */
  slow: 30,
  /** Where Fails ends: the agent gives up. */
  fail: 45,
} as const

export interface Beat {
  /** Seconds from Enter; null for what happens at the first word, or on failure, whenever that is. */
  readonly at: number | 'first' | 'fail' | 'queued'
  readonly what: string
}

export interface DirectionInfo {
  readonly key: Direction
  readonly short: string
  readonly name: string
  readonly beats: ReadonlyArray<Beat>
}

export const DIRECTIONS: ReadonlyArray<DirectionInfo> = [
  {
    key: 'T',
    short: 'Today',
    name: 'Nothing until it speaks',
    beats: [
      { at: 0, what: 'Your message lands, “just now” under it; Send turns to Stop' },
      { at: 'first', what: 'The name and the first words arrive together' },
      { at: 'fail', what: 'Nothing until the agent’s error, as a notice' },
      { at: 'queued', what: 'Waits over the composer; nothing when the lead turns to it' },
    ],
  },
  {
    key: 'A',
    short: 'A',
    name: 'Dots',
    beats: [
      { at: AT.show, what: 'Three cobalt dots, where the reply starts' },
      { at: AT.count, what: 'The seconds join: ··· 3s' },
      { at: AT.slow, what: '“Longer than usual” and Stop' },
      { at: 'first', what: 'The name takes the dots’ line; words stream under it' },
      { at: 'fail', what: 'Dots stop; what happened, and Send again' },
    ],
  },
  {
    key: 'B',
    short: 'B',
    name: 'Receipt',
    beats: [
      { at: 0, what: 'Under your message: Sending' },
      { at: AT.stored, what: 'Sent' },
      { at: AT.handed, what: '● Claude Opus has it' },
      { at: AT.count, what: '● Thinking · 3s' },
      { at: AT.slow, what: '“Longer than usual” and Stop' },
      { at: 'first', what: 'The receipt settles to “just now”' },
      { at: 'fail', what: '“Not answered”, why, and Send again' },
    ],
  },
  {
    key: 'C',
    short: 'C',
    name: 'Placeholder',
    beats: [
      { at: AT.show, what: 'The name, and “Thinking” shimmering as its first line' },
      { at: AT.count, what: 'Thinking · 3s' },
      { at: AT.slow, what: '“Longer than usual” and Stop' },
      { at: 'first', what: 'The words replace the line in place' },
      { at: 'fail', what: 'The line says what happened, and Send again' },
    ],
  },
  {
    key: 'D',
    short: 'D',
    name: 'Althar’s mark',
    beats: [
      { at: AT.show, what: 'Althar’s mark draws itself, then its point breathes' },
      { at: AT.count, what: 'The seconds join, after the mark' },
      { at: AT.slow, what: '“Longer than usual” and Stop' },
      { at: 'first', what: 'The mark gives way to the name; words stream' },
      { at: 'fail', what: 'The mark stills; what happened, and Send again' },
    ],
  },
  {
    key: 'E',
    short: 'E',
    name: 'Name at once',
    beats: [
      { at: AT.show, what: 'The reply’s name, with a breathing cobalt dot' },
      { at: AT.count, what: 'The seconds, where its time goes: 3s' },
      { at: AT.slow, what: '“Longer than usual” and Stop' },
      { at: 'first', what: 'The dot goes; words stream under the name, which never moves' },
      { at: 'fail', what: 'Under the name: what happened, and Send again' },
    ],
  },
]

export const directionOf = (key: Direction) => DIRECTIONS.find((one) => one.key === key) ?? DIRECTIONS[0]!

/** How long it took, as the thread counts: 4s, 1m 2s. */
export const seconds = (elapsed: number) => {
  const s = Math.max(0, Math.floor(elapsed))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}
