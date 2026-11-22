import { request } from 'node:http'
import { MAX_PREVIEW_BYTES, type WorkerPreviewRequest, type WorkerPreviewResponse } from '@althar/contracts'
import type { WorkerManagedProcess } from '@althar/worker-protocol/agent-runs'

/** A managed dev server must be listening on worker loopback to be previewed. */
export const workerPreviewPort = (address: string): number | null => {
  const url = URL.parse(address)
  if (url === null || url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null
  return url.port === '' ? 80 : Number(url.port)
}

export const readWorkerPreview = async (
  open: NonNullable<WorkerManagedProcess['preview']>,
  port: number,
  input: WorkerPreviewRequest,
  cancellation: AbortSignal,
): Promise<WorkerPreviewResponse> => {
  const path = input.path
  if (!path.startsWith('/') || path.startsWith('//') || /[\s\\]/u.test(path) || path.includes('#'))
    throw new Error('Choose a path in this worker preview.')
  const signal = AbortSignal.any([cancellation, AbortSignal.timeout(20_000)])
  const socket = await open(port, signal)
  const origin = `http://127.0.0.1:${port}`
  try {
    return await new Promise<WorkerPreviewResponse>((resolve, reject) => {
      const outgoing = request(
        {
          host: '127.0.0.1',
          port,
          path,
          method: input.method,
          createConnection: () => socket,
          headers: { 'accept-encoding': 'identity', connection: 'close' },
          signal,
          maxHeaderSize: 16 * 1024,
        },
        (response) => {
          let bytes = 0
          const buffers: Buffer[] = []
          const status = response.statusCode ?? 502
          const contentType = response.headers['content-type'] ?? 'application/octet-stream'
          const destination = response.headers.location
          const normalized = destination === undefined ? null : URL.parse(destination, origin)
          const location =
            normalized !== null && workerPreviewPort(normalized.href) === port && !normalized.username && !normalized.password
              ? `${normalized.pathname}${normalized.search}${normalized.hash}`
              : null
          const encoded = response.headers['content-encoding']
          response.on('error', reject)
          if (
            status < 200 ||
            status > 599 ||
            contentType.length > 512 ||
            (encoded !== undefined && encoded !== 'identity') ||
            (destination !== undefined && (location === null || location.length > 8_192))
          ) {
            response.destroy(new Error('The preview sent an unsupported response.'))
          }
          response.on('data', (chunk: Buffer) => {
            bytes += chunk.byteLength
            if (bytes > MAX_PREVIEW_BYTES) response.destroy(new Error('This preview response is too large.'))
            else buffers.push(chunk)
          })
          response.once('end', () =>
            resolve({ status, contentType, location, bodyBase64: Buffer.concat(buffers, bytes).toString('base64') }),
          )
        },
      )
      outgoing.once('error', reject)
      outgoing.end()
    })
  } finally {
    socket.destroy()
  }
}
