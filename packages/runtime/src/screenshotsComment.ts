import type { ScreenshotNow, ScreenshotsOnChange } from '@althar/contracts'
import { Schema } from 'effect'

import { signed } from './pullRequestWords'

/*
 * The comment that shows a task's screenshots on its pull request
 * (ADR-077), and what Althar keeps of it: one comment, written anew as the
 * screenshots change, rather than a new one each time, so the conversation
 * isn't buried in pictures and the comment is always the one to read. What
 * a view showed before stays in it, folded away under the views as they are
 * now. A hidden mark says which comment it is, so one whose record was lost
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
 * What the comment showed that it no longer does, newest first, before what
 * it kept from earlier: a view taken again, or gone. At most EARLIER_KEPT.
 */
export const earlierAfter = (
  shown: ReadonlyArray<PostedShot>,
  earlier: ReadonlyArray<PostedShot>,
  posted: ReadonlyArray<PostedShot>,
): ReadonlyArray<PostedShot> => {
  const now = new Map(posted.map((shot) => [shot.key, shot.digest]))
  const replaced = shown.filter((shot) => now.get(shot.key) !== shot.digest)
  return [...replaced, ...earlier].slice(0, EARLIER_KEPT)
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

const pictureOf = (shot: PostedShot) => `<img src="${attribute(shot.url)}" alt="${attribute(shot.caption)}" width="${SHOWN_WIDTH}">`

/**
 * The comment: the screenshots as they are now, each under its caption, and
 * the commit they are of; then what they showed before, folded away; signed.
 */
export const commentBody = (input: {
  readonly shown: ReadonlyArray<PostedShot>
  readonly earlier: ReadonlyArray<PostedShot>
  readonly head: string | null
}): string => {
  const of = short(input.head)
  const parts: Array<string> = [SCREENSHOTS_MARK, of === null ? '**Screenshots**' : `**Screenshots** as of \`${of}\``]
  for (const shot of input.shown) parts.push(`${plain(shot.caption)}\n\n${pictureOf(shot)}`)
  if (input.earlier.length > 0) {
    const earlier = input.earlier.map((shot) => {
      const before = short(shot.head)
      return `${plain(shot.caption)}${before === null ? '' : `, at \`${before}\``}\n\n${pictureOf(shot)}`
    })
    parts.push(`<details>\n<summary>Earlier screenshots (${input.earlier.length})</summary>\n\n${earlier.join('\n\n')}\n\n</details>`)
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
