import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { FullConfig, Suite, TestCase } from '@playwright/test/reporter'
import { describe, expect, test, vi } from 'vite-plus/test'
import { startVitest } from 'vite-plus/test/node'

import { type Flaky, fromRoot, titleOf } from '../src/flaky'
import PlaywrightReporter from '../src/playwright'
import { CAP, held, issueOf, judge, parse, type Quarantine, summary } from '../src/quarantine'
import FlakyReporter from '../src/reporter'

const fixture = (name: string) => fromRoot(join(import.meta.dirname, 'fixtures', name))

/** A quarantine of the tests named, each under an issue numbered from 7. */
const quarantining = (...tests: ReadonlyArray<{ file: string; name: string }>): Quarantine => ({
  issues: tests.map((test, index) => ({ number: 7 + index, title: titleOf(test) })),
})

const FAILS = { file: fixture('fails.fixture.ts'), name: 'a block > fails every time' }
const BROKEN = { file: fixture('broken.fixture.ts'), name: 'fails too' }

/**
 * Runs fixtures as CI runs tests, with a retry, through the reporter given this quarantine: what it recorded for
 * report.ts, the warnings it gave, and the exit code it left. Its warnings stay here: on a CI run they would read as
 * ours.
 */
const run = async (files: ReadonlyArray<string>, quarantine: Quarantine | undefined, more: Record<string, unknown> = {}) => {
  const report = join(mkdtempSync(join(tmpdir(), 'quarantine-')), 'flaky.jsonl')
  const was = { report: process.env.FLAKY_REPORT, exitCode: process.exitCode }
  process.env.FLAKY_REPORT = report
  process.exitCode = undefined
  const out: Array<string> = []
  const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk))
    return true
  })
  let exitCode: typeof process.exitCode
  try {
    const vitest = await startVitest(
      'test',
      files.map((file) => `tests/fixtures/${file}`),
      { include: ['tests/fixtures/*.fixture.ts'], retry: 1, watch: false, reporters: [new FlakyReporter({ quarantine })], ...more },
    )
    await vitest.close()
    exitCode = process.exitCode
  } finally {
    write.mockRestore()
    process.exitCode = was.exitCode
    if (was.report === undefined) delete process.env.FLAKY_REPORT
    else process.env.FLAKY_REPORT = was.report
  }
  const recorded = existsSync(report)
    ? readFileSync(report, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Flaky)
    : []
  return { exitCode: Number(exitCode ?? 0), recorded, warned: out.filter((line) => line.startsWith('::warning')) }
}

describe('a Vitest run in quarantine', () => {
  test('passes when only quarantined tests failed, and records each on its issue with what it failed with', async () => {
    const { exitCode, recorded, warned } = await run(['fails.fixture.ts'], quarantining(FAILS))
    expect(exitCode).toBe(0)
    expect(recorded).toEqual([
      {
        runner: 'vitest',
        ...FAILS,
        quarantined: 7,
        error: expect.stringMatching(/^expected 1 to be 2 \/\/ Object\.is equality\n\s+at .*fails\.fixture\.ts:6:15$/),
      },
    ])
    expect(warned).toEqual([expect.stringContaining('title=Quarantined test::a block > fails every time failed, and doesn')])
  })

  test('reads the quarantine its job kept in QUARANTINE when a config names it, as CI does', async () => {
    const kept = join(mkdtempSync(join(tmpdir(), 'quarantine-')), 'quarantine.json')
    writeFileSync(kept, JSON.stringify(quarantining(FAILS)))
    const was = process.env.QUARANTINE
    process.env.QUARANTINE = kept
    try {
      // Named, Vitest makes the reporter itself, with options of `{}`.
      const { exitCode, recorded } = await run(['fails.fixture.ts'], undefined, {
        reporters: [join(import.meta.dirname, '../src/reporter.ts')],
      })
      expect(exitCode).toBe(0)
      expect(recorded.map((test) => test.quarantined)).toEqual([7])
    } finally {
      if (was === undefined) delete process.env.QUARANTINE
      else process.env.QUARANTINE = was
    }
  })

  test('fails when a test that is not quarantined failed too, and still records the quarantined one', async () => {
    const { exitCode, recorded } = await run(['fails.fixture.ts', 'broken.fixture.ts'], quarantining(FAILS))
    expect(exitCode).toBe(1)
    expect(recorded.map((test) => [test.name, test.quarantined])).toEqual([['a block > fails every time', 7]])
  })

  test('fails once its issue is closed: the test gates again', async () => {
    expect((await run(['fails.fixture.ts'], quarantining(BROKEN))).exitCode).toBe(1)
    expect((await run(['fails.fixture.ts'], { issues: [] })).exitCode).toBe(1)
  })

  test("gates every test when the issues couldn't be read, and where nothing is quarantined", async () => {
    expect((await run(['fails.fixture.ts'], { unread: 'gh: HTTP 502' })).exitCode).toBe(1)
    const outside = await run(['fails.fixture.ts'], undefined)
    expect(outside).toEqual({ exitCode: 1, recorded: [], warned: [] })
  })

  test('fails for an error outside its tests, in a hook, though the test is quarantined', async () => {
    const { exitCode } = await run(['hook.fixture.ts'], quarantining({ file: fixture('hook.fixture.ts'), name: 'after a broken hook' }))
    expect(exitCode).toBe(1)
  })

  test('still checks coverage when quarantine lets the run pass, and fails when it would go unchecked', async () => {
    const coverage = {
      enabled: true,
      provider: 'custom',
      customProviderModule: join(import.meta.dirname, 'fixtures/coverage.ts'),
      reportOnFailure: true,
    }
    expect((await run(['fails.fixture.ts'], quarantining(FAILS), { coverage })).exitCode).toBe(0)
    expect((await run(['fails.fixture.ts'], quarantining(FAILS), { coverage: { ...coverage, thresholds: { lines: 90 } } })).exitCode).toBe(
      1,
    )
    const unchecked = await run(['fails.fixture.ts'], quarantining(FAILS), { coverage: { ...coverage, reportOnFailure: false } })
    expect(unchecked.exitCode).toBe(1)
    expect(unchecked.warned).toContainEqual(expect.stringContaining('coverage goes unchecked'))
  })

  test('passes the merge of parts that quarantine let pass, without recording their tests again', async () => {
    const blobs = mkdtempSync(join(tmpdir(), 'quarantine-blobs-'))
    const part = await run(['fails.fixture.ts'], quarantining(FAILS), {
      reporters: ['blob', new FlakyReporter({ quarantine: quarantining(FAILS) })],
      outputFile: { blob: join(blobs, 'part-1.json') },
    })
    expect(part.exitCode).toBe(0)
    expect(part.recorded).toHaveLength(1)
    const merged = await run([], quarantining(FAILS), { mergeReports: blobs })
    expect(merged).toEqual({ exitCode: 0, recorded: [], warned: [] })
    expect((await run([], quarantining(BROKEN), { mergeReports: blobs })).exitCode).toBe(1)
  })
})

/** A Playwright test as its reporter sees it at the end: titled under its file, with what each try did. */
const spec = (title: string, outcome: ReturnType<TestCase['outcome']>, ...errors: ReadonlyArray<string>) =>
  ({
    ok: () => outcome !== 'unexpected',
    outcome: () => outcome,
    titlePath: () => ['', '', 'graph.spec.ts', title],
    location: { file: join(import.meta.dirname, '../../../apps/desktop/e2e/graph.spec.ts'), line: 1, column: 1 },
    results: errors.length === 0 ? [{ status: 'passed' }] : errors.map((message) => ({ status: 'failed', error: { message } })),
  }) as unknown as TestCase

/** Ends a Playwright run of these tests through the reporter: the status it gave the run, if any, and what it recorded. */
const end = async (
  tests: ReadonlyArray<TestCase>,
  quarantine: Quarantine | undefined,
  { status = 'failed', errors = 0, named = false }: { status?: 'failed' | 'timedout'; errors?: number; named?: boolean } = {},
) => {
  const report = join(mkdtempSync(join(tmpdir(), 'quarantine-')), 'flaky.jsonl')
  const was = process.env.FLAKY_REPORT
  process.env.FLAKY_REPORT = report
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  try {
    // Named in a config, Playwright makes the reporter itself, with options of its own.
    const reporter = new PlaywrightReporter(named ? ({ configDir: '.' } as never) : { quarantine })
    reporter.onBegin({ maxFailures: 0 } as FullConfig, { allTests: () => tests } as unknown as Suite)
    for (let at = 0; at < errors; at += 1) reporter.onError()
    const given = await reporter.onEnd({ status, startTime: new Date(0), duration: 0 })
    const recorded = existsSync(report)
      ? readFileSync(report, 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line) as Flaky)
      : []
    return { given, recorded }
  } finally {
    write.mockRestore()
    if (was === undefined) delete process.env.FLAKY_REPORT
    else process.env.FLAKY_REPORT = was
  }
}

describe('a Playwright run in quarantine', () => {
  const graph = { file: fromRoot(join(import.meta.dirname, '../../../apps/desktop/e2e/graph.spec.ts')), name: 'a lane for each agent' }

  test('passes when only quarantined tests failed, and records each with its first error', async () => {
    const { given, recorded } = await end(
      [spec('a lane for each agent', 'unexpected', 'first', 'second'), spec('passes', 'expected'), spec('once', 'flaky', 'only once')],
      quarantining(graph),
    )
    expect(given).toEqual({ status: 'passed' })
    expect(recorded).toEqual([{ runner: 'playwright', ...graph, error: 'first', quarantined: 7 }])
  })

  test('leaves the run failed when another test failed, an error came from outside any test, or the run timed out', async () => {
    const tests = [spec('a lane for each agent', 'unexpected', 'first', 'second')]
    const failed = await end([...tests, spec('something else', 'unexpected', 'broken', 'broken')], quarantining(graph))
    expect(failed.given).toBeUndefined()
    expect(failed.recorded.map((test) => test.name)).toEqual(['a lane for each agent'])
    expect((await end(tests, quarantining(graph), { errors: 1 })).given).toBeUndefined()
    expect((await end(tests, quarantining(graph), { status: 'timedout' })).given).toBeUndefined()
    expect((await end(tests, { unread: 'gh: HTTP 502' })).given).toBeUndefined()
    expect((await end(tests, undefined)).given).toBeUndefined()
  })

  test('reads the quarantine its job kept in QUARANTINE when a config names it, as CI does', async () => {
    const kept = join(mkdtempSync(join(tmpdir(), 'quarantine-')), 'quarantine.json')
    writeFileSync(kept, JSON.stringify(quarantining(graph)))
    const was = process.env.QUARANTINE
    process.env.QUARANTINE = kept
    try {
      expect((await end([spec('a lane for each agent', 'unexpected', 'first', 'second')], undefined, { named: true })).given).toEqual({
        status: 'passed',
      })
    } finally {
      if (was === undefined) delete process.env.QUARANTINE
      else process.env.QUARANTINE = was
    }
  })
})

describe('which tests are quarantined', () => {
  const test1 = { file: 'packages/runtime/tests/models.test.ts', name: 'the models > record the process asking starts' }

  test('matches a test to its issue by the title report.ts gives it, exactly, and nothing else labelled flaky', () => {
    const quarantine: Quarantine = {
      issues: [
        { number: 431, title: 'models.test: the process agent is asked for its models twice on Windows' },
        { number: 434, title: titleOf(test1) },
      ],
    }
    expect(issueOf(quarantine, test1)).toBe(434)
    expect(issueOf(quarantine, { ...test1, name: 'the models > record the process asking' })).toBeUndefined()
    expect(issueOf(quarantine, { ...test1, name: `${test1.name}, twice` })).toBeUndefined()
    expect(issueOf(quarantine, { ...test1, file: 'packages/runtime/tests/other.test.ts' })).toBeUndefined()
    expect(issueOf({ unread: 'gh: HTTP 502' }, test1)).toBeUndefined()
    expect(issueOf(undefined, test1)).toBeUndefined()
    // A title is cut short as report.ts cuts it, so a test with a long name still finds its issue.
    const long = { ...test1, name: 'a'.repeat(300) }
    expect(titleOf(long)).toHaveLength(250)
    expect(issueOf(quarantining(long), long)).toBe(7)
  })

  test('lets a run pass only when every failed test is quarantined, at least one failed, and nothing else did', () => {
    const quarantine = quarantining(test1)
    const other = { ...test1, name: 'another' }
    expect(judge([test1], quarantine, false)).toEqual({ quarantined: [{ ...test1, quarantined: 7 }], gating: [], passes: true })
    expect(judge([test1, other], quarantine, false)).toEqual({
      quarantined: [{ ...test1, quarantined: 7 }],
      gating: [other],
      passes: false,
    })
    expect(judge([test1], quarantine, true).passes).toBe(false)
    expect(judge([], quarantine, false).passes).toBe(false)
    expect(judge([test1], { unread: 'gh: HTTP 502' }, false).passes).toBe(false)
    expect(judge([test1], undefined, false).passes).toBe(false)
  })

  test('reads the quarantine its job kept, and none where no job read it', () => {
    const folder = mkdtempSync(join(tmpdir(), 'quarantine-'))
    const kept = join(folder, 'quarantine.json')
    writeFileSync(kept, JSON.stringify({ issues: [{ number: 434, title: titleOf(test1), url: 'ignored' }] }))
    expect(held(kept)).toEqual({ issues: [{ number: 434, title: titleOf(test1) }] })
    // A job that read none has no QUARANTINE: in CI this one has, so it goes for the moment.
    const was = process.env.QUARANTINE
    delete process.env.QUARANTINE
    try {
      expect(held()).toBeUndefined()
    } finally {
      if (was !== undefined) process.env.QUARANTINE = was
    }
    expect(held('')).toBeUndefined()
    // A file that isn't there or isn't a quarantine quarantines nothing, and says why.
    expect(held(join(folder, 'missing.json'))).toEqual({ unread: expect.stringContaining('missing.json: ENOENT') })
    writeFileSync(kept, JSON.stringify({ issues: [{ number: '434', title: 'Flaky: x' }] }))
    expect(held(kept)).toEqual({ unread: expect.stringContaining('neither the open issues nor why') })
    expect(parse(JSON.stringify({ unread: 'gh: HTTP 502' }))).toEqual({ unread: 'gh: HTTP 502' })
  })

  test("sums up in the job's summary what quarantine let through, and warns loudly past the cap", () => {
    const repository = 'https://github.com/AltharIDE/althar'
    const failed: Flaky = { runner: 'vitest', ...test1, name: 'a | b', quarantined: 434 }
    const said = summary(quarantining(test1), [failed], repository)
    expect(said).toContain("These failed, and didn't fail the job")
    expect(said).toContain('1 test is quarantined in all')
    expect(said).toContain('| `packages/runtime/tests/models.test.ts` › a \\| b | [#434](https://github.com/AltharIDE/althar/issues/434) |')
    expect(said).not.toContain('CAUTION')
    const many = quarantining(...Array.from({ length: CAP + 1 }, (_, index) => ({ ...test1, name: `test ${index}` })))
    expect(summary(many, [], repository)).toContain(`**${CAP + 1} tests are quarantined**, more than ${CAP}`)
    expect(summary(quarantining(...Array.from({ length: CAP }, (_, index) => ({ ...test1, name: `test ${index}` }))), [], repository)).toBe(
      '',
    )
    expect(summary({ unread: 'gh: HTTP 502' }, [], repository)).toContain('every test gated in this job. gh: HTTP 502')
    expect(summary(undefined, [failed], repository)).toBe('')
  })
})
