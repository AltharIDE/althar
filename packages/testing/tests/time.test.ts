import { expect, test } from 'vite-plus/test'

import { isoAfter } from '../src/time'

/* A test's future time is relative to its present (lint/dates.js refuses one written out). */
test('builds ISO times relative to the supplied clock, across a calendar boundary', () => {
  const now = Date.parse('2025-12-31T23:59:59.000Z')
  expect(isoAfter(2000, now)).toBe('2026-01-01T00:00:01.000Z')
  expect(isoAfter(-1000, now)).toBe('2025-12-31T23:59:58.000Z')
})
