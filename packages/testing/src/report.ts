/*
 * Files what a CI job found flaky (the lines the reporters wrote to FLAKY_REPORT) as GitHub issues labelled `flaky`,
 * one per test: a new issue for a test not seen before, a comment on its issue for one that was, reopening it if it
 * was closed. Each comment says where it happened: the platform, the job, and the pull request, merge queue or main
 * it ran for. Run by .github/actions/flaky after a job's tests, whether they passed or not; it never fails the job.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

import type { Flaky } from './flaky'

const LABEL = 'flaky'

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

const report = process.env.FLAKY_REPORT
if (report !== undefined && existsSync(report)) {
  try {
    const lines = readFileSync(report, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
    const tests = new Map(lines.map((line) => JSON.parse(line) as Flaky).map((test) => [`${test.file} › ${test.name}`, test]))
    const run = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    const said = `Failed, then passed on its retry: ${process.env.RUNNER_OS ?? 'CI'}, job ${process.env.GITHUB_JOB ?? '?'}, ${where()}.\n\n${run}`
    gh('label', 'create', LABEL, '--color', 'D93F0B', '--description', 'A test that failed, then passed when CI ran it again', '--force')
    const known = JSON.parse(
      gh('issue', 'list', '--label', LABEL, '--state', 'all', '--limit', '1000', '--json', 'number,title,state'),
    ) as ReadonlyArray<{
      number: number
      title: string
      state: 'OPEN' | 'CLOSED'
    }>
    for (const [key, test] of tests) {
      const title = `Flaky: ${key}`.slice(0, 250)
      const issue = known.find((one) => one.title === title)
      if (issue?.state === 'OPEN') gh('issue', 'comment', String(issue.number), '--body', said)
      else if (issue) gh('issue', 'reopen', String(issue.number), '--comment', `Flaky again.\n\n${said}`)
      else
        gh(
          'issue',
          'create',
          '--title',
          title,
          '--label',
          LABEL,
          '--body',
          `\`${test.file}\` › ${test.name} failed in CI, then passed when it ran again. The retry let the change through, but until the cause is found and fixed, this test says nothing reliable. Each comment is another time it happened; CI reopens this if it happens after it's closed.\n\n${said}`,
        )
    }
  } catch (error) {
    // A pull request from a fork can't file issues; the warnings on its run still say what was flaky.
    process.stdout.write(`::warning title=Flaky tests::Couldn't file the flaky tests as issues: ${String(error).split('\n')[0]}\n`)
  }
}
