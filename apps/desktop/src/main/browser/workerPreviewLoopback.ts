import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, request, type IncomingHttpHeaders, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { WorkerPreviewResponse } from '@althar/contracts'

export const PREVIEW_HEADER = 'x-althar-preview-session'
const REMOTE_ORIGIN = 'http://localhost'
const API_ORIGIN = new URL(REMOTE_ORIGIN)
const HOPS = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])

const headersFor = (headers: IncomingHttpHeaders, skip: ReadonlyArray<string>) => {
  const excluded = new Set([
    ...HOPS,
    ...skip,
    ...(headers.connection?.split(',').map((item) => item.trim().toLowerCase()) ?? []),
    PREVIEW_HEADER,
  ])
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !excluded.has(name)))
}

const linkFor = (value: string, origin: string) => {
  const link = URL.parse(value, REMOTE_ORIGIN)
  if (link?.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(link.hostname) || link.username || link.password)
    return null
  return origin + link.pathname + link.search + link.hash
}

/** A throwaway loopback origin for just one browser partition and one live worker run. */
export const workerPreviewLoopback = async (
  connect: (signal: AbortSignal) => Promise<Duplex>,
  signal: AbortSignal,
  olderHome?: (path: string, method: 'GET' | 'HEAD', signal: AbortSignal) => Promise<WorkerPreviewResponse>,
) => {
  signal.throwIfAborted()
  const sockets = new Set<Duplex>()
  const secret = randomBytes(24).toString('hex')
  const bytes = Buffer.from(secret)
  let origin = ''
  let host = ''
  const allowed = (incoming: IncomingMessage) => {
    const credential = incoming.headers[PREVIEW_HEADER]
    const path = incoming.url
    return (
      incoming.headers.host === host &&
      (incoming.headers.origin === undefined || incoming.headers.origin === origin) &&
      typeof credential === 'string' &&
      Buffer.byteLength(credential) === bytes.length &&
      timingSafeEqual(Buffer.from(credential), bytes) &&
      path !== undefined &&
      path.startsWith('/') &&
      !path.startsWith('//') &&
      !path.includes('\\')
    )
  }
  const outgoingHeaders = (incoming: IncomingMessage) => ({
    ...headersFor(incoming.headers, ['host', 'origin', 'referer']),
    host: API_ORIGIN.host,
    ...(incoming.headers.origin === undefined ? {} : { origin: REMOTE_ORIGIN }),
  })
  const local = createServer({ headersTimeout: 5_000, requestTimeout: 30_000, maxHeaderSize: 16 * 1024 }, (incoming, response) => {
    const method = incoming.method
    if (!allowed(incoming) || method === undefined || !METHODS.has(method)) {
      response.writeHead(403, { connection: 'close' }).end()
      return
    }
    const controller = new AbortController()
    response.once('close', () => controller.abort())
    const localSignal = AbortSignal.any([signal, controller.signal])
    void (async () => {
      const socket = await connect(localSignal).catch(async (error: unknown) => {
        if (olderHome === undefined || (method !== 'GET' && method !== 'HEAD')) throw error
        const cached = await olderHome(incoming.url ?? '/', method, localSignal)
        const location = cached.location === null ? null : linkFor(cached.location, origin)
        response.writeHead(cached.status, {
          'content-type': cached.contentType,
          'cache-control': 'no-store',
          ...(location === null ? {} : { location }),
        })
        response.end(method === 'HEAD' ? undefined : Buffer.from(cached.bodyBase64, 'base64'))
        return null
      })
      if (socket === null) return
      const peer = request({
        hostname: API_ORIGIN.hostname,
        path: incoming.url,
        method,
        headers: { ...outgoingHeaders(incoming), connection: 'close' },
        createConnection: () => socket,
        signal: localSignal,
      })
      peer.on('error', () => {
        if (!response.headersSent && !response.destroyed) response.writeHead(502).end('The worker preview is unavailable.')
        else response.destroy()
      })
      peer.once('response', (result) => {
        const headers = headersFor(result.headers, ['location', 'set-cookie'])
        const location = result.headers.location === undefined ? null : linkFor(result.headers.location, origin)
        if (location !== null) headers.location = location
        if (result.headers['set-cookie'] !== undefined)
          headers['set-cookie'] = result.headers['set-cookie'].map((cookie) => cookie.replace(/;\s*domain\s*=[^;]*/gi, ''))
        response.writeHead(result.statusCode ?? 502, headers)
        void pipeline(result, response).catch(() => response.destroy())
      })
      incoming.once('error', () => peer.destroy())
      incoming.pipe(peer)
    })().catch(() => {
      if (!response.headersSent && !response.destroyed) response.writeHead(502).end('The worker preview is unavailable.')
      else response.destroy()
    })
  })
  local.maxConnections = 16
  local.on('connection', (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  local.on('connect', (_request, socket) => socket.destroy())
  local.on('upgrade', (incoming, browser, head) => {
    if (
      !allowed(incoming) ||
      incoming.method !== 'GET' ||
      incoming.headers.upgrade?.toLowerCase() !== 'websocket' ||
      typeof incoming.headers['sec-websocket-key'] !== 'string'
    ) {
      browser.destroy()
      return
    }
    browser.pause()
    const controller = new AbortController()
    browser.once('close', () => controller.abort())
    void connect(AbortSignal.any([signal, controller.signal]))
      .then((worker) => {
        if (browser.destroyed) {
          worker.destroy()
          return
        }
        const headers = { ...outgoingHeaders(incoming), connection: 'Upgrade', upgrade: 'websocket' }
        const serialized = Object.entries(headers).flatMap(([name, values]) =>
          (Array.isArray(values) ? values : [values]).filter((value) => value !== undefined).map((value) => name + ': ' + value),
        )
        worker.write(['GET ' + (incoming.url ?? '/') + ' HTTP/1.1', ...serialized, '', ''].join('\r\n'))
        if (head.byteLength > 0) worker.write(head)
        void pipeline(browser, worker, browser).catch(() => browser.destroy())
      })
      .catch(() => browser.destroy())
  })
  const close = () => {
    local.close()
    for (const socket of sockets) socket.destroy()
  }
  await new Promise<void>((resolve, reject) => {
    local.on('error', reject)
    local.listen(0, '127.0.0.1', resolve)
  })
  signal.addEventListener('abort', close, { once: true })
  if (signal.aborted) {
    close()
    signal.throwIfAborted()
  }
  host = '127.0.0.1:' + (local.address() as AddressInfo).port
  origin = 'http://' + host
  return { origin, host, secret }
}
