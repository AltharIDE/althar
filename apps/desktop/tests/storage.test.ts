import { link, mkdir, mkdtemp, rm, symlink, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { fold, measure, REFRESH_TIMEOUT, showPlace, storageSizes, type Size } from '../src/main/storage'

/* The size walk behind About › Storage: it counts what is there, once, and never leaves the folder. */

const made: string[] = []
const folder = async () => {
  const path = await mkdtemp(join(tmpdir(), 'althar-storage-'))
  made.push(path)
  return path
}
afterEach(async () => {
  for (const path of made.splice(0)) {
    await chmod(join(path, 'locked'), 0o755).catch(() => {})
    await rm(path, { recursive: true, force: true })
  }
})

const done = (size: Size) => {
  if (size.state !== 'done') throw new Error(`not measured: ${size.state}`)
  return size
}
const file = (path: string, length: number) => writeFile(path, Buffer.alloc(length, 1))

describe('measuring a folder', () => {
  it('counts what is in it, nested, and says a missing folder is missing', async () => {
    const root = await folder()
    await mkdir(join(root, 'a', 'b'), { recursive: true })
    await file(join(root, 'one'), 100_000)
    await file(join(root, 'a', 'b', 'two'), 100_000)
    const size = done(await measure(root))
    expect(size.bytes).toBeGreaterThanOrEqual(200_000)
    expect(size.bytes).toBeLessThan(400_000)
    expect(size.approximate).toBe(false)
    expect(size.unreadable).toBe(0)
    expect(await measure(join(root, 'nothing'))).toEqual({ state: 'missing' })
  })

  it('does not follow symlinks: a link to a big folder, or to its own parent, counts as a link', async () => {
    const root = await folder()
    const outside = await folder()
    await file(join(outside, 'big'), 5_000_000)
    await mkdir(join(root, 'inner'))
    await symlink(outside, join(root, 'out'))
    await symlink(root, join(root, 'inner', 'loop'))
    await symlink(join(outside, 'big'), join(root, 'file-link'))
    const size = done(await measure(root))
    expect(size.bytes).toBeLessThan(100_000)
    expect(size.unreadable).toBe(0)
  })

  it('counts a file with two hard links once', async () => {
    const root = await folder()
    await file(join(root, 'first'), 1_000_000)
    const alone = done(await measure(root)).bytes
    await link(join(root, 'first'), join(root, 'second'))
    const linked = done(await measure(root)).bytes
    expect(linked - alone).toBeLessThan(100_000)
  })

  it('leaves out a folder it is told is another’s, and the root itself is never left out', async () => {
    const root = await folder()
    await mkdir(join(root, 'worktrees'))
    await file(join(root, 'worktrees', 'big'), 2_000_000)
    await file(join(root, 'small'), 10_000)
    expect(done(await measure(root)).bytes).toBeGreaterThan(2_000_000)
    expect(done(await measure(root, { exclude: [join(root, 'worktrees')] })).bytes).toBeLessThan(100_000)
    expect(done(await measure(root, { exclude: [root] })).bytes).toBeGreaterThan(2_000_000)
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('skips what it can’t read, and counts it', async () => {
    const root = await folder()
    await mkdir(join(root, 'locked'))
    await file(join(root, 'locked', 'secret'), 1_000_000)
    await file(join(root, 'open'), 10_000)
    await chmod(join(root, 'locked'), 0o000)
    const size = done(await measure(root))
    expect(size.unreadable).toBe(1)
    expect(size.bytes).toBeLessThan(1_000_000)
  })

  it('gives what it has counted, as approximate, when the time is up', async () => {
    const root = await folder()
    for (const name of ['a', 'b', 'c']) {
      await mkdir(join(root, name))
      await file(join(root, name, 'f'), 10_000)
    }
    let ticks = 0
    // The first read of the clock sets the limit; every later one is past it.
    const now = () => (ticks++ === 0 ? 0 : 1_000)
    const size = done(await measure(root, { timeout: 500, now }))
    expect(size.approximate).toBe(true)
  })
})

describe('the place itself', () => {
  it('follows a link at the place’s own path, and measures what it points to', async () => {
    const real = await folder()
    await file(join(real, 'big'), 500_000)
    const at = await folder()
    const place = join(at, 'Althar')
    await symlink(real, place)
    const size = done(await measure(place))
    expect(size.bytes).toBeGreaterThanOrEqual(500_000)
  })

  it('fails, not a small size, where its own listing cannot be read', async () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return
    const root = await folder()
    await mkdir(join(root, 'locked'))
    await chmod(join(root, 'locked'), 0o000)
    expect(await measure(join(root, 'locked'))).toEqual({ state: 'failed' })
  })
})

describe('time running out during a walk', () => {
  it('stops inside a big directory and says the size is approximate', async () => {
    const root = await folder()
    for (let n = 0; n < 300; n++) await file(join(root, `f${n}`), 4_000)
    const full = done(await measure(root))
    let ticks = 0
    // Time is up on the fourth look at the clock: after the walk began, in the middle of the directory's entries.
    const now = () => (ticks++ < 4 ? 0 : 1_000)
    const partial = done(await measure(root, { timeout: 500, now }))
    expect(partial.approximate).toBe(true)
    expect(partial.bytes).toBeLessThan(full.bytes)
    expect(partial.bytes).toBeGreaterThan(0)
  })
})

describe('showing a place in the file manager', () => {
  const where = { profile: '/p', logs: '/p/logs', worktrees: '/w' }
  it('opens the folder the place names, and no other', async () => {
    const opened: string[] = []
    await showPlace(where, 'worktrees', async (path) => {
      opened.push(path)
      return ''
    })
    expect(opened).toEqual(['/w'])
  })
  it('fails with what the system said where it could not open it', async () => {
    await expect(showPlace(where, 'logs', async () => 'no file manager')).rejects.toThrow('no file manager')
  })
})

describe('the timer', () => {
  it('ends the wait at the limit where one directory never answers', async () => {
    const root = await folder()
    const started = Date.now()
    // The clock never moves, so only the timer can end this.
    const size = await measure(root, { timeout: 100, now: () => 0, list: () => new Promise(() => {}) })
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(size).toMatchObject({ state: 'done', approximate: true })
  })
})

describe('paths on Windows', () => {
  it('compare without case', async () => {
    expect(fold('C:\\Users\\Me\\Althar', 'win32')).toBe(fold('c:\\users\\me\\althar', 'win32'))
    expect(fold('/Home/Me', 'linux')).toBe('/Home/Me')
    const root = await folder()
    await mkdir(join(root, 'Inner'))
    await file(join(root, 'Inner', 'a'), 2_000_000)
    const wrong = join(root, 'INNER')
    // Where case counts, a folder spelled another way is another folder, and is counted.
    expect(done(await measure(root, { exclude: [wrong], platform: 'linux' })).bytes).toBeGreaterThan(2_000_000)
    // On Windows it is the same folder, and is left out.
    expect(done(await measure(root, { exclude: [wrong], platform: 'win32' })).bytes).toBeLessThan(100_000)
  })
})

describe('what is not kept', () => {
  const places = () => ({ profile: '/p', logs: '/p/logs', worktrees: '/w-not-there' })
  it('measures a missing place again at the next look, as the first task may have made it', async () => {
    let calls = 0
    const sizes = storageSizes(places, async () =>
      ++calls === 1 ? { state: 'missing' } : { state: 'done', bytes: 5, approximate: false, unreadable: 0 },
    )
    expect(await sizes.size('worktrees')).toEqual({ state: 'missing' })
    expect(done(await sizes.size('worktrees')).bytes).toBe(5)
    expect(calls).toBe(2)
  })

  it('gives a refresh longer than the first look', async () => {
    const limits: Array<number | undefined> = []
    const sizes = storageSizes(places, async (_root, options) => {
      limits.push(options?.timeout)
      return { state: 'done', bytes: 1, approximate: false, unreadable: 0 }
    })
    await sizes.size('logs')
    await sizes.size('logs', true)
    expect(limits[0]).toBeLessThan(limits[1] as number)
    expect(limits[1]).toBe(REFRESH_TIMEOUT)
  })
})

describe('the sizes kept for a session', () => {
  const places = () => ({
    profile: '/data/althar',
    logs: '/data/althar/logs',
    worktrees: '/home/me/Althar',
  })

  it('measures once, joins what is under way, and measures again on a refresh', async () => {
    const calls: Array<{
      root: string
      exclude: ReadonlyArray<string> | undefined
    }> = []
    const sizes = storageSizes(places, async (root, options) => {
      calls.push({ root, exclude: options?.exclude })
      return {
        state: 'done',
        bytes: calls.length,
        approximate: false,
        unreadable: 0,
      }
    })
    const [first, second] = await Promise.all([sizes.size('worktrees'), sizes.size('worktrees')])
    expect(first).toBe(second)
    await sizes.size('worktrees')
    expect(calls).toHaveLength(1)
    expect(done(await sizes.size('worktrees', true)).bytes).toBe(2)
    expect(calls).toHaveLength(2)
  })

  it('leaves the logs and task folders out of the profile where they sit inside it', async () => {
    const calls: Record<string, ReadonlyArray<string> | undefined> = {}
    const sizes = storageSizes(
      () => ({
        profile: '/data/althar',
        logs: '/data/althar/logs',
        worktrees: '/data/althar/worktrees',
      }),
      async (root, options) => {
        calls[root] = options?.exclude
        return { state: 'missing' }
      },
    )
    await sizes.size('profile')
    await sizes.size('logs')
    expect(calls['/data/althar']).toEqual(['/data/althar/logs', '/data/althar/worktrees'])
    expect(calls['/data/althar/logs']).toEqual([])
  })
})
