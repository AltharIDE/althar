import { beforeAll, expect, test } from 'vite-plus/test'

/* A hook that fails: an error outside any test, which the test's quarantine doesn't cover. */
beforeAll(() => {
  throw new Error('the setup broke')
})

test('after a broken hook', () => {
  expect(true).toBe(true)
})
