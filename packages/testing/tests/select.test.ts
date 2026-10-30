import { isBuiltin } from 'node:module'
import { join } from 'node:path'

import { describe, expect, it } from 'vite-plus/test'

import { graph, names, plan, type Plan, type Repository, repository } from '../src/select'

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

describe('the selection', () => {
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

  it('runs no end-to-end run on a draft, and in the merge queue all that the change reaches', () => {
    const changed = ['packages/runtime/src/git.ts']
    const draft = plan(changed, REPO, 'desktop', { draft: true })
    expect(draft).toMatchObject({ e2e: false, windowsE2e: false, why: ['A draft: the end-to-end runs wait until it is ready for review.'] })
    // The checks and the unit tests run on a draft as on any pull request.
    expect(draft.jobs).toEqual(plan(changed, REPO, 'desktop').jobs)
    expect(plan(changed, REPO, 'desktop', { draft: false })).toMatchObject({ e2e: true, windowsE2e: true })
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
  const known = graph(repository(join(import.meta.dirname, '../../..')))
  /** Code in a string isn't an import: samples a story shows, a file a spec writes into a test repository, prototypes. */
  const sample = (one: string) =>
    /^(?:packages\/ui\/src\/fixtures\/|packages\/ui\/prototypes\/|apps\/desktop\/e2e\/outputs\.spec\.ts:)/.test(one)

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
