import { deepEqual, throws } from 'node:assert/strict'
import { it as test } from 'vitest'
import { create, toBinary } from '@bufbuild/protobuf'

import { MAX_HELLO_BYTES, WorkerFrameSchema, negotiateWorkerHello } from '../src/index.ts'

const binding = {
  homeId: 'home_0123456789abcdef0123456789abcdef',
  workerId: 'wrk_0123456789abcdef0123456789abcdef',
  sessionId: 'wsn_0123456789abcdef0123456789abcdef',
}
const offer = (
  minVersion: number,
  maxVersion: number,
  workerId = binding.workerId,
  acceptsDiagnostics = false,
  renewsDiagnosticLease = false,
  streamsDiagnosticLogs = false,
) =>
  toBinary(
    WorkerFrameSchema,
    create(WorkerFrameSchema, {
      payload: {
        case: 'hello',
        value: { workerId, minVersion, maxVersion, acceptsDiagnostics, renewsDiagnosticLease, streamsDiagnosticLogs },
      },
    }),
  )

test('selects version 1 from an overlapping range and binds the enrolled worker', () => {
  const reply = negotiateWorkerHello(offer(1, 3), binding)
  deepEqual(reply.payload, {
    case: 'hello',
    value: {
      $typeName: 'althar.worker.v1.HomeHello',
      ...binding,
      version: 1,
      supportsDiagnostics: false,
      supportsDiagnosticLeaseRenewal: false,
      supportsDiagnosticLogs: false,
    },
  })
})

test('enables diagnostics only when both peers offer it', () => {
  const worker = offer(1, 1, binding.workerId, true)
  for (const [bytes, homeSupports, expected] of [
    [offer(1, 1), true, false],
    [worker, false, false],
    [worker, true, true],
  ] as const) {
    const reply = negotiateWorkerHello(bytes, binding, homeSupports)
    deepEqual(reply.payload.case === 'hello' && reply.payload.value.supportsDiagnostics, expected)
  }
})

test('advertises renewal only when both peers support diagnostic leases', () => {
  const renewable = offer(1, 1, binding.workerId, true, true)
  const legacy = offer(1, 1, binding.workerId, true)
  for (const [bytes, diagnostics, renewal, expected] of [
    [renewable, false, true, false],
    [legacy, true, true, false],
    [renewable, true, false, false],
    [renewable, true, true, true],
  ] as const) {
    const reply = negotiateWorkerHello(bytes, binding, diagnostics, renewal)
    deepEqual(reply.payload.case === 'hello' && reply.payload.value.supportsDiagnosticLeaseRenewal, expected)
  }
})

test('negotiates live logs only with a renewable diagnostic lease and matching capabilities', () => {
  const logWorker = offer(1, 1, binding.workerId, true, true, true)
  const noRenewal = offer(1, 1, binding.workerId, true, false, true)
  const noLogs = offer(1, 1, binding.workerId, true, true)
  for (const [bytes, logs, expected] of [
    [logWorker, true, true],
    [logWorker, false, false],
    [noRenewal, true, false],
    [noLogs, true, false],
  ] as const) {
    const reply = negotiateWorkerHello(bytes, binding, true, true, logs)
    deepEqual(reply.payload.case === 'hello' && reply.payload.value.supportsDiagnosticLogs, expected)
  }
})

test('rejects absent versions, inverted ranges and unsupported versions', () => {
  for (const [min, max] of [
    [0, 1],
    [1, 0],
    [3, 2],
    [2, 3],
  ] as const) {
    throws(() => negotiateWorkerHello(offer(min, max), binding), { reason: 'IncompatibleVersion' })
  }
})

test('checks the worker claim against the authenticated transport', () => {
  throws(() => negotiateWorkerHello(offer(1, 1, 'wrk_ffffffffffffffffffffffffffffffff'), binding), { reason: 'WrongWorker' })
  throws(() => negotiateWorkerHello(offer(1, 1), { ...binding, homeId: binding.homeId + '\n' }), { reason: 'InvalidIdentity' })
})

test('rejects missing, malformed and oversized first frames', () => {
  for (const bytes of [new Uint8Array(), Uint8Array.of(0xff)]) {
    throws(() => negotiateWorkerHello(bytes, binding), { reason: 'InvalidFrame' })
  }
  throws(() => negotiateWorkerHello(new Uint8Array(MAX_HELLO_BYTES + 1), binding), { reason: 'OversizedFrame' })
})
