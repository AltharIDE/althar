/*
 * What .github/workflows/stress.yml runs: a pull request's new and changed tests, many times over with no retry, so a
 * test that passes nine runs in ten fails on the pull request that brought it, not one run in ten on main. Chromium
 * runs a new test twenty times before it can land; this does the same, but a pull request that changes many tests runs
 * each fewer times, so the whole takes about as long as the other checks.
 *
 * `bun stress.ts plan <changed>` writes the plan for the file of changed paths to GITHUB_OUTPUT; `bun stress.ts run`
 * runs the part of it in PLAN.
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'

/** A package's changed test files, from its own folder. */
export interface Part {
  readonly dir: string
  readonly files: ReadonlyArray<string>
}

export interface Plan {
  /** Every changed test, on Linux, and how many times each runs. */
  readonly linux: { readonly parts: ReadonlyArray<Part>; readonly runs: number }
  /** Those of packages that also run on Windows (desktop.yml), where tests run three or four times slower: fewer runs. */
  readonly windows: { readonly parts: ReadonlyArray<Part>; readonly runs: number }
  /** The changed end-to-end specs, from apps/desktop, how many times each runs, and on how many machines. */
  readonly specs: { readonly files: ReadonlyArray<string>; readonly runs: number; readonly shards: ReadonlyArray<string> }
}

/** The packages desktop.yml tests on Windows. */
const ON_WINDOWS = new Set([
  'apps/desktop',
  'packages/connectors',
  'packages/contracts',
  'packages/domain',
  'packages/persistence-sqlite',
  'packages/provider-adapters',
  'packages/runtime',
  'packages/ui',
])

const TEST = /^((?:packages|apps)\/[^/]+)\/((?:tests|src)\/.+\.test\.tsx?)$/
/* Tests that drive real agents or real accounts, which CI doesn't have. */
const REAL = /\/tests\/(agents|real)\//
const SPEC = /^apps\/desktop\/(e2e\/(?!real)[^/]+\.spec\.ts)$/

/** How many times each of `count` files runs: `budget` runs in all, shared out, but never fewer than `least` or more than `most`. */
const share = (count: number, budget: number, least: number, most: number) =>
  count === 0 ? 0 : Math.max(least, Math.min(most, Math.floor(budget / count)))

const byPackage = (files: ReadonlyArray<readonly [string, string]>): ReadonlyArray<Part> => {
  const parts = new Map<string, Array<string>>()
  for (const [dir, file] of files) parts.set(dir, [...(parts.get(dir) ?? []), file])
  return [...parts].map(([dir, files]) => ({ dir, files }))
}

export const plan = (changed: ReadonlyArray<string>): Plan => {
  const tests = changed.flatMap((path) => {
    const [, dir, file] = TEST.exec(path) ?? []
    return dir !== undefined && file !== undefined && !REAL.test(path) ? [[dir, file] as const] : []
  })
  const windows = tests.filter(([dir]) => ON_WINDOWS.has(dir))
  const specs = changed.flatMap((path) => SPEC.exec(path)?.slice(1, 2) ?? [])
  const specRuns = share(specs.length, 20, 2, 5)
  // About ten spec runs a machine, each building the app first: four machines at most.
  const shards = Math.min(4, Math.ceil((specs.length * specRuns) / 10))
  return {
    linux: { parts: byPackage(tests), runs: share(tests.length, 200, 3, 20) },
    windows: { parts: byPackage(windows), runs: share(windows.length, 100, 2, 10) },
    specs: { files: specs, runs: specRuns, shards: Array.from({ length: shards }, (_, index) => `${index + 1}/${shards}`) },
  }
}

/**
 * Runs each package's changed tests as many times as planned, in an order shuffled by the run's number, with no retry:
 * one failure in any run fails it. Every package runs even when one before it fails, so a run says all that broke, and
 * the seed it prints runs the same order again (`--sequence.seed`).
 */
const run = ({ parts, runs }: Plan['linux']) => {
  const seed = process.env.GITHUB_RUN_ID ?? '1'
  process.stdout.write(`Each test runs ${runs} times, shuffled with seed ${seed}.\n`)
  const failed = parts.filter(({ dir, files }) => {
    process.stdout.write(`::group::${dir}: ${files.join(' ')}\n`)
    const args = [
      'run',
      'test',
      `--repeats=${runs - 1}`,
      '--retry=0',
      '--sequence.shuffle',
      `--sequence.seed=${seed}`,
      '--passWithNoTests',
      ...files,
    ]
    const { status } = spawnSync('bun', args, { cwd: dir, stdio: 'inherit' })
    process.stdout.write('::endgroup::\n')
    return status !== 0
  })
  if (failed.length > 0) {
    process.stdout.write(
      `::error::A changed test failed in one of its ${runs} runs, in ${failed.map(({ dir }) => dir).join(', ')}. It fails sometimes: find why before it lands.\n`,
    )
    process.exit(1)
  }
}

const [mode, list] = process.argv.slice(2)
const output = process.env.GITHUB_OUTPUT
if (mode === 'plan' && list !== undefined && output !== undefined) {
  const planned = plan(
    readFileSync(list, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== ''),
  )
  appendFileSync(
    output,
    [
      `linux=${JSON.stringify(planned.linux)}`,
      `windows=${JSON.stringify(planned.windows)}`,
      `specs=${JSON.stringify(planned.specs)}`,
      `any-linux=${planned.linux.parts.length > 0}`,
      `any-windows=${planned.windows.parts.length > 0}`,
      `any-specs=${planned.specs.files.length > 0}`,
      '',
    ].join('\n'),
  )
  process.stdout.write(`${JSON.stringify(planned, undefined, 2)}\n`)
}
if (mode === 'run' && process.env.PLAN !== undefined) run(JSON.parse(process.env.PLAN) as Plan['linux'])
