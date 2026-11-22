import { Schema } from 'effect'
import { assert, describe, it } from '@effect/vitest'

import {
  MAX_PREVIEW_SOCKET_CHUNK,
  WorkerPreviewRequest,
  WorkerPreviewSocketData,
  WorkerPreviewSocketId,
  workerPreviewAddress,
  workerPreviewTarget,
} from '../src/workerPreview'

const id = `proc_${'a'.repeat(32)}`
const projectId = `proj_${'b'.repeat(32)}`
const host = `${id}.${projectId}`

describe('worker preview addresses', () => {
  it('round-trips the worker run and carries only path and query to it', () => {
    assert.strictEqual(workerPreviewAddress(projectId, id), `althar-preview://${host}/`)
    assert.deepStrictEqual(workerPreviewTarget(`althar-preview://${host}`), { id, projectId, host, path: '/' })
    assert.deepStrictEqual(workerPreviewTarget(workerPreviewAddress(projectId, id, '/assets/a%20b?cache=1#intro')), {
      id,
      projectId,
      host,
      path: '/assets/a%20b?cache=1',
    })
  })

  it('accepts only the internal scheme and exact run and project IDs', () => {
    for (const address of [
      'unparseable',
      `https://${host}/`,
      `althar-preview://reader@${host}/`,
      `althar-preview://:secret@${host}/`,
      `althar-preview://${host}:8080/`,
      `althar-preview://${id}/`,
      `althar-preview://${host}.example/`,
      `althar-preview://proc_nope.${projectId}/`,
      `althar-preview://${id}.proj_nope/`,
    ]) {
      assert.isNull(workerPreviewTarget(address), address)
    }
  })

  it('bounds the legacy read request and the live socket frame on the wire', () => {
    const request = Schema.decodeUnknownSync(WorkerPreviewRequest)
    assert.deepStrictEqual(request({ id, projectId, path: '/page', method: 'HEAD' }), { id, projectId, path: '/page', method: 'HEAD' })
    assert.throws(() => request({ id, projectId, path: '/page', method: 'POST' }))
    assert.throws(() => request({ id, projectId, path: '/' + 'a'.repeat(8192), method: 'GET' }))
    const socket = Schema.decodeUnknownSync(WorkerPreviewSocketId)
    const data = Schema.decodeUnknownSync(WorkerPreviewSocketData)
    const socketId = `pvs_${'c'.repeat(32)}`
    const encoded = Buffer.alloc(MAX_PREVIEW_SOCKET_CHUNK).toString('base64')
    assert.strictEqual(socket(socketId), socketId)
    assert.throws(() => socket(id))
    assert.strictEqual(data(encoded), encoded)
    assert.throws(() => data(encoded + 'aaaa'))
  })
})
