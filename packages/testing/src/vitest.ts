// With its extension: Node loads this file itself, for a package's Vitest config, and needs it.
import { budget, type Size } from './budget.ts'

/** Whether this runs in CI: GitHub Actions sets CI. */
const ci = process.env.CI === 'true'

/**
 * What each package's Vitest config spreads into `test`, for the size of its tests (budget.ts). Each test, and each
 * hook, may take its size's budget here, and its waits give up a little before that (deadline.ts, set up before each
 * test). A package with setup files of its own puts them after `setupFiles` here.
 *
 * In CI a test that fails runs once more, so one that fails only now and then doesn't stop a merge. One that passes
 * only then is flaky, and is reported as such (reporter.ts): it stays in sight until its cause is fixed, and while its
 * issue is open its failures don't fail CI (quarantine.ts). Locally nothing runs twice and nothing is quarantined, so
 * a flaky test fails where it is written.
 */
export const testing = (size: Size) => ({
  testTimeout: budget[size],
  hookTimeout: budget[size],
  setupFiles: ['@althar/testing/setup'],
  retry: ci ? 1 : 0,
  reporters: ci ? ['default', 'github-actions', '@althar/testing/reporter'] : ['default'],
})
