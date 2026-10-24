import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { run } from './support'
import { describe, expect, it } from 'vitest'
import { CURATED, LEFT_OUT } from '../scripts/curation'
import { loadLocalCatalog } from '../src/local'

/* The default catalog the app ships (catalog/), as the app loads it: every skill validated with push text refused, every tree at its pin. */

const catalog = join(import.meta.dirname, '..', 'catalog')

describe('the default catalog', () => {
  it('loads as the app loads it, every skill valid and at its pinned hash', async () => {
    const loaded = await run(loadLocalCatalog(catalog))
    expect(loaded.skills.map(({ entry }) => entry.id)).toEqual(CURATED.map(({ id }) => id))
  })

  it('carries each skill from a pinned commit of an MIT upstream, with that licence beside it', async () => {
    const { skills } = await run(loadLocalCatalog(catalog))
    for (const { entry } of skills) {
      expect(entry.source).toMatchObject({ kind: 'github', subpath: `skills/${entry.id}` })
      expect(entry.license).toBe('MIT')
      expect(entry.copyright).toMatch(/^Copyright \(c\) 2025 /)
    }
    for (const name of ['agent-skills', 'superpowers'])
      expect(await readFile(join(catalog, 'LICENSES', `${name}.txt`), 'utf8')).toContain('MIT License')
  })

  it('carries no skill it left out, and no file whose terms the upstream licence does not cover', async () => {
    const { skills } = await run(loadLocalCatalog(catalog))
    const ids = skills.map(({ entry }) => entry.id)
    for (const left of Object.keys(LEFT_OUT).filter((name) => !name.includes('@'))) expect(ids).not.toContain(left)
    const writing = skills.find(({ entry }) => entry.id === 'writing-skills')
    expect(writing?.files.has('anthropic-best-practices.md')).toBe(false)
  })

  it('marks every skill that cannot be followed without subagents', async () => {
    const { skills } = await run(loadLocalCatalog(catalog))
    expect(skills.filter(({ entry }) => entry.needs.includes('subagents')).map(({ entry }) => entry.id)).toEqual([
      'doubt-driven-development',
      'dispatching-parallel-agents',
      'requesting-code-review',
      'subagent-driven-development',
      'writing-skills',
    ])
  })
})
