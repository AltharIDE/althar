import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { DownloadStopped, download, markReady, presence, remove, sizeOf, type SpeechModel } from '../src/speech/model'

/*
 * Bringing the speech model down: file by file, carrying on where a dropped
 * connection stopped, each file checked before it counts, and the model
 * there only once all of it is.
 */

const bytes = (n: number, seed: number) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 31 + seed) % 256))
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex')
const A = bytes(40_000, 1)
const B = bytes(90_000, 2)
const MODEL: SpeechModel = {
  id: 'test-model',
  base: 'https://models.test/rev',
  files: [
    { name: 'a.txt', size: A.length, sha256: sha(A) },
    { name: 'b.onnx', size: B.length, sha256: sha(B) },
  ],
}
const served: Record<string, Buffer> = { 'a.txt': A, 'b.onnx': B }

const folder = () => join(mkdtempSync(join(tmpdir(), 'althar-speech-')), MODEL.id)
const room = async () => 10_000_000_000

/** A server for the model's files, which honours ranges unless told not to, and can drop the connection `dropAfter` bytes into b.onnx. */
const server = (options: { ranges?: boolean; dropAfter?: number; status?: number } = {}) => {
  const asked: Array<{ name: string; range: string | undefined }> = []
  const get = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const name = (url instanceof Request ? url.url : url.toString()).split('/').pop() ?? ''
    const range = (init?.headers as Record<string, string> | undefined)?.Range
    asked.push({ name, range })
    if (options.status !== undefined) return new Response('no', { status: options.status })
    const all = served[name] ?? Buffer.alloc(0)
    const from = range !== undefined && options.ranges !== false ? Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0) : 0
    const body = all.subarray(from)
    let sent = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (name === 'b.onnx' && options.dropAfter !== undefined && sent >= options.dropAfter)
          return controller.error(new TypeError('terminated'))
        const chunk = body.subarray(sent, sent + 10_000)
        if (chunk.length === 0) return controller.close()
        sent += chunk.length
        controller.enqueue(new Uint8Array(chunk))
      },
    })
    return new Response(stream, { status: from > 0 ? 206 : 200 })
  })
  return { get: get as unknown as typeof fetch, asked }
}

describe('the speech model', () => {
  it('comes down file by file, each checked, and is there once all of it is', async () => {
    const dir = folder()
    expect(await presence(dir, MODEL)).toEqual({ ready: false, got: 0, size: sizeOf(MODEL) })
    const seen: Array<number> = []
    await download(dir, MODEL, { fetch: server().get, free: room, onProgress: (got) => seen.push(got) })
    expect(readFileSync(join(dir, 'b.onnx')).equals(B)).toBe(true)
    expect(await presence(dir, MODEL)).toEqual({ ready: true, got: sizeOf(MODEL), size: sizeOf(MODEL) })
    expect(seen.at(-1)).toBe(sizeOf(MODEL))
    // There already: nothing more is asked for.
    const again = server()
    await download(dir, MODEL, { fetch: again.get, free: room })
    expect(again.asked).toEqual([])
  })

  it('carries on from where a dropped connection stopped, asking for the rest', async () => {
    const dir = folder()
    const dropped = server({ dropAfter: 30_000 })
    const stop = await download(dir, MODEL, { fetch: dropped.get, free: room }).catch((error: unknown) => error)
    expect(stop).toBeInstanceOf(DownloadStopped)
    expect((stop as DownloadStopped).stop).toEqual({ reason: 'network' })
    const partway = await presence(dir, MODEL)
    expect(partway.ready).toBe(false)
    expect(partway.got).toBeGreaterThan(A.length)

    const rest = server()
    await download(dir, MODEL, { fetch: rest.get, free: room })
    expect(rest.asked).toEqual([{ name: 'b.onnx', range: `bytes=${partway.got - A.length}-` }])
    expect(readFileSync(join(dir, 'b.onnx')).equals(B)).toBe(true)
  })

  it('starts a file again when the server sends all of it rather than the rest', async () => {
    const dir = folder()
    await download(dir, MODEL, { fetch: server({ dropAfter: 30_000 }).get, free: room }).catch(() => undefined)
    await download(dir, MODEL, { fetch: server({ ranges: false }).get, free: room })
    expect(readFileSync(join(dir, 'b.onnx')).equals(B)).toBe(true)
    expect((await presence(dir, MODEL)).ready).toBe(true)
  })

  it('throws away a file that doesn’t match its hash', async () => {
    const dir = folder()
    const wrong = { ...MODEL, files: [{ ...MODEL.files[0]!, sha256: '0'.repeat(64) }] }
    const stop = await download(dir, wrong, { fetch: server().get, free: room }).catch((error: unknown) => error)
    expect((stop as DownloadStopped).stop).toEqual({ reason: 'corrupt' })
    expect(existsSync(join(dir, 'a.txt.part'))).toBe(false)
    expect(existsSync(join(dir, 'a.txt'))).toBe(false)
  })

  it('throws away a part longer than its file, and starts it again', async () => {
    const dir = folder()
    await download(dir, { ...MODEL, files: [] }, { fetch: server().get, free: room })
    writeFileSync(join(dir, 'a.txt.part'), Buffer.alloc(A.length + 10))
    await remove(join(dir, 'ready.json'))
    await download(dir, MODEL, { fetch: server().get, free: room })
    expect(readFileSync(join(dir, 'a.txt')).equals(A)).toBe(true)
  })

  it('says when the server refuses', async () => {
    const stop = await download(folder(), MODEL, { fetch: server({ status: 404 }).get, free: room }).catch((error: unknown) => error)
    expect((stop as DownloadStopped).stop).toEqual({ reason: 'network' })
  })

  it('downloads nothing when the disk hasn’t room for it', async () => {
    const dir = folder()
    const asked = server()
    const stop = await download(dir, MODEL, { fetch: asked.get, free: async () => 1_000 }).catch((error: unknown) => error)
    expect((stop as DownloadStopped).stop).toEqual({ reason: 'space', need: sizeOf(MODEL), free: 1_000 })
    expect(asked.asked).toEqual([])
  })

  it('stops when cancelled, and keeps nothing once removed', async () => {
    const dir = folder()
    const cancel = new AbortController()
    const run = download(dir, MODEL, {
      fetch: server({ ranges: true }).get,
      free: room,
      signal: cancel.signal,
      onProgress: () => cancel.abort(new Error('Cancelled')),
    })
    await expect(run).rejects.toThrow('Cancelled')
    expect((await presence(dir, MODEL)).ready).toBe(false)
    await remove(dir)
    expect(existsSync(dir)).toBe(false)
  })

  it('counts only a ready mark for this model as the model being there', async () => {
    const dir = folder()
    await markReady(dir, { ...MODEL, id: 'another' })
    expect((await presence(dir, MODEL)).ready).toBe(false)
    await markReady(dir, MODEL)
    expect((await presence(dir, MODEL)).ready).toBe(true)
  })
})
