import { Effect, Exit } from 'effect'
import { expect, test } from 'vite-plus/test'

import { begin } from '../src/deadline'
import { until } from '../src/effect'
import { budget, deadline, waitFor } from '../src/index'

test("gives a test's waits up with a tenth of its time left", () => {
  const left = deadline() - Date.now()
  expect(left).toBeLessThanOrEqual(budget.small * 0.9)
  expect(left).toBeGreaterThan(budget.small * 0.8)
})

test(
  'goes by the time a test is given, where it takes a larger size',
  () => {
    expect(deadline() - Date.now()).toBeGreaterThan(budget.large * 0.8)
  },
  budget.large,
)

test('reads until the check passes, and gives back what passed', async () => {
  let reads = 0
  const read = Effect.sync(() => (reads += 1))
  expect(await Effect.runPromise(until(read, (count) => count === 3))).toBe(3)
  expect(
    await waitFor(
      () => (reads += 1),
      (count) => count === 5,
    ),
  ).toBe(5)
})

test('says what it last read when it gives up', async () => {
  // As though this test had only a moment left.
  begin(100)
  const exit = await Effect.runPromiseExit(until(Effect.succeed({ state: 'running' }), () => false))
  expect(Exit.isFailure(exit) && String(exit.cause)).toMatch(
    /Timed out waiting \(at \S*deadline\.test\.ts:\d+:\d+\); last saw \{"state":"running"\}/,
  )
  await expect(
    waitFor(
      () => 'nope',
      () => false,
    ),
  ).rejects.toThrow(/Timed out waiting \(at \S*deadline\.test\.ts:\d+:\d+\); last saw "nope"$/)
})

test('says which wait gave up, by what it waits for and the line that asked for it', async () => {
  begin(100)
  const exit = await Effect.runPromiseExit(until(Effect.succeed([]), () => false, 'the second turn'))
  expect(Exit.isFailure(exit) && String(exit.cause)).toMatch(
    /Timed out waiting for the second turn \(at \S*deadline\.test\.ts:\d+:\d+\); last saw \[\]/,
  )
  await expect(
    waitFor(
      () => 0,
      () => false,
      'a reply',
    ),
  ).rejects.toThrow(/^Timed out waiting for a reply \(at \S*deadline\.test\.ts:\d+:\d+\); last saw 0$/)
})

test('cuts long words in what it last read, so what comes after them still shows', async () => {
  begin(100)
  const prompt = `You are working on a task. ${'And more. '.repeat(400)}The end.`
  await expect(
    waitFor(
      () => [{ prompt, state: 'pending' }],
      () => false,
    ),
  ).rejects.toThrow(/last saw \[\{"prompt":"You are working on a task\. .{0,60}….{0,70}The end\.","state":"pending"\}\]$/)
})
