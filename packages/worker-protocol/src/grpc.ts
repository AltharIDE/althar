import { createHash, randomUUID } from 'node:crypto'
import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { Server, ServerCredentials, status, type MethodDefinition, type ServerDuplexStream } from '@grpc/grpc-js'
import { runAgentMethod, type AgentWorkerPool } from './agentRuns.ts'
import { agentToolsMethod, connectAgentTools } from './agentTools.ts'
import {
  DiagnosticOutcome,
  DiagnosticLeaseSchema,
  DiagnosticOfferSchema,
  DiagnosticStartSchema,
  HomeFrameSchema,
  MAX_HELLO_BYTES,
  WorkerControlService,
  WorkerFrameSchema,
  WorkerHandshakeError,
  negotiateWorkerHello,
  validWorkerProtocolId,
  type DiagnosticLog,
  type DiagnosticOffer,
  type DiagnosticResult,
  type HomeFrame,
} from './index.ts'

const identity = (value: Buffer): Buffer => value
const connect: MethodDefinition<Buffer, Buffer> = {
  path: `/${WorkerControlService.typeName}/${WorkerControlService.method.connect.name}`,
  requestStream: true,
  responseStream: true,
  requestSerialize: identity,
  requestDeserialize: identity,
  responseSerialize: identity,
  responseDeserialize: identity,
}

interface HomeWorkerTransport {
  readonly homeId: string
  readonly certificateAuthorityPem: Buffer
  readonly certificatePem: Buffer
  readonly privateKeyPem: Buffer
  /** Look up a currently enrolled worker by SHA-256 of its verified certificate in DER format. */
  readonly workerForCertificate: (fingerprint: string) => string | undefined
  readonly agentWorkers?: AgentWorkerPool
  readonly diagnostics?: {
    readonly cancellationRequested?: (workerId: string, attemptId: string, fence: string) => boolean
    readonly next: (workerId: string, supportsProjectCommands?: boolean) => Omit<DiagnosticOffer, '$typeName'> | undefined
    readonly claim: (workerId: string, attemptId: string, fence: string, maximumMs?: number) => number
    readonly renew?: (workerId: string, attemptId: string, fence: string, maximumMs: number) => number
    readonly appendLog?: (workerId: string, chunk: DiagnosticLog) => boolean
    readonly complete: (workerId: string, result: DiagnosticResult) => boolean
  }
}

export const MAX_DIAGNOSTIC_OUTPUT = 1024
export const MAX_PROJECT_LOG_BYTES = 64 * 1024
export const MAX_DIAGNOSTIC_LOG_CHUNK = 256
export const DIAGNOSTIC_LEASE_MS = 15_000
export const DIAGNOSTIC_RENEWAL_MS = 2_000
export const PROJECT_RUNTIME_MS = 60_000
const DIAGNOSTIC_RUNTIME_MS = 3_000
const MAX_DIAGNOSTIC_RENEWALS = 8
const MAX_DIAGNOSTIC_LOG_CHUNKS = 16
const MAX_PROJECT_LOG_CHUNKS = 1024
const frame = (payload: HomeFrame['payload']) => Buffer.from(toBinary(HomeFrameSchema, create(HomeFrameSchema, { payload })))

export const workerCertificateFingerprint = (der: Uint8Array): string => createHash('sha256').update(der).digest('hex')

const fail = (call: ServerDuplexStream<Buffer, Buffer>, code: status, message: string): void => {
  call.emit('error', Object.assign(new Error(message), { code }))
}

/** Start the worker handshake listener with mutual TLS and explicit enrollment. */
export const bindWorkerHandshake = async (address: string, home: HomeWorkerTransport): Promise<{ port: number; close: () => void }> => {
  if (home.certificateAuthorityPem.length === 0) throw new Error('The home needs a certificate authority for enrolled workers')
  const credentials = ServerCredentials.createSsl(
    home.certificateAuthorityPem,
    [{ cert_chain: home.certificatePem, private_key: home.privateKeyPem }],
    true,
  )
  const server = new Server({
    'grpc.max_receive_message_length': MAX_HELLO_BYTES,
    'grpc.max_send_message_length': MAX_HELLO_BYTES,
    'grpc.max_concurrent_streams': 8,
  })
  const connected = new Set<string>()
  server.addService(
    { connect },
    {
      connect(call: ServerDuplexStream<Buffer, Buffer>) {
        const peer = call.getAuthContext().sslPeerCertificate
        if (!peer) {
          fail(call, status.UNAUTHENTICATED, 'A verified worker certificate is required')
          return
        }
        const fingerprint = workerCertificateFingerprint(peer.raw)
        let workerId: string | undefined
        let ownsStream = false
        let offer: Omit<DiagnosticOffer, '$typeName'> | undefined
        let askedToStart = false
        let supportsRenewal = false
        let supportsLogs = false
        let logChunks = 0
        let cancellationSent = false
        let execution: { until: number; budget: number; sequence: number } | undefined
        let finished = false
        const reject = (code: status, message: string): void => {
          if (finished) return
          finished = true
          fail(call, code, message)
        }
        const finish = (): void => {
          finished = true
          release()
          call.end()
        }
        const expired = (): void => reject(status.DEADLINE_EXCEEDED, 'The worker did not finish the protocol exchange')
        let timer = setTimeout(expired, 5_000)
        const clear = (): void => clearTimeout(timer)
        const release = (): void => {
          clear()
          if (ownsStream && workerId !== undefined) connected.delete(workerId)
          ownsStream = false
        }
        call.once('cancelled', () => {
          finished = true
          release()
        })
        call.once('close', release)
        call.once('error', release)
        const receive = (bytes: Buffer): void => {
          if (finished) return
          try {
            const enrolled = home.workerForCertificate(fingerprint)
            if (!enrolled || (workerId !== undefined && workerId !== enrolled)) {
              reject(status.UNAUTHENTICATED, 'The worker certificate is not enrolled')
              return
            }
            const diagnostics = home.diagnostics
            if (workerId === undefined) {
              workerId = enrolled
              const reply = negotiateWorkerHello(
                bytes,
                { homeId: home.homeId, workerId, sessionId: `wsn_${randomUUID().replaceAll('-', '')}` },
                diagnostics !== undefined,
                diagnostics?.renew !== undefined,
                diagnostics?.appendLog !== undefined,
                diagnostics?.cancellationRequested !== undefined,
              )
              call.write(Buffer.from(toBinary(HomeFrameSchema, reply)))
              if (reply.payload.case === 'hello' && reply.payload.value.supportsDiagnostics) {
                supportsRenewal = reply.payload.value.supportsDiagnosticLeaseRenewal
                supportsLogs = reply.payload.value.supportsDiagnosticLogs
                if (connected.has(workerId)) return reject(status.ALREADY_EXISTS, 'This worker already has an active exchange')
                connected.add(workerId)
                ownsStream = true
                offer = diagnostics?.next(workerId, reply.payload.value.supportsProjectCommands)
                if (offer?.projectCommand !== undefined && !reply.payload.value.supportsProjectCommands)
                  return reject(status.FAILED_PRECONDITION, 'This worker does not support project commands')
              }
              if (offer === undefined) return finish()
              clear()
              timer = setTimeout(expired, DIAGNOSTIC_LEASE_MS + 5_000 + (offer.projectCommand === undefined ? 0 : PROJECT_RUNTIME_MS))
              call.write(frame({ case: 'diagnosticOffer', value: create(DiagnosticOfferSchema, offer) }))
              return
            }
            const payload = fromBinary(WorkerFrameSchema, bytes, { readUnknownFields: false }).payload
            if (
              offer === undefined ||
              diagnostics === undefined ||
              (payload.case !== 'diagnosticClaim' &&
                payload.case !== 'diagnosticRenew' &&
                payload.case !== 'diagnosticLog' &&
                payload.case !== 'diagnosticResult') ||
              payload.value.attemptId !== offer.attemptId ||
              payload.value.fence !== offer.fence
            ) {
              return reject(status.PERMISSION_DENIED, 'This stream does not own the attempt and fence')
            }
            if (payload.case === 'diagnosticClaim') {
              if (askedToStart || offer.claimableForMs === 0) return reject(status.FAILED_PRECONDITION, 'This attempt cannot start again')
              askedToStart = true
              const { attemptId, fence } = offer
              const at = performance.now()
              const runForMs = diagnostics.claim(workerId, attemptId, fence, supportsRenewal ? DIAGNOSTIC_RENEWAL_MS : undefined)
              if (runForMs === 0) return reject(status.FAILED_PRECONDITION, 'The start lease is no longer available')
              if (supportsRenewal)
                execution = {
                  until: at + runForMs,
                  budget: at + (offer.projectCommand === undefined ? DIAGNOSTIC_RUNTIME_MS : PROJECT_RUNTIME_MS),
                  sequence: 0,
                }
              call.write(frame({ case: 'diagnosticStart', value: create(DiagnosticStartSchema, { attemptId, fence, runForMs }) }))
              return
            }
            if (payload.case === 'diagnosticRenew') {
              const { attemptId, fence, sequence } = payload.value
              const at = performance.now()
              if (
                execution === undefined ||
                cancellationSent ||
                sequence !== execution.sequence + 1 ||
                sequence > (offer.projectCommand === undefined ? MAX_DIAGNOSTIC_RENEWALS : PROJECT_RUNTIME_MS / 250) ||
                at >= execution.until
              ) {
                return reject(status.FAILED_PRECONDITION, 'There is no current execution lease to renew on this stream')
              }
              const project = offer.projectCommand !== undefined
              const worker = workerId
              const sendCancellation = () => {
                if (!project || !diagnostics.cancellationRequested?.(worker, attemptId, fence)) return false
                cancellationSent = true
                call.write(
                  frame({ case: 'diagnosticLease', value: create(DiagnosticLeaseSchema, { attemptId, fence, sequence, runForMs: 0 }) }),
                )
                return true
              }
              if (sendCancellation()) return
              const maximumMs = Math.min(DIAGNOSTIC_RENEWAL_MS, Math.floor(execution.budget - at))
              if (maximumMs <= 0) return reject(status.FAILED_PRECONDITION, 'The diagnostic has reached its execution limit')
              const runForMs = diagnostics.renew?.(workerId, attemptId, fence, maximumMs) ?? 0
              if (runForMs === 0) {
                if (sendCancellation()) return
                return reject(status.FAILED_PRECONDITION, 'The execution lease has expired')
              }
              execution = { ...execution, until: at + runForMs, sequence }
              call.write(frame({ case: 'diagnosticLease', value: create(DiagnosticLeaseSchema, { attemptId, fence, sequence, runForMs }) }))
              return
            }
            if (payload.case === 'diagnosticLog') {
              if (!supportsLogs || execution === undefined || performance.now() >= execution.until) {
                return reject(status.FAILED_PRECONDITION, 'This stream has no live grant for diagnostic logs')
              }
              const chunk = payload.value
              if (
                logChunks >= (offer.projectCommand === undefined ? MAX_DIAGNOSTIC_LOG_CHUNKS : MAX_PROJECT_LOG_CHUNKS) ||
                chunk.output.length === 0 ||
                chunk.output.length > MAX_DIAGNOSTIC_LOG_CHUNK ||
                chunk.offset + chunk.output.length > (offer.projectCommand === undefined ? MAX_DIAGNOSTIC_OUTPUT : MAX_PROJECT_LOG_BYTES)
              ) {
                return reject(status.INVALID_ARGUMENT, 'The diagnostic log chunk exceeds its size limit')
              }
              if (!diagnostics.appendLog?.(workerId, chunk)) {
                return reject(status.FAILED_PRECONDITION, 'The diagnostic log cursor or lease is no longer current')
              }
              logChunks += 1
              return
            }
            const result = payload.value
            if (
              !validWorkerProtocolId(result.attemptId, offer.projectCommand === undefined ? 'watt_' : 'wpr_') ||
              !validWorkerProtocolId(result.fence, 'wfn_') ||
              !(
                [DiagnosticOutcome.SUCCEEDED, DiagnosticOutcome.FAILED, DiagnosticOutcome.UNKNOWN].some(
                  (outcome) => outcome === result.outcome,
                ) ||
                (offer.projectCommand !== undefined && result.outcome === DiagnosticOutcome.CANCELLED)
              ) ||
              result.output.length > MAX_DIAGNOSTIC_OUTPUT ||
              (result.outcome === DiagnosticOutcome.UNKNOWN && result.output.length !== 0)
            ) {
              return reject(status.INVALID_ARGUMENT, 'The worker returned an invalid diagnostic result')
            }
            if (!diagnostics.complete(workerId, result)) return reject(status.FAILED_PRECONDITION, 'The attempt is no longer active')
            return finish()
          } catch (error) {
            if (error instanceof WorkerHandshakeError) {
              const code = error.reason === 'WrongWorker' ? status.PERMISSION_DENIED : status.INVALID_ARGUMENT
              reject(code, error.message)
              return
            }
            reject(status.INTERNAL, 'Could not complete the worker exchange')
          }
        }
        call.on('data', receive)
        call.once('end', () => reject(status.INVALID_ARGUMENT, 'The worker exchange ended before completion'))
      },
    },
  )
  const { agentWorkers } = home
  if (agentWorkers !== undefined) {
    server.addService(
      { runAgent: runAgentMethod, agentTools: agentToolsMethod },
      {
        runAgent(call: ServerDuplexStream<Buffer, Buffer>) {
          const peer = call.getAuthContext().sslPeerCertificate
          if (!peer) return fail(call, status.UNAUTHENTICATED, 'A verified worker certificate is required')
          const fingerprint = workerCertificateFingerprint(peer.raw)
          if (!home.workerForCertificate(fingerprint)) return fail(call, status.UNAUTHENTICATED, 'The worker certificate is not enrolled')
          agentWorkers.connect(call, home.homeId, () => home.workerForCertificate(fingerprint))
        },
        agentTools(call: ServerDuplexStream<Buffer, Buffer>) {
          const peer = call.getAuthContext().sslPeerCertificate
          if (!peer) return fail(call, status.UNAUTHENTICATED, 'A verified worker certificate is required')
          const fingerprint = workerCertificateFingerprint(peer.raw)
          connectAgentTools(call, agentWorkers, () => home.workerForCertificate(fingerprint))
        },
      },
    )
  }
  try {
    const port = await new Promise<number>((resolve, reject) => {
      server.bindAsync(address, credentials, (error, bound) => {
        if (error) reject(error)
        else resolve(bound)
      })
    })
    return { port, close: () => server.forceShutdown() }
  } catch (error) {
    server.forceShutdown()
    throw error
  }
}
