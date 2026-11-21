import { connect, type Socket } from 'node:net'
import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { status, type MethodDefinition, type ServerDuplexStream } from '@grpc/grpc-js'

import {
  AgentToolsRequestSchema,
  AgentToolsResponseSchema,
  WorkerControlService,
  type AgentToolsRequest,
} from './gen/althar/worker/v1/control_pb.ts'
import { validWorkerProtocolId } from './handshake.ts'
import { MAX_AGENT_CHUNK, type AgentWorkerPool } from './agentRuns.ts'

const handshakeMs = 5_000
const identity = (value: Buffer): Buffer => value

export const agentToolsMethod: MethodDefinition<Buffer, Buffer> = {
  path: '/' + WorkerControlService.typeName + '/' + WorkerControlService.method.agentTools.name,
  requestStream: true,
  responseStream: true,
  requestSerialize: identity,
  requestDeserialize: identity,
  responseSerialize: identity,
  responseDeserialize: identity,
}

export const connectAgentTools = (
  call: ServerDuplexStream<Buffer, Buffer>,
  pool: AgentWorkerPool,
  workerId: () => string | undefined,
): void => {
  let socket: Socket | undefined
  let release: (() => void) | undefined
  let finished = false
  const close = (): void => {
    if (finished) return
    finished = true
    clearTimeout(timer)
    socket?.destroy()
    release?.()
  }
  const fail = (code: status, message: string): void => {
    if (finished) return
    close()
    call.emit('error', Object.assign(new Error(message), { code }))
  }
  const invalidate = (): void => fail(status.PERMISSION_DENIED, 'The agent tool connection has ended.')
  const timer = setTimeout(() => fail(status.DEADLINE_EXCEEDED, 'The worker did not open the tool connection.'), handshakeMs)
  timer.unref()
  call.once('error', close)
  call.once('cancelled', close)
  call.once('close', close)
  call.once('end', () => {
    if (socket === undefined) return fail(status.INVALID_ARGUMENT, 'The worker did not open a tool connection.')
    socket.end()
  })

  let id: string | undefined
  call.on('data', (bytes: Buffer) => {
    if (finished) return
    let request: AgentToolsRequest
    try {
      request = fromBinary(AgentToolsRequestSchema, bytes, { readUnknownFields: false })
    } catch {
      fail(status.INVALID_ARGUMENT, 'The worker sent an invalid tool frame.')
      return
    }
    const enrolled = workerId()
    if (enrolled === undefined || (id !== undefined && id !== enrolled))
      return fail(status.UNAUTHENTICATED, 'The worker certificate is not enrolled.')
    const frame = request.payload
    if (socket === undefined) {
      if (frame.case !== 'runId' || !validWorkerProtocolId(frame.value, 'war_'))
        return fail(status.INVALID_ARGUMENT, 'The first tool frame needs its agent run ID.')
      const lease = pool.openTools(enrolled, frame.value, invalidate)
      if (lease === undefined) return fail(status.PERMISSION_DENIED, 'This worker has no tool connection for that run.')
      id = enrolled
      release = lease.release
      const next = connect({ host: '127.0.0.1', port: lease.port, allowHalfOpen: true })
      socket = next
      clearTimeout(timer)
      next.on('error', () => fail(status.UNAVAILABLE, 'The home tool server could not be reached.'))
      next.on('data', (output: Buffer) => {
        if (finished) return
        if (workerId() !== id) return invalidate()
        for (let offset = 0; offset < output.length; offset += MAX_AGENT_CHUNK) {
          const data = output.subarray(offset, offset + MAX_AGENT_CHUNK)
          if (!call.write(Buffer.from(toBinary(AgentToolsResponseSchema, create(AgentToolsResponseSchema, { data }))))) next.pause()
        }
      })
      call.on('drain', () => next.resume())
      next.once('end', () => {
        close()
        call.end()
      })
      return
    }
    if (frame.case !== 'data' || frame.value.length === 0 || frame.value.length > MAX_AGENT_CHUNK)
      return fail(status.INVALID_ARGUMENT, 'The worker sent invalid tool data.')
    if (!socket.write(frame.value)) {
      call.pause()
      socket.once('drain', () => {
        if (!finished) call.resume()
      })
    }
  })
}
