import type { Reporter, TestCase } from 'vite-plus/test/node'

import { fromRoot, record, said } from './flaky'

/** A Vitest reporter that says which tests failed, then passed on their retry (flaky.ts). */
export default class FlakyReporter implements Reporter {
  onTestCaseResult(test: TestCase) {
    // A test that passed on its retry keeps what the first run failed with.
    if (test.diagnostic()?.flaky)
      record({ runner: 'vitest', file: fromRoot(test.module.moduleId), name: test.fullName, error: said(test.result().errors?.[0]) })
  }
}
