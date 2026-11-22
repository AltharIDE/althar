import { Duplex, PassThrough } from 'node:stream'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import { MAX_PREVIEW_BYTES, type WorkerPreviewRequest } from '@althar/contracts'
import { readWorkerPreview, workerPreviewPort } from '../src/workerPreviewHttp'

const request: WorkerPreviewRequest = { id: `proc_${'1'.repeat(32)}`, projectId: `proj_${'2'.repeat(32)}`, path: '/', method: 'GET' }

const replyWith = (head: string, body?: Buffer) => async () => {
  const fromWorker = new PassThrough()
  const toWorker = new PassThrough()
  toWorker.once('data', () => {
    fromWorker.write(head)
    fromWorker.end(body)
  })
  return Duplex.from({ readable: fromWorker, writable: toWorker })
}

describe('worker HTTP previews', () => {
  it('reads an HTTP response through a preview duplex and strips app cookies', async () => {
    const server = createServer((received, reply) => {
      expect(received.headers['accept-encoding']).toBe('identity')
      reply.setHeader('Set-Cookie', 'private=worker')
      reply.setHeader('Content-Type', 'text/html')
      reply.end('<h1>From the worker</h1>')
    })
    server.listen(0, '127.0.0.1')
    try {
      await once(server, 'listening')
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('No fixture port')
      const result = await readWorkerPreview(
        async (port) => {
          const socket = connect({ host: '127.0.0.1', port })
          const fromWorker = new PassThrough()
          const toWorker = new PassThrough()
          socket.pipe(fromWorker)
          toWorker.pipe(socket)
          const duplex = Duplex.from({ readable: fromWorker, writable: toWorker })
          duplex.once('close', () => socket.destroy())
          return duplex
        },
        address.port,
        request,
        new AbortController().signal,
      )
      expect(result).toEqual({
        status: 200,
        contentType: 'text/html',
        location: null,
        bodyBase64: Buffer.from('<h1>From the worker</h1>').toString('base64'),
      })
    } finally {
      server.close()
      server.closeAllConnections()
    }
  })

  it('rejects arbitrary destinations before opening a tunnel', async () => {
    const open = () => Promise.reject(new Error('Should not connect'))
    await expect(readWorkerPreview(open, 3000, { ...request, path: '//example.org/' }, new AbortController().signal)).rejects.toThrow(
      'Choose a path',
    )
    expect(workerPreviewPort('http://[::1]:5173')).toBe(5173)
    expect(workerPreviewPort('https://localhost:5173')).toBeNull()
    expect(workerPreviewPort('http://0.0.0.0:5173')).toBeNull()
  })

  it.each(['missing', '//example.org/', '/test#fragment', '/directory\\file', '/space here'])(
    'refuses invalid request path %s before opening a tunnel',
    async (path) => {
      const open = () => Promise.reject(new Error('Should not connect'))
      await expect(readWorkerPreview(open, 5173, { ...request, path }, new AbortController().signal)).rejects.toThrow('Choose a path')
    },
  )

  it('uses HTTP defaults and confines redirects to the owned listener', async () => {
    expect(workerPreviewPort('bad address')).toBeNull()
    expect(workerPreviewPort('http://localhost/')).toBe(80)
    const signal = new AbortController().signal
    const redirect = async (destination: string) =>
      readWorkerPreview(
        replyWith('HTTP/1.1 302 Found\r\nLocation: ' + destination + '\r\nContent-Length: 0\r\n\r\n'),
        5173,
        request,
        signal,
      )
    await expect(redirect('/other?flag=1#notice')).resolves.toEqual({
      status: 302,
      contentType: 'application/octet-stream',
      location: '/other?flag=1#notice',
      bodyBase64: '',
    })
    await expect(redirect('http://localhost:5173/other')).resolves.toMatchObject({ location: '/other' })
    for (const destination of [
      'https://localhost:5173/other',
      'http://localhost:5174/other',
      'http://example.org:5173/other',
      'http://user@localhost:5173/other',
      'http://:password@localhost:5173/other',
      '/a' + 'x'.repeat(8_192),
    ])
      await expect(redirect(destination)).rejects.toThrow('unsupported response')
  })

  it('refuses unexpectedly encoded, oversized, or non-HTTP response data and closes the tunnel', async () => {
    const signal = new AbortController().signal
    for (const header of [
      'HTTP/1.1 600 Invalid\r\nContent-Length: 0\r\n\r\n',
      'HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: 0\r\n\r\n',
      'HTTP/1.1 200 OK\r\nContent-Type: ' + 'a'.repeat(513) + '\r\nContent-Length: 0\r\n\r\n',
    ])
      await expect(readWorkerPreview(replyWith(header), 5173, request, signal)).rejects.toThrow('unsupported response')
    const length = MAX_PREVIEW_BYTES + 1
    const open = replyWith('HTTP/1.1 200 OK\r\nContent-Encoding: identity\r\nContent-Length: ' + length + '\r\n\r\n', Buffer.alloc(length))
    const tunnel = await open()
    await expect(readWorkerPreview(async () => tunnel, 5173, request, signal)).rejects.toThrow('too large')
    expect(tunnel.destroyed).toBe(true)
  })
})
