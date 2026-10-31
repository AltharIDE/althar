import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseNulPaths } from '../src/guard'
import { activeSelection, installLocalCatalog, loadLocalCatalog, removedByCatalog } from '../src/local'
import { projectRun } from '../src/projection'
import { setActive } from '../src/review'
import { readInstalls, withInstall, writeInstalls } from '../src/store'
import { clean, good, skillMd, writeCatalog, run } from './support'

let root: string
let catalog: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'althar-store-'))
  catalog = await mkdtemp(join(tmpdir(), 'althar-catalog-'))
})
afterEach(async () => {
  await clean(root)
  await clean(catalog)
})

describe('a local catalog', () => {
  it('loads when every skill validates and matches its pin', async () => {
    await writeCatalog(catalog, { alpha: good('alpha'), beta: good('beta') })
    const loaded = await run(loadLocalCatalog(catalog))
    expect(loaded.revision).toBe('fixture-1')
    expect(loaded.skills.map(({ entry }) => entry.id)).toEqual(['alpha', 'beta'])
  })

  it('is refused whole when a skill fails, changed since pinned, or the catalog is damaged', async () => {
    await writeCatalog(catalog, { alpha: good('alpha') })
    await writeFile(join(catalog, 'skills', 'alpha', 'SKILL.md'), skillMd('name: alpha\ndescription: changed'))
    await expect(run(loadLocalCatalog(catalog))).rejects.toThrow('pinned tree hash')

    const bad = await mkdtemp(join(tmpdir(), 'althar-catalog-'))
    await writeCatalog(bad, { alpha: { 'SKILL.md': skillMd('name: alpha\ndescription: d\nallowed-tools: Bash') } })
    await expect(run(loadLocalCatalog(bad))).rejects.toThrow('authorizing-field')
    const pushing = await mkdtemp(join(tmpdir(), 'althar-catalog-'))
    await writeCatalog(pushing, { alpha: { ...good('alpha'), 'notes.md': 'git push origin main' } })
    await expect(run(loadLocalCatalog(pushing))).rejects.toThrow('pushes')
    await writeFile(join(bad, 'catalog.json'), '{}')
    await expect(run(loadLocalCatalog(bad))).rejects.toThrow('catalog.json')
    await Promise.all([bad, pushing].map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('installs defaults off, gives a run only those the person turned on, and keeps that choice', async () => {
    await writeCatalog(catalog, { alpha: good('alpha'), beta: good('beta') }, { beta: ['subagents'] })
    await run(installLocalCatalog(root, catalog))
    const first = await run(readInstalls(root))
    expect(first.installs.map(({ id, active, source, review }) => `${id} ${active} ${source} ${review}`)).toEqual([
      'alpha false althar-default default',
      'beta false althar-default default',
    ])
    expect(await run(activeSelection(root, new Map()))).toEqual([])
    await run(setActive(root, 'beta', true))
    await run(installLocalCatalog(root, catalog))
    const selection = await run(activeSelection(root, new Map([['beta', ['subagents']]])))
    expect(selection.map(({ id, needs }) => `${id} ${needs.join()}`)).toEqual(['beta subagents'])
  })

  it('drops a default the catalog no longer lists, after saying so, and keeps the person’s own installs', async () => {
    await writeCatalog(catalog, { alpha: good('alpha'), beta: good('beta') })
    await run(installLocalCatalog(root, catalog))
    await run(setActive(root, 'alpha', true))
    const read = await run(readInstalls(root))
    const own = { id: 'mine', source: 'local' as const, treeHash: 'c'.repeat(64), review: 'reviewed' as const, active: true }
    await run(writeInstalls(root, withInstall(read, own)))
    const next = await mkdtemp(join(tmpdir(), 'althar-catalog-'))
    await writeCatalog(next, { alpha: good('alpha') })
    expect(await run(removedByCatalog(root, next))).toEqual(['beta'])
    const result = await run(installLocalCatalog(root, next))
    expect(result.removed).toEqual(['beta'])
    expect((await run(activeSelection(root, new Map()))).map(({ id }) => id)).toEqual(['alpha', 'mine'])
    await rm(next, { recursive: true, force: true })
  })

  it('installs a catalog once: an unchanged one is only read, a changed one installed again', async () => {
    await writeCatalog(catalog, { alpha: good('alpha') })
    await run(installLocalCatalog(root, catalog))
    const written = await readFile(join(root, 'installs.json'), 'utf8')
    // Taken away by hand: an unchanged catalog does not put it back, nor write the store.
    await run(writeInstalls(root, { ...(await run(readInstalls(root))), installs: [] }))
    const again = await run(installLocalCatalog(root, catalog))
    expect(again.entries.map(({ id }) => id)).toEqual(['alpha'])
    expect((await run(readInstalls(root))).installs).toEqual([])
    await writeCatalog(catalog, { alpha: good('alpha'), beta: good('beta') })
    await run(installLocalCatalog(root, catalog))
    expect((await run(readInstalls(root))).installs.map(({ id }) => id)).toEqual(['alpha', 'beta'])
    expect(written).toContain('"catalog"')
  })

  it('stays consistent when installs happen at once', async () => {
    await writeCatalog(catalog, { alpha: good('alpha'), beta: good('beta') })
    await Promise.all(Array.from({ length: 8 }, () => run(installLocalCatalog(root, catalog))))
    const read = await run(readInstalls(root))
    expect(read.installs.map(({ id }) => id)).toEqual(['alpha', 'beta'])
  })

  it('refuses to install over a damaged installs.json', async () => {
    await writeCatalog(catalog, { alpha: good('alpha') })
    await writeFile(join(root, 'installs.json'), '{nope')
    await expect(run(installLocalCatalog(root, catalog))).rejects.toThrow('not JSON')
    await expect(run(activeSelection(root, new Map()))).rejects.toThrow('not JSON')
  })
})

describe('the Claude Code plugin layout', () => {
  it('puts skills and a bare manifest under the run, and nothing outside it', async () => {
    await writeCatalog(catalog, { alpha: good('alpha') })
    const loaded = await run(installLocalCatalog(root, catalog))
    await run(setActive(root, 'alpha', true))
    const selected = await run(activeSelection(root, new Map()))
    const result = await run(
      projectRun({
        root,
        runId: 'r1',
        agent: 'claude-code',
        selected,
        capabilities: [],
        keepOutOf: ['/repo'],
        layout: 'claude-plugin',
      }),
    )
    expect(result.directory).toBe(join(root, 'runs', 'r1', 'claude-code', 'plugin'))
    expect(await readFile(join(result.directory, 'skills', 'alpha', 'SKILL.md'), 'utf8')).toContain('name: alpha')
    const manifest = JSON.parse(await readFile(join(result.directory, '.claude-plugin', 'plugin.json'), 'utf8'))
    expect(manifest).toEqual({ name: 'althar', description: 'Skills Althar selected for this run', version: '0.0.0' })
    expect(existsSync(join(result.directory, 'hooks'))).toBe(false)
    expect(loaded.entries).toHaveLength(1)
  })
})

describe('the Agent Skills layout', () => {
  it('puts skills under the run folder’s .agents/skills, which a session is given as an added directory', async () => {
    await writeCatalog(catalog, { alpha: good('alpha') })
    await run(installLocalCatalog(root, catalog))
    await run(setActive(root, 'alpha', true))
    const result = await run(
      projectRun({
        root,
        runId: 'r1',
        agent: 'codex',
        selected: await run(activeSelection(root, new Map())),
        capabilities: [],
        keepOutOf: ['/repo'],
        layout: 'agents',
      }),
    )
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
