import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseNulPaths } from '../src/guard'
import { activeSelection, installLocalCatalog, loadLocalCatalog, removedByCatalog } from '../src/local'
import { projectRun } from '../src/projection'
import { readInstalls, withInstall, writeInstalls } from '../src/store'
import { good, skillMd, writeCatalog } from './support'

let root: string
let catalog: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'althar-store-'))
  catalog = await mkdtemp(join(tmpdir(), 'althar-catalog-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(catalog, { recursive: true, force: true })
})

describe('a local catalog', () => {
  it('loads when every skill validates and matches its pin', async () => {
    await writeCatalog(catalog, { alpha: good('alpha'), beta: good('beta') })
    const loaded = await loadLocalCatalog(catalog)
    expect(loaded.revision).toBe('fixture-1')
    expect(loaded.skills.map(({ entry }) => entry.id)).toEqual(['alpha', 'beta'])
  })

  it('is refused whole when a skill fails, changed since pinned, or the catalog is damaged', async () => {
    await writeCatalog(catalog, { alpha: good('alpha') })
    await writeFile(join(catalog, 'skills', 'alpha', 'SKILL.md'), skillMd('name: alpha\ndescription: changed'))
    await expect(loadLocalCatalog(catalog)).rejects.toThrow('pinned tree hash')

    const bad = await mkdtemp(join(tmpdir(), 'althar-catalog-'))
    await writeCatalog(bad, { alpha: { 'SKILL.md': skillMd('name: alpha\ndescription: d\nallowed-tools: Bash') } })
    await expect(loadLocalCatalog(bad)).rejects.toThrow('authorizing-field')
    const pushing = await mkdtemp(join(tmpdir(), 'althar-catalog-'))
    await writeCatalog(pushing, { alpha: { ...good('alpha'), 'notes.md': 'git push origin main' } })
    await expect(loadLocalCatalog(pushing)).rejects.toThrow('pushes')
    await writeFile(join(bad, 'catalog.json'), '{}')
    await expect(loadLocalCatalog(bad)).rejects.toThrow('catalog.json')
    await Promise.all([bad, pushing].map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('installs as active defaults, and keeps a default the person turned off', async () => {
    await writeCatalog(catalog, { alpha: good('alpha'), beta: good('beta') }, { beta: ['subagents'] })
    await installLocalCatalog(root, catalog)
    const first = await readInstalls(root)
    expect(first.ok && first.value.installs.map(({ id, active, source, review }) => `${id} ${active} ${source} ${review}`)).toEqual([
      'alpha true althar-default default',
      'beta true althar-default default',
    ])
    if (!first.ok) return
    const alpha = first.value.installs[0]!
    await writeInstalls(root, withInstall(first.value, { ...alpha, active: false }))
    await installLocalCatalog(root, catalog)
    const selection = await activeSelection(root, new Map([['beta', ['subagents']]]))
    expect(selection.map(({ id, needs }) => `${id} ${needs.join()}`)).toEqual(['beta subagents'])
  })

  it('drops a default the catalog no longer lists, after saying so, and keeps the person’s own installs', async () => {
    await writeCatalog(catalog, { alpha: good('alpha'), beta: good('beta') })
    await installLocalCatalog(root, catalog)
    const read = await readInstalls(root)
    if (!read.ok) throw new Error('unreadable')
    const own = { id: 'mine', source: 'local' as const, treeHash: 'c'.repeat(64), review: 'reviewed' as const, active: true }
    await writeInstalls(root, withInstall(read.value, own))
    const next = await mkdtemp(join(tmpdir(), 'althar-catalog-'))
    await writeCatalog(next, { alpha: good('alpha') })
    expect(await removedByCatalog(root, next)).toEqual(['beta'])
    const result = await installLocalCatalog(root, next)
    expect(result.removed).toEqual(['beta'])
    expect((await activeSelection(root, new Map())).map(({ id }) => id)).toEqual(['alpha', 'mine'])
    await rm(next, { recursive: true, force: true })
  })

  it('stays consistent when installs happen at once', async () => {
    await writeCatalog(catalog, { alpha: good('alpha'), beta: good('beta') })
    await Promise.all(Array.from({ length: 8 }, () => installLocalCatalog(root, catalog)))
    const read = await readInstalls(root)
    expect(read.ok && read.value.installs.map(({ id }) => id)).toEqual(['alpha', 'beta'])
  })

  it('refuses to install over a damaged installs.json', async () => {
    await writeCatalog(catalog, { alpha: good('alpha') })
    await writeFile(join(root, 'installs.json'), '{nope')
    await expect(installLocalCatalog(root, catalog)).rejects.toThrow('not JSON')
    await expect(activeSelection(root, new Map())).rejects.toThrow('not JSON')
  })
})

describe('the Claude Code plugin layout', () => {
  it('puts skills and a bare manifest under the run, and nothing outside it', async () => {
    await writeCatalog(catalog, { alpha: good('alpha') })
    const loaded = await installLocalCatalog(root, catalog)
    const selected = await activeSelection(root, new Map())
    const result = await projectRun({
      root,
      runId: 'r1',
      agent: 'claude-code',
      selected,
      capabilities: [],
      keepOutOf: ['/repo'],
      layout: 'claude-plugin',
    })
    expect(result.directory).toBe(join(root, 'runs', 'r1', 'claude-code', 'plugin'))
    expect(await readFile(join(result.directory, 'skills', 'alpha', 'SKILL.md'), 'utf8')).toContain('name: alpha')
    const manifest = JSON.parse(await readFile(join(result.directory, '.claude-plugin', 'plugin.json'), 'utf8'))
    expect(manifest).toEqual({ name: 'althar', description: 'Skills Althar selected for this run', version: '0.0.0' })
    expect(existsSync(join(result.directory, 'hooks'))).toBe(false)
    expect(loaded.skills).toHaveLength(1)
  })
})

describe('the Agent Skills layout', () => {
  it('puts skills under the run folder’s .agents/skills, which a session is given as an added directory', async () => {
    await writeCatalog(catalog, { alpha: good('alpha') })
    await installLocalCatalog(root, catalog)
    const result = await projectRun({
      root,
      runId: 'r1',
      agent: 'codex',
      selected: await activeSelection(root, new Map()),
      capabilities: [],
      keepOutOf: ['/repo'],
      layout: 'agents',
    })
    expect(result.directory).toBe(join(root, 'runs', 'r1', 'codex'))
    expect(await readFile(join(result.directory, '.agents', 'skills', 'alpha', 'SKILL.md'), 'utf8')).toContain('name: alpha')
    expect(result.projected).toEqual(['alpha'])
  })
})

describe('parseNulPaths', () => {
  it('splits NUL-separated paths, keeping spaces and quotes as they are', () => {
    expect(parseNulPaths('a b.md\0"q".md\0\0')).toEqual(['a b.md', '"q".md'])
    expect(parseNulPaths('')).toEqual([])
  })
})
