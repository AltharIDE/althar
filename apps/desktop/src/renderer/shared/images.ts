import { MESSAGE_IMAGES, type Picture, pictureSize, pictureType, type PictureType, type SentImage } from '@althar/contracts'
import { AttachmentKind, type MessageAttachment } from '@althar/ui'

import { pictureUrl } from '../../main/pictureAddress'
import { bytesText } from './handed'

/*
 * Images the person sends with a message (the kit's Composer), as the window
 * reads them: from the files dropped on the composer, pasted into it or
 * picked, read here as any page reads a file the person gave it, with no
 * path and nothing from the main process. The bytes are believed, as the
 * runtime believes them (`@althar/contracts`' pictureType): only PNG, JPEG,
 * GIF and WebP go. One larger than MESSAGE_IMAGES.edge pixels on its long
 * side, or than MESSAGE_IMAGES.bytes, is drawn smaller first, on a canvas;
 * one still too large, or a file over INPUT_LIMIT, is refused. The runtime
 * checks again whatever arrives.
 */

/** The largest file the window reads at all: anything larger is refused before it is read. */
export const INPUT_LIMIT = 50 * 1024 * 1024

export const text = {
  pasted: 'Pasted image',
  unsupported: (name: string) => `${name} isn’t a PNG, JPEG, GIF or WebP image, so it can’t be sent.`,
  tooLarge: (name: string) => `${name} is too large to send, even made smaller.`,
  unreadable: (name: string) => `Althar couldn’t read ${name}.`,
  tooMany: `A message can carry at most ${MESSAGE_IMAGES.count} images.`,
  /** A queued message taken back to edit whose images wouldn't fit beside those waiting: it stays in the queue. */
  noRoom: `Its images don’t fit beside these: a message can carry at most ${MESSAGE_IMAGES.count} images. Remove some first.`,
  /** Images dropped for an agent that says it doesn't take them. */
  refused: (agent: string) => `${agent} doesn’t take images, so they can’t be sent to it.`,
  /** Images waiting for an agent picked since, which doesn't take them. */
  blocked: (agent: string) => `${agent} doesn’t take images. Remove them to send this, or pick an agent that does.`,
  stillReading: 'The images are still being read. Send again in a moment.',
  /** What went with a queued message. */
  attached: (n: number) => (n === 1 ? '1 image' : `${n} images`),
  image: (n: number) => `Image ${n}`,
  size: (width: number, height: number) => `${width} × ${height}`,
}

/** Draws a picture smaller, at most `edge` pixels on its long side; null where it can't be drawn. */
export type Shrink = (
  bytes: Uint8Array,
  type: PictureType,
  edge: number,
) => Promise<{ readonly bytes: Uint8Array; readonly type: PictureType } | null>

/** An image read and ready to send. */
export interface ReadImage {
  readonly name: string
  readonly mediaType: PictureType
  /** Its bytes in base64, as they go. */
  readonly data: string
  /** Its SHA-256, as the store will name it. */
  readonly digest: string
  readonly bytes: number
  readonly width: number | null
  readonly height: number | null
  /** What it is drawn from, small: its own bytes, as a `data:` address the window's policy allows. */
  readonly src: string
}

export type Reading = { readonly ok: true; readonly image: ReadImage } | { readonly ok: false; readonly note: string }

const base64 = (bytes: Uint8Array) => {
  let binary = ''
  // In pieces, so a large picture doesn't overflow the call's arguments.
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return btoa(binary)
}

const sha256 = async (bytes: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

/** Reads one file as an image to send: its bytes believed, drawn smaller where it is large; or why it can't go. */
export const readImage = async (file: File, shrink: Shrink): Promise<Reading> => {
  const name = file.name.trim() === '' ? text.pasted : file.name
  if (file.size > INPUT_LIMIT) return { ok: false, note: text.tooLarge(name) }
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    return { ok: false, note: text.unreadable(name) }
  }
  let type = pictureType(bytes)
  if (type === null) return { ok: false, note: text.unsupported(name) }
  let size = pictureSize(bytes, type)
  const large = size !== null && Math.max(size.width, size.height) > MESSAGE_IMAGES.edge
  if (large || bytes.length > MESSAGE_IMAGES.bytes) {
    // One that can't be drawn goes as it is, where it isn't too many bytes: the agent makes it smaller itself.
    const smaller = await shrink(bytes, type, MESSAGE_IMAGES.edge).catch(() => null)
    if (smaller !== null) {
      bytes = smaller.bytes
      type = smaller.type
      size = pictureSize(bytes, type)
    }
  }
  if (bytes.length > MESSAGE_IMAGES.bytes) return { ok: false, note: text.tooLarge(name) }
  const data = base64(bytes)
  return {
    ok: true,
    image: {
      name,
      mediaType: type,
      data,
      digest: await sha256(bytes),
      bytes: bytes.length,
      width: size?.width ?? null,
      height: size?.height ?? null,
      src: `data:${type};base64,${data}`,
    },
  }
}

/**
 * Draws a picture smaller with the window's own canvas: a PNG, GIF or WebP
 * as a PNG, which keeps what is clear in it; a JPEG, or a PNG still too
 * large, as a JPEG on white.
 */
export const shrinkInWindow: Shrink = async (bytes, type, edge) => {
  const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type }))
  try {
    const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const draw = async (as: PictureType) => {
      const canvas = new OffscreenCanvas(width, height)
      const context = canvas.getContext('2d')
      if (context === null) return null
      if (as === 'image/jpeg') {
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, width, height)
      }
      context.drawImage(bitmap, 0, 0, width, height)
      const blob = await canvas.convertToBlob({ type: as, quality: 0.88 })
      return { bytes: new Uint8Array(await blob.arrayBuffer()), type: as }
    }
    const first = await draw(type === 'image/jpeg' ? 'image/jpeg' : 'image/png')
    if (first === null || first.type === 'image/jpeg' || first.bytes.length <= MESSAGE_IMAGES.bytes) return first
    return await draw('image/jpeg')
  } finally {
    bitmap.close()
  }
}

/*
 * What this window sent, by digest, drawn from its own bytes: so a message
 * shows its images the moment it is sent, before the store has them, and
 * from memory after. The newest few are kept.
 */
const PREVIEWS_KEPT = 40
const previews = new Map<string, string>()

/** Keeps an image's bytes to draw it from, by its digest. */
export const remember = (digest: string, src: string) => {
  previews.delete(digest)
  previews.set(digest, src)
  for (const oldest of previews.keys()) {
    if (previews.size <= PREVIEWS_KEPT) break
    previews.delete(oldest)
  }
}

/** What this window draws an image from, by its digest, where it sent it. */
export const previewOf = (digest: string): string | undefined => previews.get(digest)

/** An image sent with a message, as its thread item names it once the store has it. */
export const pictureOf = (image: ReadImage): Picture => ({
  digest: image.digest,
  mediaType: image.mediaType,
  bytes: image.bytes,
  width: image.width,
  height: image.height,
  name: image.name,
  unkept: null,
})

/** The images a message was sent with, as the kit's You draws them: from this window's own bytes where it has them, else from the store. */
export const sentAttachments = (pictures: ReadonlyArray<Picture>): ReadonlyArray<MessageAttachment> =>
  pictures.map((picture, index) => {
    const name = picture.name ?? text.image(index + 1)
    const facts = [
      ...(picture.width === null || picture.height === null ? [] : [text.size(picture.width, picture.height)]),
      bytesText(picture.bytes),
    ]
    const own = picture.digest === null ? undefined : previewOf(picture.digest)
    return {
      id: `${picture.digest ?? 'unkept'}:${index}`,
      kind: AttachmentKind.Image,
      name,
      meta: facts.join(' · '),
      ...(picture.digest === null
        ? { status: 'failed' as const }
        : { src: own ?? pictureUrl(picture.digest), thumb: own ?? pictureUrl(picture.digest, true) }),
      ...(picture.width === null ? {} : { width: picture.width }),
      ...(picture.height === null ? {} : { height: picture.height }),
    }
  })

/** What goes for an image: its bytes, or, for one the store keeps already, its digest. */
export const sentOf = (image: { readonly data: string | null; readonly digest: string; readonly name: string }): SentImage =>
  image.data === null ? { digest: image.digest, name: image.name } : { data: image.data, name: image.name }
