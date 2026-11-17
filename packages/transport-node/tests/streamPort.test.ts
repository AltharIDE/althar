import { PassThrough } from 'node:stream'

import { decodeWire, encodeWire } from '@althar/contracts'
import { describe, expect, it } from 'vitest'

import { streamPort } from '../src/streamPort'

const frame = (value: unknown) => {
  const body = Buffer.from(encodeWire(value))
  const prefix = Buffer.alloc(4)
  prefix.writeUInt32BE(body.length)
  return Buffer.concat([prefix, body])
}
describe('framed ports over separate byte streams', () => {
  it('buffers a split frame and an authentication/RPC handoff without losing messages', async () => {
    const readable = new PassThrough()
    const writable = new PassThrough()
    const port = streamPort({ readable, writable, maximum: 1024 })
    const bytes = frame({ identity: 'socket' })
    readable.write(bytes.subarray(0, 2))
    readable.write(Buffer.concat([bytes.subarray(2), frame([0])]))
    const heard: unknown[] = []
    const stop = port.listen((value) => {
      heard.push(value)
    })
    await Promise.resolve()
    expect(heard).toEqual([{ identity: 'socket' }, [0]])
    expect(() => port.listen(() => undefined)).toThrow('one active consumer')
    stop()
    readable.write(frame({ reply: true }))
    port.listen((value) => {
      heard.push(value)
    })
    await Promise.resolve()
    expect(heard.at(-1)).toEqual({ reply: true })
    port.close()
  })

  it('writes exact bounded wire frames and closes its owned streams on EOF', async () => {
    const readable = new PassThrough()
    const writable = new PassThrough()
    const port = streamPort({ readable, writable, maximum: 1024 })
    const written: Buffer[] = []
    writable.on('data', (value: Buffer) => written.push(value))
    const message = { bytes: new Uint8Array([1, 2]), cursor: 9n }
    port.post(message)
    const bytes = Buffer.concat(written)
    expect(bytes.readUInt32BE(0)).toBe(bytes.length - 4)
    expect(decodeWire(bytes.subarray(4).toString())).toEqual(message)
    const closed = new Promise<void>((resolve) => {
      port.closed(resolve)
    })
    readable.end()
    await closed
    expect(writable.destroyed).toBe(true)
    await new Promise<void>((resolve) => {
      port.closed(resolve)
    })
    port.post('after close')
  })

  it('rejects invalid bounds, oversized pending frames and stalled write queues', async () => {
    const readable = new PassThrough()
    const writable = new PassThrough()
    expect(() => streamPort({ readable, writable, maximum: 0 })).toThrow()
    const port = streamPort({ readable, writable, maximum: 1024 })
    readable.write(frame('x'.repeat(200)).subarray(0, 10))
    expect(() => port.setFrameLimit(-1)).toThrow()
    port.setFrameLimit(128)
    await new Promise<void>((resolve) => {
      port.closed(resolve)
    })
    const otherRead = new PassThrough()
    const otherWrite = new PassThrough()
    const other = streamPort({ readable: otherRead, writable: otherWrite })
    Object.defineProperty(otherWrite, 'writableLength', { get: () => 128 * 1024 * 1024 })
    other.post({ tooMuch: true })
    expect(otherRead.destroyed).toBe(true)
  })

  it('releases both sides on a writer failure without propagating diagnostic contents', async () => {
    const readable = new PassThrough()
    const writable = new PassThrough()
    const port = streamPort({ readable, writable })
    const closed = new Promise<void>((resolve) => {
      port.closed(resolve)
    })
    writable.destroy(new Error('private diagnostic'))
    await closed
    expect(readable.destroyed).toBe(true)
    // Subsequent stream errors cannot become unhandled exceptions.
    readable.emit('error', new Error('later diagnostic'))
    port.close()
    expect(readable.listenerCount('data')).toBe(0)
  })
})
