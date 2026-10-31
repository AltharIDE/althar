import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter'

import { type Flaky, fromRoot, record, said } from './flaky'
import { type Held, held, judge, letThrough, type Quarantine } from './quarantine'

/** A test as flaky.ts names it. Its title path starts with the root and the project, both unnamed here, then its file. */
const named = (test: TestCase): Flaky => ({
  runner: 'playwright',
  file: fromRoot(test.location.file),
  name: test.titlePath().filter(Boolean).slice(1).join(' › '),
  error: said(test.results.find((one) => one.status !== 'passed')?.error),
})

/**
 * A Playwright reporter for CI. It says which tests failed, then passed on their retry (flaky.ts); and of those that
 * failed every time, which are quarantined (quarantine.ts). A run that failed for quarantined tests alone passes.
 */
export default class FlakyReporter implements Reporter {
  readonly #quarantine: Quarantine | undefined
  #config: FullConfig | undefined
  #suite: Suite | undefined
  /* Errors outside any test: in a global setup, a worker, or no tests found. */
  #errors = 0

  /** Playwright passes a reporter its options and more: without `quarantine`, it is this job's. */
  constructor(options: Held = {}) {
    this.#quarantine = 'quarantine' in options ? options.quarantine : held()
  }

  onBegin(config: FullConfig, suite: Suite) {
    this.#config = config
    this.#suite = suite
  }

  onError() {
    this.#errors += 1
  }

  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status === 'passed' && result.retry > 0) record(named(test))
  }

  async onEnd(result: FullResult): Promise<{ status: FullResult['status'] } | undefined> {
    const failed = (this.#suite?.allTests() ?? []).filter((test) => !test.ok()).map(named)
    const max = this.#config?.maxFailures ?? 0
    const { quarantined, passes } = judge(
      failed,
      this.#quarantine,
      result.status !== 'failed' || this.#errors > 0 || (max > 0 && failed.length >= max),
    )
    for (const test of quarantined) record(test)
    if (!passes) return undefined
    process.stdout.write(letThrough(quarantined))
    return { status: 'passed' }
  }
}
