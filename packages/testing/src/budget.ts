/**
 * How many times longer tests take here than on the machines their budgets are set for, a Mac or GitHub's Linux
 * runners. On the same commit GitHub's Windows runners took a median 3.4 times as long, and a tenth of the tests
 * 5.8 times or more, so 4 there in CI. `ALTHAR_TEST_SCALE` says otherwise, for a machine that is busy or slow.
 */
export const scale = Number(process.env.ALTHAR_TEST_SCALE) || (process.env.CI === 'true' && process.platform === 'win32' ? 4 : 1)

/**
 * How long a test may take here, by its size, as Google sizes tests. A small one runs no process and touches no file
 * or network; a medium one may run real processes (git, the fake agent as one), write files and listen on localhost;
 * a large one drives the whole app. A test that passes is done as soon as it can be, so a generous budget costs
 * nothing: it only bounds how long one that hangs takes to fail. No test or wait sets a time of its own; one that
 * needs more than its package's size takes the next size, by name (`budget.large`).
 */
export const budget = {
  small: 10_000 * scale,
  medium: 60_000 * scale,
  large: 180_000 * scale,
} as const

export type Size = keyof typeof budget
