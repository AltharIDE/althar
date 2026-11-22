// @vitest-environment node
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { createConnection, type AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { PREVIEW_HEADER, workerPreviewLoopback } from '../src/main/browser/workerPreviewLoopback'

describe('the private worker preview origin', () => {
  it('requires the window credential and keeps browser requests, cookies and WebSockets on this run', async () => {
    const handshakes: Array<string | undefined> = []
    const upgraded = new Set<import('node:stream').Duplex>()
    const upstream = createServer((req, res) => {
      handshakes.push(req.headers[PREVIEW_HEADER] as string | undefined)
      if (req.url === '/redirect') {
        res.writeHead(302, { Location: 'http://localhost:5173/next#here' }).end()
        return
      }
      if (req.url === '/external') {
        res.writeHead(302, { Location: 'https://external.example/' }).end()
        return
      }
      res.setHeader('Set-Cookie', 'preview=yes; Domain=localhost; HttpOnly; Path=/')
      req.pipe(res)
    })
    upstream.on('upgrade', (req, socket) => {
      upgraded.add(socket)
      socket.once('close', () => upgraded.delete(socket))
      handshakes.push(req.headers[PREVIEW_HEADER] as string | undefined)
      const accept = createHash('sha1')
        .update(String(req.headers['sec-websocket-key']) + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64')
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n',
      )
      socket.write(Buffer.from([0x81, 0x02, 0x6f, 0x6b]))
    })
    const opened: ReturnType<typeof createConnection>[] = []
    const stop = new AbortController()
    try {
      upstream.listen(0, '127.0.0.1')
      await once(upstream, 'listening')
      const addr = upstream.address() as AddressInfo
      const preview = await workerPreviewLoopback(async (signal) => {
        const socket = createConnection({ port: addr.port, host: addr.address })
        opened.push(socket)
        signal.addEventListener('abort', () => socket.destroy(), { once: true })
        await once(socket, 'connect', { signal })
        return socket
      }, stop.signal)
      const headers = { [PREVIEW_HEADER]: preview.secret }
      await expect(fetch(preview.origin).then((response) => response.status)).resolves.toBe(403)
      await expect(
        fetch(preview.origin, { headers: { ...headers, origin: 'http://unrelated.example' } }).then((r) => r.status),
      ).resolves.toBe(403)
      expect(opened).toHaveLength(0)
      const saved = await fetch(preview.origin, { method: 'POST', headers: { ...headers, origin: preview.origin }, body: 'posted' })
      expect(await saved.text()).toBe('posted')
      expect(saved.headers.get('set-cookie')).toBe('preview=yes; HttpOnly; Path=/')
      const moved = await fetch(preview.origin + '/redirect', { headers, redirect: 'manual' })
      expect(moved.headers.get('location')).toBe(preview.origin + '/next#here')
      const external = await fetch(preview.origin + '/external', { headers, redirect: 'manual' })
      expect(external.headers.get('location')).toBeNull()
      const socket = createConnection(Number(preview.host.split(':')[1]), '127.0.0.1')
      const close = once(socket, 'close')
      const read = new Promise<Buffer>((resolve, reject) => {
        const parts: Buffer[] = []
        const disconnected = () => reject(new Error('The browser was disconnected before receiving the frame.'))
        socket.once('close', disconnected)
        socket.on('data', (bytes: Buffer) => {
          parts.push(bytes)
          const data = Buffer.concat(parts)
          if (data.includes(Buffer.from([0x81, 0x02, 0x6f, 0x6b]))) {
            socket.removeListener('close', disconnected)
            resolve(data)
          }
        })
      })
      socket.write(
        [
          'GET /hmr HTTP/1.1',
          'Host: ' + preview.host,
          'Connection: Upgrade',
          'Upgrade: websocket',
          'Origin: ' + preview.origin,
          PREVIEW_HEADER + ': ' + preview.secret,
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version: 13',
          '',
          '',
        ].join('\r\n'),
      )
      const reply = await read
      expect(reply.toString()).toContain('101 Switching Protocols')
      expect(handshakes.every((sent) => sent === undefined)).toBe(true)
      stop.abort()
      await close
    } finally {
      stop.abort()
      for (const socket of opened) socket.destroy()
      for (const socket of upgraded) socket.destroy()
      upstream.closeAllConnections()
      await new Promise<void>((resolve) => upstream.close(() => resolve()))
    }
  })
})
