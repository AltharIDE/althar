import { describe, expect, it } from 'vitest'

import type { StorageSize } from '@althar/contracts'

import { REFRESH_TIMEOUT, storageSizes } from '../src/StorageSizes'

/* The sizes About › Storage shows: kept for the session, never for a place that wasn't there, and stopped when nobody waits. */

const done = (bytes: number): StorageSize => ({ state: 'done', bytes, approximate: false, unreadable: 0 })
const bytesOf = (size: StorageSize) => {
  if (size.state !== 'done') throw new Error(`not measured: ${size.state}`)
  return size.bytes
}

describe('what is not kept', () => {
  const places = { profile: '/p', logs: '/p/logs', worktrees: '/w-not-there' }

  it('measures a missing place again at the next look, as the first task may have made it', async () => {
    let calls = 0
    const sizes = storageSizes(places, async () => (++calls === 1 ? { state: 'missing' } : done(5)))
    expect(await sizes.size('worktrees')).toEqual({ state: 'missing' })
    expect(bytesOf(await sizes.size('worktrees'))).toBe(5)
    expect(calls).toBe(2)
  })

  it('gives a refresh longer than the first look', async () => {
    const limits: Array<number | undefined> = []
    const sizes = storageSizes(places, async (_root, options) => {
      limits.push(options?.timeout)
      return done(1)
    })
    await sizes.size('logs')
    await sizes.size('logs', true)
    expect(limits[0]).toBeLessThan(limits[1] as number)
    expect(limits[1]).toBe(REFRESH_TIMEOUT)
  })
})

describe('the sizes kept for a session', () => {
  const places = { profile: '/data/althar', logs: '/data/althar/logs', worktrees: '/home/me/Althar' }

  it('measures once, joins what is under way, and measures again on a refresh', async () => {
    let calls = 0
    const sizes = storageSizes(places, async () => done(++calls))
    const [first, second] = await Promise.all([sizes.size('worktrees'), sizes.size('worktrees')])
    expect(first).toBe(second)
    await sizes.size('worktrees')
    expect(calls).toBe(1)
    expect(bytesOf(await sizes.size('worktrees', true))).toBe(2)
    expect(calls).toBe(2)
  })

  it('leaves the logs and task folders out of the profile where they sit inside it', async () => {
    const calls: Record<string, ReadonlyArray<string> | undefined> = {}
    const sizes = storageSizes(
      { profile: '/data/althar', logs: '/data/althar/logs', worktrees: '/data/althar/worktrees' },
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

describe('giving up on a size', () => {
  const places = { profile: '/p', logs: '/p/logs', worktrees: '/w' }
  /** A walk that only ends when it is stopped. */
  const endless = (stopped: string[]) =>
    ((root: string, options?: { signal?: AbortSignal }) =>
      new Promise<StorageSize>((resolve) => {
        options?.signal?.addEventListener('abort', () => {
          stopped.push(root)
          resolve({ state: 'done', bytes: 1, approximate: true, unreadable: 0 })
        })
      })) as never

  it('stops the walk when the only one waiting on it gives up, and rejects that call', async () => {
    const stopped: string[] = []
    const sizes = storageSizes(places, endless(stopped))
    const stop = new AbortController()
    const asked = sizes.size('worktrees', false, stop.signal)
    await new Promise((go) => setTimeout(go, 5))
    stop.abort()
    await expect(asked).rejects.toThrow('Stopped measuring.')
    expect(stopped).toEqual(['/w'])
  })

  it('lets the walk go on while another still waits on it', async () => {
    const stopped: string[] = []
    const sizes = storageSizes(places, endless(stopped))
    const stop = new AbortController()
    const first = sizes.size('logs', false, stop.signal)
    void sizes.size('logs')
    await new Promise((go) => setTimeout(go, 5))
    stop.abort()
    await expect(first).rejects.toThrow()
    expect(stopped).toEqual([])
  })

  it('does not keep a walk that was stopped: the next look measures anew', async () => {
    let calls = 0
    const sizes = storageSizes(
      places,
      ((_root: string, options?: { signal?: AbortSignal }) =>
        new Promise<StorageSize>((resolve) => {
          if (++calls > 1) resolve(done(9))
          options?.signal?.addEventListener('abort', () => resolve({ state: 'done', bytes: 1, approximate: true, unreadable: 0 }))
        })) as never,
    )
    const stop = new AbortController()
    const asked = sizes.size('profile', false, stop.signal)
    await new Promise((go) => setTimeout(go, 5))
    stop.abort()
    await asked.catch(() => {})
    await new Promise((go) => setTimeout(go, 5))
    expect(bytesOf(await sizes.size('profile'))).toBe(9)
  })
})
