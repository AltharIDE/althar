/*
 * Quarantine. In CI, a test with an open issue labelled `flaky` (one per flaky test, filed by report.ts) still runs,
 * but when it fails, on its retry too, it doesn't fail its job: the failure goes on its issue instead, as a flake's
 * does (report.ts), and the job's summary lists it. Every other test gates as before. Each job reads the open issues
 * afresh as it starts, so a test gates again as soon as its issue is closed, by the pull request that fixes it.
 *
 * A quarantine has an owner and an end. It lasts a week from its issue's opening (quarantines open before this landed
 * last until GRACE_ENDS); a test that fails on its retry twice in a day is broken, not flaky, and its quarantine ends
 * then. Once it has ended (lapsed), the test is skipped wherever quarantine is read, on pull requests, in the queue and
 * after merge, and listed on every job's summary; it runs every night, where nothing is quarantined and it gates. Its
 * owner is the pull request and session that last changed what it covers: the test's file or a file it imports, by
 * git. `tend.ts`, every night, records the owner on the issue, and labels the issue `broken` when its quarantine lapses,
 * naming the owner.
 *
 * `bun quarantine.ts read`, at a job's start (.github/actions/flaky/quarantine), reads the open issues with `gh` into a
 * file, and names it QUARANTINE for the job's later steps, whose reporters read it (reporter.ts, playwright.ts), and
 * whose setup skips the lapsed tests (setup.ts; for Playwright, QUARANTINE_SKIPPED, which e2e.yml passes as
 * `--grep-invert`). A job that doesn't read them quarantines nothing: a run on a computer, `nightly` and `stress`. One
 * that can't read them quarantines nothing either, and says so: it gates rather than let a failure pass.
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type Flaky, LABEL, titleOf } from './flaky'

/** How many tests may be quarantined before the summary warns: past about this many, quarantine hides too much. */
export const CAP = 10

export const DAY = 24 * 60 * 60 * 1000

/** How long a quarantine lasts, from its issue's opening: the days between a flake and its fix. */
export const LASTS = 7 * DAY

/**
 * When the quarantines open before owners and ends landed lapse, a week after it: none lapsed the day it landed. Set
 * a week after the day it lands.
 */
export const GRACE_ENDS = Date.parse('2026-12-03T00:00:00Z')

/** When owners and ends landed: what fails before it doesn't count against a test. */
export const LANDED = GRACE_ENDS - LASTS

/** The label of an issue whose quarantine lapsed: its test is skipped where quarantine is read, and runs at night. */
export const BROKEN = 'broken'

/** Who files the issues that quarantine: CI itself (report.ts), as `gh` and GitHub's API name it. */
export const CI = /^(?:app\/)?github-actions(?:\[bot\])?$/

/** An open issue labelled `flaky`. */
export interface Issue {
  readonly number: number
  readonly title: string
  /** When it was opened, as GitHub gives it. */
  readonly opened: string
  /** Who opened it. */
  readonly by: string
  readonly labels: ReadonlyArray<string>
  /** Who owns it, as tend.ts recorded it on the issue. */
  readonly owner?: string | undefined
}

/** What a job read as it started, and when: the open issues labelled `flaky`, or why it couldn't read them. */
export type Quarantine = { readonly issues: ReadonlyArray<Issue>; readonly at: number } | { readonly unread: string }

/** A test, as a reporter names it (flaky.ts). */
type Test = Pick<Flaky, 'file' | 'name'>

const isIssue = (value: unknown): value is Issue => {
  if (typeof value !== 'object' || value === null) return false
  const { number, title, opened, by, labels, owner } = value as Record<string, unknown>
  return (
    Number.isInteger(number) &&
    typeof title === 'string' &&
    typeof opened === 'string' &&
    Number.isFinite(Date.parse(opened)) &&
    typeof by === 'string' &&
    Array.isArray(labels) &&
    labels.every((label) => typeof label === 'string') &&
    (owner === undefined || typeof owner === 'string')
  )
}

/** A quarantine from its file, checked: anything else is an error. */
export const parse = (text: string): Quarantine => {
  const value: unknown = JSON.parse(text)
  if (typeof value === 'object' && value !== null) {
    const { issues, unread, at } = value as Record<string, unknown>
    if (Array.isArray(issues) && issues.every(isIssue) && typeof at === 'number' && Number.isFinite(at))
      return {
        issues: issues.map(({ number, title, opened, by, labels, owner }) => ({
          number,
          title,
          opened,
          by,
          labels,
          ...(owner === undefined ? {} : { owner }),
        })),
        at,
      }
    if (typeof unread === 'string') return { unread }
  }
  throw new Error('it holds neither the open issues nor why they are unread')
}

export const firstLine = (error: unknown) =>
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

/** When an issue's quarantine lapses: a week after it opened, and for one open before this landed, at GRACE_ENDS. */
export const lapsesAt = (issue: Pick<Issue, 'opened'>) => Math.max(Date.parse(issue.opened) + LASTS, GRACE_ENDS)

/**
 * How an issue holds its test at `at`: quarantined (it runs, and doesn't gate), lapsed (it's skipped), or not at all.
 * Only an issue titled as report.ts titles a test's quarantines, and since this landed only one CI opened: one anyone
 * else opens with a test's title gates nothing away.
 */
export const standing = (issue: Issue, at: number): 'held' | 'lapsed' | undefined => {
  if (!issue.title.startsWith('Flaky: ')) return undefined
  if (!CI.test(issue.by) && !(Date.parse(issue.opened) < LANDED)) return undefined
  return issue.labels.includes(BROKEN) || at >= lapsesAt(issue) ? 'lapsed' : 'held'
}

/** The open issues that hold a test, quarantined or lapsed: not any other issue labelled so. */
export const quarantinedTests = (quarantine: Quarantine | undefined) =>
  quarantine !== undefined && 'issues' in quarantine
    ? quarantine.issues.filter((issue) => standing(issue, quarantine.at) !== undefined)
    : []

/** The issues whose quarantine lapsed: their tests are skipped. */
export const lapsed = (quarantine: Quarantine | undefined) =>
  quarantine !== undefined && 'issues' in quarantine ? quarantine.issues.filter((issue) => standing(issue, quarantine.at) === 'lapsed') : []

/**
 * The number of the open issue a test is quarantined under, if it is, lapsed or not: its title must be the test's
 * exactly. A lapsed test is skipped, so its failure here is only one that ran anyway, which doesn't gate either.
 */
export const issueOf = (quarantine: Quarantine | undefined, test: Test) =>
  quarantinedTests(quarantine).find((issue) => issue.title === titleOf(test))?.number

/** The number of a test's issue if its quarantine lapsed, so it's skipped. */
export const lapsedOf = (quarantine: Quarantine | undefined, test: Test) =>
  lapsed(quarantine).find((issue) => issue.title === titleOf(test))?.number

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

/** A test's file and name, from its issue's title (flaky.ts's `titleOf`); whether the title was cut short. */
export const testOf = (title: string) => {
  const body = title.slice('Flaky: '.length)
  const at = body.indexOf(' › ')
  return { file: at < 0 ? body : body.slice(0, at), name: at < 0 ? '' : body.slice(at + 3), cut: title.length >= 250 }
}

const escaped = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The lapsed end-to-end tests of the specs under `folder`, as one regular expression Playwright's `--grep-invert`
 * takes, or '' when none is. Playwright matches it against a test's file from its config's folder and its titles,
 * joined with spaces, and its tags after; a title cut short matches as far as it goes.
 */
export const skippedSpecs = (quarantine: Quarantine | undefined, folder = 'apps/desktop/e2e') =>
  lapsed(quarantine)
    .map((issue) => testOf(issue.title))
    .filter(({ file, name }) => file.startsWith(`${folder}/`) && /\.spec\.[cm]?[jt]sx?$/.test(file) && name !== '')
    .map(
      ({ file, name, cut }) =>
        `(?:^| )${escaped(file.slice(folder.length + 1)).replaceAll('/', '[\\\\/]')} ${escaped(name.replaceAll(' › ', ' '))}${cut ? '' : '(?: @\\S+)*$'}`,
    )
    .join('|')

/** What a reporter says in the log of a run it lets pass, which its runner's own summary calls failed. */
export const letThrough = (quarantined: ReadonlyArray<Flaky>) => {
  const one = quarantined.length === 1
  const tests = quarantined.map((test) => `${test.name} (#${test.quarantined})`).join(', ')
  return `\n${quarantined.length} quarantined ${one ? 'test' : 'tests'} failed, and ${one ? "doesn't" : "don't"} fail the run: ${tests}.\n`
}

/* A table cell: a pipe would end it, and a newline the row. */
const cell = (text: string) => text.replaceAll('|', '\\|').replaceAll('\n', ' ')

export const day = (at: number) => new Date(at).toISOString().slice(0, 10)

/**
 * The job's summary of its quarantine, in Markdown: the lapsed tests, skipped in it, with their owners; the
 * quarantined tests that failed in it, so a red test that didn't fail the job says why; a loud warning when more than
 * CAP are quarantined; and when the issues couldn't be read, that every test gated. Empty when there's nothing to say,
 * or the job doesn't quarantine. `repository` is its address on GitHub, which the links start from.
 */
export const summary = (quarantine: Quarantine | undefined, failed: ReadonlyArray<Flaky>, repository: string) => {
  if (quarantine === undefined) return ''
  if ('unread' in quarantine)
    return `### Quarantined tests\n\n> [!WARNING]\n> Couldn't read which tests are quarantined, so none was: every test gated in this job. ${quarantine.unread}\n`
  const open = `${repository}/issues?q=${encodeURIComponent(`is:issue is:open label:${LABEL}`)}`
  const all = quarantinedTests(quarantine)
  const ended = lapsed(quarantine)
  const count = all.length - ended.length
  const link = (number: number) => `[#${number}](${repository}/issues/${number})`
  const parts = [
    ...(count > CAP
      ? [
          `> [!CAUTION]\n> **${count} tests are quarantined**, more than ${CAP}. Their failures don't fail CI: fix them, and close their [issues](${open}).`,
        ]
      : []),
    ...(ended.length > 0
      ? [
          `> [!WARNING]\n> **${ended.length} ${ended.length === 1 ? "test's quarantine has" : "tests' quarantines have"} lapsed**, and ${ended.length === 1 ? 'it is' : 'they are'} skipped in this job: quarantined a week, or failed on ${ended.length === 1 ? 'its' : 'their'} retry twice in a day. Each runs every night, where it gates. Its owner fixes it, or deletes it, and closes its issue.`,
          [
            '| Test | Issue | Since | Owner |',
            '| --- | --- | --- | --- |',
            ...ended.map((issue) => {
              const { file, name } = testOf(issue.title)
              const since = issue.labels.includes(BROKEN) ? 'labelled broken' : day(lapsesAt(issue))
              return `| \`${cell(file)}\` › ${cell(name)} | ${link(issue.number)} | ${since} | ${cell(issue.owner ?? 'named on the issue tonight')} |`
            }),
          ].join('\n'),
        ]
      : []),
    ...(failed.length > 0
      ? [
          `These failed, and didn't fail the job: each is quarantined while its issue labelled \`${LABEL}\` is open, and its failure is on the issue. ${count} ${count === 1 ? 'test is' : 'tests are'} quarantined in all ([open issues](${open})).`,
          [
            '| Test | Issue |',
            '| --- | --- |',
            ...failed.map((test) => `| \`${cell(test.file)}\` › ${cell(test.name)} | ${link(test.quarantined ?? 0)} |`),
          ].join('\n'),
        ]
      : []),
  ]
  return parts.length === 0 ? '' : `### Quarantined tests\n\n${parts.join('\n\n')}\n`
}

/** Where tend.ts records an issue's owner in its body, so the next read finds it. */
const OWNER = /\*\*Owner:\*\* (.+?) <!-- owner -->/

/** An issue's owner, from its body. */
export const ownerIn = (body: string | null | undefined) => OWNER.exec(body ?? '')?.[1]

/** The open issues labelled `flaky`, each with its body, read with GitHub's API through `gh`. */
export const listed = (repository: string) =>
  execFileSync(
    'gh',
    [
      'api',
      '--paginate',
      `repos/${repository}/issues?labels=${LABEL}&state=open&per_page=100`,
      '--jq',
      '.[] | select(.pull_request == null) | {number, title, opened: .created_at, by: .user.login, labels: [.labels[].name], body}',
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Omit<Issue, 'owner'> & { readonly body: string | null })

/** The open issues labelled `flaky`, read with `gh`, and when; or, if that fails, why. */
const read = (repository: string): Quarantine => {
  try {
    const issues = listed(repository).map(({ body, ...issue }) => ({ ...issue, owner: ownerIn(body) }))
    return parse(JSON.stringify({ issues, at: Date.now() }))
  } catch (error) {
    return { unread: firstLine(error) }
  }
}

const main = (process.argv[1] ?? '').replaceAll('\\', '/').endsWith('/quarantine.ts')
const repository = process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY ?? ''

if (main && process.argv[2] === 'read') {
  const quarantine = read(repository)
  try {
    const path = join(process.env.RUNNER_TEMP ?? tmpdir(), 'althar-quarantine.json')
    writeFileSync(path, JSON.stringify(quarantine))
    const run = process.env.LAPSED === 'run'
    const skipped = run ? '' : skippedSpecs(quarantine)
    if (process.env.GITHUB_ENV !== undefined)
      appendFileSync(
        process.env.GITHUB_ENV,
        `QUARANTINE=${path}\nQUARANTINE_SKIPPED=${skipped}\nQUARANTINE_LAPSED=${run ? 'run' : 'skip'}\n`,
      )
    if ('unread' in quarantine)
      process.stdout.write(
        `::warning title=Quarantine::Couldn't read which tests are quarantined, so none is: every test gates in this job. ${quarantine.unread}\n`,
      )
    else {
      const tests = quarantinedTests(quarantine)
      const ended = new Set(lapsed(quarantine))
      const quarantined = tests.filter((issue) => !ended.has(issue))
      process.stdout.write(
        [
          `${quarantined.length} ${quarantined.length === 1 ? 'test is' : 'tests are'} quarantined: they run, but don't fail this job.`,
          ...quarantined.map((issue) => `  #${issue.number} ${issue.title}, until ${day(lapsesAt(issue))}`),
          `${ended.size} ${ended.size === 1 ? "test's quarantine has" : "tests' quarantines have"} lapsed: ${run ? "run for their coverage, but don't fail this job" : 'skipped in this job'}.`,
          ...[...ended].map((issue) => `  #${issue.number} ${issue.title}`),
          '',
        ].join('\n'),
      )
    }
  } catch (error) {
    // Without QUARANTINE, the job quarantines nothing: every test gates.
    process.stdout.write(`::warning title=Quarantine::Couldn't keep which tests are quarantined, so none is: ${firstLine(error)}\n`)
  }
}
