import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseCatalog } from '../src/catalog'
import { treeHash } from '../src/hash'
import { projectRun, releaseRun } from '../src/projection'
import { EMPTY_INSTALLS, putObject, readInstalls, readObject, withInstall, writeInstalls } from '../src/store'
import { good, tree } from './support'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'althar-skills-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const SHA = 'a'.repeat(40)
const HASH = 'b'.repeat(64)

describe('the object store', () => {
  it('keeps a tree under its hash, once, and reads it back', async () => {
    const files = tree({ ...good(), 'references/a.md': 'more' })
    const hash = await putObject(root, files)
    expect(hash).toBe(treeHash(files))
    expect(await putObject(root, files)).toBe(hash)
    const back = await readObject(root, hash)
    expect([...back.keys()].toSorted()).toEqual(['SKILL.md', 'references/a.md'])
  })

  it('refuses an unsafe path and writes nothing for it', async () => {
    await expect(putObject(root, tree({ '../x': 'y' }))).rejects.toThrow('unsafe path')
    expect(existsSync(join(root, 'x'))).toBe(false)
  })

  it('notices a stored file that changed, or a link in a tree', async () => {
    const hash = await putObject(root, tree(good()))
    await chmod(join(root, 'objects', hash, 'SKILL.md'), 0o644)
    await writeFile(join(root, 'objects', hash, 'SKILL.md'), 'changed')
    await expect(readObject(root, hash)).rejects.toThrow('no longer matches')
    await symlink('/etc/hostname', join(root, 'objects', hash, 'link'))
    await expect(readObject(root, hash)).rejects.toThrow('not a plain file')
  })
})

describe('installs.json', () => {
  it('starts empty, and replaces an install by id in order', async () => {
    expect(await readInstalls(root)).toEqual({ ok: true, value: EMPTY_INSTALLS })
    const one = {
      id: 'b-skill',
      source: 'github' as const,
      repo: 'o/r',
      sha: SHA,
      subpath: 'skills/b',
      treeHash: HASH,
      review: 'reviewed' as const,
      active: true,
    }
    const two = { id: 'a-skill', source: 'local' as const, treeHash: HASH, review: 'not-reviewed' as const, active: false }
    const installs = withInstall(withInstall(withInstall(EMPTY_INSTALLS, one), two), { ...one, active: false })
    expect(installs.installs.map(({ id, active }) => `${id}:${active}`)).toEqual(['a-skill:false', 'b-skill:false'])
    await writeInstalls(root, installs)
    expect(await readInstalls(root)).toEqual({ ok: true, value: installs })
  })

  it('says why it cannot read a damaged file', async () => {
    await writeFile(join(root, 'installs.json'), '{nope')
    expect(await readInstalls(root)).toEqual({ ok: false, error: 'installs.json is not JSON' })
    await writeFile(join(root, 'installs.json'), JSON.stringify({ version: 2, installs: [] }))
    expect((await readInstalls(root)).ok).toBe(false)
  })

  it('refuses to write an install that does not fit the schema', async () => {
    await expect(
      writeInstalls(root, { version: 1, installs: [{ id: 'x', source: 'github', treeHash: 'short', review: 'default', active: true }] }),
    ).rejects.toThrow()
  })
})

describe('parseCatalog', () => {
  const entry = { id: 'tdd', source: { kind: 'github', repo: 'o/r', sha: SHA, subpath: 'skills/tdd' }, treeHash: HASH, license: 'MIT' }
  const text = (entries: unknown[]) => JSON.stringify({ version: 1, revision: '2026.10.1', entries })

  it('reads entries and fills defaults', () => {
    const parsed = parseCatalog(text([entry, { ...entry, id: 'own', source: { kind: 'althar' } }]))
    expect(parsed.ok && parsed.value.entries[0]).toMatchObject({ needs: [], note: '' })
  })

  it.each([
    ['not json', 'not JSON'],
    [text([{ ...entry, source: { kind: 'github', repo: 'o/r', sha: 'main', subpath: 's' } }]), 'sha'],
    [text([{ ...entry, extra: 1 }]), 'extra'],
    [text([entry, entry]), 'appears twice'],
  ])('refuses %#', (input, why) => {
    const parsed = parseCatalog(input)
    expect(!parsed.ok && parsed.error).toContain(why)
  })
})

describe('projectRun', () => {
  const base = { runId: 'run-1', agent: 'codex', capabilities: [] as string[], keepOutOf: [] as string[] }

  it('copies chosen skills read-only under the run, and leaves out one needing a capability', async () => {
    const plain = await putObject(root, tree(good('plain')))
    const fancy = await putObject(root, tree(good('fancy')))
    const result = await projectRun({
      ...base,
      root,
      selected: [
        { id: 'plain', treeHash: plain },
        { id: 'fancy', treeHash: fancy, needs: ['subagents'] },
      ],
    })
    expect(result.projected).toEqual(['plain'])
    expect(result.omitted).toEqual([{ id: 'fancy', missing: ['subagents'] }])
    expect(await readFile(join(result.directory, 'plain', 'SKILL.md'), 'utf8')).toContain('name: plain')
    await expect(writeFile(join(result.directory, 'plain', 'SKILL.md'), 'x')).rejects.toThrow()
    const again = await projectRun({
      ...base,
      root,
      capabilities: ['subagents'],
      selected: [{ id: 'fancy', treeHash: fancy, needs: ['subagents'] }],
    })
    expect(again.projected).toEqual(['fancy'])
    expect(existsSync(join(result.directory, 'plain'))).toBe(false)
    await releaseRun(root, 'run-1')
    expect(existsSync(join(root, 'runs', 'run-1'))).toBe(false)
    await releaseRun(root, 'never-ran')
  })

  it('refuses a store inside a repository, and unsafe names', async () => {
    await expect(projectRun({ ...base, root, keepOutOf: [join(root, '..')], selected: [] })).rejects.toThrow('inside the repository')
    await expect(projectRun({ ...base, root, keepOutOf: ['/somewhere/else'], selected: [] })).resolves.toBeDefined()
    await expect(projectRun({ ...base, root, runId: '..', selected: [] })).rejects.toThrow('unsafe')
    await expect(projectRun({ ...base, root, agent: 'a/b', selected: [] })).rejects.toThrow('unsafe')
    await expect(projectRun({ ...base, root, selected: [{ id: '../x', treeHash: HASH }] })).rejects.toThrow('unsafe skill id')
    await expect(releaseRun(root, '../x')).rejects.toThrow('unsafe')
  })
})
