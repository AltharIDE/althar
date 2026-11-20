import { Schema } from 'effect'
import { useCallback, useEffect, useSyncExternalStore } from 'react'

import { lineCommentsText, type CommentFact, type ComposerComment } from '@althar/ui'

import { DEVICES, isViewport, type Viewport } from '../../main/browser/devices'
import { pickedOf, type Picked } from '../../main/browser/picked'
import { shownAddress } from '../../main/browser/addresses'
import { elementLine, onLine, selectorLine, sized, sizeLine } from '../../main/browser/elementWords'
import { CanvasAnchor, LINE_COMMENTS, LineComment, type Picture, type SentCanvasComment, type SentImage } from '@althar/contracts'
import { draftCrop } from './draftCrops'
import { pictureOf, type ReadImage, readImage, remember, type Shrink, sentOf, shrinkInWindow } from './images'

/*
 * Comments waiting in a thread's composer. The window keeps their facts
 * with the draft and keeps crop bytes in its own IndexedDB. Only an explicit
 * send brings any of this to the runtime.
 */

/** A spot on a page beside the conversation, as the person pointed at it. */
export interface PageSpot {
  readonly kind: 'page'
  readonly picked: Picked
  readonly address: string
  readonly viewport: Viewport
}

/** A spot on one of the project's canvases (ADR-104): a version, and where in it: the whole canvas, or the words selected. */
export interface CanvasSpot {
  readonly kind: 'canvas'
  readonly canvasId: string
  readonly name: string
  readonly title: string
  readonly version: number
  readonly anchor: CanvasAnchor
}

export interface DiffSpot {
  readonly kind: 'diff'
  readonly line: Omit<LineComment, 'note'>
}

/** What the person pointed at when writing a comment. */
export type CommentOn = PageSpot | CanvasSpot | DiffSpot

/** Where a comment on a canvas points, in a few words: the whole canvas, or the words it is on. */
export const canvasPlace = (anchor: CanvasAnchor): string => {
  switch (anchor.kind) {
    case 'whole':
      return text.wholeCanvas
    case 'passage':
      return `“${anchor.text}”`
    case 'area':
      return text.area
    case 'element':
      return anchor.label
  }
}

/** The comments on canvases among a draft's, as the message sends them for the runtime to keep with it (ADR-104). */
export const canvasCommentsOf = (comments: ReadonlyArray<GatheredComment>): ReadonlyArray<SentCanvasComment> =>
  comments.flatMap((comment) =>
    comment.on.kind === 'canvas' && comment.earlier !== true
      ? [{ canvasId: comment.on.canvasId, version: comment.on.version, anchor: comment.on.anchor, body: comment.note }]
      : [],
  )

/** The comments on pages among a draft's: what a page draws pins for. */
export const pageCommentsOf = (comments: ReadonlyArray<GatheredComment>): ReadonlyArray<GatheredComment & { readonly on: PageSpot }> =>
  comments.flatMap((comment) => (comment.on.kind === 'page' ? [comment as GatheredComment & { readonly on: PageSpot }] : []))

export interface GatheredComment {
  readonly id: string
  readonly note: string
  readonly on: CommentOn
  readonly crop: ReadImage | null
  readonly cropId?: string
  readonly cropLost?: boolean
  readonly earlier?: boolean
}

export type DiffDraft = GatheredComment & { readonly on: DiffSpot }
export const isDiffDraft = (comment: GatheredComment): comment is DiffDraft => comment.on.kind === 'diff'
export const toLineComment = (comment: DiffDraft): LineComment => ({ ...comment.on.line, note: comment.note })

interface ThreadComments {
  all: ReadonlyArray<GatheredComment>
  shown: ReadonlyArray<GatheredComment>
  readonly sending: Set<string>
  readonly reading: Set<string>
}

const prefix = 'althar.drafts.comments:'
const threads = new Map<string, ThreadComments>()
const listeners = new Map<string, Set<() => void>>()
const NONE: ReadonlyArray<GatheredComment> = []

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const anchorOf = Schema.decodeUnknownOption(CanvasAnchor)
const lineOf = Schema.decodeUnknownOption(LineComment)

const restore = (value: unknown): GatheredComment | null => {
  if (!record(value) || typeof value.id !== 'string' || typeof value.note !== 'string' || !record(value.on)) return null
  const { id, note, on, cropId, cropLost, earlier } = value
  let spot: CommentOn
  switch (on.kind) {
    case 'page': {
      const picked = pickedOf(on.picked)
      if (picked === null || typeof on.address !== 'string' || !isViewport(on.viewport)) return null
      spot = { kind: 'page', picked, address: on.address, viewport: on.viewport }
      break
    }
    case 'canvas': {
      const anchor = anchorOf(on.anchor)
      if (
        anchor._tag === 'None' ||
        typeof on.canvasId !== 'string' ||
        typeof on.name !== 'string' ||
        typeof on.title !== 'string' ||
        typeof on.version !== 'number'
      )
        return null
      spot = { kind: 'canvas', canvasId: on.canvasId, name: on.name, title: on.title, version: on.version, anchor: anchor.value }
      break
    }
    case 'diff': {
      if (!record(on.line)) return null
      const decoded = lineOf({ ...on.line, note })
      if (decoded._tag === 'None') return null
      const { note: _note, ...line } = decoded.value
      spot = { kind: 'diff', line }
      break
    }
    default:
      return null
  }
  return {
    id,
    note,
    on: spot,
    crop: null,
    ...(typeof cropId === 'string' ? { cropId } : {}),
    ...(cropLost === true ? { cropLost: true } : {}),
    ...(earlier === true ? { earlier: true } : {}),
  }
}

const threadOf = (key: string): ThreadComments => {
  const known = threads.get(key)
  if (known !== undefined) return known
  let all = NONE
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(prefix + key) ?? '[]')
    if (Array.isArray(saved)) all = saved.flatMap((value: unknown) => restore(value) ?? [])
  } catch {
    // No readable draft for this thread.
  }
  const thread: ThreadComments = { all, shown: all, sending: new Set(), reading: new Set() }
  threads.set(key, thread)
  return thread
}

const publish = (key: string, thread: ThreadComments) => {
  thread.shown = thread.sending.size === 0 ? thread.all : thread.all.filter((one) => !thread.sending.has(one.id))
  listeners.get(key)?.forEach((listener) => listener())
}

const keep = (key: string, thread: ThreadComments) => {
  try {
    if (thread.all.length === 0) window.localStorage.removeItem(prefix + key)
    else {
      window.localStorage.setItem(
        prefix + key,
        JSON.stringify(
          thread.all.map(({ crop, ...facts }) => ({
            ...facts,
            ...(crop !== null && facts.cropId === undefined ? { cropLost: true } : {}),
          })),
        ),
      )
    }
  } catch {
    // The window still has the comments when storage is unavailable.
  }
}

const change = (key: string, thread: ThreadComments, next: ReadonlyArray<GatheredComment>) => {
  thread.all = next
  keep(key, thread)
  publish(key, thread)
}

/** The comments waiting in a draft, in the order they were made. */
export const commentsOf = (key: string): ReadonlyArray<GatheredComment> => threadOf(key).shown

export const gather = (key: string, comment: GatheredComment) => {
  const thread = threadOf(key)
  change(key, thread, [...thread.all, comment])
}

export const rewrite = (key: string, id: string, note: string, again?: Pick<GatheredComment, 'on' | 'crop'>) => {
  const thread = threadOf(key)
  change(
    key,
    thread,
    thread.all.map((one) => (one.id === id ? { ...one, note, ...again } : one)),
  )
}

export const markEarlier = (key: string, states: ReadonlyMap<string, boolean>) => {
  const thread = threadOf(key)
  let changed = false
  const next = thread.all.map((one) => {
    const earlier = states.get(one.id)
    if (earlier === undefined || earlier === (one.earlier === true)) return one
    changed = true
    return { ...one, earlier }
  })
  if (changed) change(key, thread, next)
}

const removeCrop = (id: string | undefined) => {
  if (id !== undefined) void draftCrop.remove(id).catch(() => undefined)
}

export const drop = (key: string, id: string) => {
  const thread = threadOf(key)
  const one = thread.shown.find((comment) => comment.id === id)
  if (one === undefined) return
  change(
    key,
    thread,
    thread.all.filter((comment) => comment !== one),
  )
  removeCrop(one.cropId)
}

/** The chips go at once. Their saved copies go when the runtime accepts them. */
export const takeComments = (key: string, onlyDiff = false) => {
  const thread = threadOf(key)
  let lines = 0
  const taken = thread.shown.filter((one) => (one.on.kind === 'diff' ? lines++ < LINE_COMMENTS.count : !onlyDiff))
  const ids = new Set(taken.map((one) => one.id))
  for (const id of ids) thread.sending.add(id)
  if (ids.size > 0) publish(key, thread)
  return {
    taken,
    finish: (accepted: boolean) => {
      if (ids.size === 0 || threads.get(key) !== thread) return
      for (const id of ids) thread.sending.delete(id)
      if (accepted) {
        for (const one of taken) removeCrop(one.cropId)
        change(
          key,
          thread,
          thread.all.filter((one) => !ids.has(one.id)),
        )
      } else publish(key, thread)
    },
  }
}

/** A queued message taken back for editing puts its diff comments ahead of the ones already waiting. */
export const giveBackLines = (key: string, comments: ReadonlyArray<LineComment>) => {
  const thread = threadOf(key)
  const back = comments.map(({ note, ...line }): GatheredComment => ({
    id: crypto.randomUUID(),
    note,
    on: { kind: 'diff', line },
    crop: null,
  }))
  const ids = new Set(back.map((one) => one.id))
  change(key, thread, [...back, ...thread.all])
  return () =>
    change(
      key,
      thread,
      thread.all.filter((one) => !ids.has(one.id)),
    )
}

/** Forgets in-memory drafts, as on restart, and optionally their saved copies, for tests. */
export const forgetComments = (saved = true) => {
  for (const [key, thread] of threads) {
    if (saved) {
      thread.all = NONE
      keep(key, thread)
    }
  }
  threads.clear()
}

export const useComments = (key: string): ReadonlyArray<GatheredComment> => {
  const comments = useSyncExternalStore(
    useCallback(
      (listener: () => void) => {
        const set = listeners.get(key) ?? new Set()
        set.add(listener)
        listeners.set(key, set)
        return () => {
          set.delete(listener)
          if (set.size === 0) listeners.delete(key)
        }
      },
      [key],
    ),
    () => commentsOf(key),
  )
  useEffect(() => {
    const thread = threadOf(key)
    for (const one of comments) void loadCrop(key, thread, one)
  }, [key, comments])
  return comments
}

const needsCrop = (one: GatheredComment): one is GatheredComment & { readonly cropId: string } =>
  one.cropId !== undefined && one.crop === null && one.cropLost !== true

/** A crop still loading holds Send just like an image being read. */
export const readingCommentCrops = (key: string) => commentsOf(key).some(needsCrop)

const loadCrop = async (key: string, thread: ThreadComments, one: GatheredComment, captured?: string) => {
  if (!needsCrop(one) || thread.reading.has(one.cropId)) return
  const id = one.cropId
  thread.reading.add(id)
  // Saving and converting the same capture run independently. A crop that can't be saved still works in this window.
  if (captured !== undefined) void draftCrop.write(id, captured).catch(() => undefined)
  const crop = await Promise.resolve()
    .then(async () => cropOf(captured ?? (await draftCrop.read(id)), thread.all.indexOf(one) + 1))
    .catch(() => null)
  thread.reading.delete(id)
  if (threads.get(key) !== thread || !thread.all.some((comment) => comment.cropId === id)) return
  // Crop availability is checked anew at launch, separately from the saved comment.
  thread.all = thread.all.map((comment) => (comment.cropId === id ? { ...comment, crop, cropLost: crop === null } : comment))
  publish(key, thread)
}

/** Gather the note immediately. Its crop follows when the picture can be read. */
export const savePageComment = (key: string, id: string | null, note: string, on: PageSpot, captured: string | null) => {
  const thread = threadOf(key)
  const before = thread.shown.find((one) => one.id === id)
  if (id !== null && before === undefined) return
  if (before !== undefined && captured === null) {
    rewrite(key, before.id, note)
    return
  }
  const comment: GatheredComment = {
    id: id ?? crypto.randomUUID(),
    note,
    on,
    crop: null,
    ...(captured === null ? {} : { cropId: crypto.randomUUID() }),
  }
  if (before === undefined) gather(key, comment)
  else {
    change(
      key,
      thread,
      thread.all.map((one) => (one === before ? comment : one)),
    )
    removeCrop(before.cropId)
  }
  if (captured !== null) void loadCrop(key, thread, comment, captured)
}

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
  /** What the lead reads before them, where some are on canvases. */
  headingCanvas: (count: number) => (count === 1 ? 'A comment on a canvas:' : `${count} comments:`),
  canvas: 'Canvas',
  passage: 'On',
  wholeCanvas: 'Whole canvas',
  area: 'An area of it',
  canvasLine: (name: string, version: number, place: string) => `On canvas ${name} v${version}: ${place}`,
  canvasVersion: (name: string, version: number) => `${name} v${version}`,
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
  const status = [comment.earlier === true ? 'On an earlier version' : '', comment.cropLost === true ? 'Crop is gone' : '']
    .filter(Boolean)
    .join(' · ')
  const chipStatus = status === '' ? {} : { status }
  if (comment.on.kind === 'diff') {
    const line = comment.on.line
    const where = lineCommentsText.lines(line.side, line.start, line.end)
    return {
      id: comment.id,
      n,
      note: comment.note,
      place: `${line.path} · ${where}`,
      ...chipStatus,
      facts: [
        { label: 'File', value: line.path, kind: 'code' },
        { label: 'On', value: where },
      ],
    }
  }
  if (comment.on.kind === 'canvas') {
    const spot = comment.on
    return {
      id: comment.id,
      n,
      note: comment.note,
      place: spot.title,
      ...chipStatus,
      facts: [
        { label: text.canvas, value: text.canvasVersion(spot.name, spot.version), kind: 'code' },
        ...(spot.anchor.kind === 'passage' ? [{ label: text.passage, value: spot.anchor.text, kind: 'quote' as const }] : []),
      ],
    }
  }
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
    ...chipStatus,
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
  const beside = comments.filter((one): one is GatheredComment & { readonly on: PageSpot | CanvasSpot } => one.on.kind !== 'diff')
  if (beside.length === 0) return ''
  const each = beside.map((comment, index) => {
    const spot = comment.on
    if (spot.kind === 'canvas')
      return [
        `${index + 1}. ${comment.note.replace(/\n/g, '\n   ')}`,
        `   - ${text.canvasLine(spot.name, spot.version, canvasPlace(spot.anchor))}`,
      ].join('\n')
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
  const heading = beside.some((comment) => comment.on.kind === 'canvas') ? text.headingCanvas(beside.length) : text.heading(beside.length)
  return [heading, ...each].join('\n\n')
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
