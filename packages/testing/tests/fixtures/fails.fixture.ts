import { describe, expect, test } from 'vite-plus/test'

/* Fails every time it runs, its retry too: a quarantined test on a bad day, or a broken one. */
describe('a block', () => {
  test('fails every time', () => {
    expect(1).toBe(2)
  })
})

test('passes', () => {
  expect(true).toBe(true)
})
