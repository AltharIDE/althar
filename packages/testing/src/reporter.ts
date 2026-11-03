import type { Reporter, SerializedError, TestCase, TestModule, TestRunEndReason, Vitest } from 'vite-plus/test/node'

import { type Flaky, fromRoot, record, said } from './flaky'
import { type Held, held, issueOf, judge, letThrough, type Quarantine } from './quarantine'

const named = (test: TestCase): Flaky => ({
  runner: 'vitest',
  file: fromRoot(test.module.moduleId),
  name: test.fullName,
  error: said(test.result().errors?.[0]),
})

/** Whether a module failed only for tests that failed: not for an error outside them, in its import or a suite's hook. */
const failedInTests = (module: TestModule) =>
  module.ok() ||
  (module.errors().length === 0 &&
    [...module.children.allSuites()].every((suite) => suite.errors().length === 0) &&
    [...module.children.allTests('failed')].length > 0)

/**
 * A Vitest reporter for CI. It says which tests failed, then passed on their retry (flaky.ts); and of those that failed
 * every time, which are quarantined (quarantine.ts). A run that failed for quarantined tests alone passes.
 */
export default class FlakyReporter implements Reporter {
  readonly #quarantine: Quarantine | undefined
  #vitest: Vitest | undefined
  #exitCode: typeof process.exitCode

  /** Vitest passes a reporter named in a config its options, `{}` by default: without `quarantine`, it is this job's. */
  constructor(options: Held = {}) {
    this.#quarantine = 'quarantine' in options ? options.quarantine : held()
  }

  onInit(vitest: Vitest) {
    this.#vitest = vitest
  }

  /* Merging the parts' reports, which said what they found in jobs of their own: here it only decides the run. */
  get #merging() {
    return Boolean(this.#vitest?.config.mergeReports)
  }

  onTestRunStart() {
    this.#exitCode = process.exitCode
  }

  onTestCaseResult(test: TestCase) {
    if (this.#merging) return
    // A test that passed on its retry keeps what the first run failed with.
    if (test.diagnostic()?.flaky) record(named(test))
    else if (test.result().state === 'failed') {
      const failed = named(test)
      const issue = issueOf(this.#quarantine, failed)
      if (issue !== undefined) record({ ...failed, quarantined: issue })
    }
  }

  onTestRunEnd(modules: ReadonlyArray<TestModule>, errors: ReadonlyArray<SerializedError>, reason: TestRunEndReason) {
    if (reason !== 'failed') return
    const failed = modules.flatMap((module) => [...module.children.allTests('failed')].map(named))
    // Vitest checks coverage only on a run with no failed test, unless told to on one that fails; a run quarantine
    // let pass would skip it unsaid. A merge of parts' reports checks it whatever failed.
    const coverage = this.#vitest?.config.coverage
    const unchecked = !this.#merging && coverage?.enabled === true && !coverage.reportOnFailure
    const { quarantined, gating, passes } = judge(
      failed,
      this.#quarantine,
      errors.length > 0 || modules.length === 0 || !modules.every(failedInTests) || unchecked,
    )
    if (unchecked && quarantined.length > 0 && gating.length === 0)
      process.stdout.write(
        `::warning title=Quarantine::Only quarantined tests failed, but without coverage.reportOnFailure coverage goes unchecked on a run with a failed test, so this run still fails.\n`,
      )
    // Something before this run had failed the process already: not this run's to undo.
    if (!passes || Number(this.#exitCode ?? 0) !== 0) return
    process.exitCode = 0
    process.stdout.write(letThrough(quarantined))
  }
}
