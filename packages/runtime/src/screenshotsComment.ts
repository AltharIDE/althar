import { BEFORE_SUFFIX, viewOfKey, type ScreenshotNow, type ScreenshotsOnChange } from '@althar/contracts'
import { Schema } from 'effect'

import { signed } from './pullRequestWords'

/*
 * The comment that shows a task's screenshots on its pull request
 * (ADR-077), and what Althar keeps of it: one comment, written anew as the
 * screenshots change, rather than a new one each time, so the conversation
 * isn't buried in pictures and the comment is always the one to read. What
 * a view it still shows looked like before stays in it, folded away under
 * the views as they are now. A hidden mark says which comment it is, so one whose record was lost
 * is found again rather than posted twice; and it is signed, as every
 * reply Althar posts is, so listening knows it as Althar's own.
 */

/** The mark at the top of the comment, which finds it again. */
export const SCREENSHOTS_MARK = '<!-- althar:screenshots -->'

/** How many earlier versions the comment keeps under the screenshots as they are now: the newest. */
export const EARLIER_KEPT = 24

/** A screenshot the comment shows: its view, what it is called, its picture by digest, where the host serves it, and the commit it was of. */
export const PostedShot = Schema.Struct({
  key: Schema.String,
  caption: Schema.String,
  digest: Schema.String,
  url: Schema.String,
  /** The pull request's head when it was posted; null where it wasn't known. */
  head: Schema.NullOr(Schema.String),
})
export type PostedShot = typeof PostedShot.Type

/** What Althar keeps of a pull request's screenshots, as its row holds it. */
export interface Kept {
  readonly commentId: string | null
  readonly commentUrl: string | null
  readonly shown: ReadonlyArray<PostedShot>
  readonly earlier: ReadonlyArray<PostedShot>
  readonly leftOut: ReadonlyArray<string>
  /** Every picture uploaded for it, by digest, to where the host serves it. */
  readonly uploads: Readonly<Record<string, string>>
  readonly postedAt: string | null
  readonly failed: string | null
  readonly updatedAt: string
}

/** A screenshot as it would go up: one that is kept, of a view not left out. */
export interface Posting {
  readonly key: string
  readonly caption: string
  readonly digest: string
  readonly name: string
  readonly mediaType: string
}

/** The screenshots as they are now that go up: those kept, of the views not left out, in Outputs' order. */
export const postingOf = (now: ReadonlyArray<ScreenshotNow>, leftOut: ReadonlyArray<string>): ReadonlyArray<Posting> =>
  now.flatMap((shot) =>
    shot.picture.digest === null || leftOut.includes(shot.key)
      ? []
      : [
          {
            key: shot.key,
            caption: shot.caption,
            digest: shot.picture.digest,
            name: shot.picture.name ?? `${shot.key.replace(/[^\w.-]+/g, '-')}${extensionOf(shot.picture.mediaType)}`,
            mediaType: shot.picture.mediaType,
          },
        ],
  )

const extensionOf = (mediaType: string) =>
  mediaType === 'image/jpeg' ? '.jpg' : mediaType === 'image/gif' ? '.gif' : mediaType === 'image/webp' ? '.webp' : '.png'

/**
 * How many screenshots differ between what would go up and what the comment
 * shows: a view taken again, one new, or one gone. Its order alone isn't a
 * change.
 */
export const changedBetween = (posting: ReadonlyArray<Pick<Posting, 'key' | 'digest'>>, shown: ReadonlyArray<PostedShot>): number => {
  const before = new Map(shown.map((shot) => [shot.key, shot.digest]))
  const now = new Set(posting.map((shot) => shot.key))
  const differ = posting.filter((shot) => before.get(shot.key) !== shot.digest).length
  const gone = shown.filter((shot) => !now.has(shot.key)).length
  return differ + gone
}

/**
 * Where a pull request's screenshots stand, for its card: none posted yet;
 * posted, and as Outputs shows them; or with so many changed since. Where
 * every screenshot is left out, or none is kept, there is nothing to post.
 */
export const standingOf = (now: ReadonlyArray<ScreenshotNow>, kept: Kept | undefined, synced: boolean): ScreenshotsOnChange => {
  const leftOut = kept?.leftOut ?? []
  const posting = postingOf(now, leftOut)
  const changed = kept === undefined || kept.commentId === null ? posting.length : changedBetween(posting, kept.shown)
  return {
    standing: kept === undefined || kept.commentId === null ? 'unposted' : changed === 0 ? 'posted' : 'changed',
    changed,
    synced,
    // Only the views Outputs still shows: one gone is nothing to leave out.
    leftOut: leftOut.filter((key) => now.some((shot) => shot.key === key)),
    commentUrl: kept?.commentUrl ?? null,
    failed: kept?.failed ?? null,
  }
}

/**
 * What the views the comment shows looked like before, newest first: a view
 * taken again keeps its earlier pictures, folded away. A view gone, as one
 * a later round replaced or an option, goes with all of them: it no longer
 * says anything of the change (ADR-079). At most EARLIER_KEPT.
 */
export const earlierAfter = (
  shown: ReadonlyArray<PostedShot>,
  earlier: ReadonlyArray<PostedShot>,
  posted: ReadonlyArray<PostedShot>,
): ReadonlyArray<PostedShot> => {
  const now = new Map(posted.map((shot) => [shot.key, shot.digest]))
  const replaced = shown.filter((shot) => now.get(shot.key) !== shot.digest)
  return [...replaced, ...earlier].filter((shot) => now.has(shot.key)).slice(0, EARLIER_KEPT)
}

/** A caption as text in the comment: nothing in it reads as markup. */
const plain = (text: string) =>
  text
    .replace(/[\\`*_[\]<>#|~]/g, (char) => `\\${char}`)
    .replace(/\s+/g, ' ')
    .trim()

/** A caption in an attribute: quotes and angle brackets as entities. */
const attribute = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\s+/g, ' ').trim()

const short = (head: string | null) => (head === null ? null : head.slice(0, 7))

/** How wide a screenshot shows in the comment, at most: its own width where it is narrower, as a host draws it. */
const SHOWN_WIDTH = 720

const pictureOf = (shot: PostedShot, width = SHOWN_WIDTH) =>
  `<img src="${attribute(shot.url)}" alt="${attribute(shot.caption)}" width="${width}">`

/** How wide each picture of a Before | After table shows, so the two fit side by side. */
const PAIRED_WIDTH = 356

const isBefore = (shot: PostedShot) => shot.key.endsWith(BEFORE_SUFFIX)

/** A divider between screenshots: a rule, which both hosts draw in light and dark. */
const DIVIDER = '---'

/** A screenshot or a pair, as one block: a small heading, then the picture or the table. */
type Block = { readonly heading: string; readonly body: string }

/**
 * The screenshots as blocks, in order: a view with a before and a picture
 * now is a Before | After table, at the place of whichever comes first; any
 * other, a picture of its own. A before whose view has no picture now
 * shows alone, marked as the before. `note` adds to a heading, as where
 * the picture was taken.
 */
const blocksOf = (shots: ReadonlyArray<PostedShot>, note: (shot: PostedShot) => string): ReadonlyArray<Block> => {
  const blocks: Array<Block> = []
  const done = new Set<PostedShot>()
  for (const shot of shots) {
    if (done.has(shot)) continue
    done.add(shot)
    const view = viewOfKey(shot.key)
    const other = shots.find(
      (candidate) => !done.has(candidate) && viewOfKey(candidate.key) === view && isBefore(candidate) !== isBefore(shot),
    )
    if (other === undefined) {
      const label = isBefore(shot) ? ' · Before' : ''
      blocks.push({ heading: `${plain(shot.caption)}${label}${note(shot)}`, body: pictureOf(shot) })
      continue
    }
    done.add(other)
    const [before, after] = isBefore(shot) ? [shot, other] : [other, shot]
    blocks.push({
      heading: `${plain(after.caption)}${note(after)}`,
      body: `| Before | After |\n| :---: | :---: |\n| ${pictureOf(before, PAIRED_WIDTH)} | ${pictureOf(after, PAIRED_WIDTH)} |`,
    })
  }
  return blocks
}

const joined = (blocks: ReadonlyArray<Block>) => blocks.map((block) => `#### ${block.heading}\n\n${block.body}`).join(`\n\n${DIVIDER}\n\n`)

/**
 * The comment: the screenshots as they are now, each under its caption (a
 * view with a before, as a Before | After table), set apart by dividers, and
 * the commit they are of; then what they showed before, folded away; signed.
 */
/** What the comment says once none of the views it showed shows the change as it is now. */
export const NONE_NOW = 'No screenshots show this change as it is now.'

export const commentBody = (input: {
  readonly shown: ReadonlyArray<PostedShot>
  readonly earlier: ReadonlyArray<PostedShot>
  readonly head: string | null
}): string => {
  const of = short(input.head)
  const parts: Array<string> = [SCREENSHOTS_MARK, of === null ? '**Screenshots**' : `**Screenshots** as of \`${of}\``]
  if (input.shown.length > 0) parts.push(joined(blocksOf(input.shown, () => '')))
  // The views it showed no longer say anything of the change: it says so, rather than keep them.
  else parts.push(NONE_NOW)
  if (input.earlier.length > 0) {
    // Each earlier picture on its own, with the commit it was taken at.
    const earlier = joined(
      input.earlier.flatMap((shot) =>
        blocksOf([shot], (one) => {
          const before = short(one.head)
          return before === null ? '' : `, at \`${before}\``
        }),
      ),
    )
    parts.push(`<details>\n<summary>Earlier screenshots (${input.earlier.length})</summary>\n\n${earlier}\n\n</details>`)
  }
  return signed(parts.join('\n\n'), null)
}

/** The line that tells reviewers the screenshots changed after they reviewed: how many, and where. */
export const updatedNote = (changed: number, commentUrl: string | null) =>
  signed(
    `Screenshots updated: ${changed === 1 ? 'one changed' : `${changed} changed`}.${commentUrl === null ? '' : ` [See them](${commentUrl}).`}`,
    null,
  )

/** Whether a comment is the one that shows a task's screenshots, by its mark. */
export const isScreenshotsComment = (body: string) => body.trimStart().startsWith(SCREENSHOTS_MARK)
