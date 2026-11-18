import { connect, type Socket } from 'node:net'

import { createWebSocketStream, WebSocket } from 'ws'

import { RELAY_CHUNK_LIMIT, RELAY_READY, RELAY_TOKEN, relayPath } from './relayProtocol.ts'

export interface HomeRelayOptions {
  readonly url: string
  readonly token: string
  readonly ca: Buffer
}

export const validateHomeRelay = (options: HomeRelayOptions): void => {
  const url = new URL(options.url)
  if (
    url.protocol !== 'wss:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    relayPath(url.pathname)?.role !== 'home' ||
    !RELAY_TOKEN.test(options.token) ||
    options.ca.length === 0
  )
    throw new Error('Invalid home relay endpoint or credential')
}

/** Maintain a home-side route independently of the lifetime of an individual worker. */
export const connectHomeRelay = (options: HomeRelayOptions, target: { host: string; port: number }): (() => void) => {
  validateHomeRelay(options)
  let socket: WebSocket | undefined
  let tcp: Socket | undefined
  let retry: NodeJS.Timeout | undefined
  let stopped = false
  let delay = 250

  const dial = (): void => {
    const peer = new WebSocket(options.url, {
      headers: { Authorization: `Bearer ${options.token}` },
      ca: options.ca,
      rejectUnauthorized: true,
      perMessageDeflate: false,
      maxPayload: RELAY_CHUNK_LIMIT,
      handshakeTimeout: 5000,
    })
    socket = peer
    peer.on('error', () => peer.terminate())
    peer.once('close', () => {
      tcp?.destroy()
      tcp = undefined
      socket = undefined
      if (!stopped) {
        retry = setTimeout(dial, delay)
        retry.unref()
        delay = Math.min(delay * 2, 5000)
      }
    })
    peer.once('message', (data, binary) => {
      if (!binary || !Buffer.isBuffer(data) || data.length !== 1 || data[0] !== RELAY_READY) {
        peer.terminate()
        return
      }
      delay = 250
      const local = connect(target)
      tcp = local
      const stream = createWebSocketStream(peer, { highWaterMark: 32 * 1024 })
      const close = () => {
        local.destroy()
        peer.terminate()
      }
      local.once('close', close)
      local.on('error', close)
      stream.on('error', close)
      stream.pipe(local)
      local.pipe(stream)
    })
  }

  dial()
  return () => {
    stopped = true
    clearTimeout(retry)
    tcp?.destroy()
    socket?.terminate()
  }
}
