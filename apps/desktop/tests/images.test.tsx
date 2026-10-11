import { createHash } from 'node:crypto'

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MESSAGE_IMAGES } from '@althar/contracts'
import { AttachmentKind } from '@althar/ui'

import {
  INPUT_LIMIT,
  previewOf,
  readImage,
  remember,
  sentAttachments,
  sentOf,
  type Shrink,
  shrinkInWindow,
  text,
} from '../src/renderer/shared/images'
import { sentWith, takesImages, useImages } from '../src/renderer/shared/useImages'
import { models } from './fixtures'

const be32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
/** A PNG's signature and header: enough for its kind and size. */
const png = (width: number, height: number, padding = 0) =>
  new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...be32(13),
    // IHDR
    0x49,
    0x48,
    0x44,
    0x52,
    ...be32(width),
    ...be32(height),
    8,
    6,
    0,
    0,
    0,
    ...Array.from({ length: padding }, () => 0),
  ])
const fileOf = (bytes: Uint8Array, name: string, type = 'image/png') => new File([new Uint8Array(bytes)], name, { type })
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const asIs: Shrink = () => Promise.resolve(null)

describe('reading an image to send', () => {
  it('believes its bytes, and keeps them, their digest and size, to send and to draw', async () => {
    const bytes = png(640, 400)
    const shrink = vi.fn(asIs)
    const read = await readImage(fileOf(bytes, 'shot.png', 'application/octet-stream'), shrink)
    expect(read).toEqual({
      ok: true,
      image: {
        name: 'shot.png',
        mediaType: 'image/png',
        data: Buffer.from(bytes).toString('base64'),
        digest: digest(bytes),
        bytes: bytes.length,
        width: 640,
        height: 400,
        src: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`,
      },
    })
    expect(shrink).not.toHaveBeenCalled()
  })

  it('refuses what isn’t a PNG, JPEG, GIF or WebP, whatever it is called, and names one pasted with no name', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
    expect(await readImage(fileOf(svg, 'logo.png'), asIs)).toEqual({ ok: false, note: text.unsupported('logo.png') })
    expect(await readImage(fileOf(svg, ''), asIs)).toEqual({ ok: false, note: text.unsupported('Pasted image') })
  })

  it('draws a large one smaller first, and sends what it drew', async () => {
    const smaller = png(2000, 1500)
    const shrink = vi.fn<Shrink>(() => Promise.resolve({ bytes: smaller, type: 'image/png' }))
    const read = await readImage(fileOf(png(4000, 3000), 'wide.png'), shrink)
    expect(shrink).toHaveBeenCalledWith(expect.any(Uint8Array), 'image/png', MESSAGE_IMAGES.edge)
    expect(read.ok && [read.image.width, read.image.height, read.image.digest]).toEqual([2000, 1500, digest(smaller)])
  })

  it('sends one it can’t draw as it is, unless it is too many bytes, and refuses one too large to read', async () => {
    const wide = png(4000, 3000)
    expect((await readImage(fileOf(wide, 'wide.png'), asIs)).ok).toBe(true)
    expect((await readImage(fileOf(wide, 'wide.png'), () => Promise.reject(new Error('no canvas')))).ok).toBe(true)
    const heavy = png(100, 100, MESSAGE_IMAGES.bytes)
    expect(await readImage(fileOf(heavy, 'heavy.png'), asIs)).toEqual({ ok: false, note: text.tooLarge('heavy.png') })
    const huge = fileOf(png(10, 10), 'huge.png')
    Object.defineProperty(huge, 'size', { value: INPUT_LIMIT + 1 })
    const shrink = vi.fn(asIs)
    expect(await readImage(huge, shrink)).toEqual({ ok: false, note: text.tooLarge('huge.png') })
    expect(shrink).not.toHaveBeenCalled()
  })

  it('says when it couldn’t read a file', async () => {
    const gone = fileOf(png(10, 10), 'gone.png')
    Object.defineProperty(gone, 'arrayBuffer', { value: () => Promise.reject(new Error('moved')) })
    expect(await readImage(gone, asIs)).toEqual({ ok: false, note: text.unreadable('gone.png') })
  })
})

describe('drawing an image smaller in the window', () => {
  afterEach(() => vi.unstubAllGlobals())

  /** The window's canvas, as far as drawing smaller uses it: each draw's size and kind, and the bytes it gives back. */
  const canvas = (bitmap: { width: number; height: number }, sizes: Partial<Record<string, number>> = {}, context = true) => {
    const drawn: Array<{ width: number; height: number; type: string; filled: boolean }> = []
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', () => Promise.resolve({ ...bitmap, close }))
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        filled = false
        constructor(
          readonly width: number,
          readonly height: number,
        ) {}
        getContext() {
          if (!context) return null
          return {
            fillStyle: '',
            fillRect: () => {
              this.filled = true
            },
            drawImage: () => undefined,
          }
        }
        convertToBlob({ type }: { type: string }) {
          drawn.push({ width: this.width, height: this.height, type, filled: this.filled })
          return Promise.resolve(new Blob([new Uint8Array(sizes[type] ?? 10)], { type }))
        }
      },
    )
    return { drawn, close }
  }

  it('draws a PNG as a PNG, at most the edge on its long side, and lets the picture go', async () => {
    const { drawn, close } = canvas({ width: 4000, height: 1000 })
    const smaller = await shrinkInWindow(png(4000, 1000), 'image/png', 2000)
    expect(smaller?.type).toBe('image/png')
    expect(drawn).toEqual([{ width: 2000, height: 500, type: 'image/png', filled: false }])
    expect(close).toHaveBeenCalled()
  })

  it('draws a JPEG, or a PNG still too many bytes, as a JPEG on white', async () => {
    const { drawn } = canvas({ width: 3000, height: 3000 }, { 'image/png': MESSAGE_IMAGES.bytes + 1 })
    expect((await shrinkInWindow(new Uint8Array([0xff, 0xd8, 0xff]), 'image/jpeg', 2000))?.type).toBe('image/jpeg')
    expect(drawn.splice(0).map((draw) => [draw.type, draw.filled])).toEqual([['image/jpeg', true]])
    const smaller = await shrinkInWindow(png(3000, 3000), 'image/png', 2000)
    expect(smaller?.type).toBe('image/jpeg')
    expect(drawn.map((draw) => [draw.type, draw.filled])).toEqual([
      ['image/png', false],
      ['image/jpeg', true],
    ])
  })

  it('draws nothing where the window gives it no canvas to draw on', async () => {
    canvas({ width: 10, height: 10 }, {}, false)
    expect(await shrinkInWindow(png(10, 10), 'image/gif', 2000)).toBeNull()
  })
})

describe('images in the thread', () => {
  it('draws what this window sent from its own bytes, the newest few, and the rest from the store', () => {
    remember('a'.repeat(64), 'data:image/png;base64,AAAA')
    expect(previewOf('a'.repeat(64))).toBe('data:image/png;base64,AAAA')
    for (let n = 0; n < 40; n += 1) remember(n.toString(16).padStart(64, '0'), 'data:,')
    expect(previewOf('a'.repeat(64))).toBeUndefined()
    remember('0'.repeat(64), 'data:image/png;base64,BBBB')
    const [own, kept, unkept] = sentAttachments([
      { digest: '0'.repeat(64), mediaType: 'image/png', bytes: 2048, width: 640, height: 400, name: 'shot.png', unkept: null },
      { digest: 'b'.repeat(64), mediaType: 'image/jpeg', bytes: 300, width: null, height: null, name: null, unkept: null },
      { digest: null, mediaType: 'image/png', bytes: 0, width: null, height: null, name: null, unkept: 'unkept' },
    ])
    expect(own).toEqual({
      id: `${'0'.repeat(64)}:0`,
      kind: AttachmentKind.Image,
      name: 'shot.png',
      meta: '640 × 400 · 2 KB',
      src: 'data:image/png;base64,BBBB',
      thumb: 'data:image/png;base64,BBBB',
      width: 640,
      height: 400,
    })
    expect(kept).toMatchObject({ name: 'Image 2', src: `althar-picture://shot/${'b'.repeat(64)}`, meta: '300 B' })
    expect(kept && 'thumb' in kept && kept.thumb).toBe(`althar-picture://shot/${'b'.repeat(64)}?w=1120`)
    expect(unkept).toMatchObject({ name: 'Image 3', status: 'failed' })
  })

  it('sends an image by its bytes, or by its digest where the store keeps it', () => {
    expect(sentOf({ data: 'AAAA', digest: 'c'.repeat(64), name: 'a.png' })).toEqual({ data: 'AAAA', name: 'a.png' })
    expect(sentOf({ data: null, digest: 'c'.repeat(64), name: 'a.png' })).toEqual({ digest: 'c'.repeat(64), name: 'a.png' })
    expect(sentWith(undefined)).toEqual({})
    expect(sentWith({ sent: [], pictures: [] })).toEqual({})
  })

  it('knows which agents take images, from their models', () => {
    expect([takesImages(models, 'claude-code'), takesImages(models, 'codex'), takesImages(models, 'opencode')]).toEqual([true, false, null])
    expect([takesImages(null, 'codex'), takesImages(models, null)]).toEqual([null, null])
  })
})

describe('the images waiting in a composer', () => {
  const claude = { name: 'Claude Code', takes: true }
  const codex = { name: 'Codex', takes: false }

  it('reads what is added, shows it, and sends it with the message, drawn from its own bytes', async () => {
    const { result } = renderHook(() => useImages(asIs))
    const bytes = png(640, 400)
    act(() => result.current.props(claude).onAddImages([fileOf(bytes, 'shot.png')]))
    expect(result.current.props(claude).images).toEqual([{ id: 'image-1', name: 'shot.png', reading: true }])
    await waitFor(() => expect(result.current.props(claude).images[0]?.src).toMatch(/^data:image\/png;base64,/))
    let outgoing = null as ReturnType<typeof result.current.take>
    act(() => {
      outgoing = result.current.take(claude)
    })
    expect(outgoing?.sent).toEqual([{ data: Buffer.from(bytes).toString('base64'), name: 'shot.png' }])
    expect(outgoing?.pictures).toEqual([
      { digest: digest(bytes), mediaType: 'image/png', bytes: bytes.length, width: 640, height: 400, name: 'shot.png', unkept: null },
    ])
    expect(previewOf(digest(bytes))).toMatch(/^data:image\/png/)
    act(() => result.current.clear())
    expect(result.current.props(claude).images).toEqual([])
  })

  it('says why it refused one, takes one off, and takes no more than a message carries', async () => {
    const { result } = renderHook(() => useImages(asIs))
    const svg = new TextEncoder().encode('<svg/>')
    act(() => result.current.props(claude).onAddImages([fileOf(svg, 'logo.svg'), fileOf(png(1, 1), 'a.png')]))
    await waitFor(() => expect(result.current.props(claude).imageNote).toBe(text.unsupported('logo.svg')))
    await waitFor(() => expect(result.current.props(claude).images.map((image) => image.name)).toEqual(['a.png']))
    act(() => result.current.props(claude).onRemoveImage('image-2'))
    expect(result.current.props(claude)).toMatchObject({ images: [] })
    expect(result.current.props(claude).imageNote).toBeUndefined()
    const many = Array.from({ length: MESSAGE_IMAGES.count + 2 }, (_, n) => fileOf(png(1, 1), `${n}.png`))
    act(() => result.current.props(claude).onAddImages(many))
    expect(result.current.props(claude).images).toHaveLength(MESSAGE_IMAGES.count)
    expect(result.current.props(claude).imageNote).toBe(text.tooMany)
  })

  it('holds the message back while an image is still being read', () => {
    const { result } = renderHook(() => useImages(asIs))
    const slow = fileOf(png(1, 1), 'slow.png')
    Object.defineProperty(slow, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>(() => undefined) })
    act(() => result.current.props(claude).onAddImages([slow]))
    let outgoing: ReturnType<typeof result.current.take> | undefined
    act(() => {
      outgoing = result.current.take(claude)
    })
    expect(outgoing).toBeNull()
    expect(result.current.props(claude).imageNote).toBe(text.stillReading)
  })

  it('takes none for an agent that doesn’t take images, and holds back those added before it was picked, saying why', async () => {
    const { result } = renderHook(() => useImages(asIs))
    act(() => result.current.props(codex).onAddImages([fileOf(png(1, 1), 'a.png')]))
    expect(result.current.props(codex)).toMatchObject({ images: [], imageNote: text.refused('Codex') })
    act(() => result.current.props(claude).onAddImages([fileOf(png(1, 1), 'a.png')]))
    await waitFor(() => expect(result.current.props(claude).images[0]?.src).toBeDefined())
    expect(result.current.props(codex).imageNote).toBe(text.blocked('Codex'))
    let outgoing: ReturnType<typeof result.current.take> | undefined
    act(() => {
      outgoing = result.current.take(codex)
    })
    expect(outgoing).toBeNull()
    // With nothing waiting, a message goes to it as before.
    act(() => result.current.clear())
    act(() => {
      outgoing = result.current.take(codex)
    })
    expect(outgoing).toEqual({ sent: [], pictures: [] })
  })

  it('puts back the images of a message taken back from the queue, to go again by their digests', () => {
    const { result } = renderHook(() => useImages(asIs))
    act(() =>
      result.current.restore([
        { digest: 'd'.repeat(64), mediaType: 'image/png', bytes: 68, width: 1, height: 1, name: 'shot.png', unkept: null },
        { digest: null, mediaType: 'image/png', bytes: 0, width: null, height: null, name: null, unkept: 'unkept' },
        { digest: 'e'.repeat(64), mediaType: 'image/png', bytes: 68, width: 1, height: 1, name: null, unkept: null },
      ]),
    )
    expect(result.current.props(claude).images).toEqual([
      { id: 'image-1', name: 'shot.png', src: `althar-picture://shot/${'d'.repeat(64)}?w=1120` },
      { id: 'image-2', name: 'Image 2', src: `althar-picture://shot/${'e'.repeat(64)}?w=1120` },
    ])
    let outgoing: ReturnType<typeof result.current.take> | undefined
    act(() => {
      outgoing = result.current.take(claude)
    })
    expect(outgoing?.sent).toEqual([
      { digest: 'd'.repeat(64), name: 'shot.png' },
      { digest: 'e'.repeat(64), name: 'Image 2' },
    ])
  })
})
