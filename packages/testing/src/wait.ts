import { deadline } from './deadline'
import { calledFrom, timedOut } from './seen'

/**
 * Reads until what it reads passes the check, every 20 ms, and gives back what passed: `until` (effect.ts) for a test
 * written with promises. It gives up only near its test's own time, and says which wait it was and what it last read.
 */
export const waitFor = async <A>(read: () => A | Promise<A>, check: (value: A) => boolean = Boolean, what?: string): Promise<A> => {
  const where = calledFrom()
  for (;;) {
    const value = await read()
    if (check(value)) return value
    if (Date.now() > deadline()) throw timedOut(what, where, value)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
