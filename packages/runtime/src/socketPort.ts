import { decodeWire, encodeWire, type PortLike } from '@althar/contracts'
import type { Socket } from 'node:net'

/** Includes the existing API's maximum image message plus wire overhead; authentication uses a much smaller limit. */
export const MAX_SOCKET_FRAME = 96 * 1024 * 1024
const MAX_BUFFERED_MESSAGES = 32
const MAX_WRITE_BUFFER = 128 * 1024 * 1024

export interface SocketPort extends PortLike {
  close(): void
  setFrameLimit(bytes: number): void
}

/** A length-prefixed, bounded, single-consumer port. Buffers the handoff from authentication to RPC without losing messages. */
export const socketPort = (socket: Socket, maximum = MAX_SOCKET_FRAME): SocketPort => {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > MAX_SOCKET_FRAME) throw new Error('Invalid socket frame limit')
  let frameLimit = maximum
  let ended = socket.destroyed
  let headerAt = 0
  let frameLength = 0
  let received = 0
  let chunks: Array<Uint8Array> = []
  const header = Buffer.alloc(4)
  const buffered: Array<{ readonly message: unknown; readonly bytes: number }> = []
  let bufferedBytes = 0
  let listener: ((message: unknown) => void) | undefined
  const closed = new Set<() => void>()
  const close = () => socket.destroy()
  const onClose = () => {
    if (ended) return
    ended = true
    chunks = []
    buffered.length = 0
    bufferedBytes = 0
    for (const handler of closed) handler()
    closed.clear()
    socket.off('data', receive)
    listener = undefined
  }
  const receive = (data: Buffer) => {
    try {
      let at = 0
      while (at < data.length && !socket.destroyed) {
        if (headerAt < 4) {
          const take = Math.min(4 - headerAt, data.length - at)
          data.copy(header, headerAt, at, at + take)
          headerAt += take
          at += take
          if (headerAt < 4) continue
          frameLength = header.readUInt32BE(0)
          if (frameLength === 0 || frameLength > frameLimit) return void close()
        }
        const take = Math.min(frameLength - received, data.length - at)
        if (take > 0) chunks.push(data.subarray(at, at + take))
        received += take
        at += take
        if (received !== frameLength) continue
        const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, frameLength))
        const message = decodeWire(text)
        const bytes = frameLength
        chunks = []
        headerAt = 0
        frameLength = 0
        received = 0
        if (listener !== undefined) listener(message)
        else {
          bufferedBytes += bytes
          if (buffered.length >= MAX_BUFFERED_MESSAGES || bufferedBytes > frameLimit) return void close()
          buffered.push({ message, bytes })
        }
      }
    } catch {
      close()
    }
  }
  socket.on('data', receive)
  socket.once('close', onClose)
  // A protocol failure closes the stream; never leak message contents into a transport error or leave an unhandled error event.
  socket.on('error', close)
  return {
    close,
    setFrameLimit: (bytes) => {
      if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_SOCKET_FRAME) throw new Error('Invalid socket frame limit')
      frameLimit = bytes
      if (frameLength > bytes || bufferedBytes > bytes) close()
    },
    post: (message) => {
      if (ended || socket.destroyed) return
      try {
        const body = Buffer.from(encodeWire(message))
        if (body.length > frameLimit || socket.writableLength + body.length + 4 > MAX_WRITE_BUFFER) return void close()
        const prefix = Buffer.alloc(4)
        prefix.writeUInt32BE(body.length)
        socket.cork()
        socket.write(prefix)
        socket.write(body)
        socket.uncork()
      } catch {
        close()
      }
    },
    listen: (handler) => {
      if (listener !== undefined) throw new Error('An Althar socket can have only one active consumer')
      listener = handler
      while (buffered.length > 0 && listener === handler && !ended) {
        const next = buffered.shift()
        if (next === undefined) break
        bufferedBytes -= next.bytes
        handler(next.message)
      }
      return () => {
        if (listener === handler) listener = undefined
      }
    },
    closed: (handler) => {
      if (ended) queueMicrotask(handler)
      else closed.add(handler)
      return () => {
        closed.delete(handler)
      }
    },
  }
}
