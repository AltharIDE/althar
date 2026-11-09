import { useSyncExternalStore } from 'react'

import type { CommentFact, ComposerComment } from '@althar/ui'

import { DEVICES, type Viewport } from '../../main/browser/devices'
import type { Picked } from '../../main/browser/picked'
import { shownAddress } from '../../main/browser/addresses'
import { elementLine, onLine, selectorLine, sized, sizeLine } from '../../main/browser/elementWords'
import type { Picture, SentImage } from '@althar/contracts'
import { pictureOf, type ReadImage, readImage, remember, type Shrink, sentOf, shrinkInWindow } from './images'

/*
 * Comments gathered for a conversation's agent (ADR-100): what the person
 * says about something beside the conversation, made where it is and
 * waiting in the composer, to go with what they write next. Today a spot on
 * a page beside the conversation, pointed at, with a crop of it; a line of
 * the diff would be another kind of the same (DEV-175), gathered and sent
 * the same way. Kept by the thread's draft, as its images are, for the
 * window's life. Sent, the person's words go first, then each comment with
 * what it is on, and its crop goes as a picture after their own.
 */

/** A spot on a page beside the conversation, as the person pointed at it. */
export interface PageSpot {
  readonly kind: 'page'
  readonly picked: Picked
  readonly address: string
  readonly viewport: Viewport
}

/** What a comment is on. A line of the diff is to come (DEV-175). */
export type CommentOn = PageSpot

export interface GatheredComment {
  readonly id: string
  readonly note: string
  readonly on: CommentOn
  /** The crop of the spot, read as an image to send; null where none of it showed. */
  readonly crop: ReadImage | null
}

const gathered = new Map<string, ReadonlyArray<GatheredComment>>()
const listeners = new Map<string, Set<() => void>>()
const NONE: ReadonlyArray<GatheredComment> = []

const changed = (key: string, next: ReadonlyArray<GatheredComment>) => {
  if (next.length === 0) gathered.delete(key)
  else gathered.set(key, next)
  for (const listener of listeners.get(key) ?? []) listener()
}

/** The comments waiting in a draft, in the order they were made. */
export const commentsOf = (key: string): ReadonlyArray<GatheredComment> => gathered.get(key) ?? NONE

/** Adds a comment to a draft, last; its number is its place. */
export const gather = (key: string, comment: GatheredComment) => changed(key, [...commentsOf(key), comment])

/** Changes what a comment says, or the spot it is on where it was found again. */
export const rewrite = (key: string, id: string, note: string, again?: Pick<GatheredComment, 'on' | 'crop'>) =>
  changed(
    key,
    commentsOf(key).map((one) => (one.id === id ? { ...one, note, ...again } : one)),
  )

/** Takes a comment off; those after it move up a number. */
export const drop = (key: string, id: string) =>
  changed(
    key,
    commentsOf(key).filter((one) => one.id !== id),
  )

/** Takes every comment off a draft, as its message is sent; and puts them back, first, where Althar didn't take it. */
export const takeAll = (key: string): ReadonlyArray<GatheredComment> => {
  const taken = commentsOf(key)
  changed(key, [])
  return taken
}
export const giveBack = (key: string, comments: ReadonlyArray<GatheredComment>) => changed(key, [...comments, ...commentsOf(key)])

/** Forgets every draft's comments: for tests. */
export const forgetComments = () => {
  // A Map may lose the key it is on while it is gone through.
  for (const key of gathered.keys()) changed(key, [])
}

/** The comments waiting in a draft, as they change. */
export const useComments = (key: string): ReadonlyArray<GatheredComment> =>
  useSyncExternalStore(
    (listener) => {
      const set = listeners.get(key) ?? new Set()
      set.add(listener)
      listeners.set(key, set)
      return () => void set.delete(listener)
    },
    () => commentsOf(key),
  )

/** A picture's bytes from its data address: decoded here, as the window's policy lets it fetch nothing, a data address included. */
const bytesOf = (dataUrl: string): Uint8Array | null => {
  const found = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (found === null) return null
  const binary = atob(found[1] ?? '')
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Reads a crop the main process drew, as an image to send: smaller where it is large, as any image is. */
export const cropOf = async (dataUrl: string | null, n: number, shrink: Shrink = shrinkInWindow): Promise<ReadImage | null> => {
  const bytes = dataUrl === null ? null : bytesOf(dataUrl)
  if (bytes === null) return null
  const read = await readImage(new File([new Uint8Array(bytes)], `comment-${n}.png`, { type: 'image/png' }), shrink)
  return read.ok ? read.image : null
}

export const text = {
  element: 'Element',
  text: 'Text',
  size: 'Size',
  font: 'Font',
  colour: 'Colour',
  background: 'Background',
  page: 'Page',
  selector: 'Selector',
  sized,
  at: (address: string, size: string) => `${address} at ${size}`,
  /** What the lead reads before them. */
  heading: (count: number) => (count === 1 ? 'A comment on a page:' : `${count} comments on pages:`),
  on: onLine,
  selectorLine,
  pageLine: (address: string, size: string, device: string | null) => `Page: ${address} at ${size}${device === null ? '' : ` (${device})`}`,
  pictureLine: (n: number) => `Picture ${n} of those attached.`,
  devices: { desktop: 'desktop', laptop: 'laptop', tablet: 'tablet', phone: 'phone' } as Readonly<Record<Exclude<Viewport, 'fit'>, string>>,
} as const

const sizeOf = (spot: PageSpot) => sizeLine(spot.picked)
const pageSize = (spot: PageSpot) => {
  const device = spot.viewport === 'fit' ? null : DEVICES[spot.viewport]
  return device === null ? text.sized(spot.picked.page.width, spot.picked.page.height) : text.sized(device.width, device.height)
}

/** A comment as its chip and card show it in the composer: its number is its place. */
export const composerComment = (comment: GatheredComment, n: number): ComposerComment => {
  const { picked } = comment.on
  const facts: Array<CommentFact> = [
    { label: text.element, value: picked.label, kind: 'code' },
    ...(picked.text === '' ? [] : [{ label: text.text, value: picked.text, kind: 'quote' as const }]),
    { label: text.size, value: sizeOf(comment.on) },
    { label: text.font, value: picked.font },
    { label: text.colour, value: picked.colour, kind: 'colour' },
    { label: text.background, value: picked.background, kind: 'colour' },
    { label: text.page, value: text.at(shownAddress(comment.on.address), pageSize(comment.on)) },
    { label: text.selector, value: picked.selector, kind: 'code' },
  ]
  return {
    id: comment.id,
    n,
    note: comment.note,
    place: picked.label,
    ...(comment.crop === null || comment.crop.width === null || comment.crop.height === null
      ? {}
      : { crop: { src: comment.crop.src, width: comment.crop.width, height: comment.crop.height } }),
    facts,
  }
}

/**
 * What the agent reads of the comments, after the person's own words: each
 * with what it is on (its element and words, its size, its selector), the
 * page and the size it was at, and which picture is its crop, counted
 * after `before` pictures of the person's own; none where pictures don't go.
 */
export const commentsText = (comments: ReadonlyArray<GatheredComment>, before: number, pictures: boolean): string => {
  let picture = before
  const each = comments.map((comment, index) => {
    const spot = comment.on
    const device = spot.viewport === 'fit' ? null : text.devices[spot.viewport]
    const lines = [
      `${index + 1}. ${comment.note.replace(/\n/g, '\n   ')}`,
      `   - ${elementLine(spot.picked)}`,
      `   - ${selectorLine(spot.picked.selector)}`,
      `   - ${text.pageLine(spot.address, pageSize(spot), device)}`,
    ]
    if (pictures && comment.crop !== null) {
      picture += 1
      lines.push(`   - ${text.pictureLine(picture)}`)
    }
    return lines.join('\n')
  })
  return [text.heading(comments.length), ...each].join('\n\n')
}

/** The person's words, then the comments: what the message says. */
export const withComments = (words: string, comments: ReadonlyArray<GatheredComment>, before: number, pictures: boolean): string =>
  comments.length === 0 ? words : [words.trim(), commentsText(comments, before, pictures)].filter((part) => part !== '').join('\n\n')

/** The comments' crops, as the message sends them after the person's own pictures, and as its window copy shows them. */
export const cropsOf = (
  comments: ReadonlyArray<GatheredComment>,
): { readonly sent: ReadonlyArray<SentImage>; readonly pictures: ReadonlyArray<Picture> } => {
  const crops = comments.flatMap((comment) => (comment.crop === null ? [] : [comment.crop]))
  for (const crop of crops) remember(crop.digest, crop.src)
  return {
    sent: crops.map((crop) => sentOf({ data: crop.data, digest: crop.digest, name: crop.name })),
    pictures: crops.map(pictureOf),
  }
}
