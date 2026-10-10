/*
 * What a picture's bytes say it is, and how big it is in pixels, read from
 * its header the way the browser will: the bytes are believed over the type
 * an agent gives. Only the kinds the window draws are known (PNG, JPEG, GIF
 * and WebP); anything else, SVG among them, is not a picture Althar shows.
 */

export type PictureType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

const starts = (bytes: Uint8Array, signature: ReadonlyArray<number>, at = 0) =>
  bytes.length >= at + signature.length && signature.every((byte, i) => bytes[at + i] === byte)

const ascii = (text: string) => Array.from({ length: text.length }, (_, i) => text.charCodeAt(i))

/** The kind of picture the bytes are, or null for anything the window doesn't draw. */
export const pictureType = (bytes: Uint8Array): PictureType | null => {
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (starts(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (starts(bytes, ascii('GIF87a')) || starts(bytes, ascii('GIF89a'))) return 'image/gif'
  if (starts(bytes, ascii('RIFF')) && starts(bytes, ascii('WEBP'), 8)) return 'image/webp'
  return null
}

export interface Size {
  readonly width: number
  readonly height: number
}

const sized = (width: number, height: number): Size | null => (width > 0 && height > 0 ? { width, height } : null)

/** A JPEG's size, from its first frame's header: the markers are walked until one says it. */
const jpegSize = (view: DataView): Size | null => {
  let at = 2
  while (at + 9 < view.byteLength) {
    if (view.getUint8(at) !== 0xff) return null
    const marker = view.getUint8(at + 1)
    // Padding, and markers that stand alone, carry no length.
    if (marker === 0xff) {
      at += 1
      continue
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2
      continue
    }
    // A frame's header, of any coding but the tables that share its range.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return sized(view.getUint16(at + 7), view.getUint16(at + 5))
    at += 2 + view.getUint16(at + 2)
  }
  return null
}

/** A 24-bit number, least significant byte first, as WebP's extended header has them. */
const little24 = (view: DataView, at: number) => view.getUint16(at, true) | (view.getUint8(at + 2) << 16)

/** A WebP's size, from whichever of its three kinds of first chunk it has. */
const webpSize = (bytes: Uint8Array, view: DataView): Size | null => {
  if (starts(bytes, ascii('VP8 '), 12)) return sized(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff)
  if (starts(bytes, ascii('VP8L'), 12)) {
    const bits = view.getUint32(21, true)
    return sized((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1)
  }
  if (starts(bytes, ascii('VP8X'), 12)) return sized(little24(view, 24) + 1, little24(view, 27) + 1)
  return null
}

/** How big a picture is, in pixels, as its header says; null where it doesn't, or where it is cut short. */
export const pictureSize = (bytes: Uint8Array, type: PictureType): Size | null => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  try {
    switch (type) {
      case 'image/png':
        return sized(view.getUint32(16), view.getUint32(20))
      case 'image/gif':
        return sized(view.getUint16(6, true), view.getUint16(8, true))
      case 'image/jpeg':
        return jpegSize(view)
      case 'image/webp':
        return webpSize(bytes, view)
    }
  } catch {
    // A header cut short reads past its end.
    return null
  }
}
