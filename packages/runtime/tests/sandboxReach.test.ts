import { hostOf, runsOutside } from '@althar/contracts'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Ids, newId } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { Instance } from '../src/Instance'
import { Policies } from '../src/Policies'
import { Projects } from '../src/Projects'
import { essentials } from '../src/rules'
import * as Runtime from '../src/Runtime'
import { ALWAYS, commandsIn, hostsIn, hostsOfRemote, hostsOfTracker, runCommandsOf, setupCommandsOf, withEdits } from '../src/sandboxReach'
import { Sessions, upFrontSaid } from '../src/Sessions'
import { repository, runtime, sessionMetas, turns, until } from './support'

/*
 * What a lead's sandbox lets through from the start: commands it runs
 * outside it, worked out from the project's packages, scripts and what is
 * kept for how it runs, and hosts it reaches without asking, from its
 * remotes, its package managers and the trackers Althar is connected to.
 * The person's edits hold over what is worked out, and a host goes in only
 * where the rules would let a request for it through without anyone.
 */

const git = (cwd: string, ...args: Array<string>) =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@althar.test', ...args], { cwd })

/** A folder with a package.json, a lockfile and what else is given, not a repository. */
const folder = (manifest: Readonly<Record<string, unknown>>, files: Readonly<Record<string, string>> = {}) => {
  const path = mkdtempSync(join(tmpdir(), 'althar-reach-'))
  writeFileSync(join(path, 'package.json'), JSON.stringify(manifest))
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(path, name, '..'), { recursive: true })
    writeFileSync(join(path, name), body)
  }
  return path
}

/** A repository on GitHub with Playwright and Electron, end-to-end tests and a bun lockfile, as this one is. */
const desktopApp = () => {
  const path = repository()
  writeFileSync(
    join(path, 'package.json'),
    JSON.stringify({
      name: 'meridian',
      scripts: { dev: 'vite', test: 'vitest', 'test:e2e': 'node scripts/e2e.ts', check: 'tsc' },
      devDependencies: { '@playwright/test': '1', electron: '38', vitest: '4' },
    }),
  )
  writeFileSync(join(path, 'bun.lock'), '{}\n')
  git(path, 'add', '.')
  git(path, 'commit', '-q', '-m', 'Packages')
  git(path, 'remote', 'add', 'origin', 'git@github.com:acme/meridian.git')
  return path
}

describe('what a repository says its leads run outside the sandbox', () => {
  it('names the tools its packages bring, by its package manager, and its test scripts', () => {
    const root = folder(
      {
        name: 'shop',
        workspaces: ['apps/*'],
        scripts: { test: 'vitest', build: 'vite build' },
        devDependencies: { vitest: '4' },
      },
      {
        'pnpm-lock.yaml': '',
        'apps/web/package.json': JSON.stringify({
          name: 'web',
          scripts: { test: 'vitest', e2e: 'playwright test', dev: 'vite' },
          devDependencies: { playwright: '1', jest: '30' },
        }),
      },
    )
    assert.deepStrictEqual(commandsIn(root), [
      'pnpm exec playwright',
      'pnpm exec vitest',
      'pnpm exec jest',
      'pnpm run test',
      'pnpm run e2e',
    ])
  })

  it('names Bun’s scripts by what they run, as Claude Code keeps a line that starts with bun in its sandbox', () => {
    const root = folder(
      { name: 'althar', workspaces: ['apps/*'], scripts: { test: "bun --filter '*' test", 'test:e2e': "bun --filter '*' test:e2e" } },
      {
        'bun.lock': '{}',
        'node_modules/.bin/vp': '',
        'apps/desktop/package.json': JSON.stringify({
          name: '@althar/desktop',
          scripts: {
            test: 'vp test run',
            'test:e2e': 'node scripts/e2e.ts',
            screenshots: 'playwright test shots',
            dev: 'bun run build && electron .',
          },
          devDependencies: { '@playwright/test': '1' },
        }),
      },
    )
    assert.deepStrictEqual(commandsIn(root), ['bunx playwright', 'bunx vp test run', 'node scripts/e2e.ts'])
    assert.deepStrictEqual(
      ['bun run test:e2e', '/opt/bin/bun x', 'bunx playwright', 'node scripts/e2e.ts', 'bundle exec rspec'].map(runsOutside),
      [false, false, true, true, true],
    )
  })

  it('names none where it has no packages, and npm’s where no lockfile says', () => {
    assert.deepStrictEqual(commandsIn(mkdtempSync(join(tmpdir(), 'althar-reach-'))), [])
    assert.deepStrictEqual(commandsIn(folder({ name: 'tool', devDependencies: { electron: '38' } })), ['npx electron'])
  })

  it('reads a kept setup by how each command starts, and a kept run command whole, without what only tests or changes folder', () => {
    assert.deepStrictEqual(setupCommandsOf('test -d node_modules || bun install --frozen-lockfile'), ['bun install'])
    assert.deepStrictEqual(setupCommandsOf('if not exist node_modules npm ci'), ['npm ci'])
    assert.deepStrictEqual(setupCommandsOf('uv sync && (cd web && pnpm install)'), ['uv sync', 'pnpm install'])
    assert.deepStrictEqual(runCommandsOf('cd apps/desktop && bunx  storybook dev --port 6116'), ['bunx storybook dev --port 6116'])
    assert.deepStrictEqual(runCommandsOf('bun --filter @althar/ui storybook'), ['bun --filter @althar/ui storybook'])
  })

  it('always names ps and env -i', () => {
    assert.deepStrictEqual(ALWAYS, ['ps', 'env -i'])
  })
})

describe('what a project says its leads reach without asking', () => {
  it('names a remote’s code host, with its API and where it serves files, or the one host it names', () => {
    assert.deepStrictEqual(hostsOfRemote('git@github.com:acme/shop.git'), [
      'github.com',
      'api.github.com',
      'codeload.github.com',
      'raw.githubusercontent.com',
      'objects.githubusercontent.com',
      'release-assets.githubusercontent.com',
    ])
    assert.deepStrictEqual(hostsOfRemote('https://bitbucket.org/acme/shop.git'), ['bitbucket.org', 'api.bitbucket.org'])
    assert.deepStrictEqual(hostsOfRemote('https://git.acme.dev/shop.git'), ['git.acme.dev'])
    assert.deepStrictEqual(hostsOfRemote('git@git.acme.dev:shop.git'), ['git.acme.dev'])
    assert.deepStrictEqual(hostsOfRemote('/srv/git/shop.git'), [])
  })

  it('names a tracker’s hosts, Linear’s uploads too, and none for a code host, whose remotes say', () => {
    assert.deepStrictEqual(hostsOfTracker('linear', 'https://linear.app', 'https://api.linear.app'), [
      'linear.app',
      'api.linear.app',
      'uploads.linear.app',
    ])
    assert.deepStrictEqual(hostsOfTracker('jira_cloud', 'https://acme.atlassian.net', 'https://acme.atlassian.net/rest/api/3'), [
      'acme.atlassian.net',
    ])
    assert.deepStrictEqual(hostsOfTracker('github', 'https://github.com', 'https://api.github.com'), [])
  })

  it('names the registries its package managers fetch from, and where Playwright and Electron download from', () => {
    const app = folder({ name: 'app', devDependencies: { '@playwright/test': '1' } }, { 'yarn.lock': '', 'pyproject.toml': '' })
    assert.deepStrictEqual(hostsIn(app), [
      'registry.npmjs.org',
      'registry.yarnpkg.com',
      'repo.yarnpkg.com',
      'pypi.org',
      'files.pythonhosted.org',
      'cdn.playwright.dev',
      'playwright.download.prss.microsoft.com',
      'playwright.azureedge.net',
    ])
  })
})

describe('the person’s edits', () => {
  it('take out what they removed and add what they added, each once, over what is worked out', () => {
    assert.deepStrictEqual(withEdits(['ps', 'bunx playwright', 'env -i'], { added: ['make e2e', 'ps'], removed: ['env -i'] }), [
      'ps',
      'bunx playwright',
      'make e2e',
    ])
    assert.deepStrictEqual(withEdits(['ps'], undefined), ['ps'])
  })
})

describe('a network request’s record', () => {
  it('keeps the host it was for', () => {
    assert.deepStrictEqual(essentials({ host: 'registry.npmjs.org' }), { input: { host: 'registry.npmjs.org' }, cut: [] })
  })
})

/** A ready connection to Linear on this device, as connecting one keeps it. */
const linear = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const instance = yield* Instance
  const now = new Date().toISOString()
  yield* sql`INSERT INTO connections ${sql.insert({
    id: yield* newId(Ids.connection),
    deviceId: instance.deviceId,
    product: 'linear',
    webUrl: 'https://linear.app',
    apiUrl: 'https://api.linear.app',
    accountId: 'user-1',
    accountLogin: 'ada',
    auth: 'pkce',
    credentialRef: 'linear:user-1',
    state: 'ready',
    createdAt: now,
    updatedAt: now,
  })}`
})

/** A task on a desktop app with Claude Code leading it, its project's rules as given; what its lead's session was started with. */
const leading = (rules: Parameters<Policies['Service']['set']>[1]) =>
  Effect.gen(function* () {
    const projects = yield* Projects
    const policies = yield* Policies
    const instance = yield* Instance
    const sessions = yield* Sessions
    yield* linear
    const project = yield* projects.open({ envelope: yield* Runtime.envelope('project.open', {}), path: desktopApp() })
    yield* policies.set(project.projectId, rules, instance.personId)
    const made = yield* projects.createTask({
      envelope: yield* Runtime.envelope('task.create', { title: 'Retry checkout' }),
      projectId: project.projectId,
      title: 'Retry checkout',
    })
    sessionMetas.length = 0
    yield* sessions.start({ threadId: made.threadId, agentId: 'claude-code' })
    yield* until(turns(made.threadId), (rows) => rows.length >= 1)
    const lead = sessionMetas.find((meta) => meta.role === 'lead')
    return lead?.options?.sandbox
  })

describe('a lead’s session', () => {
  it.live(
    'runs the project’s known commands outside its sandbox, and reaches its code host, registry and tracker without asking',
    () =>
      Effect.gen(function* () {
        const sandbox = yield* leading({ permissions: 'rules' })
        // Not `bun run dev` or `bun install`, which Claude Code would run in the sandbox anyway.
        assert.deepStrictEqual(sandbox?.commands, [
          'bunx playwright',
          'bunx electron',
          'bunx vitest',
          'node scripts/e2e.ts',
          'ps',
          'env -i',
        ])
        // Not GitHub's release downloads: the rules read `release-assets` as publishing, which always asks here.
        assert.deepStrictEqual(sandbox?.hosts, [
          'github.com',
          'api.github.com',
          'codeload.github.com',
          'raw.githubusercontent.com',
          'objects.githubusercontent.com',
          'registry.npmjs.org',
          'cdn.playwright.dev',
          'playwright.download.prss.microsoft.com',
          'playwright.azureedge.net',
          'linear.app',
          'api.linear.app',
          'uploads.linear.app',
        ])
      }).pipe(Effect.provide(runtime())),
    20_000,
  )

  it.live(
    'is given the person’s edits, and no host while the rest asks the person, though its commands still run outside',
    () =>
      Effect.gen(function* () {
        const sandbox = yield* leading({
          permissions: 'ask',
          sandbox: {
            commands: { added: ['make  e2e *', 'bun run test:e2e'], removed: ['env -i'] },
            hosts: { added: ['https://Pkgs.Acme.dev:8443/simple'], removed: [] },
          },
        })
        assert.deepStrictEqual(sandbox?.commands, [
          'bunx playwright',
          'bunx electron',
          'bunx vitest',
          'node scripts/e2e.ts',
          'ps',
          'make e2e',
        ])
        assert.deepStrictEqual(sandbox?.hosts, [])
      }).pipe(Effect.provide(runtime())),
    20_000,
  )

  it.live(
    'reaches every host with everything allowed, but one the project never lets a command name',
    () =>
      Effect.gen(function* () {
        const sandbox = yield* leading({ allowEverything: true, commands: [{ pattern: 'uploads.linear.app', decision: 'never' }] })
        assert.include(sandbox?.hosts ?? [], 'registry.npmjs.org')
        assert.notInclude(sandbox?.hosts ?? [], 'uploads.linear.app')
      }).pipe(Effect.provide(runtime())),
    20_000,
  )

  it.live(
    'never reaches every host under a name, which would pass one the project never allows',
    () =>
      Effect.gen(function* () {
        // The rules allow `*.example.com` as written, and refuse `private.example.com`, which it would let through.
        const sandbox = yield* leading({
          permissions: 'rules',
          commands: [{ pattern: 'private.example.com', decision: 'never' }],
          sandbox: { hosts: { added: ['*.example.com', 'pkgs.example.com'], removed: [] } },
        })
        assert.include(sandbox?.hosts ?? [], 'pkgs.example.com')
        assert.notInclude(sandbox?.hosts ?? [], '*.example.com')
      }).pipe(Effect.provide(runtime())),
    20_000,
  )
})

describe('a lead’s brief', () => {
  it('names what runs outside its sandbox, how one does, and the hosts it reaches', () => {
    assert.strictEqual(
      upFrontSaid({ commands: ['bunx playwright', 'ps'], hosts: ['github.com', 'registry.npmjs.org'] }),
      "These commands run outside your sandbox from the start, so they don't fail inside it first: `bunx playwright`, `ps`. Each still asks, and meets the project's rules. One runs outside only on a line of its own: a line that runs anything else with it, `cd` included, stays in the sandbox, so change folder in a call of its own first. A line that starts with `bun` always stays in the sandbox: run what its script runs instead, from the script's folder, as listed here. Your sandbox reaches these hosts without asking: github.com, registry.npmjs.org.",
    )
    assert.strictEqual(upFrontSaid({ commands: ['ps'], hosts: [] }).includes('hosts'), false)
  })
})

describe('a host the person types', () => {
  it('is one host by its name, from an address or with a port, and never every host under one', () => {
    assert.deepStrictEqual(
      ['HTTPS://PyPI.org/simple', 'pkgs.acme.dev:8443', 'localhost', '*.example.com', 'private.*.com', 'not a host', ''].map(hostOf),
      ['pypi.org', 'pkgs.acme.dev', 'localhost', null, null, null, null],
    )
  })
})
