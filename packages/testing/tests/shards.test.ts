import { globSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vite-plus/test'

import { balance, playwrightShard, shardNumber } from '../src/shards'

const key = (file: string) => file

describe('test files assigned by duration', () => {
  it('runs every file exactly once and balances slow files instead of equal file counts', () => {
    const files = ['a', 'b', 'c', 'd', 'e', 'f']
    const history = { a: 100, b: 90, c: 80, d: 20, e: 10, f: 5 }
    const shards = balance(files, 3, key, history)
    expect(shards.flat().sort()).toEqual(files)
    expect(shards.map((part) => part.reduce((sum, file) => sum + history[file as keyof typeof history], 0))).toEqual([105, 100, 100])
    expect(balance([...files].reverse(), 3, key, history)).toEqual(shards)
  })

  it('keeps new and unmeasured files even with absent, stale or invalid timing history', () => {
    const files = ['new', 'a', 'b', 'c', 'd']
    for (const history of [{}, { deleted: 1000 }, { a: Number.NaN, b: -1, c: Infinity, d: 0 }, { a: 42 }]) {
      expect(balance(files, 4, key, history).flat().sort()).toEqual([...files].sort())
    }
  })

  it('rejects a duplicate inventory or an invalid shard request', () => {
    expect(() => balance(['a', 'a'], 2, key, {})).toThrow('Duplicate')
    for (const count of [0, -1, 1.5, Infinity, 129]) expect(() => balance(['a'], count, key, {})).toThrow('Invalid')
    for (const part of ['0/4', '5/4', '1/0', 'no', '1/129', '1.2/4']) expect(() => shardNumber(part)).toThrow('Invalid')
  })

  it('matches new spec extensions and punctuation literally, without overlap or omissions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'althar-shards-'))
    mkdirSync(join(dir, 'e2e/nested'), { recursive: true })
    try {
      for (const file of ['a.spec.ts', 'b[1].spec.ts', 'c.test.mjs', 'nested/d.spec.cts', 'support.ts'])
        writeFileSync(join(dir, 'e2e', file), '')
      const files = globSync('e2e/**/*', { cwd: dir }).filter((file) => /\.(spec|test)\./.test(file))
      const matches = Array.from({ length: 4 }, (_, i) => playwrightShard(dir, `${i + 1}/4`))
      for (const file of files)
        expect(matches.flat().filter((pattern) => pattern.test(join(dir, file).replaceAll('\\', '/')))).toHaveLength(1)
      expect(matches.flat().some((pattern) => pattern.test(join(dir, 'e2e/b1.spec.ts')))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('assigns every desktop spec in this checkout exactly once across the four real shards', () => {
    const directory = join(import.meta.dirname, '../../../apps/desktop')
    const files = globSync('e2e/**/*', { cwd: directory }).filter((file) => /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(file))
    const matches = Array.from({ length: 4 }, (_, i) => playwrightShard(directory, `${i + 1}/4`)).flat()
    expect(files.length).toBeGreaterThan(20)
    for (const file of files) expect(matches.filter((pattern) => pattern.test(join(directory, file).replaceAll('\\', '/')))).toHaveLength(1)
  })
})
