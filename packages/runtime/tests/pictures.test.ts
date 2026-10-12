import { describe, expect, it } from 'vitest'

import { SCREENSHOT_PNG } from '@althar/provider-adapters/testing'

import { pictureSize, pictureType } from '../src/pictures'

const bytes = (...parts: ReadonlyArray<ReadonlyArray<number> | string>) =>
  new Uint8Array(parts.flatMap((part) => (typeof part === 'string' ? Array.from(part, (char) => char.charCodeAt(0)) : [...part])))

const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff]
const le24 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff]
const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff]

describe('pictures', () => {
  it('reads a PNG’s kind and size from its header', () => {
    const png = new Uint8Array(Buffer.from(SCREENSHOT_PNG, 'base64'))
    expect(pictureType(png)).toBe('image/png')
    expect(pictureSize(png, 'image/png')).toEqual({ width: 480, height: 300 })
    expect(pictureSize(png.slice(0, 20), 'image/png')).toBeNull()
  })

  it('reads a GIF, of either version', () => {
    const gif = bytes('GIF89a', le16(640), le16(400))
    expect(pictureType(gif)).toBe('image/gif')
    expect(pictureSize(gif, 'image/gif')).toEqual({ width: 640, height: 400 })
    expect(pictureType(bytes('GIF87a', le16(1), le16(1)))).toBe('image/gif')
    expect(pictureSize(bytes('GIF89a', [1]), 'image/gif')).toBeNull()
  })

  it('walks a JPEG’s markers to its frame header, past padding and tables', () => {
    const jpeg = bytes(
      [0xff, 0xd8],
      // An app segment, its length counting itself.
      [0xff, 0xe0],
      be16(6),
      'JFIF',
      // A table that shares the frames' range, and padding.
      [0xff, 0xc4],
      be16(4),
      [0, 0],
      [0xff, 0xff, 0xd0],
      [0xff, 0xc2],
      be16(17),
      [8],
      be16(900),
      be16(1440),
      [3, 0, 0, 0, 0, 0, 0, 0, 0],
    )
    expect(pictureType(jpeg)).toBe('image/jpeg')
    expect(pictureSize(jpeg, 'image/jpeg')).toEqual({ width: 1440, height: 900 })
    // A marker where there should be one is missing: no size, rather than a wrong one.
    expect(pictureSize(bytes([0xff, 0xd8, 0x00, 0x01, 0, 0, 0, 0, 0, 0, 0, 0]), 'image/jpeg')).toBeNull()
    expect(pictureSize(bytes([0xff, 0xd8]), 'image/jpeg')).toBeNull()
  })

  it('reads each kind of WebP', () => {
    const lossy = bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8 ', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], le16(320), le16(200))
    expect(pictureType(lossy)).toBe('image/webp')
    expect(pictureSize(lossy, 'image/webp')).toEqual({ width: 320, height: 200 })
    const bits = (320 - 1) | ((200 - 1) << 14)
    const lossless = bytes(
      'RIFF',
      [0, 0, 0, 0],
      'WEBP',
      'VP8L',
      [0, 0, 0, 0, 0x2f],
      [bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >> 24) & 0xff],
    )
    expect(pictureSize(lossless, 'image/webp')).toEqual({ width: 320, height: 200 })
    const extended = bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8X', [0, 0, 0, 0, 0, 0, 0, 0], le24(1919), le24(1079))
    expect(pictureSize(extended, 'image/webp')).toEqual({ width: 1920, height: 1080 })
    expect(pictureSize(bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'ALPH'), 'image/webp')).toBeNull()
  })

  it('passes over a JPEG’s markers that stand alone, and says nothing of a header cut short', () => {
    const jpeg = bytes([0xff, 0xd8], [0xff, 0x01], [0xff, 0xd3], [0xff, 0xc0], be16(17), [8], be16(10), be16(20), [3, 0, 0, 0, 0, 0, 0])
    expect(pictureSize(jpeg, 'image/jpeg')).toEqual({ width: 20, height: 10 })
    for (const kind of ['VP8 ', 'VP8L', 'VP8X']) expect(pictureSize(bytes('RIFF', [0, 0, 0, 0], 'WEBP', kind), 'image/webp')).toBeNull()
    expect(pictureSize(bytes([0x89, 'P'.charCodeAt(0)]), 'image/png')).toBeNull()
  })

  it('knows nothing else as a picture, SVG among them', () => {
    expect(pictureType(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(pictureType(bytes('BM'))).toBeNull()
    expect(pictureType(new Uint8Array())).toBeNull()
    expect(pictureSize(bytes('GIF89a', le16(0), le16(4)), 'image/gif')).toBeNull()
  })
})
