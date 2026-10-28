import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { assert, describe, it } from '@effect/vitest'

import { scriptsIn } from '../src/runCommand'

/*
 * A repository's scripts, where launches.test.ts doesn't go: a root with no
 * name, and workspaces that name nothing to run.
 */

const folder = () => mkdtempSync(join(tmpdir(), 'althar-scripts-'))

const write = (path: string, manifest: unknown) => {
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'package.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest))
}

describe("a repository's scripts", () => {
  it('names a root with no name by its folder, and passes over workspaces that name nothing to run', () => {
    const here = folder()
    write(here, {
      scripts: { dev: 'vite' },
      // A folder with no package.json, one that isn't a pattern at all, a folder of folders that isn't there, and one whose
      // package.json can't be read.
      workspaces: ['docs', 42, 'missing/*', 'tools/broken', 'apps/**'],
    })
    mkdirSync(join(here, 'docs'))
    write(join(here, 'tools', 'broken'), '{ not json')
    write(join(here, 'apps', 'web'), { name: 'web', scripts: { dev: 'next dev' } })
    assert.deepStrictEqual(
      scriptsIn(here).map((script) => [script.package, script.name, script.command]),
      [
        [basename(here), 'dev', 'npm run dev'],
        ['web', 'dev', 'npm run dev --workspace web'],
      ],
    )
  })
})
