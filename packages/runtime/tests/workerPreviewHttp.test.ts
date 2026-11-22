import { Duplex, PassThrough } from 'node:stream'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { WorkerPreviewRequest } from '@althar/contracts'
import { readWorkerPreview, workerPreviewPort } from '../src/workerPreviewHttp'

const request: WorkerPreviewRequest = { id: `proc_${'1'.repeat(32)}`, projectId: `proj_${'2'.repeat(32)}`, path: '/', method: 'GET' }

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
})
