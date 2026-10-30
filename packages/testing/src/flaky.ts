import { appendFileSync } from 'node:fs'
import { relative } from 'node:path'

/** A test that failed, then passed when it ran again. */
export interface Flaky {
  /** Its file, from the repository's root. */
  readonly file: string
  /** Its name after the names of the blocks it is in, as its runner joins them. */
  readonly name: string
  readonly runner: 'vitest' | 'playwright'
  /** What it failed with the first time, cut short: what a fix starts from. */
  readonly error?: string | undefined
}

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
 * Says a test was flaky, out loud: as a warning on the CI run, which GitHub shows on the run and its pull request,
 * and as a line in the file `FLAKY_REPORT` names, from which CI files an issue for the test (report.ts).
 */
export const record = (test: Flaky) => {
  const first = test.error === undefined ? '' : `\n${test.error}`
  process.stdout.write(
    `::warning file=${test.file},title=Flaky test::${escape(`${test.name} failed, then passed on its retry.${first}`)}\n`,
  )
  const report = process.env.FLAKY_REPORT
  if (report) appendFileSync(report, `${JSON.stringify(test)}\n`)
}

/** A file's path from the repository's root, as GitHub names it on a run. */
export const fromRoot = (path: string) => relative(process.env.GITHUB_WORKSPACE ?? process.cwd(), path).replaceAll('\\', '/')

/* An annotation's message ends at a newline, and `%` starts an escape. */
const escape = (text: string) => text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')
