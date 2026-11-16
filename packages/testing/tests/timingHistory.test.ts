import { expect, test } from 'vite-plus/test'

import { timingHistory } from '../src/timingHistory'

const record = (milliseconds: number, platform = 'linux') => JSON.stringify({ platform, file: 'apps/desktop/e2e/a.spec.ts', milliseconds })

test('sums a spec’s attempts per job, uses the median across jobs, and keeps OS timings separate', () => {
  expect(timingHistory([`${record(10)}\n${record(20)}`, record(50), record(900), record(100, 'win32')])).toEqual({
    linux: { 'apps/desktop/e2e/a.spec.ts': 50 },
    win32: { 'apps/desktop/e2e/a.spec.ts': 100 },
  })
})

test('refuses invalid data and paths instead of turning them into execution instructions', () => {
  for (const line of [record(-1), record(0), '{', JSON.stringify({ platform: 'linux', file: '../../a', milliseconds: 1 })])
    expect(() => timingHistory([line])).toThrow()
})
