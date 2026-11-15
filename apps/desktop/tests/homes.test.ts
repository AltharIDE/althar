import { chmodSync, linkSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { removeTreeSync } from '@althar/testing'
import { afterEach, describe, expect, it } from 'vitest'

import { homeController } from '../src/main/homes/controller'
import { homeName, homeStore, homeTarget } from '../src/main/homes/store'
import { homePartition, remoteExternalUrl } from '../src/main/homes/policy'
import type { RemoteHome, WindowHome } from '../src/homes'

const homeId = `home_${'1'.repeat(32)}`
const status = { homeId, hostDeviceId: `dev_${'2'.repeat(32)}`, apiVersion: 1, version: 'fixture' }
const identity = { homeId, actorId: `act_${'3'.repeat(32)}`, deviceId: status.hostDeviceId, role: 'socket' as const }
const remote = (digit = '4'): RemoteHome => ({ id: `remote_${digit.repeat(32)}`, name: 'VPS', homeId, ssh: { target: 'fixture' } })
const roots: string[] = []
const temporary = () => {
  const root = mkdtempSync(join(tmpdir(), 'althar-homes-'))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) removeTreeSync(root)
})

describe('saved homes', () => {
  it('atomically preserves concurrent choices, deduplicates connections and forgets only local settings', async () => {
    const store = homeStore(temporary())
    expect(await store.list()).toEqual([])
    await Promise.all([store.save(remote()), store.save({ ...remote('5'), ssh: { target: 'other-host' } })])
    expect(await store.list()).toHaveLength(2)
    expect(await store.save({ ...remote('6'), name: 'Another label' })).toEqual(remote())
    await store.forget(remote().id)
    expect((await store.list()).map((home) => home.id)).toEqual([remote('5').id])
  })
  it('refuses malformed, linked, exposed or oversized files without replacing them', async () => {
    const root = temporary()
    const store = homeStore(root)
    const path = join(root, 'homes.json')
    for (const content of [
      'private invalid JSON',
      '{}',
      'x'.repeat(256 * 1024 + 1),
      JSON.stringify({ version: 1, homes: [remote(), remote()] }),
    ]) {
      writeFileSync(path, content, { mode: 0o600 })
      await expect(store.save(remote())).rejects.toThrow('could not be read safely')
      expect(readFileSync(path, 'utf8')).toBe(content)
    }
    rmSync(path)
    if (process.platform !== 'win32') {
      const outside = join(root, 'outside')
      writeFileSync(outside, JSON.stringify({ version: 1, homes: [] }), { mode: 0o600 })
      symlinkSync(outside, path)
      await expect(store.list()).rejects.toThrow('safely')
      rmSync(path)
      linkSync(outside, path)
      await expect(store.list()).rejects.toThrow('safely')
      rmSync(path)
      writeFileSync(path, JSON.stringify({ version: 1, homes: [] }), { mode: 0o644 })
      chmodSync(path, 0o644)
      await expect(store.list()).rejects.toThrow('safely')
      chmodSync(path, 0o600)
      chmodSync(root, 0o777)
      await expect(store.list()).rejects.toThrow('safely')
      chmodSync(root, 0o700)
    }
  })
  it('validates literal connection settings and rejects credential fields or shell fragments', () => {
    expect(homeName('  My host ')).toBe('My host')
    for (const name of ['', 'x'.repeat(121), 'unsafe\nname', null]) expect(() => homeName(name)).toThrow()
    for (const target of [
      { target: '-oProxyCommand=bad' },
      { target: 'host;bad' },
      { target: 'host', password: 'private' },
      { target: 'host', profile: 'relative' },
      { target: 'host', port: 0 },
      null,
    ])
      expect(() => homeTarget(target)).toThrow()
    expect(homeTarget({ target: 'user@fixture', profile: "/literal ' $profile", port: 2222 })).toEqual({
      target: 'user@fixture',
      profile: "/literal ' $profile",
      port: 2222,
    })
  })
})

describe('home confirmations', () => {
  const fixture = (inspect = async () => status) => {
    let at = 0
    const opened: WindowHome[] = []
    const controller = homeController({
      store: homeStore(temporary()),
      inspect,
      open: (home) => {
        opened.push(home)
      },
      changed: () => {},
      now: () => at,
    })
    controller.register(1, { kind: 'local' })
    controller.register(2, { kind: 'local' })
    return {
      controller,
      opened,
      advance: (milliseconds: number) => {
        at += milliseconds
      },
    }
  }
  it('binds one-use confirmation to a window and expires or cancels it on navigation', async () => {
    const at = fixture()
    const checked = await at.controller.inspect(1, { target: 'fixture' })
    await expect(at.controller.connect(2, checked.checkId, 'Host')).rejects.toThrow('another window')
    await at.controller.connect(1, checked.checkId, 'Host')
    expect(at.opened).toHaveLength(1)
    await expect(at.controller.connect(1, checked.checkId, 'Host')).rejects.toThrow('expired')
    const expired = await at.controller.inspect(1, { target: 'fixture' })
    at.advance(5 * 60_000 + 1)
    await expect(at.controller.connect(1, expired.checkId, 'Host')).rejects.toThrow('expired')
    const cancelled = await at.controller.inspect(1, { target: 'fixture' })
    at.controller.navigating(1)
    await expect(at.controller.connect(1, cancelled.checkId, 'Host')).rejects.toThrow('expired')
    const closed = await at.controller.inspect(1, { target: 'fixture' })
    at.controller.closed(1)
    await expect(at.controller.connect(1, closed.checkId, 'Host')).rejects.toThrow('expired')
  })
  it('pins home and socket authority and ignores callbacks from an older tunnel', async () => {
    const at = fixture()
    const checked = await at.controller.inspect(1, { target: 'fixture' })
    await at.controller.connect(1, checked.checkId, 'Host')
    const current = at.opened[0]!
    at.controller.register(3, current)
    const old = at.controller.begin(3)
    const next = at.controller.begin(3)
    expect(at.controller.connected(3, old.generation, identity)).toBe(false)
    expect(() => at.controller.connected(3, next.generation, { ...identity, role: 'window' })).toThrow('authority')
    expect(() => at.controller.connected(3, next.generation, { ...identity, homeId: `home_${'8'.repeat(32)}` })).toThrow('identity')
    expect(at.controller.connected(3, next.generation, identity)).toBe(true)
    at.controller.disconnected(3, old.generation)
    expect(at.controller.state(3).connection).toBe('connected')
    at.controller.disconnected(3, next.generation)
    expect(at.controller.state(3).connection).toBe('disconnected')
    const saved = (await at.controller.list())[0]!
    await at.controller.open(1, saved.id)
    expect(at.opened.at(-1)).toEqual(current)
    await at.controller.forget(1, saved.id)
    await expect(at.controller.open(1, saved.id)).rejects.toThrow('forgotten')
    expect(at.controller.state(3).current).toEqual(current)
    await at.controller.open(1, 'local')
    expect(at.opened.at(-1)).toEqual({ kind: 'local' })
  })
  it('cancels active checks and refuses new work during shutdown without changing a window’s home', async () => {
    let signal: AbortSignal | undefined
    let finish: (value: typeof status) => void = () => {}
    const controller = homeController({
      store: homeStore(temporary()),
      inspect: (_target, stopping) => {
        signal = stopping
        return new Promise((done) => {
          finish = done
        })
      },
      open: () => {
        throw new Error('No window may open')
      },
      changed: () => {},
    })
    controller.register(1, { kind: 'ssh', home: remote() })
    const checking = controller.inspect(1, { target: 'fixture' })
    controller.stopping()
    expect(signal?.aborted).toBe(true)
    finish(status)
    await expect(checking).rejects.toThrow('expired')
    await expect(controller.inspect(1, { target: 'fixture' })).rejects.toThrow('closing')
    await expect(controller.open(1, 'local')).rejects.toThrow('closing')
    expect(controller.state(1).current.kind).toBe('ssh')
  })
  it('refuses incompatible hosts before saving and discards late checks after their window closes', async () => {
    const incompatible = fixture(async () => ({ ...status, apiVersion: 2 }))
    await expect(incompatible.controller.inspect(1, { target: 'fixture' })).rejects.toThrow('Update them')
    expect(await incompatible.controller.list()).toEqual([])
    let finish: (value: typeof status) => void = () => {}
    const at = fixture(
      () =>
        new Promise((done) => {
          finish = done
        }),
    )
    const checking = at.controller.inspect(1, { target: 'fixture' })
    at.controller.closed(1)
    finish(status)
    await expect(checking).rejects.toThrow('expired')
  })
})

it('isolates storage and refuses desktop-local addresses in links from a remote home', () => {
  expect(homePartition({ kind: 'local' })).toBeUndefined()
  expect(homePartition({ kind: 'ssh', home: remote() })).toBe(`persist:althar-home-${homeId}`)
  expect(() => homePartition({ kind: 'ssh', home: { ...remote(), homeId: '../escape' } })).toThrow()
  for (const url of [
    'file:///tmp/private',
    'http://example.test',
    'https://localhost',
    'https://127.1',
    'https://2130706433',
    'https://10.2.3.4',
    'https://192.168.0.1',
    'https://172.16.2.3',
    'https://[::1]',
    'https://[::]',
    'https://[::ffff:127.0.0.1]',
    'https://[fd00::1]',
    'https://printer',
    'https://private.local',
    'https://user:password@example.test',
  ])
    expect(remoteExternalUrl(url)).toBeNull()
  expect(remoteExternalUrl('https://github.com/AltharIDE/althar')).toBe('https://github.com/AltharIDE/althar')
})
