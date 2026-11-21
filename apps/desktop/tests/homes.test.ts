import { chmodSync, linkSync, mkdtempSync, promises, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { removeTreeSync } from '@althar/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { homeController } from '../src/main/homes/controller'
import { homeGlances, reportedProjects } from '../src/main/homes/glances'
import { homeName, homeStore, homeTarget } from '../src/main/homes/store'
import { homePartition, remoteExternalUrl } from '../src/main/homes/policy'
import type { RemoteHome, WindowHome } from '../src/homes'

const homeId = `home_${'1'.repeat(32)}`
const status = { homeId, hostDeviceId: `dev_${'2'.repeat(32)}`, apiVersion: 1, version: 'fixture' }
const identity = { homeId, actorId: `act_${'3'.repeat(32)}`, deviceId: status.hostDeviceId, role: 'socket' as const }
const remote = (digit = '4'): Extract<RemoteHome, { ssh: unknown }> => ({
  id: `remote_${digit.repeat(32)}`,
  name: 'VPS',
  homeId,
  ssh: { target: 'fixture' },
})
const roots: string[] = []
const temporary = () => {
  const root = mkdtempSync(join(tmpdir(), 'althar-homes-'))
  roots.push(root)
  return root
}
afterEach(() => {
  vi.restoreAllMocks()
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
  it('never replaces the file while a read has it open, as Windows refuses to', async () => {
    const root = temporary()
    const store = homeStore(root)
    const path = join(root, 'homes.json')
    await store.save(remote())
    const { open, rename } = promises
    let reading = 0
    const reads: Array<Promise<unknown>> = []
    vi.spyOn(promises, 'open').mockImplementation(async (...given: Parameters<typeof open>) => {
      // A read the glances' cache starts while a change is writing its file, as a window opening does.
      if (String(given[0]).endsWith('.tmp')) reads.push(store.list())
      const handle = await open(...given)
      if (given[0] !== path) return handle
      reading++
      const read = handle.read.bind(handle)
      const close = handle.close.bind(handle)
      Object.assign(handle, {
        read: async (...args: Parameters<typeof read>) => {
          await new Promise((resolve) => setTimeout(resolve, 40))
          return read(...args)
        },
        close: async () => {
          reading--
          return close()
        },
      })
      return handle
    })
    vi.spyOn(promises, 'rename').mockImplementation(async (from, to) => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      if (to === path && reading > 0)
        throw Object.assign(new Error(`EPERM: operation not permitted, rename '${String(from)}'`), { code: 'EPERM' })
      return rename(from, to)
    })
    expect((await store.rename(remote().id, 'Renamed')).name).toBe('Renamed')
    expect(reads).toHaveLength(1)
    expect((await reads[0]) as ReadonlyArray<RemoteHome>).toEqual([{ ...remote(), name: 'Renamed' }])
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

describe('managing saved homes', () => {
  const otherHome = `home_${'9'.repeat(32)}`
  const project = (id: string, working = 0, yours = 0) => ({ id, name: id, ink: 'clay', working, yours })
  const fixture = (inspect = async (_target: unknown) => status) => {
    let at = 1_000
    const profile = temporary()
    const opened: Array<{ home: WindowHome; projectId?: string }> = []
    const told: Array<{ owner: number; name: string }> = []
    let overviews = 0
    const glances = homeGlances({ profile, now: () => at, writeAfter: 0, wanted: () => controller.wanted() })
    const controller = homeController({
      store: homeStore(profile),
      inspect,
      open: (home, projectId) => {
        opened.push({ home, ...(projectId === undefined ? {} : { projectId }) })
      },
      changed: (owner, state) => {
        if (state.current.kind === 'ssh') told.push({ owner, name: state.current.home.name })
      },
      overviewChanged: () => {
        overviews++
      },
      glances,
      now: () => at,
    })
    controller.register(1, { kind: 'local' })
    return {
      controller,
      glances,
      profile,
      opened,
      told,
      overviews: () => overviews,
      advance: (milliseconds: number) => {
        at += milliseconds
      },
      saved: async (name = 'VPS') => {
        const checked = await controller.inspect(1, { target: 'fixture' })
        await controller.save(1, checked.checkId, name)
        return (await controller.list()).at(-1)!
      },
    }
  }
  it('saves a checked home without opening it, renames it at once and tells its open window', async () => {
    const at = fixture()
    const home = await at.saved()
    expect(at.opened).toEqual([])
    at.controller.register(2, { kind: 'ssh', home })
    await at.controller.rename(1, home.id, '  Hetzner box ')
    expect((await at.controller.list())[0]!.name).toBe('Hetzner box')
    expect(at.controller.state(2).current).toEqual({ kind: 'ssh', home: { ...home, name: 'Hetzner box' } })
    expect(at.told.at(-1)).toEqual({ owner: 2, name: 'Hetzner box' })
    await expect(at.controller.rename(1, home.id, 'bad\nname')).rejects.toThrow('control characters')
    await expect(at.controller.rename(1, `remote_${'0'.repeat(32)}`, 'Gone')).rejects.toThrow('forgotten')
    await expect(at.controller.rename(1, '../escape', 'Gone')).rejects.toThrow('saved home')
  })
  it('changes a connection only to a host with the same home, by this window’s own unexpired check', async () => {
    let homeId = status.homeId
    const at = fixture(async () => ({ ...status, homeId }))
    const home = await at.saved()
    at.controller.register(2, { kind: 'ssh', home })
    const same = await at.controller.inspect(1, { target: 'root@fixture.example', port: 2222 })
    await at.controller.change(1, home.id, same.checkId)
    expect((await at.controller.list())[0]!.ssh).toEqual({ target: 'root@fixture.example', port: 2222 })
    expect(at.controller.begin(2).home.ssh?.target).toBe('root@fixture.example')
    await expect(at.controller.change(1, home.id, same.checkId)).rejects.toThrow('expired')
    homeId = otherHome
    const other = await at.controller.inspect(1, { target: 'another' })
    await expect(at.controller.change(1, home.id, other.checkId)).rejects.toThrow('another has a different home.')
    expect((await at.controller.list())[0]!.homeId).toBe(status.homeId)
    homeId = status.homeId
    const late = await at.controller.inspect(1, { target: 'fixture' })
    at.advance(5 * 60_000 + 1)
    await expect(at.controller.change(1, home.id, late.checkId)).rejects.toThrow('expired')
  })
  it('puts a forgotten home back where it was within a moment, and never one the window names', async () => {
    const at = fixture()
    const first = await at.saved('First')
    const checked = await at.controller.inspect(1, { target: 'second' })
    await at.controller.save(1, checked.checkId, 'Second')
    await at.controller.forget(1, first.id)
    expect((await at.controller.list()).map((home) => home.name)).toEqual(['Second'])
    await at.controller.restore(1, first.id)
    expect((await at.controller.list()).map((home) => home.name)).toEqual(['First', 'Second'])
    await expect(at.controller.restore(1, first.id)).rejects.toThrow('can’t be put back')
    await at.controller.forget(1, first.id)
    at.advance(30_001)
    await expect(at.controller.restore(1, first.id)).rejects.toThrow('can’t be put back')
    await expect(at.controller.restore(1, { ...first })).rejects.toThrow('can’t be put back')
  })
  it('keys a window’s projects by its own home, live only while it is connected, and remembers them afterwards', async () => {
    const at = fixture()
    const home = await at.saved()
    at.controller.register(2, { kind: 'ssh', home })
    at.controller.report(1, [project('althar', 2, 1)])
    at.controller.report(2, [project('ledger', 1)])
    let overview = await at.controller.overview()
    expect(overview.windows).toEqual({ local: 'local', [homeId]: 'connecting' })
    expect(overview.projects.local).toEqual({ live: true, list: [project('althar', 2, 1)] })
    expect(overview.projects[homeId]).toEqual({ live: false, list: [project('ledger')] })
    const { generation } = at.controller.begin(2)
    at.controller.connected(2, generation, identity)
    overview = await at.controller.overview()
    expect(overview.windows[homeId]).toBe('connected')
    expect(overview.projects[homeId]).toEqual({ live: true, list: [project('ledger', 1)] })
    expect(overview.opened[home.id]).toBe(1_000)
    // A check called off leaves what the window reads live; loading its page again doesn't, until it reads again.
    at.controller.cancel(1)
    expect((await at.controller.overview()).projects.local?.live).toBe(true)
    at.controller.navigating(1)
    expect((await at.controller.overview()).projects.local?.live).toBe(false)
    at.controller.closed(2)
    overview = await at.controller.overview()
    expect(overview.windows[homeId]).toBeUndefined()
    expect(overview.projects[homeId]).toEqual({ live: false, list: [project('ledger')] })
    expect(at.overviews()).toBeGreaterThan(4)
    for (const bad of [
      'not a list',
      [{ ...project('x'), ink: 'neon' }],
      [{ ...project('x'), name: 'bad\u0007' }],
      [{ ...project('x'), id: '../x' }],
      [{ ...project('x'), working: -1 }],
      Array.from({ length: 201 }, (_, i) => project(`p${i}`)),
    ])
      expect(() => at.controller.report(1, bad)).toThrow()
    expect(reportedProjects([project('a'), project('a')])).toHaveLength(1)
  })
  it('keeps names and inks across launches, prunes forgotten homes, and ignores a cache it can’t read', async () => {
    const at = fixture()
    const home = await at.saved()
    at.controller.register(2, { kind: 'ssh', home })
    at.controller.report(2, [project('ledger', 3, 2)])
    await at.glances.flush()
    const written = JSON.parse(readFileSync(join(at.profile, 'home-glances.json'), 'utf8'))
    expect(written.projects[homeId]).toEqual([{ id: 'ledger', name: 'ledger', ink: 'clay' }])
    const again = homeGlances({ profile: at.profile })
    await again.loaded
    expect(again.projectsOf(homeId, () => false)).toEqual({ live: false, list: [project('ledger')] })
    await at.controller.forget(1, home.id)
    at.advance(30_001)
    at.glances.opened('remote_' + 'a'.repeat(32))
    await at.glances.flush()
    expect(JSON.parse(readFileSync(join(at.profile, 'home-glances.json'), 'utf8')).projects[homeId]).toBeUndefined()
    writeFileSync(join(at.profile, 'home-glances.json'), 'not json', { mode: 0o600 })
    const broken = homeGlances({ profile: at.profile, writeAfter: 0 })
    await broken.loaded
    expect(broken.keys()).toEqual([])
    broken.report(1, 'local', [project('althar')])
    await broken.flush()
    expect(JSON.parse(readFileSync(join(at.profile, 'home-glances.json'), 'utf8')).projects.local).toHaveLength(1)
  })
  it('opens a home on one of its projects, and refuses a project id that isn’t one', async () => {
    const at = fixture()
    const home = await at.saved()
    await at.controller.open(1, home.id, 'prj_ledger')
    expect(at.opened.at(-1)).toEqual({ home: { kind: 'ssh', home }, projectId: 'prj_ledger' })
    await at.controller.open(1, 'local', 'althar')
    expect(at.opened.at(-1)).toEqual({ home: { kind: 'local' }, projectId: 'althar' })
    await expect(at.controller.open(1, home.id, '../../etc')).rejects.toThrow('project')
  })
})

describe('home confirmations', () => {
  const fixture = (inspect = async () => status) => {
    let at = 0
    const opened: WindowHome[] = []
    const controller = homeController({
      store: homeStore(temporary()),
      inspect,
      open: (home: WindowHome) => {
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
