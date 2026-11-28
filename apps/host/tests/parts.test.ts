import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { c } from 'tar'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { completeRelease, NoRoom, treeDigest } from '../src/updates/parts'
import type { ReleasePart } from '../src/updates/release'
import { temporary } from './support'

/*
 * A worker's release in parts (apps/host/src/updates/parts.ts): what a part holds, known whatever brought it; a part a
 * release already here has, lent to the new one without a copy, or copied where the disk can't link; the rest
 * downloaded, checked and unpacked.
 */

// Where a disk can't hard-link, a part is copied: `link` fails while `linking` says so.
let linking = true
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  return {
    ...actual,
    link: async (from: string, to: string) => {
      if (!linking) throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' })
      return actual.link(from, to)
    },
  }
})
afterEach(() => {
  linking = true
})

/** A folder of files: each path's text, executable where its name has no dot. */
const tree = (folder: string, files: Record<string, string>) => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(folder, path, '..'), { recursive: true, mode: 0o700 })
    writeFileSync(join(folder, path), text, { mode: /\.[a-z]+$/u.test(path) ? 0o600 : 0o700 })
  }
  return folder
}
const CODEX = { 'package.json': '{"version":"0.173.0"}', 'vendor/target/bin/codex': 'Codex', 'vendor/target/codex-path/rg': 'rg' }
const PATH = 'node_modules/@openai/codex-test'

/** A part as a manifest lists it, its archive served at its address. */
const partOf = async (files: Record<string, string>, tree_?: string) => {
  const root = temporary()
  const folder = tree(join(root, 'part'), files)
  const file = join(root, 'part.tar.zst')
  await c({ file, cwd: folder, portable: true, noMtime: true, zstd: true }, readdirSync(folder))
  const bytes = readFileSync(file)
  const part: ReleasePart = {
    name: 'codex-test',
    path: PATH,
    agent: 'codex',
    tree: tree_ ?? (await treeDigest(folder)),
    url: 'https://updates.example/codex-test.tar.zst',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
    files: Object.keys(files).length,
    unpackedBytes: Object.values(files).reduce((sum, text) => sum + Buffer.byteLength(text), 0),
  }
  const asked: string[] = []
  const fetcher = (async (url: string) => {
    asked.push(url)
    return new Response(bytes)
  }) as unknown as typeof fetch
  return { part, fetcher, asked }
}
/** A release folder of the program folder, and an empty scratch beside it. */
const release = (program: string, name: string) => {
  const folder = join(program, name)
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  return folder
}
const scratchIn = (program: string) => {
  const folder = join(program, '.scratch')
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  return folder
}

describe('what a part holds', () => {
  it('is the same whatever folder it is in, and changes with a file’s text, name or whether it runs', async () => {
    const one = await treeDigest(tree(temporary(), CODEX))
    expect(await treeDigest(tree(temporary(), CODEX))).toBe(one)
    expect(await treeDigest(tree(temporary(), { ...CODEX, 'vendor/target/bin/codex': 'Codex!' }))).not.toBe(one)
    const renamed = { ...CODEX, 'vendor/target/codex-path/ripgrep': 'rg' } as Record<string, string>
    delete renamed['vendor/target/codex-path/rg']
    expect(await treeDigest(tree(temporary(), renamed))).not.toBe(one)
    const still = tree(temporary(), CODEX)
    chmodSync(join(still, 'vendor/target/bin/codex'), 0o600)
    expect(await treeDigest(still)).not.toBe(one)
  })

  it('refuses a link inside it', async () => {
    const folder = tree(temporary(), CODEX)
    symlinkSync('/etc/passwd', join(folder, 'vendor', 'escape'))
    await expect(treeDigest(folder)).rejects.toMatchObject({ code: 'ReleaseRejected' })
  })
})

describe('putting a release together from its parts', () => {
  it('lends a part a release here has, folders and all, by hard links, and asks for nothing', async () => {
    const program = temporary()
    const { part, fetcher, asked } = await partOf(CODEX)
    const donor = release(program, 'bundle-old')
    tree(join(donor, PATH), CODEX)
    const target = release(program, 'bundle-new')
    const done = await completeRelease(target, [part], {
      donors: [join(program, 'bundle-other'), donor],
      scratch: scratchIn(program),
      fetcher,
    })
    expect(done).toEqual({ lent: ['codex-test'], downloaded: [], missing: [], bytes: 0 })
    expect(asked).toEqual([])
    const program_ = join(PATH, 'vendor/target/bin/codex')
    expect(statSync(join(target, program_)).ino).toBe(statSync(join(donor, program_)).ino)
  })

  it('copies a part it lends where its disk can’t link, each file as it runs', async () => {
    const program = temporary()
    const { part, fetcher } = await partOf(CODEX)
    const donor = release(program, 'bundle-old')
    tree(join(donor, PATH), CODEX)
    const target = release(program, 'bundle-new')
    linking = false
    await completeRelease(target, [part], {
      donors: [donor],
      scratch: scratchIn(program),
      fetcher,
      free: async () => Number.MAX_SAFE_INTEGER,
    })
    const program_ = join(PATH, 'vendor/target/bin/codex')
    expect(statSync(join(target, program_)).ino).not.toBe(statSync(join(donor, program_)).ino)
    expect(statSync(join(target, program_)).mode & 0o777).toBe(0o700)
    expect(statSync(join(target, PATH, 'package.json')).mode & 0o777).toBe(0o600)
    expect(await treeDigest(join(target, PATH))).toBe(part.tree)
  })

  it('keeps a part already in place, and replaces one that doesn’t hold what it should', async () => {
    const program = temporary()
    const { part, fetcher, asked } = await partOf(CODEX)
    const target = release(program, 'bundle-new')
    tree(join(target, PATH), CODEX)
    expect(await completeRelease(target, [part], { donors: [], scratch: scratchIn(program), fetcher })).toMatchObject({
      lent: [],
      downloaded: [],
    })
    expect(asked).toEqual([])
    // Changed since: downloaded again, as the disk's free space allows (its own, unless said).
    writeFileSync(join(target, PATH, 'vendor/target/bin/codex'), 'something else')
    const said: number[] = []
    const done = await completeRelease(target, [part], {
      donors: [],
      scratch: scratchIn(program),
      fetcher,
      progress: (bytes) => said.push(bytes),
    })
    expect(done).toMatchObject({ downloaded: ['codex-test'], bytes: part.bytes })
    expect(said.at(-1)).toBe(part.bytes)
    expect(readFileSync(join(target, PATH, 'vendor/target/bin/codex'), 'utf8')).toBe('Codex')
  })

  it('leaves out what no release here lends where only lending is asked for', async () => {
    const program = temporary()
    const { part, fetcher, asked } = await partOf(CODEX)
    const target = release(program, 'bundle-new')
    expect(await completeRelease(target, [part], { donors: [], scratch: scratchIn(program), fetcher, lendOnly: true })).toEqual({
      lent: [],
      downloaded: [],
      missing: ['codex-test'],
      bytes: 0,
    })
    expect(asked).toEqual([])
    expect(existsSync(join(target, PATH))).toBe(false)
  })

  it('refuses a download that doesn’t hold what the manifest says, and one there’s no room for, before asking', async () => {
    const program = temporary()
    const wrong = await partOf(CODEX, 'f'.repeat(64))
    const target = release(program, 'bundle-new')
    await expect(
      completeRelease(target, [wrong.part], { donors: [], scratch: scratchIn(program), fetcher: wrong.fetcher }),
    ).rejects.toMatchObject({
      code: 'ReleaseRejected',
    })
    expect(existsSync(join(target, PATH))).toBe(false)
    const right = await partOf(CODEX)
    const room = completeRelease(target, [right.part], {
      donors: [],
      scratch: scratchIn(program),
      fetcher: right.fetcher,
      free: async () => 0,
    })
    await expect(room).rejects.toBeInstanceOf(NoRoom)
    await expect(room).rejects.toMatchObject({ needed: right.part.bytes + right.part.unpackedBytes })
    expect(right.asked).toEqual([])
  })
})
