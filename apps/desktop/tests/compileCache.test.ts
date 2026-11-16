// @vitest-environment node
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { type CompileCaching, keepCompiled, keepCompiledNow } from '../src/compileCache'
import { compiledIn, windowFolderOf } from '../src/main/windowFolder'

const constants = { compileCacheStatus: { ENABLED: 1, ALREADY_ENABLED: 2, FAILED: 0, DISABLED: 3 } } as CompileCaching['constants']

/** Node's module as a test makes it: how it answers, and the folders it was given. */
const node = (status: number | 'throws') => {
  const given: Array<unknown> = []
  let flushed = 0
  const caching: CompileCaching = {
    constants,
    enableCompileCache: (dir) => {
      given.push(dir)
      if (status === 'throws') throw new Error('no')
      return { status }
    },
    flushCompileCache: () => {
      flushed += 1
      if (status === 'throws') throw new Error('no')
    },
  }
  return { caching, given, flushed: () => flushed }
}

describe('V8’s compiled code, kept between launches', () => {
  it('is kept in the folder given, enabled now or before', () => {
    const enabled = node(1)
    expect(keepCompiled('/profile/window/compile-cache', enabled.caching)).toBe(true)
    expect(enabled.given).toEqual(['/profile/window/compile-cache'])
    expect(keepCompiled('/elsewhere', node(2).caching)).toBe(true)
  })

  it('is not, and the process starts as it always did, where Node can’t, won’t or has no cache, or no folder is given', () => {
    expect(keepCompiled('/x', node(0).caching)).toBe(false)
    expect(keepCompiled('/x', node(3).caching)).toBe(false)
    expect(keepCompiled('/x', node('throws').caching)).toBe(false)
    expect(keepCompiled('/x', {})).toBe(false)
    expect(keepCompiled('/x', { enableCompileCache: () => ({ status: 1 }) })).toBe(false)
    const none = node(1)
    expect(keepCompiled(undefined, none.caching)).toBe(false)
    expect(keepCompiled('', none.caching)).toBe(false)
    expect(none.given).toEqual([])
  })

  it('is written at once when asked, and asking never fails', () => {
    const kept = node(1)
    keepCompiledNow(kept.caching)
    expect(kept.flushed()).toBe(1)
    const failing = node('throws')
    expect(() => keepCompiledNow(failing.caching)).not.toThrow()
    expect(() => keepCompiledNow({})).not.toThrow()
  })

  it('lives in the window’s folder of the profile, or of the app’s own data where no profile is given', () => {
    // By the system's own separators, as the folders are on disk: backslashes on Windows.
    expect(compiledIn(windowFolderOf('/tmp/e2e/profile', '/home/dana/.config'))).toBe(join('/tmp/e2e/profile', 'window', 'compile-cache'))
    expect(windowFolderOf(undefined, '/home/dana/.config')).toBe(join('/home/dana/.config', '@althar', 'desktop'))
    expect(windowFolderOf('', '/home/dana/.config')).toBe(join('/home/dana/.config', '@althar', 'desktop'))
  })
})
