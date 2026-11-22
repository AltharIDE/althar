import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { API_VERSION } from '@althar/contracts'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Fiber } from 'effect'
import { TestClock } from 'effect/testing'

import { hostStatus } from '../src/status'
import { temporary } from './support'

describe('private API health', () => {
  it.live('treats missing, malformed and unreachable endpoints as unavailable without revealing their contents', () =>
    Effect.gen(function* () {
      const root = temporary()
      assert.strictEqual((yield* Effect.flip(hostStatus(root))).code, 'HostUnavailable')
      mkdirSync(join(root, 'api'), { mode: 0o700 })
      assert.strictEqual((yield* Effect.flip(hostStatus(root))).code, 'HostUnavailable')
      const endpoint = {
        protocol: 1,
        homeId: `home_${'1'.repeat(32)}`,
        address: join(root, 'unbound.sock'),
        apiVersion: API_VERSION,
        secret: 'a'.repeat(64),
      }
      for (const data of [
        'private malformed token',
        JSON.stringify({ homeId: 'wrong', secret: 'private' }),
        JSON.stringify({ ...endpoint, address: 'relative.sock' }),
        JSON.stringify({ ...endpoint, apiVersion: API_VERSION + 1 }),
        JSON.stringify(endpoint),
      ]) {
        writeFileSync(join(root, 'api/endpoint.json'), data, { mode: 0o600 })
        const error = yield* Effect.flip(hostStatus(root))
        assert.strictEqual(error.code, 'HostUnavailable')
        assert.notInclude(error.message, 'private malformed token')
        assert.notInclude(error.message, endpoint.secret)
      }
    }),
  )

  it.live.skipIf(process.platform === 'win32')('does not retry an exposed endpoint directory, even when asked to wait', () =>
    Effect.gen(function* () {
      const root = temporary()
      mkdirSync(join(root, 'api'), { mode: 0o700 })
      chmodSync(join(root, 'api'), 0o755)
      assert.strictEqual((yield* Effect.flip(hostStatus(root, true))).code, 'UnsafePermissions')
    }),
  )

  it.effect('bounds readiness waits by the Effect clock', () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(Effect.flip(hostStatus(temporary(), true)))
      yield* TestClock.adjust('31 seconds')
      assert.strictEqual((yield* Fiber.join(fiber)).code, 'HostUnavailable')
    }),
  )
})
