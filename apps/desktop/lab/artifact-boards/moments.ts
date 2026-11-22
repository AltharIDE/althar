import { GIFT } from './artifacts'
import { chat } from './chat'
import { live, type Pin, type Spot } from './live'
import { EVERY_PAGE, type Opening } from './parts/ArtifactCanvas'
import type { Direction } from './state'

/*
 * Where each direction's moments start: what is open, what was said on the
 * boards before, and what landed. Everything after is live.
 */

const on = (part: string, label: string, board = 'a'): Spot => ({
  artifactId: GIFT,
  boardId: board,
  selector: `[data-part="${part}"]`,
  label,
  box: { x: 0, y: 0, width: 0, height: 0 },
  part,
})

const AMOUNTS_NOTE = 'The amounts are presents now: each on a card of its own, with a pot in its class’s colour and what it buys in a line.'
const CARD_NOTE = 'The card is on the studio’s paper, in its clay, with Sam’s note in their own hand.'

const SAM: Pin = {
  id: 'pin-sam',
  spot: on('card', 'The card'),
  who: 'Sam',
  lines: [{ who: 'you', text: 'This reads like a voucher, not a present.' }],
  state: 'comment',
}
const LEE: Pin = {
  id: 'pin-lee',
  spot: on('title', 'The heading'),
  who: 'Lee',
  lines: [{ who: 'you', text: 'Could the heading say who it’s for? “Give Jo a class.”' }],
  state: 'comment',
}
const AMOUNTS: Pin = {
  id: 'pin-amounts',
  spot: on('amounts', 'The amounts'),
  who: 'you',
  lines: [
    { who: 'you', text: 'They still look like a form. Make them feel like presents.' },
    { who: 'lead', text: `**v5.** ${AMOUNTS_NOTE}`, version: 5 },
  ],
  state: 'changed',
  version: 5,
}

/** What a moment starts with, on the canvas and in the conversation. */
export const seed = (d: Direction, m: number) => {
  chat.reset(momentOf(d, m).open ?? null)
  if (d === 'd') {
    const warmed = m >= 1
    live.reset({
      versions: { [GIFT]: warmed ? 6 : 5 },
      landed: {
        [`${GIFT}/a`]: [
          { look: { amounts: 'presents' }, version: 5, note: AMOUNTS_NOTE },
          ...(warmed ? [{ look: { card: 'warm' }, version: 6, note: CARD_NOTE }] : []),
        ],
      },
      pins: [
        AMOUNTS,
        warmed
          ? {
              ...SAM,
              lines: [...SAM.lines, { who: 'you', text: 'Agreed. Warm it up?' }, { who: 'lead', text: `**v6.** ${CARD_NOTE}`, version: 6 }],
              state: 'changed',
              version: 6,
            }
          : SAM,
        LEE,
      ],
      lines: [
        { who: 'lead', text: `**v5** of Gift a class, from a pin on the amounts: ${AMOUNTS_NOTE.replace(/^The/, 'the')}`, version: 5 },
        ...(warmed
          ? [
              {
                who: 'lead' as const,
                text: `**v6** of Gift a class, from Sam’s pin on the card: ${CARD_NOTE.replace(/^The/, 'the')}`,
                version: 6,
              },
            ]
          : []),
      ],
    })
    return
  }
  // Elsewhere, people's comments are pins on the boards: Sam's on the card. Where Share opens, Gift a class is shared with kiln already.
  live.reset({ pins: [SAM], ...(momentOf(d, m).share === true ? { reach: { [GIFT]: 'shared' as const } } : {}) })
}

export interface Moment {
  readonly opening: Opening
  /** The artifact switcher open in the panel's head (A). */
  readonly switcher?: boolean
  readonly share?: boolean
  /** The artifact open in its room (B), or none: the gallery, the wall. */
  readonly open?: string | null
  /** The page as someone it was shared with sees it (D). */
  readonly guest?: boolean
  /** Where it lives open in the head, a repository chosen. */
  readonly keep?: 'althar' | 'repo'
}

export const momentOf = (d: Direction, m: number): Moment => {
  const every: Opening = { page: 'directions', view: 'every' }
  const one: Opening = { page: 'directions', view: 'one', focus: 'a' }
  if (d === 'a')
    return m === 1
      ? { opening: { ...one, aim: { board: 'a', selector: '[data-part="amounts"]' } } }
      : m === 2
        ? { opening: every, switcher: true }
        : m === 3
          ? { opening: every, share: true }
          : m === 4
            ? { opening: every, keep: 'repo' }
            : { opening: every }
  if (d === 'b') return m === 0 ? { opening: every, open: null } : { opening: every, open: GIFT, share: m === 2 }
  // A lot of work in one artifact: every page at once, a row each, beside the conversation or in its room.
  if (d === 'c') return { opening: { page: EVERY_PAGE, view: 'every' }, open: m === 1 ? GIFT : null }
  return m === 1 ? { opening: { ...one, pin: 'pin-sam' } } : m === 2 ? { opening: one, guest: true } : { opening: one }
}
