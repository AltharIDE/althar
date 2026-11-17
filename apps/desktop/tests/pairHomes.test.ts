import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { removeTreeSync } from '@althar/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Schema } from 'effect'

import { connectionCredentials } from '../src/main/homes/credentials'
import { homeController } from '../src/main/homes/controller'
import { homeStore } from '../src/main/homes/store'
import type { RemoteHome, WindowHome } from '../src/homes'

const roots: string[] = []
const temporary = () => {
  const root = mkdtempSync(join(tmpdir(), 'althar-pair-homes-'))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) removeTreeSync(root)
})
const homeId = `home_${'1'.repeat(32)}`
const deviceId = `dev_${'2'.repeat(32)}`
const secureHome = (): Extract<RemoteHome, { https: unknown }> => ({
  id: `remote_${'3'.repeat(32)}`,
  name: 'My VPS',
  homeId,
  https: { homeId, deviceId, origin: 'https://home.test:6769', tlsKeyPin: '4'.repeat(64) },
})
// A per-test authenticated sealer substitutes only for the OS keyring port.
const protection = () => {
  const secret = randomBytes(32)
  return vi.fn(async (sealing: boolean, value: string) => {
    if (sealing) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', secret, iv)
      return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]).toString('base64')
    }
    const bytes = Buffer.from(value, 'base64')
    const decipher = createDecipheriv('aes-256-gcm', secret, bytes.subarray(0, 12))
    decipher.setAuthTag(bytes.subarray(-16))
    return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString('utf8')
  })
}

describe('connection credentials', () => {
  it('removes a forgotten key from disk and restores only its original sealed record through Undo', async () => {
    const profile = temporary()
    const protect = protection()
    const store = connectionCredentials(profile, protect, () => 0)
    const first = await store.pending('5'.repeat(64), 100, new Set())
    const restore = await store.forget(first.id)
    expect(readFileSync(join(profile, 'connection-keys/devices.json'), 'utf8')).not.toContain(first.id)
    await expect(connectionCredentials(profile, protect).load(first.id)).rejects.toThrow('safely')
    expect(restore).toBeDefined()
    await restore?.()
    await restore?.()
    expect(await store.load(first.id)).toEqual(first.key)
    expect(readFileSync(join(profile, 'connection-keys/devices.json'), 'utf8')).not.toContain(first.key.privateKey)
    expect(await store.forget(`remote_${'0'.repeat(32)}`)).toBeUndefined()
  })

  it('does not overwrite a newer pending key when an old connection is restored', async () => {
    const store = connectionCredentials(temporary(), protection(), () => 0)
    const first = await store.pending('5'.repeat(64), 100, new Set())
    const restore = await store.forget(first.id)
    const newer = await store.pending('5'.repeat(64), 100, new Set())
    await expect(restore?.()).rejects.toThrow('safely')
    expect(await store.load(newer.id)).toEqual(newer.key)
  })

  it('saves only sealed keys and reuses a pending key across concurrent retries and restarts', async () => {
    const profile = temporary()
    const protect = protection()
    const store = connectionCredentials(profile, protect, () => 0)
    const hash = '5'.repeat(64)
    const [first, retry] = await Promise.all([store.pending(hash, 100, new Set()), store.pending(hash, 100, new Set())])
    expect(retry).toEqual(first)
    expect(await connectionCredentials(profile, protect, () => 0).load(first.id)).toEqual(first.key)
    const bytes = readFileSync(join(profile, 'connection-keys/devices.json'), 'utf8')
    expect(bytes).not.toContain(first.key.privateKey)
    expect(bytes).not.toContain('privateKey')
  })

  it('fails before publishing a key when OS protection is unavailable', async () => {
    const profile = temporary()
    const store = connectionCredentials(profile, async () => {
      throw new Error('Unlock the keyring.')
    })
    await expect(store.pending('5'.repeat(64), 100, new Set())).rejects.toThrow('Unlock the keyring')
    expect(() => readFileSync(join(profile, 'connection-keys/devices.json'))).toThrow()
  })

  it('binds sealed data to the record and retains expired keys while a saved home references them', async () => {
    const profile = temporary()
    const protect = protection()
    let now = 0
    const store = connectionCredentials(profile, protect, () => now)
    const first = await store.pending('5'.repeat(64), 10, new Set())
    now = 20
    await store.pending('6'.repeat(64), 100, new Set([first.id]))
    expect(await store.load(first.id)).toEqual(first.key)
    const path = join(profile, 'connection-keys/devices.json')
    const file = Schema.decodeUnknownSync(
      Schema.Struct({
        version: Schema.Literal(1),
        keys: Schema.Array(
          Schema.Struct({
            id: Schema.String,
            pairingHash: Schema.String,
            expiresAt: Schema.Int,
            publicKey: Schema.String,
            sealed: Schema.String,
          }),
        ),
      }),
    )(JSON.parse(readFileSync(path, 'utf8')))
    const tampered = { ...file, keys: file.keys.map((key, index) => (index === 0 ? { ...key, pairingHash: '7'.repeat(64) } : key)) }
    writeFileSync(path, JSON.stringify(tampered), { mode: 0o600 })
    await expect(store.load(first.id)).rejects.toThrow('safely')
  })
})

describe('paired home routing', () => {
  it('reads old SSH settings, versions new settings and distinguishes device connections to the same home', async () => {
    const profile = temporary()
    const ssh = { id: `remote_${'8'.repeat(32)}`, name: 'SSH', homeId, ssh: { target: 'fixture' } }
    writeFileSync(join(profile, 'homes.json'), JSON.stringify({ version: 1, homes: [ssh] }), { mode: 0o600 })
    const store = homeStore(profile)
    await store.save(secureHome())
    expect(await store.list()).toEqual([ssh, secureHome()])
    expect(
      Schema.decodeUnknownSync(Schema.Struct({ version: Schema.Int }))(JSON.parse(readFileSync(join(profile, 'homes.json'), 'utf8')))
        .version,
    ).toBe(2)
    await expect(
      store.save({ ...secureHome(), https: { homeId, deviceId, origin: 'http://home.test', tlsKeyPin: '4'.repeat(64) } }),
    ).rejects.toThrow()
  })

  it('does not open a window after cancellation, and checks the paired device identity on reconnect', async () => {
    const store = homeStore(temporary())
    let finish = (_home: RemoteHome) => {}
    let signal: AbortSignal | undefined
    const opened: WindowHome[] = []
    const controller = homeController({
      store,
      inspect: async () => {
        throw new Error('unused')
      },
      open: (home) => opened.push(home),
      changed: () => {},
      pair: (_code, _name, given) => {
        signal = given
        return new Promise((resolve) => {
          finish = resolve
        })
      },
    })
    controller.register(1, { kind: 'local' })
    const pairing = controller.pair(1, 'opaque-code', 'My VPS')
    controller.navigating(1)
    expect(signal?.aborted).toBe(true)
    finish(secureHome())
    await pairing
    expect(opened).toEqual([])
    expect(await store.list()).toEqual([secureHome()])
    controller.register(2, { kind: 'https', home: secureHome() })
    const { generation } = controller.begin(2)
    const identity = { homeId, deviceId, actorId: `act_${'9'.repeat(32)}`, role: 'socket' }
    expect(() => controller.connected(2, generation, { ...identity, deviceId: `dev_${'0'.repeat(32)}` })).toThrow('unexpected identity')
    expect(controller.connected(2, generation, identity)).toBe(true)
  })
})
