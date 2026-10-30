import { deadline } from './deadline'

/**
 * Reads until what it reads passes the check, every 20 ms, and gives back what passed: `until` (effect.ts) for a test
 * written with promises. It gives up only near its test's own time, and says what it last read.
 */
export const waitFor = async <A>(read: () => A | Promise<A>, check: (value: A) => boolean = Boolean): Promise<A> => {
  for (;;) {
    const value = await read()
    if (check(value)) return value
    if (Date.now() > deadline()) throw new Error(`Timed out waiting; last saw ${JSON.stringify(value)}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
