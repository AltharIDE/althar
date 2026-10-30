import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'vite-plus/test'
import { startVitest } from 'vite-plus/test/node'

import { fromRoot, said } from '../src/flaky'
import FlakyReporter from '../src/reporter'

test('reports a test that failed, then passed on its retry, and no other', async () => {
  const report = join(mkdtempSync(join(tmpdir(), 'flaky-')), 'flaky.jsonl')
  const was = process.env.FLAKY_REPORT
  process.env.FLAKY_REPORT = report
  try {
    const vitest = await startVitest('test', ['tests/fixtures/once.fixture.ts'], {
      include: ['tests/fixtures/*.fixture.ts'],
      retry: 1,
      watch: false,
      reporters: [new FlakyReporter()],
    })
    await vitest.close()
  } finally {
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
})

test("says a first run's error without a terminal's colours, as Playwright colours its own", () => {
  expect(said({ message: '\u001b[2mexpect(\u001b[22m\u001b[31mreceived\u001b[39m).toContain(expected)', stack: '' })).toBe(
    'expect(received).toContain(expected)',
  )
})
