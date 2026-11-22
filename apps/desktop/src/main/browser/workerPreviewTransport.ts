import { Duplex, Readable, Writable } from 'node:stream'
import { MAX_PREVIEW_SOCKET_CHUNK, type WorkerPreviewRun, type WorkerPreviewApi } from '@althar/contracts'
import { Effect, Stream } from 'effect'
import type { RpcClient, RpcClientError } from 'effect/rpc'

export type PreviewClient = RpcClient.FromGroup<typeof WorkerPreviewApi, RpcClientError.RpcClientError>

/** Keeps the loopback adapter's browser socket behind the authenticated home connection. */
export const workerPreviewTransport = async (client: PreviewClient, run: WorkerPreviewRun, signal: AbortSignal): Promise<Duplex> => {
  const socket = await Effect.runPromise(client.OpenLaunchPreviewSocket(run), { signal })
  const fromWorker = client.ReadLaunchPreviewSocket({ socket }).pipe(Stream.map((data) => Buffer.from(data, 'base64')))
  const outgoing = new Writable({
    write(data: Buffer, _encoding, done) {
      void (async () => {
        for (let at = 0; at < data.length; at += MAX_PREVIEW_SOCKET_CHUNK) {
          const chunk = data.subarray(at, at + MAX_PREVIEW_SOCKET_CHUNK).toString('base64')
          await Effect.runPromise(client.WriteLaunchPreviewSocket({ socket, data: chunk }), { signal })
        }
      })().then(() => done(), done)
    },
  })
  const connection = Duplex.from({ readable: Readable.from(Stream.toAsyncIterable(fromWorker), { objectMode: false }), writable: outgoing })
  const abort = () => connection.destroy()
  signal.addEventListener('abort', abort, { once: true })
  connection.once('close', () => {
    signal.removeEventListener('abort', abort)
    void Effect.runPromise(client.CloseLaunchPreviewSocket({ socket })).catch(() => undefined)
  })
  connection.on('error', () => undefined)
  if (signal.aborted) abort()
  return connection
}
