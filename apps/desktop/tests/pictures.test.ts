// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { artifactPath } from '@althar/runtime/artifacts'
import { describe, expect, it, vi } from 'vitest'

import { pictureAsked, pictureUrl, THUMB_WIDTH } from '../src/main/pictureAddress'
import { type Resize, servePicture } from '../src/main/pictures'

/* A 1 × 1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const digestOf = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/** A store holding the bytes given, by their digests, as the runtime keeps them. */
const store = (...files: ReadonlyArray<Buffer>) => {
  const root = mkdtempSync(join(tmpdir(), 'althar-pictures-'))
  for (const bytes of files) {
    const path = artifactPath(root, digestOf(bytes))
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, bytes)
  }
  return root
}

const ask = (url: string) => new Request(url)

describe('a picture’s address', () => {
  it('names a digest, and a smaller copy at the one width it is made at', () => {
    const digest = digestOf(PNG)
    expect(pictureUrl(digest)).toBe(`althar-picture://shot/${digest}`)
    expect(pictureAsked(pictureUrl(digest))).toEqual({ digest, width: null })
    expect(pictureAsked(pictureUrl(digest, true))).toEqual({ digest, width: THUMB_WIDTH })
  })

  it('asks for nothing else: another scheme, host, digest or width', () => {
    const digest = digestOf(PNG)
    for (const url of [
      `https://shot/${digest}`,
      `althar-picture://other/${digest}`,
      'althar-picture://shot/../../etc/passwd',
      `althar-picture://shot/${digest.toUpperCase()}`,
      `althar-picture://shot/${digest}?w=99999`,
      'not a url',
    ])
      expect(pictureAsked(url)).toBeNull()
  })
})

describe('serving a picture from the store', () => {
  it('answers with the bytes and what they are, for good', async () => {
    const root = store(PNG)
    const answer = await servePicture(root, vi.fn())(ask(pictureUrl(digestOf(PNG))))
    expect(answer.status).toBe(200)
    expect(answer.headers.get('content-type')).toBe('image/png')
    expect(answer.headers.get('cache-control')).toContain('immutable')
    expect(answer.headers.get('x-content-type-options')).toBe('nosniff')
    expect(Buffer.from(await answer.arrayBuffer()).equals(PNG)).toBe(true)
  })

  it('answers 404 for an address it doesn’t serve, a digest it doesn’t hold, or bytes that aren’t a picture', async () => {
    const text = Buffer.from('TOKEN=secret')
    const root = store(text)
    const serve = servePicture(root, vi.fn())
    for (const url of ['althar-picture://shot/nothing', pictureUrl(digestOf(PNG)), pictureUrl(digestOf(text))])
      expect((await serve(ask(url))).status).toBe(404)
  })

  it('makes a smaller copy once, keeps it beside the store, and serves it after', async () => {
    const root = store(PNG)
    const smaller = Buffer.from('smaller')
    const resize = vi.fn<Resize>(() => ({ bytes: smaller, type: 'image/png' }))
    const serve = servePicture(root, resize)
    const first = await serve(ask(pictureUrl(digestOf(PNG), true)))
    expect(Buffer.from(await first.arrayBuffer()).toString()).toBe('smaller')
    expect(resize).toHaveBeenCalledWith(PNG, 'image/png', THUMB_WIDTH)
    const again = await serve(ask(pictureUrl(digestOf(PNG), true)))
    expect(Buffer.from(await again.arrayBuffer()).toString()).toBe('smaller')
    expect(resize).toHaveBeenCalledOnce()
    // Nothing half-written is left beside it.
    expect(readdirSync(join(root, 'smaller'))).toEqual([`${digestOf(PNG)}-${THUMB_WIDTH}.png`])
  })

  it('serves the picture itself where no smaller copy is needed, and a JPEG’s copy as a JPEG', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
    const root = store(PNG, jpeg)
    const serve = servePicture(root, (_bytes, type) => (type === 'image/jpeg' ? { bytes: Buffer.from('small jpeg'), type } : null))
    const whole = await serve(ask(pictureUrl(digestOf(PNG), true)))
    expect(Buffer.from(await whole.arrayBuffer()).equals(PNG)).toBe(true)
    const copy = await serve(ask(pictureUrl(digestOf(jpeg), true)))
    expect(copy.headers.get('content-type')).toBe('image/jpeg')
    expect(Buffer.from(await copy.arrayBuffer()).toString()).toBe('small jpeg')
    const kept = await servePicture(root, vi.fn())(ask(pictureUrl(digestOf(jpeg), true)))
    expect(Buffer.from(await kept.arrayBuffer()).toString()).toBe('small jpeg')
  })

  it('makes copies asked for at once each whole, and leaves nothing half-written', async () => {
    const root = store(PNG)
    const smaller = Buffer.alloc(64 * 1024, 7)
    const serve = servePicture(root, () => ({ bytes: smaller, type: 'image/png' }))
    const answers = await Promise.all(Array.from({ length: 6 }, () => serve(ask(pictureUrl(digestOf(PNG), true)))))
    for (const answer of answers) expect(Buffer.from(await answer.arrayBuffer()).equals(smaller)).toBe(true)
    expect(readdirSync(join(root, 'smaller'))).toEqual([`${digestOf(PNG)}-${THUMB_WIDTH}.png`])
    const kept = await servePicture(root, vi.fn())(ask(pictureUrl(digestOf(PNG), true)))
    expect(Buffer.from(await kept.arrayBuffer()).equals(smaller)).toBe(true)
  })

  it('serves a smaller copy even where it can’t keep it', async () => {
    const root = store(PNG)
    // A file where the copies' folder should be.
    writeFileSync(join(root, 'smaller'), 'not a folder')
    const answer = await servePicture(root, () => ({ bytes: Buffer.from('small'), type: 'image/png' }))(
      ask(pictureUrl(digestOf(PNG), true)),
    )
    expect(Buffer.from(await answer.arrayBuffer()).toString()).toBe('small')
  })
})
