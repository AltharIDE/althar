import { expect, test } from 'vite-plus/test'

/* Fails the first time it runs and passes the second: a flaky test, as a retry sees one. */
let runs = 0
test('passes the second time', () => {
  runs += 1
  expect(runs).toBe(2)
})

test('passes', () => {
  expect(true).toBe(true)
})
