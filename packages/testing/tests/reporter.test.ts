import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, vi } from 'vite-plus/test'
import { startVitest } from 'vite-plus/test/node'

import { fromRoot, said } from '../src/flaky'
import FlakyReporter from '../src/reporter'

test('reports a test that failed, then passed on its retry, and no other', async () => {
  const report = join(mkdtempSync(join(tmpdir(), 'flaky-')), 'flaky.jsonl')
  const was = process.env.FLAKY_REPORT
  process.env.FLAKY_REPORT = report
  // What it says out loud stays here: on a CI run, the fixture's warning would read as a flaky test of ours.
  const out: Array<string> = []
  const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk))
    return true
  })
  try {
    const vitest = await startVitest('test', ['tests/fixtures/once.fixture.ts'], {
      include: ['tests/fixtures/*.fixture.ts'],
      retry: 1,
      watch: false,
      reporters: [new FlakyReporter()],
    })
    await vitest.close()
  } finally {
    write.mockRestore()
    if (was === undefined) delete process.env.FLAKY_REPORT
    else process.env.FLAKY_REPORT = was
  }
  const lines = readFileSync(report, 'utf8').trim().split('\n')
  expect(lines.map((line) => JSON.parse(line))).toEqual([
    // Named from the repository's root in CI, where GITHUB_WORKSPACE says where that is.
    {
      runner: 'vitest',
      file: fromRoot(join(import.meta.dirname, 'fixtures/once.fixture.ts')),
      name: 'passes the second time',
      // What it failed with first, and where, without Vitest's own frames.
      error: expect.stringMatching(/^expected 1 to be 2 \/\/ Object\.is equality\n\s+at .*once\.fixture\.ts:7:16$/),
    },
  ])
  expect(out.filter((line) => line.startsWith('::warning'))).toEqual([
    expect.stringContaining('title=Flaky test::passes the second time failed, then passed on its retry.'),
  ])
})

test("says a first run's error without a terminal's colours, as Playwright colours its own", () => {
  expect(said({ message: '\u001b[2mexpect(\u001b[22m\u001b[31mreceived\u001b[39m).toContain(expected)', stack: '' })).toBe(
    'expect(received).toContain(expected)',
  )
})
