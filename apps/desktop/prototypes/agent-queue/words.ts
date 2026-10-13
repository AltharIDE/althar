import type { Direction, InLine } from './scene'

/*
 * What each direction says of work waiting for a free agent, wherever the
 * app says it: its row up next, its card where it stays running, its dock,
 * its task's header and card in the conversation, and its project's line on
 * the home.
 */

export const directions: ReadonlyArray<{ readonly key: Exclude<Direction, 'today'>; readonly name: string; readonly gist: string }> = [
  {
    key: 'a',
    name: 'A · Up next, under “Starts when an agent is free”',
    gist: 'Waiting work moves to Up next, first, under one small divider that says it starts by itself. Each row says only its place: “1st in line”, “2nd in line”. Work already under way that waits for its next turn joins the same line, marked “Under way”. Nothing about the Mac on the cards.',
  },
  {
    key: 'b',
    name: 'B · Up next, a quiet line on each card',
    gist: 'Waiting work moves to Up next. Each row says “Next in line”, “2nd in line”, and nothing else; pointing at it says why (every agent on this Mac is busy) and that it starts by itself. The dock and the task’s header say the same in full.',
  },
  {
    key: 'c',
    name: 'C · Up next with a strip of agents; cards say “Queued”',
    gist: 'Up next opens with a small strip: a dot for each agent this Mac runs at once, filled while it works. Waiting rows just say “Queued”, in order; the strip says why. When a dot frees, the first row moves to Running.',
  },
  {
    key: 'd',
    name: 'D · Not started: Up next. Under way: stays in Running, paused',
    gist: 'What hasn’t started waits in Up next, “Starts when an agent is free”. Work already under way whose next turn waits stays in Running, so it doesn’t jump lanes for a short wait, but goes quiet: muted, “Paused for a free agent”.',
  },
  {
    key: 'e',
    name: 'E · Mine: A’s divider, B’s words, D’s split',
    gist: 'Up next holds what hasn’t started, under “Starts when an agent is free”, each row “Next in line”, “2nd in line”. Work under way that waits for a turn stays in Running, muted, with its place: “2nd in line · Carries on when an agent is free”. One word for it everywhere: in line.',
  },
]

export const ordinal = (n: number) =>
  n % 10 === 1 && n !== 11 ? `${n}st` : n % 10 === 2 && n !== 12 ? `${n}nd` : n % 10 === 3 && n !== 13 ? `${n}rd` : `${n}th`

/** Its place, the first said as the next. */
const nextIn = (n: number) => (n === 1 ? 'Next in line' : `${ordinal(n)} in line`)

/** Whether waiting work goes up next in this direction, or stays running. */
export const upNext = (q: InLine) => q.direction !== 'today' && !(q.started && (q.direction === 'd' || q.direction === 'e'))

/** The divider over the waiting work up next, where the direction has one. */
export const dividerOf = (direction: Direction): string | null =>
  direction === 'a' || direction === 'e' ? 'Starts when an agent is free' : null

/** A row up next: what it says, a word on its top line, and what pointing at it says. */
export const rowOf = (q: InLine): { readonly reason: string; readonly kind?: string; readonly tip?: string } => {
  const under = q.started ? { kind: `Under way · ${q.step}` } : {}
  switch (q.direction) {
    case 'a':
      return { reason: `${ordinal(q.place)} in line`, ...under }
    case 'b':
      return {
        reason: nextIn(q.place),
        ...under,
        tip: `All ${q.atOnce} agents on this Mac are busy. It ${q.started ? 'carries on' : 'starts'} by itself when one is free.`,
      }
    case 'c':
      return { reason: 'Queued', ...under }
    case 'd':
      return { reason: 'Starts when an agent is free' }
    default:
      return { reason: nextIn(q.place) }
  }
}

/** A running card for work under way whose turn waits (D, E): its status word and its line. */
export const pausedOf = (q: InLine): { readonly status: string; readonly note: string } =>
  q.direction === 'd'
    ? { status: 'Paused', note: 'Paused for a free agent' }
    : { status: nextIn(q.place), note: 'Carries on when an agent is free' }

/** What its dock, its task's header and its card in the conversation say. */
export const fullOf = (q: InLine): string => {
  const then = q.started ? 'carries on when an agent is free' : 'starts when an agent is free'
  switch (q.direction) {
    case 'a':
      return `${ordinal(q.place)} in line · ${then}`
    case 'b':
      return `${nextIn(q.place)} · all ${q.atOnce} agents on this Mac are busy`
    case 'c':
      return `Queued · ${then}`
    case 'd':
      return q.started ? 'Paused for a free agent · carries on by itself' : `Starts when an agent is free · ${ordinal(q.place)} in line`
    default:
      return `${nextIn(q.place)} · ${then}`
  }
}

/** Its project's line on the home: how many wait. */
export const homeOf = (n: number, q: InLine): string => {
  switch (q.direction) {
    case 'b':
      return `${n} in line`
    case 'c':
      return `${n} queued`
    case 'd':
      return [(q.fresh ?? 0) > 0 && `${q.fresh} up next`, (q.under ?? 0) > 0 && `${q.under} paused for an agent`]
        .filter(Boolean)
        .join(' · ')
    default:
      return `${n} in line for an agent`
  }
}

/** The lane its dock names: where the board shows it. */
export const laneOf = (q: InLine) => (upNext(q) ? 'Up next' : 'Running')

/** C's strip: how many agents are at work of how many this Mac runs at once. */
export const stripOf = (busy: number, atOnce: number) =>
  busy >= atOnce ? `All ${atOnce} agents at work` : `${atOnce - busy} of ${atOnce} agents free`
