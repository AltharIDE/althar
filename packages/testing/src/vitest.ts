/** Whether this runs in CI: GitHub Actions sets CI. */
const ci = process.env.CI === 'true'

/**
 * What each package's Vitest config spreads into `test`. In CI a test that fails runs once more, so one that fails
 * only now and then doesn't stop a merge. One that passes only then is flaky, and is reported as such (reporter.ts):
 * it stays in sight until its cause is fixed. Locally nothing runs twice, so a flaky test fails where it is written.
 */
export const testing = {
  retry: ci ? 1 : 0,
  reporters: ci ? ['default', 'github-actions', '@althar/testing/reporter'] : ['default'],
}
