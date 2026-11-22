import { randomUUID } from 'node:crypto'
import { Duplex, PassThrough } from 'node:stream'
import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { status, type MethodDefinition, type ServerDuplexStream } from '@grpc/grpc-js'

import { AgentPreviewRequestSchema, AgentPreviewResponseSchema, WorkerControlService } from './gen/althar/worker/v1/control_pb.ts'
import { deferred } from './deferred.ts'
import { validWorkerProtocolId } from './handshake.ts'

const CHUNK = 2_048
const OPEN_TIMEOUT = 4_000
const MAX_CONNECTIONS = 4
const identity = (value: Buffer) => value

export const agentPreviewMethod: MethodDefinition<Buffer, Buffer> = {
  path: `/${WorkerControlService.typeName}/${WorkerControlService.method.agentPreview.name}`,
  requestStream: true,
  responseStream: true,
  requestSerialize: identity,
  requestDeserialize: identity,
  responseSerialize: identity,
  responseDeserialize: identity,
}

interface Tunnel {
  readonly workerId: string
  readonly commandId: string
  readonly active: () => boolean
  readonly attach: (peer: ServerDuplexStream<Buffer, Buffer>) => { readonly read: PassThrough; readonly write: PassThrough }
  readonly close: (error: Error) => void
  attached: boolean
}

export const makePreviewTunnels = () => {
  const tunnels = new Map<string, Tunnel>()
  return {
    open(workerId: string, commandId: string, active: () => boolean, notify: (id: string) => void, signal?: AbortSignal) {
      if (signal?.aborted === true || !active()) return Promise.reject(new Error('This worker preview has ended.'))
      if ([...tunnels.values()].filter((tunnel) => tunnel.workerId === workerId).length >= MAX_CONNECTIONS)
        return Promise.reject(new Error('This worker has too many open previews.'))
      const id = `prv_${randomUUID().replaceAll('-', '')}`
      const waiting = deferred<Duplex>()
      const read = new PassThrough({ highWaterMark: 16 * CHUNK })
      const write = new PassThrough({ highWaterMark: 16 * CHUNK })
      const duplex = Duplex.from({ readable: read, writable: write })
      duplex.on('error', () => undefined)
      let server: ServerDuplexStream<Buffer, Buffer> | undefined
      const cleanup = () => {
        clearTimeout(timer)
        tunnels.delete(id)
        signal?.removeEventListener('abort', abort)
      }
      const close = (error: Error) => {
        cleanup()
        waiting.reject(error)
        duplex.destroy(error)
        server?.emit('error', Object.assign(new Error(error.message), { code: status.CANCELLED }))
      }
      const abort = () => close(new Error('The worker preview was closed.'))
      const timer = setTimeout(() => close(new Error('The worker could not open the preview port.')), OPEN_TIMEOUT).unref()
      const tunnel: Tunnel = {
        workerId,
        commandId,
        active,
        attached: false,
        close,
        attach: (peer) => {
          tunnel.attached = true
          server = peer
          clearTimeout(timer)
          waiting.resolve(duplex)
          return { read, write }
        },
      }
      duplex.once('close', cleanup)
      signal?.addEventListener('abort', abort, { once: true })
      tunnels.set(id, tunnel)
      notify(id)
      return waiting.promise
    },
    close: (workerId: string, commandId: string) => {
      for (const tunnel of tunnels.values()) {
        if (tunnel.workerId === workerId && tunnel.commandId === commandId) tunnel.close(new Error('This worker preview has ended.'))
      }
    },
    connect: (call: ServerDuplexStream<Buffer, Buffer>, workerId: () => string | undefined) => {
      let tunnel: Tunnel | undefined
      let output: PassThrough | undefined
      let ended = false
      const fail = (code: status, message: string) => {
        if (ended) return
        ended = true
        output?.destroy(new Error(message))
        call.emit('error', Object.assign(new Error(message), { code }))
      }
      const timer = setTimeout(() => fail(status.DEADLINE_EXCEEDED, 'The worker did not attach its preview.'), OPEN_TIMEOUT).unref()
      const cleanup = () => {
        clearTimeout(timer)
        if (!ended) output?.destroy()
        ended = true
      }
      call.once('close', cleanup)
      call.once('error', cleanup)
      call.once('cancelled', cleanup)
      call.once('end', () => {
        if (output === undefined) return fail(status.INVALID_ARGUMENT, 'The worker did not attach its preview.')
        clearTimeout(timer)
        ended = true
        output.end()
        call.end()
      })
      call.on('data', (bytes: Buffer) => {
        if (ended) return
        try {
          const { payload } = fromBinary(AgentPreviewRequestSchema, bytes, { readUnknownFields: false })
          const enrolled = workerId()
          if (enrolled === undefined) return fail(status.UNAUTHENTICATED, 'The certificate is no longer enrolled.')
          if (tunnel === undefined) {
            if (payload.case !== 'tunnelId' || !validWorkerProtocolId(payload.value, 'prv_'))
              return fail(status.INVALID_ARGUMENT, 'The first preview frame needs its ticket.')
            const offered = tunnels.get(payload.value)
            if (offered === undefined || offered.attached || offered.workerId !== enrolled || !offered.active())
              return fail(status.PERMISSION_DENIED, 'There is no active preview with that ticket.')
            tunnel = offered
            const { read, write } = offered.attach(call)
            clearTimeout(timer)
            output = read
            write.on('data', (chunk: Buffer) => {
              if (!offered.active() || workerId() !== enrolled) return fail(status.PERMISSION_DENIED, 'The preview has ended.')
              for (let offset = 0; offset < chunk.byteLength; offset += CHUNK) {
                const data = chunk.subarray(offset, offset + CHUNK)
                if (!call.write(Buffer.from(toBinary(AgentPreviewResponseSchema, create(AgentPreviewResponseSchema, { data })))))
                  write.pause()
              }
            })
            call.on('drain', () => write.resume())
            return
          }
          if (tunnel.workerId !== enrolled || !tunnel.active()) return fail(status.PERMISSION_DENIED, 'The preview has ended.')
          if (payload.case !== 'data' || payload.value.byteLength === 0 || payload.value.byteLength > CHUNK)
            return fail(status.INVALID_ARGUMENT, 'The worker sent invalid preview data.')
          if (output?.write(payload.value) === false) {
            call.pause()
            output.once('drain', () => {
              if (!ended) call.resume()
            })
          }
        } catch {
          fail(status.INVALID_ARGUMENT, 'The worker sent an invalid preview frame.')
        }
      })
    },
  }
}

export type PreviewTunnels = ReturnType<typeof makePreviewTunnels>
