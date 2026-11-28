import { mkdtempSync, writeFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vite-plus/test'

import { covered, gated, graph, names, nearest, plan, type Plan, queueEntries, queuePlan, type Repository, repository } from '../src/select'

const json = (value: unknown) => JSON.stringify(value)

/** Many runtime tests that use its support, as most do, and a few that use only what they test. */
const RUNTIME_TESTS = Object.fromEntries([
  ...Array.from({ length: 160 }, (_, index) => [`packages/runtime/tests/run${index}.test.ts`, "import { start } from './support'"]),
  ...Array.from({ length: 3 }, (_, index) => [`packages/runtime/tests/words${index}.test.ts`, "import { said } from '../src/words'"]),
])

/** A repository shaped like this one, small. */
const FILES: Record<string, string> = {
  'package.json': json({ workspaces: ['apps/*', 'packages/*'] }),
  'bun.lock': '',
  'README.md': '# Althar',
  'docs/plans/tests-that-hold.md': '# A plan',
  'packages/testing/package.json': json({ name: '@althar/testing', exports: { '.': './src/index.ts' } }),
  'packages/testing/src/index.ts': 'export const waitFor = () => {}',
  'packages/domain/package.json': json({ name: '@althar/domain', exports: { '.': './src/index.ts' } }),
  'packages/domain/src/index.ts': "export * from './ids'",
  'packages/domain/src/ids.ts': 'export const id = 1',
  'packages/domain/tests/ids.test.ts': "import { id } from '../src/ids'",
  'packages/provider-adapters/package.json': json({
    name: '@althar/provider-adapters',
    exports: { '.': './src/index.ts', './testing': './src/testing/index.ts' },
    dependencies: { '@althar/domain': 'workspace:*' },
  }),
  'packages/provider-adapters/src/index.ts': "export * from './process.js'",
  'packages/provider-adapters/src/process.ts': "import type { Id } from '@althar/domain'\nexport const spawn = () => {}",
  'packages/provider-adapters/src/testing/index.ts':
    "import { fileURLToPath } from 'node:url'\nexport const fakeAgentMain = fileURLToPath(new URL('./fakeAgentMain.ts', import.meta.url))",
  'packages/provider-adapters/src/testing/fakeAgentMain.ts': "process.stdout.write('ready')",
  'packages/provider-adapters/tests/process.test.ts': "import { spawn } from '../src/process'",
  'packages/runtime/package.json': json({
    name: '@althar/runtime',
    exports: { '.': './src/index.ts' },
    dependencies: { '@althar/domain': 'workspace:*', '@althar/provider-adapters': 'workspace:*' },
  }),
  'packages/runtime/src/index.ts': "export * from './Runtime'",
  'packages/runtime/src/Runtime.ts':
    "import { id } from '@althar/domain'\nimport { spawn } from '@althar/provider-adapters'\nimport { commit } from './git'",
  'packages/runtime/src/git.ts': 'export const commit = () => {}',
  'packages/runtime/src/words.ts': "export const said = 'Sent back'",
  'packages/runtime/src/unused.ts': 'export const nobody = 1',
  'packages/runtime/tests/support.ts':
    "import { layer } from '../src/Runtime'\nimport { fakeAgentMain } from '@althar/provider-adapters/testing'",
  ...RUNTIME_TESTS,
  'packages/ui/package.json': json({ name: '@althar/ui', exports: { '.': './src/index.ts', './styles.css': './src/styles/global.css' } }),
  'packages/ui/vite.config.ts': "export default { test: { setupFiles: ['tests/setup.ts'] } }",
  'packages/ui/README.md': '# The UI kit',
  'packages/ui/src/index.ts': "export * from './chrome/TaskHeader/TaskHeader'\nexport * from './primitives/Button/Button'",
  'packages/ui/src/chrome/TaskHeader/TaskHeader.tsx':
    "import styles from './TaskHeader.module.css'\nexport const TaskHeader = () => 'Waiting for you'",
  'packages/ui/src/chrome/TaskHeader/TaskHeader.module.css': '.header { composes: quiet from "../../styles/type.css"; }',
  'packages/ui/src/chrome/TaskHeader/TaskHeader.stories.tsx': "import { TaskHeader } from './TaskHeader'",
  'packages/ui/src/styles/type.css': '.quiet { color: gray }',
  'packages/ui/src/styles/global.css': "@import './type.css';",
  'packages/ui/src/primitives/Button/Button.tsx': "export const Button = () => 'Start'",
  'packages/ui/tests/setup.ts': '',
  'packages/ui/tests/TaskHeader.test.tsx': "import { TaskHeader } from '../src/chrome/TaskHeader/TaskHeader'",
  'packages/ui/tests/Button.test.tsx': "import { Button } from '../src/primitives/Button/Button'",
  'packages/ui/tests/stories.chrome.test.tsx':
    "runStories(import.meta.glob<StoryFile>(['../src/chrome/**/*.stories.tsx'], { eager: true }))",
  'apps/desktop/package.json': json({
    name: '@althar/desktop',
    dependencies: { '@althar/runtime': 'workspace:*', '@althar/ui': 'workspace:*', '@althar/provider-adapters': 'workspace:*' },
  }),
  'apps/desktop/release-notes/0.6.0.md': '# 0.6.0',
  'apps/desktop/src/main/main.ts': "import { seal } from './keyring'\nconst here = import.meta.dirname",
  'apps/desktop/src/main/keyring.ts': 'export const seal = () => {}',
  'apps/desktop/src/runtime/runtime.ts': "import { layer } from '@althar/runtime'",
  'apps/desktop/src/renderer/main.tsx': "import { Home } from './features/home'\nimport '@althar/ui/styles.css'",
  'apps/desktop/src/renderer/features/home.tsx': "import { TaskHeader } from '@althar/ui'",
  'apps/desktop/src/renderer/features/plan.ts': "export const planWords = 'Out of usage'",
  'apps/desktop/tests/keyring.test.ts': "import { seal } from '../src/main/keyring'",
  'apps/desktop/tests/home.test.tsx': "import { Home } from '../src/renderer/features/home'",
  'apps/desktop/tests/plan.test.ts': "import { planWords } from '../src/renderer/features/plan'",
  'apps/desktop/tests/runtime.test.ts': "import { start } from '../src/runtime/runtime'",
  'apps/desktop/e2e/support.ts': "import { join } from 'node:path'\nconst app = join(import.meta.dirname, '..')",
  'apps/desktop/e2e/smoke.spec.ts': "import { launch } from './support'",
  'apps/desktop/e2e/home.spec.ts': "import { launch } from './support'",
}

const REPO: Repository = { files: Object.keys(FILES), read: (path) => FILES[path] ?? '' }

/** What a plan runs, by job: each part's package, with checks or not, and which of its tests. */
const runs = (jobs: Plan['jobs']) =>
  Object.fromEntries(
    jobs.map((job) => [
      job.name,
      job.parts.map((part) => `${part.dir}${part.check ? ' checked' : ''}: ${part.tests === 'all' ? 'all' : part.tests.join(' ')}`),
    ]),
  )

const RUNTIME_PARTS = ['packages/runtime 1/4', 'packages/runtime 2/4', 'packages/runtime 3/4', 'packages/runtime 4/4']

describe('the merge queue’s selection', () => {
  it('runs only the tests that both an entry and what landed beneath it reach', () => {
    // A runtime change beneath a UI change: the app's home test reaches both, the runtime's own tests only one.
    const entries = [
      { pr: 2, changes: ['packages/ui/src/chrome/TaskHeader/TaskHeader.tsx'], since: ['apps/desktop/src/renderer/features/home.tsx'] },
    ]
    expect(runs(queuePlan(entries, REPO, 'desktop').jobs)).toEqual({ 'apps/desktop': ['apps/desktop checked: tests/home.test.tsx'] })
    // The UI kit builds on nothing the app changed: its tests and checks ran on its own pull request.
    expect(queuePlan(entries, REPO, 'ui').jobs).toEqual([])
    expect(queuePlan(entries, REPO, 'harness').jobs).toEqual([])
  })

  it('runs only the checks for an entry whose tests nothing that landed beneath it reaches', () => {
    const queued = queuePlan(
      [{ pr: 3, changes: ['packages/runtime/src/words.ts'], since: ['packages/domain/src/ids.ts', 'README.md'] }],
      REPO,
      'harness',
    )
    // The runtime builds on the domain, so its checks run; its words tests don't import the domain.
    expect(runs(queued.jobs)).toEqual({ 'packages/runtime': ['packages/runtime checked: '] })
    expect(queuePlan([{ pr: 4, changes: ['packages/runtime/src/git.ts'], since: [] }], REPO, 'harness')).toMatchObject({
      jobs: [],
      why: ['#4: nothing landed beneath it since it branched.'],
    })
  })

  it('runs no end-to-end run, which the pull request and post-merge run', () => {
    const queued = queuePlan(
      [{ pr: 5, changes: ['apps/desktop/src/main/keyring.ts'], since: ['apps/desktop/src/main/main.ts'] }],
      REPO,
      'desktop',
    )
    expect(queued).toMatchObject({ e2e: false, windowsE2e: false })
  })

  it('runs what an entry reaches when what landed beneath it may change any test, and the other way round', () => {
    const changes = ['packages/runtime/src/words.ts']
    const words = { 'packages/runtime': ['packages/runtime checked: tests/words0.test.ts tests/words1.test.ts tests/words2.test.ts'] }
    expect(runs(queuePlan([{ pr: 6, changes, since: ['bun.lock'] }], REPO, 'harness').jobs)).toEqual(words)
    expect(runs(queuePlan([{ pr: 7, changes: ['bun.lock'], since: changes }], REPO, 'harness').jobs)).toEqual(words)
  })

  it('reads the entries queue-entries.py wrote, and none from a file that isn’t them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'althar-entries-'))
    const write = (name: string, text: string) => {
      writeFileSync(join(dir, name), text)
      return join(dir, name)
    }
    const entries = [{ pr: 1, changes: ['a.ts'], since: [] }]
    expect(queueEntries(write('good.json', JSON.stringify(entries)))).toEqual(entries)
    // Each falls back to everything the group changes.
    expect(queueEntries(join(dir, 'missing.json'))).toBeUndefined()
    expect(queueEntries(write('empty.json', '[]'))).toBeUndefined()
    expect(queueEntries(write('broken.json', '[{'))).toBeUndefined()
    expect(queueEntries(write('shape.json', JSON.stringify([{ pr: '1', changes: [], since: [] }])))).toBeUndefined()
    expect(queueEntries(write('null.json', 'null'))).toBeUndefined()
  })

  it('takes every entry of the group together', () => {
    const queued = queuePlan(
      [
        { pr: 8, changes: ['packages/runtime/src/words.ts'], since: ['packages/runtime/tests/words0.test.ts'] },
        { pr: 9, changes: ['packages/runtime/src/words.ts'], since: ['packages/runtime/src/words.ts'] },
      ],
      REPO,
      'harness',
    )
    expect(runs(queued.jobs)).toEqual({
      'packages/runtime': ['packages/runtime checked: tests/words0.test.ts tests/words1.test.ts tests/words2.test.ts'],
    })
    expect(queued.why).toHaveLength(2)
  })
})

describe('the selection', () => {
  it('checks and tests Node transports and their runtime/desktop consumers on Linux and Windows', () => {
    const files = {
      ...FILES,
      'packages/transport-node/package.json': json({ name: '@althar/transport-node', exports: { '.': './src/index.ts' } }),
      'packages/transport-node/src/index.ts': "export * from './ssh'",
      'packages/transport-node/src/ssh.ts': 'export const connect = () => {}',
      'packages/transport-node/tests/ssh.test.ts': "import { connect } from '../src/ssh'",
      'packages/runtime/package.json': json({
        name: '@althar/runtime',
        exports: { '.': './src/index.ts' },
        dependencies: { '@althar/transport-node': 'workspace:*' },
      }),
      'packages/runtime/src/Runtime.ts': "import { connect } from '@althar/transport-node'",
    }
    const at = { files: Object.keys(files), read: (path: string) => files[path as keyof typeof files] ?? '' }
    const changed = ['packages/transport-node/src/ssh.ts']
    for (const workflow of ['harness', 'windows'] as const) {
      const selected = plan(changed, at, workflow).jobs.flatMap((job) => job.parts)
      expect(selected.find((part) => part.dir === 'packages/transport-node')).toMatchObject({ check: workflow === 'harness', tests: 'all' })
      expect(selected.some((part) => part.dir === 'packages/runtime')).toBe(true)
    }
    expect(plan(changed, at, 'desktop')).toMatchObject({ e2e: true, windowsE2e: true })
  })
  it('keeps checks and other packages when full runtime coverage replaces the selected tests', () => {
    const selected = plan(['packages/runtime/src/git.ts'], REPO, 'harness').jobs
    const jobs = covered(selected, ['packages/runtime'])
    expect(jobs.filter((job) => job.name === 'packages/runtime checks')).toHaveLength(1)
    expect(jobs.flatMap((job) => job.parts).filter((part) => part.dir === 'packages/runtime')).toEqual([
      { dir: 'packages/runtime', check: true, tests: [] },
    ])
    expect(jobs.flatMap((job) => job.parts).filter((part) => part.dir !== 'packages/runtime')).toEqual(
      selected.flatMap((job) => job.parts).filter((part) => part.dir !== 'packages/runtime'),
    )
    // A test-only dependency can reach runtime tests without requiring a runtime check.
    expect(
      covered([{ name: 'runtime', parts: [{ dir: 'packages/runtime', check: false, tests: ['tests/x.test.ts'] }] }], ['packages/runtime']),
    ).toEqual([])
  })

  it('gates the coverage of each package the change reaches that has a gate of its own, and leaves its tests to it', () => {
    const files = {
      ...FILES,
      'packages/domain/package.json': json({
        name: '@althar/domain',
        exports: { '.': './src/index.ts' },
        scripts: { test: 'vp test run', 'test:coverage': 'vp test run --coverage' },
      }),
      'packages/runtime/package.json': json({
        name: '@althar/runtime',
        exports: { '.': './src/index.ts' },
        scripts: { 'test:coverage': 'vp test run --coverage' },
        dependencies: { '@althar/domain': 'workspace:*', '@althar/provider-adapters': 'workspace:*' },
      }),
    }
    const at = { files: Object.keys(files), read: (path: string) => files[path as keyof typeof files] ?? '' }
    const selected = plan(['packages/domain/src/ids.ts'], at, 'harness').jobs
    // The domain has a gate; provider-adapters, which it reaches, has none; the runtime's runs in parts of its own.
    expect(gated(selected, at)).toEqual(['packages/domain'])
    const jobs = covered(selected, gated(selected, at))
    expect(jobs.flatMap((job) => job.parts).find((part) => part.dir === 'packages/domain')).toEqual({
      dir: 'packages/domain',
      check: true,
      tests: [],
    })
    expect(gated(plan(['README.md'], at, 'harness').jobs, at)).toEqual([])
    expect(gated(plan(['packages/runtime/src/words.ts'], at, 'harness').jobs, at)).toEqual([])
  })
  it('runs a UI copy change in the tests that reach it and the app’s end-to-end run, but not Windows’ smoke test', () => {
    const changed = ['packages/ui/src/chrome/TaskHeader/TaskHeader.tsx']
    expect(runs(plan(changed, REPO, 'ui').jobs)).toEqual({
      'packages/ui': ['packages/ui checked: tests/TaskHeader.test.tsx tests/stories.chrome.test.tsx'],
    })
    // The app builds on the UI kit, so its checks run too, and its tests that reach the header.
    expect(plan(changed, REPO, 'desktop')).toMatchObject({ e2e: true, windowsE2e: false })
    expect(runs(plan(changed, REPO, 'desktop').jobs)).toEqual({ 'apps/desktop': ['apps/desktop checked: tests/home.test.tsx'] })
  })

  it('runs a runtime change in the tests that reach it, split as they take, and both end-to-end runs', () => {
    const changed = ['packages/runtime/src/git.ts']
    const harness = plan(changed, REPO, 'harness')
    expect(harness.jobs.map((job) => job.name)).toEqual(RUNTIME_PARTS)
    // The checks don't change by part: the first runs them.
    expect(harness.jobs.map(({ parts: [part] }) => [part?.check, part?.shard])).toEqual([
      [true, '1/4'],
      [false, '2/4'],
      [false, '3/4'],
      [false, '4/4'],
    ])
    expect(harness.jobs[0]?.parts[0]?.tests).toHaveLength(160)
    const desktop = plan(changed, REPO, 'desktop')
    expect(runs(desktop.jobs)).toEqual({ 'apps/desktop': ['apps/desktop checked: tests/runtime.test.ts'] })
    expect([desktop.e2e, desktop.windowsE2e]).toEqual([true, true])
  })

  it('runs a few affected runtime tests in one job, not four', () => {
    expect(runs(plan(['packages/runtime/src/words.ts'], REPO, 'harness').jobs)).toEqual({
      'packages/runtime': ['packages/runtime checked: tests/words0.test.ts tests/words1.test.ts tests/words2.test.ts'],
    })
  })

  it('runs a change to the main process in its tests, and the smoke test on Windows', () => {
    const desktop = plan(['apps/desktop/src/main/keyring.ts'], REPO, 'desktop')
    expect(runs(desktop.jobs)).toEqual({ 'apps/desktop': ['apps/desktop checked: tests/keyring.test.ts'] })
    expect([desktop.e2e, desktop.windowsE2e]).toEqual([true, true])
  })

  it('runs a renderer change without Windows’ smoke test', () => {
    const desktop = plan(['apps/desktop/src/renderer/features/plan.ts'], REPO, 'desktop')
    expect(runs(desktop.jobs)).toEqual({ 'apps/desktop': ['apps/desktop checked: tests/plan.test.ts'] })
    expect([desktop.e2e, desktop.windowsE2e]).toEqual([true, false])
  })

  it('runs the affected Windows unit tests, on drafts too, with runtime sharding and no duplicate type checks', () => {
    const windows = plan(['packages/runtime/src/git.ts'], REPO, 'windows', { draft: true })
    expect(windows.jobs.filter((job) => job.name.startsWith('packages/runtime')).map((job) => job.name)).toEqual(RUNTIME_PARTS)
    expect(windows.jobs.every((job) => job.parts.every((part) => !part.check))).toBe(true)
    expect(runs(windows.jobs).desktop).toEqual(['apps/desktop: tests/runtime.test.ts'])
    expect([windows.e2e, windows.windowsE2e]).toEqual([false, false])
    expect(runs(plan(['packages/runtime/tests/words1.test.ts'], REPO, 'windows').jobs)).toEqual({
      'packages/runtime': ['packages/runtime: tests/words1.test.ts'],
    })
  })

  it('splits the runtime’s tests into up to six parts on Windows, and four on Linux', () => {
    const files: Record<string, string> = {
      ...FILES,
      ...Object.fromEntries(
        Array.from({ length: 300 }, (_, index) => [`packages/runtime/tests/more${index}.test.ts`, "import { start } from './support'"]),
      ),
    }
    const at = { files: Object.keys(files), read: (path: string) => files[path] ?? '' }
    const parts = (workflow: 'harness' | 'windows') =>
      plan(['packages/runtime/src/git.ts'], at, workflow).jobs.filter((job) => job.name.startsWith('packages/runtime')).length
    expect(parts('harness')).toBe(4)
    expect(parts('windows')).toBe(6)
  })

  it('runs Windows for main-process changes and shared tooling, leaving renderer-only work and docs out', () => {
    expect(runs(plan(['apps/desktop/src/main/keyring.ts'], REPO, 'windows').jobs)).toEqual({
      desktop: ['apps/desktop: tests/keyring.test.ts'],
    })
    for (const changed of [
      ['apps/desktop/src/renderer/features/plan.ts'],
      ['packages/ui/src/chrome/TaskHeader/TaskHeader.tsx'],
      ['README.md'],
    ])
      expect(plan(changed, REPO, 'windows').jobs).toEqual([])
    for (const changed of [['bun.lock'], ['.github/workflows/windows.yml'], ['packages/testing/src/files.ts'], ['*']])
      expect(plan(changed, REPO, 'windows').jobs.length).toBeGreaterThan(0)
  })

  it('runs nothing for docs, a README or release notes no test reads', () => {
    const changed = ['docs/plans/tests-that-hold.md', 'README.md', 'packages/ui/README.md', 'apps/desktop/release-notes/0.6.0.md']
    for (const workflow of ['harness', 'desktop', 'ui'] as const)
      expect(plan(changed, REPO, workflow)).toMatchObject({ jobs: [], e2e: false, windowsE2e: false })
  })

  it('runs everything when the lockfile, @althar/testing or a workflow changes, or what changed is unknown', () => {
    for (const changed of [['bun.lock'], ['*'], ['packages/testing/src/index.ts'], ['.github/workflows/desktop.yml']]) {
      expect(plan(changed, REPO, 'desktop')).toMatchObject({ e2e: true, windowsE2e: true })
      expect(runs(plan(changed, REPO, 'desktop').jobs)).toEqual({ 'apps/desktop': ['apps/desktop checked: all'] })
      expect(runs(plan(changed, REPO, 'harness').jobs)).toEqual({
        packages: ['packages/domain checked: all', 'packages/provider-adapters checked: all', 'packages/testing checked: '],
        ...Object.fromEntries(RUNTIME_PARTS.map((name, index) => [name, [`packages/runtime${index === 0 ? ' checked' : ''}: all`]])),
      })
    }
  })

  it('runs a test helper’s change in the tests that use it, with no end-to-end run', () => {
    const changed = ['packages/runtime/tests/support.ts']
    expect(plan(changed, REPO, 'harness').jobs.map((job) => job.name)).toEqual(RUNTIME_PARTS)
    expect(plan(changed, REPO, 'harness').jobs[0]?.parts[0]?.tests).toHaveLength(160)
    // The app doesn't use the tests' support, and the packages that build on the runtime don't see it.
    expect(plan(changed, REPO, 'desktop')).toEqual({ why: [], jobs: [], e2e: false, windowsE2e: false })
  })

  it('runs one changed test alone', () => {
    expect(runs(plan(['packages/runtime/tests/words1.test.ts'], REPO, 'harness').jobs)).toEqual({
      'packages/runtime': ['packages/runtime checked: tests/words1.test.ts'],
    })
  })

  it('takes a file nothing reaches for its whole package', () => {
    const harness = plan(['packages/runtime/src/unused.ts'], REPO, 'harness')
    expect(harness.why).toEqual(['packages/runtime/src/unused.ts reaches no test and not the app: it stands for all of packages/runtime.'])
    expect(harness.jobs[0]?.parts[0]?.tests).toBe('all')
    // Every test that reaches the runtime runs too.
    expect(runs(plan(['packages/runtime/src/unused.ts'], REPO, 'desktop').jobs)).toEqual({
      'apps/desktop': ['apps/desktop checked: tests/runtime.test.ts'],
    })
  })

  it('takes a package’s config or test setup for every test of it, and every test that reaches it', () => {
    for (const changed of [['packages/ui/vite.config.ts'], ['packages/ui/tests/setup.ts']])
      expect(runs(plan(changed, REPO, 'ui').jobs)).toEqual({ 'packages/ui': ['packages/ui checked: all'] })
    expect(runs(plan(['packages/ui/vite.config.ts'], REPO, 'desktop').jobs)).toEqual({
      'apps/desktop': ['apps/desktop checked: tests/home.test.tsx'],
    })
    // Its tests' setup is its own: what builds on it sees nothing new to check.
    expect(runs(plan(['packages/ui/tests/setup.ts'], REPO, 'desktop').jobs)).toEqual({
      'apps/desktop': ['apps/desktop: tests/home.test.tsx'],
    })
  })

  it('follows the fake agent, which tests start by its path, to the tests that start it', () => {
    expect(plan(['packages/provider-adapters/src/testing/fakeAgentMain.ts'], REPO, 'harness').jobs.map((job) => job.name)).toEqual([
      'packages',
      ...RUNTIME_PARTS,
    ])
  })

  it('runs no end-to-end run on a draft, and all that the change reaches once it is ready', () => {
    const changed = ['packages/runtime/src/git.ts']
    const draft = plan(changed, REPO, 'desktop', { draft: true })
    expect(draft).toMatchObject({ e2e: false, windowsE2e: false, why: ['A draft: the end-to-end runs wait until it is ready for review.'] })
    // The checks and the unit tests run on a draft as on any pull request.
    expect(draft.jobs).toEqual(plan(changed, REPO, 'desktop').jobs)
    expect(plan(changed, REPO, 'desktop', { draft: false })).toMatchObject({ e2e: true, windowsE2e: true })
  })

  it('stresses the tests nearest a change by their imports, nearest first, as many as asked', () => {
    const known = graph(REPO)
    expect(nearest(known, ['packages/domain/src/ids.ts'], 1)).toEqual(['packages/domain/tests/ids.test.ts'])
    // Then the runtime's, through what imports the domain, in the order of their paths.
    expect(nearest(known, ['packages/domain/src/ids.ts'], 2)).toEqual([
      'packages/domain/tests/ids.test.ts',
      'packages/runtime/tests/run0.test.ts',
    ])
    // The runtime's words reach three tests directly; the others only through its support, further off.
    expect(nearest(known, ['packages/runtime/src/words.ts'], 8)).toEqual([
      'packages/runtime/tests/words0.test.ts',
      'packages/runtime/tests/words1.test.ts',
      'packages/runtime/tests/words2.test.ts',
    ])
    expect(nearest(known, ['packages/runtime/src/git.ts'], 3)).toHaveLength(3)
    expect(nearest(known, ['README.md'], 8)).toEqual([])
  })

  it('leaves a change to specs alone to stress.yml, but runs everything for their support, and Windows’ smoke test for its own', () => {
    expect(plan(['apps/desktop/e2e/home.spec.ts'], REPO, 'desktop')).toMatchObject({ e2e: false, windowsE2e: false })
    expect(plan(['apps/desktop/e2e/support.ts'], REPO, 'desktop')).toMatchObject({ e2e: true, windowsE2e: true })
    expect(plan(['apps/desktop/e2e/smoke.spec.ts'], REPO, 'desktop')).toMatchObject({ e2e: false, windowsE2e: true })
  })
})

describe('what a file names', () => {
  it('reads imports and re-exports, mocks, CSS, globs and paths from where it is, but not imports of types alone', () => {
    const named = names(
      'packages/ui/tests/x.test.tsx',
      [
        "import type { Story } from '../src/storybook/types'",
        "import { type Id, Button } from '../src/primitives/Button/Button'",
        "export * from './more'",
        "vi.mock('../src/clock', () => ({}))",
        "const raw = import.meta.glob('../src/**/*.tsx', { query: '?raw' })",
        "const tokens = readFileSync(join(import.meta.dirname, '../src/styles', 'tokens.css'))",
        'const page = resolve(import.meta.dirname, `../public${image}`)',
        "const fake = new URL('./fake.ts', import.meta.url)",
        'const require = createRequire(import.meta.url)',
      ].join('\n'),
    )
    expect(named.specifiers).toEqual(['../src/primitives/Button/Button', './more', '../src/clock'])
    expect(named.prefixes).toEqual([
      'packages/ui/tests/fake.ts',
      'packages/ui/src/',
      'packages/ui/src/styles/tokens.css',
      'packages/ui/public',
    ])
    expect(named.anywhere).toBe(false)
  })

  it('reads anything in its package when it builds a path from where it is some other way', () => {
    expect(names('apps/desktop/src/main/main.ts', 'const here = import.meta.dirname').anywhere).toBe(true)
    expect(names('apps/desktop/scripts/load.ts', 'await import(pathToFileURL(file).href)').anywhere).toBe(true)
  })
})

describe('this repository', () => {
  const repo = repository(join(import.meta.dirname, '../../..'))
  const known = graph(repo)

  it('runs the guard of the specs’ imports with the app’s tests when a change reaches a spec, as nearly any but docs does', () => {
    const guard = (changed: ReadonlyArray<string>) =>
      plan(changed, repo, 'desktop')
        .jobs.flatMap((job) => job.parts)
        .find((part) => part.dir === 'packages/testing')
    expect(guard(['apps/desktop/e2e/smoke.spec.ts'])).toEqual({
      dir: 'packages/testing',
      check: false,
      tests: ['tests/e2eImports.test.ts'],
    })
    // The kit's device helpers, which the specs' support imports.
    expect(guard(['packages/ui/src/foundations/device.ts'])?.tests).toEqual(['tests/e2eImports.test.ts'])
    // What the app's support reads by its path, the app's own files, may be what a spec imports.
    expect(guard(['apps/desktop/src/renderer/features/settings/sections.ts'])?.tests).toEqual(['tests/e2eImports.test.ts'])
    expect(guard(['README.md'])).toBeUndefined()
  })

  it('runs that guard in the merge queue when both an entry and what landed beneath it reach a spec', () => {
    const guard = (changes: ReadonlyArray<string>, since: ReadonlyArray<string>) =>
      queuePlan([{ pr: 1, changes, since }], repo, 'desktop')
        .jobs.flatMap((job) => job.parts)
        .find((part) => part.dir === 'packages/testing')
    expect(guard(['apps/desktop/e2e/smoke.spec.ts'], ['packages/ui/src/foundations/device.ts'])?.tests).toEqual([
      'tests/e2eImports.test.ts',
    ])
    // A spec that one of them reaches ran with the guard on its own pull request.
    expect(guard(['apps/desktop/e2e/smoke.spec.ts'], ['README.md'])).toBeUndefined()
  })
  /**
   * Illustrative code isn't part of the import graph: samples a story shows, a file a spec
   * writes into a test repository, prototypes, the small repositories of this file and the stress plan's, and the
   * modules the runtime's structure test gives its lint rules to read.
   */
  const sample = (one: string) =>
    /^(?:packages\/ui\/src\/fixtures\/|packages\/ui\/prototypes\/|apps\/desktop\/e2e\/outputs\.spec\.ts:|packages\/testing\/tests\/(?:select|stress)\.test\.ts:|packages\/runtime\/tests\/structure\.test\.ts:)/.test(
      one,
    )

  it('has every relative import lead to a file', () => {
    expect(known.unresolved.filter((one) => !sample(one))).toEqual([])
  })

  it('has every other import name a workspace package, a dependency or Node’s own', () => {
    // An import this doesn't know (an alias, say) would go unseen, and the tests that rest on it with it.
    expect(
      known.bare.filter((one) => !sample(one) && !known.dependencies.has(one.split(': ')[1] ?? '') && !isBuiltin(one.split(': ')[1] ?? '')),
    ).toEqual([])
  })
})
