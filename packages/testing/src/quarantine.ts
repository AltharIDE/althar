/*
 * Quarantine. In CI, a test with an open issue labelled `flaky` (one per flaky test, filed by report.ts) still runs,
 * but when it fails, on its retry too, it doesn't fail its job: the failure goes on its issue instead, as a flake's
 * does (report.ts), and the job's summary lists it. Every other test gates as before. Each job reads the open issues
 * afresh as it starts, so a test gates again as soon as its issue is closed, by the pull request that fixes it.
 *
 * `bun quarantine.ts read`, at a job's start (.github/actions/flaky/quarantine), reads the open issues with `gh` into a
 * file, and names it QUARANTINE for the job's later steps, whose reporters read it (reporter.ts, playwright.ts). A job
 * that doesn't read them quarantines nothing: a run on a computer, `nightly` and `stress`. One that can't read them
 * quarantines nothing either, and says so: it gates rather than let a failure pass.
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type Flaky, LABEL, titleOf } from './flaky'

/** How many tests may be quarantined before the summary warns: past about this many, quarantine hides too much. */
export const CAP = 10

/** An open issue labelled `flaky`. */
export interface Issue {
  readonly number: number
  readonly title: string
}

/** What a job read as it started: the open issues labelled `flaky`, or why it couldn't read them. */
export type Quarantine = { readonly issues: ReadonlyArray<Issue> } | { readonly unread: string }

/** A test, as a reporter names it (flaky.ts). */
type Test = Pick<Flaky, 'file' | 'name'>

const isIssue = (value: unknown): value is Issue =>
  typeof value === 'object' &&
  value !== null &&
  Number.isInteger((value as Record<string, unknown>).number) &&
  typeof (value as Record<string, unknown>).title === 'string'

/** A quarantine from its file, checked: anything else is an error. */
export const parse = (text: string): Quarantine => {
  const value: unknown = JSON.parse(text)
  if (typeof value === 'object' && value !== null) {
    const { issues, unread } = value as Record<string, unknown>
    if (Array.isArray(issues) && issues.every(isIssue)) return { issues: issues.map(({ number, title }) => ({ number, title })) }
    if (typeof unread === 'string') return { unread }
  }
  throw new Error('it holds neither the open issues nor why they are unread')
}

const firstLine = (error: unknown) =>
  String((error as { stderr?: unknown } | undefined)?.stderr || (error instanceof Error ? error.message : error))
    .trim()
    .split('\n')[0] ?? ''

/** This job's quarantine, from the file QUARANTINE names: undefined in a job that doesn't quarantine. */
export const held = (path = process.env.QUARANTINE): Quarantine | undefined => {
  if (path === undefined || path === '') return undefined
  try {
    return parse(readFileSync(path, 'utf8'))
  } catch (error) {
    return { unread: `${path}: ${firstLine(error)}` }
  }
}

/** A reporter's options: a quarantine given it, for a test of the reporter; without one, it reads its job's (`held`). */
export interface Held {
  readonly quarantine?: Quarantine | undefined
}

/** The open issues that quarantine a test: those titled as report.ts titles a test's, not any other issue labelled so. */
export const quarantinedTests = (quarantine: Quarantine | undefined) =>
  quarantine !== undefined && 'issues' in quarantine ? quarantine.issues.filter((issue) => issue.title.startsWith('Flaky: ')) : []

/** The number of the open issue a test is quarantined under, if it is: its title must be the test's exactly. */
export const issueOf = (quarantine: Quarantine | undefined, test: Test) =>
  quarantinedTests(quarantine).find((issue) => issue.title === titleOf(test))?.number

/**
 * A run's failed tests sorted into those quarantined, with their issue, and those that gate; and whether the run
 * passes: only when it failed for quarantined tests alone. `otherwise` says something else failed it too (an error
 * outside any test, a hook's, no tests at all), which always gates.
 */
export const judge = <T extends Test>(failed: ReadonlyArray<T>, quarantine: Quarantine | undefined, otherwise: boolean) => {
  const sorted = failed.map((test) => ({ test, issue: issueOf(quarantine, test) }))
  const quarantined = sorted.flatMap(({ test, issue }) => (issue === undefined ? [] : [{ ...test, quarantined: issue }]))
  const gating = sorted.flatMap(({ test, issue }) => (issue === undefined ? [test] : []))
  return { quarantined, gating, passes: !otherwise && quarantined.length > 0 && gating.length === 0 }
}

/** What a reporter says in the log of a run it lets pass, which its runner's own summary calls failed. */
export const letThrough = (quarantined: ReadonlyArray<Flaky>) => {
  const one = quarantined.length === 1
  const tests = quarantined.map((test) => `${test.name} (#${test.quarantined})`).join(', ')
  return `\n${quarantined.length} quarantined ${one ? 'test' : 'tests'} failed, and ${one ? "doesn't" : "don't"} fail the run: ${tests}.\n`
}

/* A table cell: a pipe would end it, and a newline the row. */
const cell = (text: string) => text.replaceAll('|', '\\|').replaceAll('\n', ' ')

/**
 * The job's summary of its quarantine, in Markdown: the quarantined tests that failed in it, so a red test that didn't
 * fail the job says why; a loud warning when more than CAP are quarantined; and when the issues couldn't be read,
 * that every test gated. Empty when there's nothing to say, or the job doesn't quarantine. `repository` is its address
 * on GitHub, which the links start from.
 */
export const summary = (quarantine: Quarantine | undefined, failed: ReadonlyArray<Flaky>, repository: string) => {
  if (quarantine === undefined) return ''
  if ('unread' in quarantine)
    return `### Quarantined tests\n\n> [!WARNING]\n> Couldn't read which tests are quarantined, so none was: every test gated in this job. ${quarantine.unread}\n`
  const open = `${repository}/issues?q=${encodeURIComponent(`is:issue is:open label:${LABEL}`)}`
  const count = quarantinedTests(quarantine).length
  const parts = [
    ...(count > CAP
      ? [
          `> [!CAUTION]\n> **${count} tests are quarantined**, more than ${CAP}. Their failures don't fail CI: fix them, and close their [issues](${open}).`,
        ]
      : []),
    ...(failed.length > 0
      ? [
          `These failed, and didn't fail the job: each is quarantined while its issue labelled \`${LABEL}\` is open, and its failure is on the issue. ${count} ${count === 1 ? 'test is' : 'tests are'} quarantined in all ([open issues](${open})).`,
          [
            '| Test | Issue |',
            '| --- | --- |',
            ...failed.map(
              (test) =>
                `| \`${cell(test.file)}\` › ${cell(test.name)} | [#${test.quarantined}](${repository}/issues/${test.quarantined}) |`,
            ),
          ].join('\n'),
        ]
      : []),
  ]
  return parts.length === 0 ? '' : `### Quarantined tests\n\n${parts.join('\n\n')}\n`
}

/** The open issues labelled `flaky`, read with `gh`; or, if that fails, why. */
const read = (repository: string): Quarantine => {
  try {
    const listed = execFileSync(
      'gh',
      ['issue', 'list', '--repo', repository, '--label', LABEL, '--state', 'open', '--limit', '1000', '--json', 'number,title'],
      { encoding: 'utf8' },
    )
    return parse(JSON.stringify({ issues: JSON.parse(listed) as unknown }))
  } catch (error) {
    return { unread: firstLine(error) }
  }
}

if (process.argv[2] === 'read' && (process.argv[1] ?? '').endsWith('quarantine.ts')) {
  const quarantine = read(process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY ?? '')
  try {
    const path = join(process.env.RUNNER_TEMP ?? tmpdir(), 'althar-quarantine.json')
    writeFileSync(path, JSON.stringify(quarantine))
    if (process.env.GITHUB_ENV !== undefined) appendFileSync(process.env.GITHUB_ENV, `QUARANTINE=${path}\n`)
    if ('unread' in quarantine)
      process.stdout.write(
        `::warning title=Quarantine::Couldn't read which tests are quarantined, so none is: every test gates in this job. ${quarantine.unread}\n`,
      )
    else {
      const tests = quarantinedTests(quarantine)
      process.stdout.write(
        `${tests.length} ${tests.length === 1 ? 'test is' : 'tests are'} quarantined: they run, but don't fail this job.\n${tests.map((issue) => `  #${issue.number} ${issue.title}\n`).join('')}`,
      )
    }
  } catch (error) {
    // Without QUARANTINE, the job quarantines nothing: every test gates.
    process.stdout.write(`::warning title=Quarantine::Couldn't keep which tests are quarantined, so none is: ${firstLine(error)}\n`)
  }
}
