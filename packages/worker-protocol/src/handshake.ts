import { create, fromBinary } from '@bufbuild/protobuf'
import { HomeFrameSchema, WorkerFrameSchema, type HomeFrame } from './gen/althar/worker/v1/control_pb.ts'

export const WORKER_PROTOCOL_VERSION = 1
export const MAX_HELLO_BYTES = 4096

export interface WorkerSessionBinding {
  /** Values from the authenticated transport and the home, before reading the peer's claim. */
  readonly homeId: string
  readonly workerId: string
  readonly sessionId: string
}

type Rejection = 'InvalidIdentity' | 'OversizedFrame' | 'InvalidFrame' | 'WrongWorker' | 'IncompatibleVersion'
export class WorkerHandshakeError extends Error {
  readonly reason: Rejection

  constructor(reason: Rejection) {
    super(reason)
    this.name = 'WorkerHandshakeError'
    this.reason = reason
  }
}

export const validWorkerProtocolId = (value: string, prefix: string): boolean =>
  value.startsWith(prefix) && value.length === prefix.length + 32 && /^[a-f0-9]{32}$/.test(value.slice(prefix.length))

/** The caller must authenticate the worker and allocate its session before accepting its first frame. */
export const negotiateWorkerHello = (
  bytes: Uint8Array,
  binding: WorkerSessionBinding,
  diagnostics = false,
  renewals = false,
  logs = false,
): HomeFrame => {
  if (
    !validWorkerProtocolId(binding.homeId, 'home_') ||
    !validWorkerProtocolId(binding.workerId, 'wrk_') ||
    !validWorkerProtocolId(binding.sessionId, 'wsn_')
  )
    throw new WorkerHandshakeError('InvalidIdentity')
  if (bytes.byteLength > MAX_HELLO_BYTES) throw new WorkerHandshakeError('OversizedFrame')
  const frame = (() => {
    try {
      return fromBinary(WorkerFrameSchema, bytes, { readUnknownFields: false })
    } catch {
      throw new WorkerHandshakeError('InvalidFrame')
    }
  })()
  if (frame.payload.case !== 'hello') throw new WorkerHandshakeError('InvalidFrame')
  const hello = frame.payload.value
  if (hello.workerId !== binding.workerId) throw new WorkerHandshakeError('WrongWorker')
  if (hello.minVersion < 1 || hello.minVersion > WORKER_PROTOCOL_VERSION || hello.maxVersion < WORKER_PROTOCOL_VERSION)
    throw new WorkerHandshakeError('IncompatibleVersion')
  const supportsDiagnostics = diagnostics && hello.acceptsDiagnostics
  const supportsDiagnosticLeaseRenewal = supportsDiagnostics && renewals && hello.renewsDiagnosticLease
  return create(HomeFrameSchema, {
    payload: {
      case: 'hello',
      value: {
        ...binding,
        version: WORKER_PROTOCOL_VERSION,
        supportsDiagnostics,
        supportsDiagnosticLeaseRenewal,
        supportsDiagnosticLogs: supportsDiagnosticLeaseRenewal && logs && hello.streamsDiagnosticLogs,
      },
    },
  })
}
