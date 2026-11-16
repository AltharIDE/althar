import { decodeWire, encodeWire, type PortLike } from '@althar/contracts'
import type { Readable, Writable } from 'node:stream'

/** Includes the existing API's maximum image message plus wire overhead; authentication uses a much smaller limit. */
export const MAX_SOCKET_FRAME = 96 * 1024 * 1024
const MAX_BUFFERED_MESSAGES = 32
const MAX_WRITE_BUFFER = 128 * 1024 * 1024

export interface StreamPort extends PortLike {
  close(): void
  closed(handler: () => void): () => void
  setFrameLimit(bytes: number): void
}

export interface ByteStreams {
  readonly readable: Readable
  readonly writable: Writable
  readonly close?: () => void
  readonly maximum?: number
}

/** Bounded, length-prefixed messages on one owned pair of streams; no shell or transport authentication is implied. */
export const streamPort = ({ readable, writable, close: closeStreams, maximum = MAX_SOCKET_FRAME }: ByteStreams): StreamPort => {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > MAX_SOCKET_FRAME) throw new Error('Invalid socket frame limit')
  let frameLimit = maximum
  let ended = false
  let headerAt = 0
  let frameLength = 0
  let received = 0
  let body: Buffer | undefined
  const header = Buffer.alloc(4)
  const buffered: Array<{ readonly message: unknown; readonly bytes: number }> = []
  let bufferedBytes = 0
  let listener: ((message: unknown) => void) | undefined
  let draining = false
  const closed = new Set<() => void>()
  const close = () => {
    if (ended) return
    onClose()
    if (closeStreams !== undefined) closeStreams()
    else {
      readable.destroy()
      writable.destroy()
    }
  }
  const onClose = () => {
    if (ended) return
    ended = true
    body = undefined
    buffered.length = 0
    bufferedBytes = 0
    for (const handler of closed) handler()
    closed.clear()
    readable.off('data', receive)
    listener = undefined
  }
  const drain = () => {
    if (draining || ended || listener === undefined || buffered.length === 0) return
    draining = true
    // Let a one-shot listener receive its unsubscribe function before delivery.
    // Otherwise a coalesced RPC frame can be lost during the auth handoff.
    queueMicrotask(() => {
      const handler = listener
      try {
        while (handler !== undefined && listener === handler && buffered.length > 0 && !ended) {
          const next = buffered.shift()
          if (next === undefined) break
          bufferedBytes -= next.bytes
          handler(next.message)
        }
      } catch {
        close()
      } finally {
        draining = false
        drain()
      }
    })
  }
  const receive = (data: Buffer) => {
    try {
      let at = 0
      while (at < data.length && !ended) {
        if (headerAt < 4) {
          const take = Math.min(4 - headerAt, data.length - at)
          data.copy(header, headerAt, at, at + take)
          headerAt += take
          at += take
          if (headerAt < 4) continue
          frameLength = header.readUInt32BE(0)
          if (frameLength === 0 || frameLength > frameLimit) return close()
          // One allocation bounds memory even when a peer fragments a frame into millions of tiny writes.
          body = Buffer.allocUnsafe(frameLength)
        }
        const take = Math.min(frameLength - received, data.length - at)
        if (take > 0) data.copy(body!, received, at, at + take)
        received += take
        at += take
        if (received !== frameLength) continue
        const text = new TextDecoder('utf-8', { fatal: true }).decode(body)
        const message = decodeWire(text)
        const bytes = frameLength
        body = undefined
        headerAt = 0
        frameLength = 0
        received = 0
        if (listener !== undefined && buffered.length === 0 && !draining) listener(message)
        else {
          bufferedBytes += bytes
          if (buffered.length >= MAX_BUFFERED_MESSAGES || bufferedBytes > frameLimit) return close()
          buffered.push({ message, bytes })
          drain()
        }
      }
    } catch {
      close()
    }
  }
  readable.on('data', receive)
  readable.once('end', close)
  readable.once('close', close)
  writable.once('close', close)
  writable.once('finish', close)
  // A protocol failure closes the stream; never leak message contents into a transport error or leave an unhandled error event.
  readable.on('error', close)
  if (!Object.is(writable, readable)) writable.on('error', close)
  if (readable.destroyed || readable.readableEnded || writable.destroyed || writable.writableFinished) close()
  return {
    close,
    setFrameLimit: (bytes) => {
      if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_SOCKET_FRAME) throw new Error('Invalid socket frame limit')
      frameLimit = bytes
      if (frameLength > bytes || bufferedBytes > bytes) close()
    },
    post: (message) => {
      if (ended || readable.destroyed || writable.destroyed) return
      try {
        const body = Buffer.from(encodeWire(message))
        if (body.length > frameLimit || writable.writableLength + body.length + 4 > MAX_WRITE_BUFFER) return close()
        const prefix = Buffer.alloc(4)
        prefix.writeUInt32BE(body.length)
        writable.cork()
        writable.write(prefix)
        writable.write(body)
        writable.uncork()
      } catch {
        close()
      }
    },
    listen: (handler) => {
      if (listener !== undefined) throw new Error('An Althar socket can have only one active consumer')
      listener = handler
      drain()
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
