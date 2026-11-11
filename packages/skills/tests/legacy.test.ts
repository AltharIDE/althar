import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { withoutBundled } from '../src/legacy'
import { listInstalls, putObject, readInstalls, removeBundledSkills } from '../src/store'
import { clean, good, install, run, tree } from './support'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'althar-skills-'))
})
afterEach(async () => {
  await clean(root)
})

const bundled = (id: string, treeHash: string, extra: Record<string, unknown> = {}) => ({
  id,
  source: 'althar-default',
  treeHash,
  review: 'reviewed',
  active: true,
  ...extra,
})

describe('withoutBundled', () => {
  it('leaves alone what is not an install list', () => {
    for (const value of [null, 'text', [], { installs: 'no' }]) {
      expect(withoutBundled(value)).toEqual({ value, removed: [], hashes: [], changed: false })
    }
  })

  it('finds nothing to change in a store without them', () => {
    const value = { version: 1, installs: [{ id: 'mine', source: 'local', treeHash: 'x', history: [{ source: 'local' }] }] }
    expect(withoutBundled(value)).toEqual({ value, removed: [], hashes: [], changed: false })
  })

  it('takes out the catalog hash alone', () => {
    expect(withoutBundled({ catalog: 'h', installs: [] })).toEqual({ value: { installs: [] }, removed: [], hashes: [], changed: true })
  })

  it('takes out shipped installs, with their past versions, and shipped versions in the history of the person’s own', () => {
    const taken = withoutBundled({
      catalog: 'h',
      installs: [
        bundled('a', 'ha', { history: [{ source: 'althar-default', treeHash: 'ha0' }, 'odd', { source: 'x' }] }),
        { source: 'althar-default' },
        bundled('b', 'hb', { history: 'not a list' }),
        {
          id: 'mine',
          source: 'local',
          treeHash: 'hm',
          history: [
            { source: 'althar-default', treeHash: 'old' },
            { source: 'local', treeHash: 'hm0' },
          ],
        },
        { id: 'only', source: 'local', treeHash: 'ho', history: [{ source: 'althar-default' }] },
        'not an install',
      ],
    })
    expect(taken.changed).toBe(true)
    expect(taken.removed).toEqual(['a', 'b'])
    expect(taken.hashes).toEqual(['ha', 'ha0', 'hb', 'old'])
    expect(taken.value).toEqual({
      installs: [
        { id: 'mine', source: 'local', treeHash: 'hm', history: [{ source: 'local', treeHash: 'hm0' }] },
        { id: 'only', source: 'local', treeHash: 'ho' },
        'not an install',
      ],
    })
  })
})

describe('removeBundledSkills', () => {
  it('does nothing where there is no store, or nothing shipped in it', async () => {
    expect(await run(removeBundledSkills(root))).toEqual([])
    await install(root, 'mine', good('mine'))
    const before = await readFile(join(root, 'installs.json'), 'utf8')
    expect(await run(removeBundledSkills(root))).toEqual([])
    expect(await readFile(join(root, 'installs.json'), 'utf8')).toBe(before)
  })

  it('takes the shipped skills and their stored versions out, keeps a version the person’s own still uses, and is done after once', async () => {
    const shared = await install(root, 'mine', good('mine'))
    const own = await run(putObject(root, tree(good('shipped'))))
    const text = JSON.parse(await readFile(join(root, 'installs.json'), 'utf8')) as { installs: Array<unknown> }
    text.installs.push(bundled('shipped', own), bundled('twin', shared), bundled('odd', 'not-a-hash'))
    await writeFile(join(root, 'installs.json'), JSON.stringify({ ...text, catalog: 'h' }))

    expect((await run(listInstalls(root))).map((one) => (one.ok ? one.install.id : one.id))).toEqual(['mine'])
    expect(await run(removeBundledSkills(root))).toEqual(['shipped', 'twin', 'odd'])
    expect(existsSync(join(root, 'objects', own))).toBe(false)
    expect(existsSync(join(root, 'objects', shared))).toBe(true)
    expect((await run(readInstalls(root))).installs.map(({ id }) => id)).toEqual(['mine'])
    expect(await run(removeBundledSkills(root))).toEqual([])
  })
})
