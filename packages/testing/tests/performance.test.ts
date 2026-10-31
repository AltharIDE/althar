import { expect, test } from 'vite-plus/test'

import { scale } from '../src/budget'
import { measure, type Measuring } from '../src/performance'

/** A context whose benchmarks take the mean each case names, and that keeps what is noted on the run. */
const context = (means: Readonly<Record<string, number>>): Measuring & { ran: Array<string>; noted: Array<[string, string]> } => {
  const ran: Array<string> = []
  const noted: Array<[string, string]> = []
  return {
    ran,
    noted,
    bench: (name: string, run: () => unknown) => ({
      run: async () => {
        run()
        ran.push(name)
        return { latency: { mean: means[name] ?? 0 } }
      },
    }),
    annotate: async (message: string, type: string) => {
      noted.push([message, type])
    },
  }
}

test('benchmarks every case, and warns of one over its budget without failing', async () => {
  const fake = context({ quick: 1, slow: 500 * scale })
  await measure(fake, 100, { quick: () => 'a', slow: () => 'b' })
  expect(fake.ran).toEqual(['quick', 'slow'])
  expect(fake.noted).toEqual([[`slow: ${(500 * scale).toFixed(1)} ms on average, over its budget of ${100 * scale} ms`, 'warning']])
})
