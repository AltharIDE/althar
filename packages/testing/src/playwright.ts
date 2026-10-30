import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter'

import { fromRoot, record } from './flaky'

/** A Playwright reporter that says which tests failed, then passed on their retry (flaky.ts). */
export default class FlakyReporter implements Reporter {
  onTestEnd(test: TestCase, result: TestResult) {
    // Its title path starts with the root and the project, both unnamed here, then its file.
    if (result.status === 'passed' && result.retry > 0)
      record({ runner: 'playwright', file: fromRoot(test.location.file), name: test.titlePath().filter(Boolean).slice(1).join(' › ') })
  }
}
