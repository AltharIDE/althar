import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'vite-plus/test'
import { startVitest } from 'vite-plus/test/node'

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
    { runner: 'vitest', file: 'tests/fixtures/once.fixture.ts', name: 'passes the second time' },
  ])
})
