import { screenshotsNow, type ThreadItem, type ThreadSnapshot } from '@althar/contracts'
import type { EvidencePiece, GalleryShot } from '@althar/ui'

import { pieceOf, piecesOf } from './evidence'

/*
 * What a task came to, as its Outputs page tells it. What it is, in the
 * words its pull request says it: the description its lead last wrote for
 * it, else what the lead last said it built, else its last summary, with the
 * part that says what it is apart from the rest. A change in several
 * repositories is one task with a pull request in each: what it built says
 * what it is, and each description follows under its repository's name. How it looks now: the
 * pictures of its last state, each view once, as last taken. A change shows
 * those since it became one, so a prototype's rounds before don't count; any
 * other task, its last round that showed pictures and those after: as
 * `screenshotsNow` works them out, which the runtime posts to its pull
 * request by too (ADR-076). And what its lead last checked of it, and what
 * it couldn't.
 */

type Report = Extract<ThreadItem, { kind: 'step_result' }>

export interface Outcome {
  /** What it is: its first paragraph, which says so, and the rest after it; null where its lead said nothing. */
  readonly story: { readonly lede: string; readonly rest: string } | null
  /** Each with its view's key, by which it is left out of a pull request's comment. */
  readonly shots: ReadonlyArray<GalleryShot & { readonly key: string }>
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

  // Each repository's description as its lead last gave it, in the order they were first given.
  const described = new Map<string, string>()
  for (const item of lead) for (const [slug, given] of Object.entries(item.content.descriptions ?? {})) described.set(slug, given)
  const whole = lead.findLast((item) => item.content.built !== null)?.content.built ?? lead.at(-1)?.content.summary ?? null
  const [one] = described.values()
  const story =
    described.size > 1
      ? {
          lede: splitStory(whole ?? one ?? '').lede,
          rest: [...described].map(([slug, given]) => `# ${slug}\n\n${given.trim()}`).join('\n\n'),
        }
      : (one ?? whole) === null
        ? null
        : splitStory(one ?? whole ?? '')

  const rounds = lead.map((item) => piecesOf(item.id, item.content.evidence).filter((piece) => piece.form !== 'picture'))
  const now = screenshotsNow(
    lead.map((item) => ({ id: item.id, sequence: item.sequence, createdAt: item.createdAt, evidence: item.content.evidence })),
    { change: task.kind === 'change' || task.changes.length > 0, since: task.madeChangeAt ?? null },
  )
  return {
    story,
    // Full size, each is called by what it shows.
    shots: now.flatMap((one): Array<GalleryShot & { readonly key: string }> => {
      const piece = pieceOf(
        { kind: 'screenshot', caption: one.caption, picture: one.picture, command: null, exit: null, text: null, dropped: 0 },
        one.id,
      )
      return piece.form === 'picture' ? [{ ...piece.shot, id: one.id, key: one.key, caption: one.caption, label: one.caption }] : []
    }),
    checked: rounds.findLast((rest) => rest.length > 0) ?? [],
    // The last list it said, even empty: what an earlier step couldn't show, a later one may have.
    unverified: [...(lead.findLast((item) => item.content.unverified !== null)?.content.unverified ?? [])],
  }
}

/** Whether it has anything to show for itself: something it said it is, or pictures. */
export const hasOutcome = (outcome: Outcome) => outcome.story !== null || outcome.shots.length > 0
