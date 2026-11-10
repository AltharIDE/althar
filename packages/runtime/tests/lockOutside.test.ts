import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { notInstalled, outsideEntries, outsideRegistry } from '../src/lockOutside'

/*
 * What Run safely can't install (a task is a conversation plus parts, "Run
 * it"): a lockfile's entries from a git host or a tarball off a registry,
 * read from each lockfile Althar installs from, and named where they aren't
 * in node_modules after the install.
 */

describe('a lockfile’s entries from outside a registry', () => {
  it('knows a git host or a tarball off a registry from what a registry serves', () => {
    expect(outsideRegistry('git+ssh://git@github.com/acme/left-pad.git#abc')).toBe(true)
    expect(outsideRegistry('github:acme/left-pad#abc')).toBe(true)
    expect(outsideRegistry('https://codeload.github.com/acme/left-pad/tar.gz/abc')).toBe(true)
    expect(outsideRegistry('https://files.example.com/left-pad-1.0.0.tgz')).toBe(true)
    expect(outsideRegistry('https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz')).toBe(false)
    expect(outsideRegistry('https://npm.acme.internal/left-pad/-/left-pad-1.3.0.tgz')).toBe(false)
  })

  it('reads them from npm’s, bun’s, yarn’s and pnpm’s lockfiles', () => {
    const npm = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'meridian' },
        'node_modules/left-pad': { resolved: 'git+ssh://git@github.com/acme/left-pad.git#abc' },
        'node_modules/@acme/ui': { resolved: 'https://files.example.com/ui-1.0.0.tgz' },
        'node_modules/react': { resolved: 'https://registry.npmjs.org/react/-/react-19.0.0.tgz' },
      },
    })
    expect(outsideEntries('package-lock.json', npm).map((one) => one.name)).toEqual(['left-pad', '@acme/ui'])
    const bun = [
      '{',
      '  "packages": {',
      '    "left-pad": ["left-pad@github:acme/left-pad#abc", {}, "acme-left-pad-abc"],',
      '    "@acme/ui": ["@acme/ui@https://files.example.com/ui-1.0.0.tgz", {}],',
      '    "react": ["react@19.0.0", "", {}, "sha512-x"],',
      '  }',
      '}',
    ].join('\n')
    expect(outsideEntries('bun.lock', bun)).toEqual([
      { name: 'left-pad', from: 'github:acme/left-pad#abc' },
      { name: '@acme/ui', from: 'https://files.example.com/ui-1.0.0.tgz' },
    ])
    const yarn = [
      '"left-pad@git+https://github.com/acme/left-pad.git":',
      '  version "1.0.0"',
      '  resolved "git+https://github.com/acme/left-pad.git#abc"',
      '',
      'react@^19.0.0:',
      '  version "19.0.0"',
      '  resolved "https://registry.yarnpkg.com/react/-/react-19.0.0.tgz#sha"',
    ].join('\n')
    expect(outsideEntries('yarn.lock', yarn).map((one) => one.name)).toEqual(['left-pad'])
    const pnpm = [
      'packages:',
      '',
      "  '@acme/ui@https://files.example.com/ui-1.0.0.tgz':",
      '    resolution: {tarball: https://files.example.com/ui-1.0.0.tgz}',
      '',
      '  left-pad@https://codeload.github.com/acme/left-pad/tar.gz/abc:',
      '    resolution: {tarball: https://codeload.github.com/acme/left-pad/tar.gz/abc}',
      '',
      '  react@19.0.0:',
      '    resolution: {integrity: sha512-x}',
    ].join('\n')
    expect(outsideEntries('pnpm-lock.yaml', pnpm).map((one) => one.name)).toEqual(['@acme/ui', 'left-pad'])
    expect(outsideEntries('Cargo.lock', 'anything')).toEqual([])
  })

  it('names those that aren’t in node_modules once installed', () => {
    const copy = mkdtempSync(join(tmpdir(), 'althar-lock-'))
    writeFileSync(
      join(copy, 'package-lock.json'),
      JSON.stringify({
        packages: {
          'node_modules/left-pad': { resolved: 'github:acme/left-pad#abc' },
          'node_modules/right-pad': { resolved: 'github:acme/right-pad#abc' },
        },
      }),
    )
    mkdirSync(join(copy, 'node_modules', 'right-pad'), { recursive: true })
    writeFileSync(join(copy, 'node_modules', 'right-pad', 'package.json'), '{}')
    expect(notInstalled(copy, 'package-lock.json')).toEqual([{ name: 'left-pad', from: 'github:acme/left-pad#abc' }])
    expect(notInstalled(copy, 'bun.lock')).toEqual([])
  })
})
