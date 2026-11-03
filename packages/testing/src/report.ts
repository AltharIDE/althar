/*
 * Files what a CI job's tests found (the lines the reporters wrote to FLAKY_REPORT) on GitHub issues labelled `flaky`,
 * one per test. A flaky test, which failed and then passed on its retry, gets a new issue if it wasn't seen before, or
 * a comment on its issue, reopening it if it was closed. A quarantined test that failed every time (quarantine.ts) gets
 * a comment on its open issue, reopening it if it was closed while the job ran. Each comment says where it happened:
 * the platform, the job, and the pull request, merge queue or main it ran for.
 *
 * First it writes the job's summary of its quarantine: the quarantined tests that failed, and a warning when too many
 * are quarantined or they couldn't be read. Run by .github/actions/flaky after a job's tests, whether they passed or
 * not; it never fails the job.
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'

import { type Flaky, LABEL, titleOf } from './flaky'
import { held, summary } from './quarantine'

const gh = (...args: ReadonlyArray<string>) => execFileSync('gh', args, { encoding: 'utf8' }).trim()

/** The pull request, merge queue entry or branch this run is for. */
const where = () => {
  const ref = process.env.GITHUB_REF ?? ''
  const pull = /^refs\/pull\/(\d+)\//.exec(ref)
  if (pull) return `pull request #${pull[1]}`
  const queued = /gh-readonly-queue\/[^/]+\/pr-(\d+)-/.exec(ref)
  if (queued) return `the merge queue, for #${queued[1]}`
  return process.env.GITHUB_REF_NAME ?? ref
}

/** What the job's reporters wrote, one entry a test: a job that runs a test more than once reports it once. */
const found = (report: string | undefined) => {
  try {
    const lines = report !== undefined && existsSync(report) ? readFileSync(report, 'utf8').split('\n') : []
    return new Map(
      lines
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as Flaky)
        .map((test) => [titleOf(test), test]),
    )
  } catch (error) {
    process.stdout.write(`::warning title=Flaky tests::Couldn't read what the tests reported: ${String(error).split('\n')[0]}\n`)
    return new Map<string, Flaky>()
  }
}

const tests = found(process.env.FLAKY_REPORT)
const repository = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}`

try {
  const said = summary(
    held(),
    [...tests.values()].filter((test) => test.quarantined !== undefined),
    repository,
  )
  if (said !== '' && process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, said)
} catch (error) {
  process.stdout.write(`::warning title=Quarantined tests::Couldn't write the job's summary: ${String(error).split('\n')[0]}\n`)
}

if (tests.size > 0) {
  try {
    const run = `${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`
    const context = `${process.env.RUNNER_OS ?? 'CI'}, job ${process.env.GITHUB_JOB ?? '?'}, ${where()}.\n\n${run}`
    gh('label', 'create', LABEL, '--color', 'D93F0B', '--description', 'A test that failed, then passed when CI ran it again', '--force')
    const known = JSON.parse(
      gh('issue', 'list', '--label', LABEL, '--state', 'all', '--limit', '1000', '--json', 'number,title,state'),
    ) as ReadonlyArray<{
      number: number
      title: string
      state: 'OPEN' | 'CLOSED'
    }>
    for (const [title, test] of tests) {
      const quarantined = test.quarantined !== undefined
      const said = quarantined
        ? `Failed, on its retry too, and didn't fail the job: it's quarantined while this is open. ${context}`
        : `Failed, then passed on its retry: ${context}`
      const failed =
        test.error === undefined ? '' : `\n\n${quarantined ? 'It' : 'The first run'} failed with:\n\n\`\`\`\n${test.error}\n\`\`\``
      const issue = known.find((one) => one.title === title)
      if (issue?.state === 'OPEN') gh('issue', 'comment', String(issue.number), '--body', `${said}${failed}`)
      else if (issue)
        gh('issue', 'reopen', String(issue.number), '--comment', `${quarantined ? 'Failed again' : 'Flaky again'}.\n\n${said}${failed}`)
      else
        gh(
          'issue',
          'create',
          '--title',
          title,
          '--label',
          LABEL,
          '--body',
          `\`${test.file}\` › ${test.name} failed in CI, then passed when it ran again. The retry let the change through, but until the cause is found and fixed, this test says nothing reliable. Each comment is another time it happened; CI reopens this if it happens after it's closed.\n\nWhile this is open, the test is quarantined: it still runs in CI, but when it fails, on its retry too, it doesn't fail the job, and the failure is said here. Close this from the pull request that fixes it, and it fails CI again.\n\n${said}${failed}`,
        )
    }
  } catch (error) {
    // A pull request from a fork can't file issues; the warnings on its run still say what was flaky or quarantined.
    process.stdout.write(`::warning title=Flaky tests::Couldn't file the flaky tests as issues: ${String(error).split('\n')[0]}\n`)
  }
}
