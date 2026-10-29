import { appendFileSync } from 'node:fs'
import { relative } from 'node:path'

/** A test that failed, then passed when it ran again. */
export interface Flaky {
  /** Its file, from the repository's root. */
  readonly file: string
  /** Its name after the names of the blocks it is in, as its runner joins them. */
  readonly name: string
  readonly runner: 'vitest' | 'playwright'
}

/**
 * Says a test was flaky, out loud: as a warning on the CI run, which GitHub shows on the run and its pull request,
 * and as a line in the file `FLAKY_REPORT` names, from which CI files an issue for the test (report.ts).
 */
export const record = (test: Flaky) => {
  process.stdout.write(`::warning file=${test.file},title=Flaky test::${escape(test.name)} failed, then passed on its retry.\n`)
  const report = process.env.FLAKY_REPORT
  if (report) appendFileSync(report, `${JSON.stringify(test)}\n`)
}

/** A file's path from the repository's root, as GitHub names it on a run. */
export const fromRoot = (path: string) => relative(process.env.GITHUB_WORKSPACE ?? process.cwd(), path).replaceAll('\\', '/')

/* An annotation's message ends at a newline, and `%` starts an escape. */
const escape = (text: string) => text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
