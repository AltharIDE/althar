import { appendFileSync } from 'node:fs'
import { relative } from 'node:path'

/** The label of a flaky test's issue (report.ts), and of the tests in quarantine while it is open (quarantine.ts). */
export const LABEL = 'flaky'

/**
 * A test that failed, then passed when it ran again; or, with `quarantined`, one that failed every time while its
 * flaky issue was open, so it didn't fail its job (quarantine.ts).
 */
export interface Flaky {
  /** Its file, from the repository's root. */
  readonly file: string
  /** Its name after the names of the blocks it is in, as its runner joins them. */
  readonly name: string
  readonly runner: 'vitest' | 'playwright'
  /** What it failed with the first time, cut short: what a fix starts from. */
  readonly error?: string | undefined
  /** The number of the open issue it is quarantined under, when it failed every time. */
  readonly quarantined?: number | undefined
}

/** The title of a test's issue: how report.ts files it, and how quarantine finds it. */
export const titleOf = (test: { readonly file: string; readonly name: string }) => `Flaky: ${test.file} › ${test.name}`.slice(0, 250)

/* A terminal's colours, which Playwright's messages carry. */
// eslint-disable-next-line no-control-regex -- a terminal's colours are control characters
const COLOURS = /\u001b\[[0-9;]*m/g

/** An error's message and where it was thrown, short enough for an issue: only the frames in the repository's own code. */
export const said = (error: { readonly message?: string; readonly stack?: string } | undefined) => {
  if (error === undefined) return undefined
  const frames = (error.stack ?? '').split('\n').filter((line) => /^\s+at /.test(line) && !/node_modules|node:|<anonymous>/.test(line))
  return [error.message ?? '', ...frames.slice(0, 3)].join('\n').replace(COLOURS, '').trim().slice(0, 1500) || undefined
}

/**
 * Says a test was flaky, or failed in quarantine, out loud: as a warning on the CI run, which GitHub shows on the run
 * and its pull request, and as a line in the file `FLAKY_REPORT` names, from which CI files or comments on the test's
 * issue (report.ts).
 */
export const record = (test: Flaky) => {
  const first = test.error === undefined ? '' : `\n${test.error}`
  const [title, what] =
    test.quarantined === undefined
      ? ['Flaky test', 'failed, then passed on its retry.']
      : ['Quarantined test', `failed, and doesn't fail the job: it is quarantined while #${test.quarantined} is open.`]
  process.stdout.write(`::warning file=${test.file},title=${title}::${escape(`${test.name} ${what}${first}`)}\n`)
  const report = process.env.FLAKY_REPORT
  if (report) appendFileSync(report, `${JSON.stringify(test)}\n`)
}

/** A file's path from the repository's root, as GitHub names it on a run. */
export const fromRoot = (path: string) => relative(process.env.GITHUB_WORKSPACE ?? process.cwd(), path).replaceAll('\\', '/')

/* An annotation's message ends at a newline, and `%` starts an escape. */
const escape = (text: string) => text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
