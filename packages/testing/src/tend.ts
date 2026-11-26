/*
 * Tends the open quarantines (quarantine.ts), once a night (nightly.yml), with git's whole history at hand. For each
 * open issue that quarantines a test it records the test's owner on the issue, and labels the issue `broken` once its
 * quarantine has lapsed, by its age or by the test failing on its retry twice in a day, and says so to the owner.
 *
 * The owner is who last changed what the test covers: the last commit, by git, to the test's file or the source it
 * imports (select.ts's import graph; not the tests' shared support or @althar/testing, which every test imports). A squash merge's subject
 * names its pull request (`… (#1219)`), and a `Claude-Session` trailer the session that wrote it; the pull request's
 * author is asked of GitHub. The owner goes in the issue's body, which quarantine.ts reads for the jobs' summaries.
 *
 * `bun tend.ts`, with GH_REPO and GH_TOKEN, from the repository's root.
 */
import { execFileSync } from 'node:child_process'

import { BROKEN, CI, DAY, day, firstLine, GRACE_ENDS, LANDED, lapsesAt, listed, ownerIn, standing, testOf } from './quarantine'
import { graph, repository as checkout } from './select'

/** A comment on an issue: when, by whom, and how it starts. */
export interface Said {
  readonly at: string
  readonly by: string
  readonly body: string
}

/**
 * Whether a test failed on its retry twice within a day, by its issue's comments, which report.ts writes for each time
 * a quarantined test does: then it's broken, not flaky. What happened before owners and ends landed doesn't count.
 */
export const failedTwice = (comments: ReadonlyArray<Said>) => {
  const times = comments
    .filter((comment) => CI.test(comment.by) && /^(?:Failed, on its retry too|Failed again)\b/.test(comment.body))
    .map((comment) => Date.parse(comment.at))
    .filter((at) => at >= LANDED)
    .sort((a, b) => a - b)
  return times.some((at, index) => index > 0 && at - (times[index - 1] ?? -Infinity) <= DAY)
}

/** Who owns a test: the last commit to what it covers, its pull request and session, and the file it changed. */
export interface Owner {
  readonly commit: string
  readonly date: string
  readonly subject: string
  readonly pull?: number | undefined
  readonly session?: string | undefined
  readonly file?: string | undefined
}

/**
 * The owner of a test: the last commit, by git, to the test's file or a file it imports (`covers`), with the pull
 * request its subject names, as a squash merge's does (`… (#1219)`), and the session its `Claude-Session` trailer
 * names. `git` runs git and gives what it printed. Undefined where git has no commit to any of them.
 */
export const ownerOf = (covers: ReadonlyArray<string>, git: (...args: ReadonlyArray<string>) => string): Owner | undefined => {
  const [commit = '', date = '', subject = '', session = ''] = git(
    'log',
    '-1',
    '--format=%H%x1f%cs%x1f%s%x1f%(trailers:key=Claude-Session,valueonly,separator=%x20)',
    '--',
    ...covers,
  )
    .trim()
    .split('\x1f')
  if (commit === '') return undefined
  const file = git('log', '-1', '--format=', '--name-only', commit, '--', ...covers)
    .split('\n')
    .find((line) => line.trim() !== '')
  const pull = /\(#(\d+)\)$/.exec(subject)?.[1]
  return {
    commit,
    date,
    subject,
    pull: pull === undefined ? undefined : Number(pull),
    session: session.trim().split(/\s+/)[0] || undefined,
    file: file?.trim(),
  }
}

/** An owner as the issue says it: `#1219 (its subject) by its author, session …: the last to change … on …`. */
export const described = (owner: Owner, author?: string) => {
  const what =
    owner.pull === undefined
      ? `${owner.commit.slice(0, 8)} (${owner.subject})`
      : `#${owner.pull} (${owner.subject.replace(/ \(#\d+\)$/, '')})`
  return [
    what,
    author === undefined ? '' : ` by ${author}`,
    owner.session === undefined ? '' : `, session ${owner.session}`,
    `: the last to change ${owner.file === undefined ? 'what it covers' : `\`${owner.file}\``}, on ${owner.date}`,
  ].join('')
}

/** What a test imports that is no test's subject: the tests' and specs' support, fixtures, and @althar/testing. */
const SUPPORT = /\/(?:tests|e2e)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|^packages\/testing\//

/** Tends each open quarantine of `repository`, as the file's comment says. */
const tend = (repository: string) => {
  const gh = (...args: ReadonlyArray<string>) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const git = (...args: ReadonlyArray<string>) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (git('rev-parse', '--is-shallow-repository').trim() === 'true')
    throw new Error('git has a shallow history here: owners need all of it')
  const known = graph(checkout())
  const imports = new Map<string, Array<string>>()
  for (const [target, importers] of known.importers)
    for (const importer of importers) imports.set(importer, [...(imports.get(importer) ?? []), target])
  const at = Date.now()
  gh(
    'label',
    'create',
    BROKEN,
    '--color',
    'B60205',
    '--description',
    'A flaky test whose quarantine lapsed: skipped in CI but at night',
    '--force',
  )
  for (const { body, ...issue } of listed(repository)) {
    if (standing(issue, at) === undefined) continue
    const { file } = testOf(issue.title)
    // What it covers: its file and the source it imports, not the tests' shared support, which every test of a package
    // imports, or @althar/testing's.
    const covers = [file, ...(imports.get(file) ?? []).filter((one) => !SUPPORT.test(one))].filter((one) => known.files.has(one))
    let recorded = ownerIn(body)
    const found = covers.length === 0 ? undefined : ownerOf(covers, git)
    let author: string | undefined
    try {
      author =
        found?.pull === undefined
          ? undefined
          : gh('api', `repos/${repository}/pulls/${found.pull}`, '--jq', '.user.login').trim() || undefined
    } catch {
      author = undefined
    }
    if (recorded === undefined && found !== undefined) {
      recorded = described(found, author)
      gh('issue', 'edit', String(issue.number), '--body', `${body ?? ''}\n\n**Owner:** ${recorded} <!-- owner -->`)
    }
    if (issue.labels.includes(BROKEN)) continue
    const comments = gh(
      'api',
      '--paginate',
      `repos/${repository}/issues/${issue.number}/comments?since=${new Date(LANDED).toISOString()}&per_page=100`,
      '--jq',
      '.[] | {at: .created_at, by: .user.login, body: .body[0:40]}',
    )
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as Said)
    const twice = failedTwice(comments)
    if (!twice && at < lapsesAt(issue)) continue
    const why = twice
      ? 'It failed on its retry twice in a day: broken, not flaky.'
      : `It has been quarantined since ${day(Date.parse(issue.opened))}, and a quarantine lasts a week${Date.parse(issue.opened) < LANDED ? ` (one open before quarantines had an end lasted until ${day(GRACE_ENDS)})` : ''}.`
    const owner =
      recorded === undefined ? '' : `\n\nOwner: ${found !== undefined && author !== undefined ? described(found, `@${author}`) : recorded}.`
    gh('issue', 'edit', String(issue.number), '--add-label', BROKEN)
    gh(
      'issue',
      'comment',
      String(issue.number),
      '--body',
      `${why} Its quarantine has lapsed: from now on the test is skipped on pull requests, in the merge queue and after merge, and listed on every job's summary there; it still runs every night, where it gates. Fix it, or delete it, and close this from that pull request.${owner}`,
    )
  }
}

if ((process.argv[1] ?? '').replaceAll('\\', '/').endsWith('/tend.ts'))
  try {
    tend(process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY ?? '')
  } catch (error) {
    process.stdout.write(`::error title=Quarantine::Couldn't tend the quarantines: ${firstLine(error)}\n`)
    process.exitCode = 1
  }
