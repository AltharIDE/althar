import type { ThreadItem, ThreadSnapshot } from '@althar/contracts'
import { type EvidencePiece, type GalleryShot, shotName } from '@althar/ui'

import { piecesOf } from './evidence'

/*
 * What a task came to, as its Outputs page tells it. What it is, in the
 * words its pull request says it: the description its lead wrote for it,
 * else what the lead last said it built, else its last summary, with the
 * part that says what it is apart from the rest. How it looks now: the
 * pictures of its last state, each view once, as last taken. A change shows
 * those since it became one, so a prototype's rounds before don't count; any
 * other task, its last round that showed pictures and those after. And what
 * its lead last checked of it, and what it couldn't.
 */

type Report = Extract<ThreadItem, { kind: 'step_result' }>

export interface Outcome {
  /** What it is: its first paragraph, which says so, and the rest after it; null where its lead said nothing. */
  readonly story: { readonly lede: string; readonly rest: string } | null
  readonly shots: ReadonlyArray<GalleryShot>
  /** What the last round that ran anything showed of it working, other than pictures. */
  readonly checked: ReadonlyArray<EvidencePiece>
  readonly unverified: ReadonlyArray<string>
}

/** Its first paragraph, and the rest. A first paragraph that runs long gives its first sentences, the rest following them. */
export const splitStory = (text: string): { readonly lede: string; readonly rest: string } => {
  const parts = text.trim().split(/\n\s*\n/)
  // A heading over it says what part it is, not what it is.
  const at = parts.findIndex((part) => !/^\s*#{1,6}\s/.test(part))
  const first = parts[at] ?? ''
  const rest = parts.filter((_, index) => index !== at)
  // A list from the start: its first item says what it is.
  if (/^\s*[-*] /.test(first)) {
    const [head = '', ...lines] = first.split('\n')
    return { lede: head.replace(/^\s*[-*] /, ''), rest: [lines.join('\n'), ...rest].join('\n\n').trim() }
  }
  if (first.length > LONG) {
    const sentences = first.split(/(?<=[.!?])\s+(?=[A-Z“"(])/)
    let lede = sentences.shift() ?? ''
    while (sentences.length > 0 && lede.length + (sentences[0]?.length ?? 0) < LEDE) lede = `${lede} ${sentences.shift() ?? ''}`
    return { lede, rest: [sentences.join(' '), ...rest].join('\n\n').trim() }
  }
  return { lede: first, rest: rest.join('\n\n').trim() }
}

/** Past this, a first paragraph is cut after a few sentences: about what three lines hold. */
const LONG = 320
const LEDE = 260

export const outcomeOf = (snapshot: ThreadSnapshot): Outcome => {
  const { task } = snapshot
  // The lead's reports, whatever page they're on, and any that came since.
  const byId = new Map([...snapshot.reports, ...snapshot.items].map((item) => [item.id, item]))
  const lead = [...byId.values()]
    .filter((item): item is Report => item.kind === 'step_result' && (item.content.step === 'implement' || item.content.step === 'settle'))
    .sort((one, other) => one.sequence - other.sequence)

  const described = lead.findLast((item) => item.content.descriptions !== undefined)?.content.descriptions
  const text =
    (described === undefined ? undefined : Object.values(described)[0]) ??
    lead.findLast((item) => item.content.built !== null)?.content.built ??
    lead.at(-1)?.content.summary ??
    null

  const rounds = lead.map((item) => {
    const pieces = piecesOf(item.id, item.content.evidence)
    return {
      at: item.createdAt,
      // Full size, it is called by what it shows.
      shots: pieces.flatMap((piece): GalleryShot[] =>
        piece.form === 'picture' ? [{ ...piece.shot, id: piece.id, caption: piece.caption, label: piece.caption }] : [],
      ),
      rest: pieces.filter((piece) => piece.form !== 'picture'),
    }
  })
  const made = task.madeChangeAt ?? null
  const lastShown = rounds.findLastIndex((round) => round.shots.length > 0)
  const now =
    task.kind === 'change' || task.changes.length > 0
      ? rounds.filter((round) => made === null || round.at >= made)
      : lastShown === -1
        ? []
        : rounds.slice(lastShown)
  // A view taken again shows once, where it was last taken; a picture with no name is its own view.
  const latest = new Map<string, string>()
  for (const round of now) for (const shot of round.shots) latest.set(shotName(shot.caption) ?? shot.id, shot.id)
  return {
    story: text === null ? null : splitStory(text),
    shots: now.flatMap((round) => round.shots.filter((shot) => latest.get(shotName(shot.caption) ?? shot.id) === shot.id)),
    checked: rounds.findLast((round) => round.rest.length > 0)?.rest ?? [],
    // The last list it said, even empty: what an earlier step couldn't show, a later one may have.
    unverified: [...(lead.findLast((item) => item.content.unverified !== null)?.content.unverified ?? [])],
  }
}

/** Whether it has anything to show for itself: something it said it is, or pictures. */
export const hasOutcome = (outcome: Outcome) => outcome.story !== null || outcome.shots.length > 0
