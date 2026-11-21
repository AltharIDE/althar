import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { realPath } from '@althar/testing'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'

import { INSTRUCTIONS_ALL, INSTRUCTIONS_EACH, instructionsSection, repositoryInstructions } from '../src/repositoryInstructions'

/*
 * What a project's repositories tell agents, as the coordinator's brief
 * carries it: read from its copies, imports put in place, links never
 * followed, and as much as a brief has room for.
 */

/** A folder standing for a copy, with these files in it, and one beside it that isn't in it. */
const copy = (files: Readonly<Record<string, string>>) => {
  const place = realPath(mkdtempSync(join(tmpdir(), 'althar-instructions-')))
  const root = join(place, 'copy')
  mkdirSync(root)
  writeFileSync(join(place, 'outside.md'), 'A secret beside the copy.\n')
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return { place, root }
}

describe("a repository's instructions for agents", () => {
  it.effect('are read from AGENTS.md, and a CLAUDE.md that only imports it says nothing twice', () =>
    Effect.gen(function* () {
      const { root } = copy({ 'AGENTS.md': '# Agents\n\nRun bun run check.\n', 'CLAUDE.md': '@AGENTS.md\n' })
      const said = yield* repositoryInstructions([{ name: 'meridian', root, within: null }])
      assert.strictEqual(said, `meridian, AGENTS.md (${join(root, 'AGENTS.md')}):\n# Agents\n\nRun bun run check.`)
    }),
  )

  it.effect('put an import in place, name one read already, and leave one outside the copy as it was written', () =>
    Effect.gen(function* () {
      const { root } = copy({
        'AGENTS.md': 'Use Effect on the runtime side.\n',
        'CLAUDE.md': '# Claude\n@AGENTS.md\n@docs/agents.md\n@../outside.md\nSee @docs/agents.md for more.\n',
        'docs/agents.md': 'Migrations live in packages/persistence-sqlite.\n',
      })
      const said = yield* repositoryInstructions([{ name: 'meridian', root, within: null }])
      assert.include(said, 'meridian, AGENTS.md')
      assert.include(
        said,
        `meridian, CLAUDE.md (${join(root, 'CLAUDE.md')}):\n# Claude\n(AGENTS.md, above)\nMigrations live in packages/persistence-sqlite.\n@../outside.md\nSee @docs/agents.md for more.`,
      )
      assert.notInclude(said, 'A secret')
    }),
  )

  it.effect('never follow a link, to a file or through a folder, out of the copy', () =>
    Effect.gen(function* () {
      const { place, root } = copy({})
      symlinkSync(join(place, 'outside.md'), join(root, 'AGENTS.md'))
      mkdirSync(join(place, 'elsewhere'))
      writeFileSync(join(place, 'elsewhere', 'CLAUDE.md'), 'A secret elsewhere.\n')
      symlinkSync(join(place, 'elsewhere'), join(root, 'apps'))
      const said = yield* repositoryInstructions([{ name: 'meridian', root, within: 'apps' }])
      assert.strictEqual(said, '')
      assert.deepStrictEqual(instructionsSection(said), [])
    }),
  )

  it.effect("read the project's folder's too, where the project is one folder of its repository", () =>
    Effect.gen(function* () {
      const { root } = copy({ 'AGENTS.md': 'The whole repository.\n', 'apps/web/CLAUDE.md': 'Only the web app.\n' })
      const said = yield* repositoryInstructions([{ name: 'meridian', root, within: 'apps/web' }])
      assert.include(said, 'meridian, AGENTS.md')
      assert.include(said, `meridian, apps/web/CLAUDE.md (${join(root, 'apps/web/CLAUDE.md')}):\nOnly the web app.`)
      const [section] = instructionsSection(said)
      assert.match(section ?? '', /^What the project's repositories tell the agents that work in them/)
      assert.include(section, 'you still change none')
    }),
  )

  it.effect('carry as much as a brief has room for, and say where the rest is', () =>
    Effect.gen(function* () {
      const long = 'x'.repeat(INSTRUCTIONS_EACH + 500)
      const first = copy({ 'AGENTS.md': long, 'CLAUDE.md': long })
      const second = copy({ 'AGENTS.md': 'Left out.\n' })
      const said = yield* repositoryInstructions([
        { name: 'one', root: first.root, within: null },
        { name: 'two', root: second.root, within: null },
      ])
      assert.include(said, `… (cut here: the rest is in ${join(first.root, 'AGENTS.md')})`)
      assert.include(said, `… (cut here: the rest is in ${join(first.root, 'CLAUDE.md')})`)
      assert.include(said, `two, AGENTS.md: left out for room; it is at ${join(second.root, 'AGENTS.md')}`)
      assert.notInclude(said, 'Left out.')
      assert.isBelow(said.length, INSTRUCTIONS_ALL + 1_000)
    }),
  )
})
