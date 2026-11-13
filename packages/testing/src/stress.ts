/*
 * What .github/workflows/stress.yml runs: new and changed tests, many times over with no retry. On a pull request,
 * three times each and a changed spec twice: a few minutes, about as long as its other checks, and enough to catch a
 * test that fails one run in three, which is the kind that fails everyone's pull requests and the merge queue. At night
 * (nightly.yml), the tests main changed that day as Chromium runs a new test before it can land, twenty times for a few,
 * fewer for many, and a spec up to five times: what fails one run in ten, found within a day, not one run in ten on
 * main. A slow file runs only as many times as fit in its share of the time (three at least).
 *
 * `bun stress.ts plan <changed> [nightly]` writes the plan for the file of changed paths to GITHUB_OUTPUT;
 * `bun stress.ts run` runs the part of it in PLAN.
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'

/** A package's changed test files, from its own folder. */
export interface Part {
  readonly dir: string
  readonly files: ReadonlyArray<string>
}

export interface Plan {
  /** Every changed test, on Linux, how many times each runs, and the seconds all of them have, shared out. */
  readonly linux: { readonly parts: ReadonlyArray<Part>; readonly runs: number; readonly seconds: number }
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

/** A pull request's stress run, or the night's (nightly.yml) of what main changed that day. */
export type When = 'pull request' | 'nightly'

export const plan = (changed: ReadonlyArray<string>, when: When = 'pull request'): Plan => {
  const nightly = when === 'nightly'
  const tests = changed.flatMap((path) => {
    const [, dir, file] = TEST.exec(path) ?? []
    return dir !== undefined && file !== undefined && !REAL.test(path) ? [[dir, file] as const] : []
  })
  const windows = tests.filter(([dir]) => ON_WINDOWS.has(dir))
  const specs = changed.flatMap((path) => SPEC.exec(path)?.slice(1, 2) ?? [])
  const specRuns = nightly ? share(specs.length, 20, 2, 5) : share(specs.length, 2, 2, 2)
  // About ten spec runs a machine, each building the app first: four machines at most.
  const shards = Math.min(4, Math.ceil((specs.length * specRuns) / 10))
  return {
    linux: nightly
      ? { parts: byPackage(tests), runs: share(tests.length, 200, 3, 20), seconds: 40 * 60 }
      : { parts: byPackage(tests), runs: share(tests.length, 3, 3, 3), seconds: 15 * 60 },
    windows: { parts: byPackage(windows), runs: share(windows.length, 100, 2, 10) },
    specs: { files: specs, runs: specRuns, shards: Array.from({ length: shards }, (_, index) => `${index + 1}/${shards}`) },
  }
}

/** The fewest runs a changed test has, however slow. */
const LEAST_RUNS = 3

/**
 * How many more runs a package's tests get after a first that took `seconds`: what fits in its share of the budget,
 * but no more than planned and no fewer than LEAST_RUNS in all. The first run's time includes starting Vitest, so the
 * estimate errs short.
 */
export const moreRuns = (planned: number, seconds: number, share: number): number =>
  Math.max(LEAST_RUNS - 1, Math.min(planned - 1, Math.floor(share / Math.max(seconds, 1)) - 1))

/**
 * Runs each package's changed tests once, timed, and then again as many times as planned or as fit in its share of
 * the plan's seconds, in an order shuffled by the run's number, with no retry: one failure in any run fails it. Every
 * package runs even when one before it fails, so a run says all that broke, and the seed it prints runs the same
 * order again (`--sequence.seed`).
 */
const run = ({ parts, runs, seconds }: Plan['linux']) => {
  const seed = process.env.GITHUB_RUN_ID ?? '1'
  const share = seconds / Math.max(parts.length, 1)
  process.stdout.write(`Each test runs up to ${runs} times, shuffled with seed ${seed}.\n`)
  const vitest = (dir: string, files: ReadonlyArray<string>, repeats: number) =>
    spawnSync(
      'bun',
      ['run', 'test', `--repeats=${repeats}`, '--retry=0', '--sequence.shuffle', `--sequence.seed=${seed}`, '--passWithNoTests', ...files],
      { cwd: dir, stdio: 'inherit' },
    ).status
  const failed = parts.filter(({ dir, files }) => {
    process.stdout.write(`::group::${dir}: ${files.join(' ')}\n`)
    const started = performance.now()
    let status = vitest(dir, files, 0)
    if (status === 0) {
      const more = moreRuns(runs, (performance.now() - started) / 1000, share)
      process.stdout.write(`${dir}: ${more + 1} runs in all.\n`)
      status = vitest(dir, files, more - 1)
    }
    process.stdout.write('::endgroup::\n')
    return status !== 0
  })
  if (failed.length > 0) {
    process.stdout.write(
      `::error::A changed test failed in one of its runs, in ${failed.map(({ dir }) => dir).join(', ')}. It fails sometimes: find why before it lands.\n`,
    )
    process.exit(1)
  }
}

const [mode, list, when] = process.argv.slice(2)
const output = process.env.GITHUB_OUTPUT
if (mode === 'plan' && list !== undefined && output !== undefined) {
  const planned = plan(
    readFileSync(list, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== ''),
    when === 'nightly' ? 'nightly' : 'pull request',
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
