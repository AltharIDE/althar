import { expect, test } from 'vite-plus/test'

/* Another test that fails every time. */
test('fails too', () => {
  expect('broken').toBe('fixed')
})
