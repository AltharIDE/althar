import { once } from 'node:events'
import { createConnection, createServer, type Socket } from 'node:net'

import { encodeWire } from '@althar/contracts'
import { assert, describe, it } from '@effect/vitest'

import { socketPort } from '../src/socketPort'

const frame = (value: unknown) => {
  const body = Buffer.from(encodeWire(value))
  const prefix = Buffer.alloc(4)
  prefix.writeUInt32BE(body.length)
  return Buffer.concat([prefix, body])
}
const connected = async (exercise: (writer: Socket, reader: Socket) => Promise<void>) => {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Missing test socket')
  const accepted = once(server, 'connection')
  const writer = createConnection(address.port, '127.0.0.1')
  const [reader] = (await accepted) as [Socket]
  try {
    await exercise(writer, reader)
  } finally {
    writer.destroy()
    reader.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe('framed socket ports', () => {
  it('reassembles fragmented and coalesced frames and buffers the authentication-to-RPC handoff', async () =>
    connected(async (writer, reader) => {
      const port = socketPort(reader, 4096)
      const values = [{ hello: 'world' }, [0, { bytes: new Uint8Array([0, 255]), id: 9n }], { next: true }]
      const first = frame(values[0])
      writer.write(first.subarray(0, 2))
      writer.write(first.subarray(2, 7))
      writer.write(Buffer.concat([first.subarray(7), frame(values[1]), frame(values[2])]))
      const heard: unknown[] = []
      await new Promise<void>((resolve) => {
        port.listen((message) => {
          heard.push(message)
          if (heard.length === 3) resolve()
        })
      })
      assert.deepStrictEqual(heard, values)
      assert.throws(() => port.listen(() => {}), /one active consumer/)
    }))

  it('closes on oversized lengths, invalid UTF-8, invalid wire data and excessive queued frames', async () => {
    const huge = Buffer.alloc(4)
    huge.writeUInt32BE(1025)
    const invalidText = Buffer.from([0, 0, 0, 1, 0xff])
    const invalidWire = Buffer.from([0, 0, 0, 4, 110, 117, 108, 108])
    for (const input of [huge, invalidText, invalidWire, Buffer.concat(Array.from({ length: 33 }, () => frame(null)))]) {
      await connected(async (writer, reader) => {
        const port = socketPort(reader, 1024)
        const ended = new Promise<void>((resolve) => {
          port.closed?.(resolve)
        })
        writer.write(input)
        await ended
        assert.isTrue(reader.destroyed)
      })
    }
  })

  it('limits outgoing messages and notifies subscribers added after the socket closed', async () =>
    connected(async (_writer, reader) => {
      const port = socketPort(reader, 128)
      const ended = new Promise<void>((resolve) => {
        port.closed?.(resolve)
      })
      port.post('x'.repeat(129))
      await ended
      await new Promise<void>((resolve) => {
        port.closed?.(resolve)
      })
      assert.isTrue(reader.destroyed)
    }))
})
