import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:https'
import type { Duplex } from 'node:stream'

import { createWebSocketStream, WebSocket, WebSocketServer } from 'ws'

import { RELAY_CHUNK_LIMIT, RELAY_READY, RELAY_ROUTE, RELAY_TOKEN, relayPath, type RelayRole } from './relayProtocol.ts'

const DAY = 24 * 60 * 60 * 1000

interface RelayRoute {
  readonly id: string
  readonly homeDigest: string
  readonly workerDigest: string
  readonly expiresAt: number
}

interface RelayServerOptions {
  readonly certificate: Buffer
  readonly key: Buffer
  readonly host: string
  readonly port: number
  readonly routes: unknown
}

interface Link {
  readonly peers: Partial<Record<RelayRole, WebSocket>>
  paired: boolean
  expiry: NodeJS.Timeout
}

const parseRoutes = (raw: unknown, now: number): Map<string, RelayRoute> => {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 128) throw new Error('Expected 1 to 128 worker relay routes')
  const routes = new Map<string, RelayRoute>()
  const credentials = new Set<string>()
  for (const value of raw as unknown[]) {
    if (!value || typeof value !== 'object') throw new Error('Invalid worker relay route')
    const { id, homeDigest, workerDigest, expiresAt } = value as Partial<RelayRoute>
    if (
      typeof id !== 'string' ||
      !RELAY_ROUTE.test(id) ||
      routes.has(id) ||
      typeof homeDigest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(homeDigest) ||
      typeof workerDigest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(workerDigest) ||
      workerDigest === homeDigest ||
      credentials.has(homeDigest) ||
      credentials.has(workerDigest) ||
      typeof expiresAt !== 'number' ||
      !Number.isSafeInteger(expiresAt) ||
      expiresAt <= now ||
      expiresAt - now > DAY
    )
      throw new Error('Invalid worker relay route or expiry')
    routes.set(id, { id, homeDigest, workerDigest, expiresAt })
    credentials.add(homeDigest)
    credentials.add(workerDigest)
  }
  return routes
}

const deny = (socket: Duplex, code: '401 Unauthorized' | '409 Conflict'): void => {
  socket.end(`HTTP/1.1 ${code}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

/** Pair two outbound peers. The forwarded stream contains the existing end-to-end TLS records. */
export const bindWorkerRelay = async (options: RelayServerOptions): Promise<{ port: number; close: () => Promise<void> }> => {
  const routes = parseRoutes(options.routes, Date.now())
  const active = new Map<string, Link>()
  const server = createServer(
    { cert: options.certificate, key: options.key, minVersion: 'TLSv1.2', headersTimeout: 5000, maxHeaderSize: 8192 },
    (_, response) => {
      response.writeHead(404).end()
    },
  )
  const wss = new WebSocketServer({ noServer: true, maxPayload: RELAY_CHUNK_LIMIT, perMessageDeflate: false })
  const release = (id: string, link: Link): void => {
    if (active.get(id) !== link) return
    active.delete(id)
    clearTimeout(link.expiry)
    for (const peer of Object.values(link.peers)) peer.terminate()
  }
  const alive = new WeakSet<WebSocket>()
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!alive.delete(socket)) socket.terminate()
      else if (socket.readyState === WebSocket.OPEN) socket.ping()
    }
  }, 25000)
  heartbeat.unref()

  server.on('upgrade', (request, socket, head) => {
    socket.on('error', () => socket.destroy())
    const match = relayPath(request.url ?? '')
    const route = match === undefined ? undefined : routes.get(match.route)
    const token = request.headers.authorization?.slice('Bearer '.length)
    if (
      !match ||
      !route ||
      route.expiresAt <= Date.now() ||
      !request.headers.authorization?.startsWith('Bearer ') ||
      token === undefined ||
      !RELAY_TOKEN.test(token)
    )
      return deny(socket, '401 Unauthorized')
    const digest = createHash('sha256').update(token).digest()
    const expected = Buffer.from(match.role === 'home' ? route.homeDigest : route.workerDigest, 'hex')
    if (!timingSafeEqual(digest, expected)) return deny(socket, '401 Unauthorized')
    if (active.get(route.id)?.peers[match.role] !== undefined) return deny(socket, '409 Conflict')

    wss.handleUpgrade(request, socket, head, (peer) => {
      let link = active.get(route.id)
      if (link === undefined) {
        const fresh: Link = {
          peers: {},
          paired: false,
          expiry: setTimeout(() => release(route.id, fresh), Math.max(0, route.expiresAt - Date.now())),
        }
        active.set(route.id, fresh)
        link = fresh
      }
      const attached = link
      const end = () => release(route.id, attached)
      attached.peers[match.role] = peer
      alive.add(peer)
      peer.on('pong', () => alive.add(peer))
      peer.once('close', end)
      peer.on('error', end)
      peer.on('message', (_, binary) => {
        if (!attached.paired || !binary) end()
      })
      const { home, worker } = attached.peers
      if (!home || !worker) return
      attached.paired = true
      const homeStream = createWebSocketStream(home, { highWaterMark: 32 * 1024 })
      const workerStream = createWebSocketStream(worker, { highWaterMark: 32 * 1024 })
      homeStream.on('error', end)
      workerStream.on('error', end)
      home.send(Buffer.of(RELAY_READY), (error) => {
        if (error) end()
      })
      worker.send(Buffer.of(RELAY_READY), (error) => {
        if (error) end()
      })
      homeStream.pipe(workerStream)
      workerStream.pipe(homeStream)
    })
  })

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(options.port, options.host, () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Worker relay did not bind to TCP')
    return {
      port: address.port,
      close: async () => {
        clearInterval(heartbeat)
        for (const [id, link] of active) release(id, link)
        wss.close()
        await new Promise<void>((resolve, reject) =>
          server.close((error) => {
            if (error) reject(error)
            else resolve()
          }),
        )
      },
    }
  } catch (error) {
    clearInterval(heartbeat)
    wss.close()
    server.close()
    throw error
  }
}
