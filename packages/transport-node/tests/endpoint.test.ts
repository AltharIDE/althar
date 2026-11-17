import { chmodSync, linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Effect } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { removeTreeSync } from '@althar/testing'

import { readLocalEndpoint } from '../src/endpoint'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) removeTreeSync(root)
})
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'althar-client-endpoint-'))
  roots.push(root)
  mkdirSync(join(root, 'api'), { mode: 0o700 })
  const endpoint = { protocol: 1, homeId: `home_${'1'.repeat(32)}`, apiVersion: 1, address: join(root, 'api.sock'), secret: 'a'.repeat(64) }
  const file = join(root, 'api/endpoint.json')
  writeFileSync(file, JSON.stringify(endpoint), { mode: 0o600 })
  return { root, file, endpoint }
}
describe('private endpoint discovery', () => {
  it('reads an existing private descriptor and pins the expected home/version', async () => {
    const at = fixture()
    expect(await Effect.runPromise(readLocalEndpoint(at.root, at.endpoint.homeId))).toEqual(at.endpoint)
    expect(await Effect.runPromise(Effect.flip(readLocalEndpoint(at.root, `home_${'2'.repeat(32)}`)))).toMatchObject({
      reason: 'HomeMismatch',
    })
    writeFileSync(at.file, JSON.stringify({ ...at.endpoint, apiVersion: 2 }))
    expect(await Effect.runPromise(Effect.flip(readLocalEndpoint(at.root)))).toMatchObject({ reason: 'ApiVersionMismatch' })
  })
  it('fails closed on missing, linked, exposed, malformed and oversized descriptors without echoing secrets', async () => {
    const at = fixture()
    for (const content of ['not JSON', '{}', 'x'.repeat(16_385), JSON.stringify({ ...at.endpoint, address: 'relative' })]) {
      writeFileSync(at.file, content)
      const error = await Effect.runPromise(Effect.flip(readLocalEndpoint(at.root)))
      expect(error.reason).toBe('UnsafeEndpoint')
      expect(JSON.stringify(error)).not.toContain(at.endpoint.secret)
    }
    if (process.platform !== 'win32') {
      writeFileSync(at.file, JSON.stringify(at.endpoint))
      chmodSync(at.file, 0o644)
      expect(await Effect.runPromise(Effect.flip(readLocalEndpoint(at.root)))).toMatchObject({ reason: 'UnsafeEndpoint' })
      chmodSync(at.file, 0o600)
      linkSync(at.file, join(at.root, 'linked'))
      expect(await Effect.runPromise(Effect.flip(readLocalEndpoint(at.root)))).toMatchObject({ reason: 'UnsafeEndpoint' })
      rmSync(at.file)
      symlinkSync(join(at.root, 'linked'), at.file)
      expect(await Effect.runPromise(Effect.flip(readLocalEndpoint(at.root)))).toMatchObject({ reason: 'UnsafeEndpoint' })
    }
    rmSync(at.file)
    expect(await Effect.runPromise(Effect.flip(readLocalEndpoint(at.root)))).toMatchObject({ reason: 'UnsafeEndpoint' })
    expect(await Effect.runPromise(Effect.flip(readLocalEndpoint('relative')))).toMatchObject({ reason: 'UnsafeEndpoint' })
  })
})
