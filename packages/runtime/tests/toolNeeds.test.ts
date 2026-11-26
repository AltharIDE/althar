import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { needsAcross, needsInAll, needsOn, pinnedVersion, projectNeeds, toolsToInstall, withNeeds } from '../src/toolNeeds'

/* The tools a project's files say it needs, with why, and what a worker lacks of them (ADR-103). */

const files = (given: Readonly<Record<string, string>>) => async (path: string) => given[path]

describe('what a project’s files say it needs', () => {
  it('reads Bun and its version from the lockfile and .bun-version, and Node where it’s pinned too', async () => {
    expect(
      await projectNeeds(
        files({
          'package.json': JSON.stringify({ engines: { node: '^24.11.0 || >=26.0.0' } }),
          'bun.lock': '',
          '.bun-version': '1.3.5\n',
          '.node-version': '24',
        }),
      ),
    ).toEqual([
      { name: 'bun', why: 'bun.lock', version: '1.3.5' },
      { name: 'node', why: '.node-version', version: '24' },
    ])
  })

  it('takes the package manager package.json names first, and Node for every manager but Bun', async () => {
    expect(
      await projectNeeds(files({ 'package.json': JSON.stringify({ packageManager: 'pnpm@9.15.0+sha512.abc' }), 'pnpm-lock.yaml': '' })),
    ).toEqual([
      { name: 'pnpm', why: 'package.json', version: '9.15.0' },
      { name: 'node', why: 'package.json' },
    ])
    expect(await projectNeeds(files({ 'package.json': '{}', 'yarn.lock': '', '.nvmrc': 'lts/*' }))).toEqual([
      { name: 'yarn', why: 'yarn.lock' },
      { name: 'node', why: '.nvmrc', version: 'lts' },
    ])
    expect(await projectNeeds(files({ 'package.json': '{}', 'package-lock.json': '' }))).toEqual([
      { name: 'npm', why: 'package-lock.json' },
      { name: 'node', why: 'package.json' },
    ])
  })

  it('reads uv where uv.lock or pyproject.toml says so, else Python, and cargo, Go and Bundler by their files', async () => {
    expect(await projectNeeds(files({ 'pyproject.toml': '[project]\nname = "x"\n\n[tool.uv]\ndev = []\n' }))).toEqual([
      { name: 'uv', why: 'pyproject.toml' },
    ])
    expect(await projectNeeds(files({ 'requirements.txt': 'requests\n' }))).toEqual([{ name: 'python3', why: 'requirements.txt' }])
    expect(await projectNeeds(files({ 'Cargo.toml': '', 'go.mod': '', Gemfile: '' }))).toEqual([
      { name: 'cargo', why: 'Cargo.toml' },
      { name: 'go', why: 'go.mod' },
      { name: 'bundle', why: 'Gemfile' },
    ])
    expect(await projectNeeds(files({}))).toEqual([])
  })

  it('reads a pinned version as a project writes it', () => {
    expect(pinnedVersion('v24.11.0')).toBe('24.11.0')
    expect(pinnedVersion('lts/iron')).toBe('lts')
    expect(pinnedVersion('>=20.19 <22')).toBe('20')
    expect(pinnedVersion('  ')).toBeUndefined()
  })
})

describe('what a worker lacks of them', () => {
  const needs = [
    { name: 'bun', why: 'bun.lock', version: '1.3.5' },
    { name: 'node', why: '.node-version', version: '24' },
    { name: 'cargo', why: 'Cargo.toml' },
  ]
  const readiness = (tools: ReadonlyArray<{ name: string; version: string }>) => ({ sandbox: { starts: true as const }, tools, models: [] })

  it('installs what it installs itself, at the version asked, and leaves the rest to the lead', () => {
    const lacking = needsOn(
      needs,
      readiness([
        { name: 'node', version: '24.11.1' },
        { name: 'bun', version: '1.2.0' },
      ]),
    )
    expect(lacking).toEqual([
      { name: 'bun', why: 'bun.lock', version: '1.3.5', installs: true },
      { name: 'cargo', why: 'Cargo.toml', installs: false },
    ])
    expect(toolsToInstall(lacking)).toEqual([{ name: 'bun', version: '1.3.5' }])
    expect(toolsToInstall([{ name: 'node', why: 'package.json', installs: true }])).toEqual([{ name: 'node', version: 'lts' }])
  })

  it('takes npm with a Node it installs, as Althar’s own Node on a worker has none', () => {
    expect(
      needsOn(
        [
          { name: 'npm', why: 'package-lock.json' },
          { name: 'node', why: 'package.json' },
        ],
        readiness([{ name: 'node', version: '24.11.1' }]),
      ),
    ).toEqual([{ name: 'node', why: 'package-lock.json', installs: true }])
  })

  it('says nothing of a worker that hasn’t checked itself, and nothing where it lacks nothing', () => {
    expect(needsOn(needs, undefined)).toBeUndefined()
    const worker = { workerId: 'wrk_1', providers: [], busy: false }
    expect(withNeeds([worker], needs)).toEqual([worker])
    const ready = {
      ...worker,
      readiness: readiness([
        { name: 'bun', version: '1.3.5' },
        { name: 'node', version: '24.0.0' },
        { name: 'cargo', version: '1.80.0' },
      ]),
    }
    expect(withNeeds([ready], needs)).toEqual([ready])
  })
})

describe('what a task’s repositories need, each in its folder', () => {
  const repositories = () => {
    const root = mkdtempSync(join(tmpdir(), 'althar-needs-'))
    // A repository bound to its app/ folder, where bun.lock is, and a second one with uv.
    mkdirSync(join(root, 'web', 'app'), { recursive: true })
    writeFileSync(join(root, 'web', 'app', 'package.json'), '{}')
    writeFileSync(join(root, 'web', 'app', 'bun.lock'), '')
    writeFileSync(join(root, 'web', 'app', '.bun-version'), '1.3')
    mkdirSync(join(root, 'api'))
    writeFileSync(join(root, 'api', 'uv.lock'), '')
    return root
  }

  it('reads each repository where its setup runs, a subfolder included, at the closest pin any gives', async () => {
    const root = repositories()
    writeFileSync(join(root, 'api', 'package.json'), JSON.stringify({ packageManager: 'bun@1.3.5' }))
    expect(
      await needsAcross([
        { name: 'web', folder: join(root, 'web', 'app') },
        { name: 'api', folder: join(root, 'api') },
      ]),
    ).toEqual({
      needs: [
        { name: 'bun', why: 'package.json', version: '1.3.5' },
        { name: 'uv', why: 'uv.lock' },
      ],
    })
    // Read at the repository's top, the subfolder's bun.lock isn't seen: the folder is what counts.
    expect(await needsInAll([join(root, 'web')])).toEqual([])
  })

  it('refuses pins of a tool that can’t be one install, naming both repositories and versions', async () => {
    const root = repositories()
    writeFileSync(join(root, 'api', 'package.json'), JSON.stringify({ packageManager: 'bun@1.2.0' }))
    expect(
      await needsAcross([
        { name: 'web', folder: join(root, 'web', 'app') },
        { name: 'api', folder: join(root, 'api') },
      ]),
    ).toEqual({
      conflict:
        'web pins Bun 1.3 (bun.lock) and api pins Bun 1.2.0 (package.json): a worker runs a task with one of each. Run it on the home, or pin the same version in both.',
    })
  })
})
