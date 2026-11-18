import { deepEqual, throws } from 'node:assert/strict'
import { it as test } from 'vitest'
import { create, toBinary } from '@bufbuild/protobuf'

import { MAX_HELLO_BYTES, WorkerFrameSchema, negotiateWorkerHello } from '../src/index.ts'

const binding = {
  homeId: 'home_0123456789abcdef0123456789abcdef',
  workerId: 'wrk_0123456789abcdef0123456789abcdef',
  sessionId: 'wsn_0123456789abcdef0123456789abcdef',
}
const offer = (minVersion: number, maxVersion: number, workerId = binding.workerId) =>
  toBinary(WorkerFrameSchema, create(WorkerFrameSchema, { payload: { case: 'hello', value: { workerId, minVersion, maxVersion } } }))

test('selects version 1 from an overlapping range and binds the enrolled worker', () => {
  const reply = negotiateWorkerHello(offer(1, 3), binding)
  deepEqual(reply.payload, {
    case: 'hello',
    value: { $typeName: 'althar.worker.v1.HomeHello', ...binding, version: 1 },
  })
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
