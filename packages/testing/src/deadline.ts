import { budget } from './budget'

let started = Date.now()
let allowed: number = budget.medium

/** Notes that a test starts, and the time it may take (setup.ts, before each test). */
export const begin = (timeout: number) => {
  started = Date.now()
  allowed = timeout
}

/**
 * When a wait in the running test gives up: with a tenth of the test's time still left, so that the wait, which knows
 * what it was waiting for, fails the test, rather than the test's time running out and saying only that it did.
 */
export const deadline = () => started + allowed * 0.9
