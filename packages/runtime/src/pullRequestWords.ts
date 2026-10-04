import type { Check, Comment, Review } from '@althar/connectors'

/*
 * What Althar writes about a task's pull request: its description, made
 * from what the steps reported, and what it tells the lead of what people
 * said on it and how its checks went, in the host's own words (`PR #12`,
 * `MR !4`).
 */

/** A head's checks, summed up. */
export interface ChecksSum {
  readonly sha: string
  readonly outcome: 'none' | 'running' | 'passed' | 'failed'
  readonly passed: number
  readonly failed: number
  readonly running: number
  readonly total: number
  readonly failing: ReadonlyArray<string>
  /** Each check, by name, as it stands. */
  readonly list: ReadonlyArray<{ readonly name: string; readonly state: Check['state']; readonly summary: string | null }>
}

/** Sums up a head's checks: passed, failed, still running, and how they stand overall. */
export const checksOf = (sha: string, checks: ReadonlyArray<Check>): ChecksSum => {
  const failed = checks.filter((check) => check.state === 'failed')
  const running = checks.filter((check) => check.state === 'queued' || check.state === 'running').length
  const passed = checks.filter((check) => check.state === 'passed').length
  return {
    sha,
    outcome: checks.length === 0 ? 'none' : running > 0 ? 'running' : failed.length > 0 ? 'failed' : 'passed',
    passed,
    failed: failed.length,
    running,
    total: checks.length,
    failing: failed.map((check) => check.name),
    list: checks.map((check) => ({ name: check.name, state: check.state, summary: check.summary })),
  }
}

/** The pull request's name, as people say it: `PR #12`, `MR !4`. */
export const nameOf = (change: { readonly number: number; readonly words: { readonly short: string; readonly prefix: string } }) =>
  `${change.words.short} ${change.words.prefix}${change.number}`

/** Where a comment is: a line of a file, or the conversation. */
export const whereOf = (comment: Pick<Comment, 'path' | 'line'>) =>
  comment.path === null ? '' : ` on ${comment.path}${comment.line === null ? '' : `:${comment.line}`}`

export const quoted = (text: string) =>
  text
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')

/** The end of a check's log, fenced. */
export const logOf = (name: string, log: string) => `The end of ${name}'s log:\n\`\`\`\n${log}\n\`\`\``

/** A finding, as the description lists it, with what became of it. */
export interface FindingLine {
  readonly severity: string
  readonly file: string | null
  readonly line: number | null
  readonly claim: string
  readonly state: string
  readonly response: string | null
}

/** The pull request's description: the lead's summary, how review went, the issue it is for, and who opened it. */
export const bodyOf = (input: {
  readonly lead: string | null
  readonly review: { readonly rounds: number; readonly verdict: string | null } | null
  readonly findings: ReadonlyArray<FindingLine>
  readonly issue: { readonly key: string; readonly url: string; readonly sameHost: boolean } | null
}) => {
  const parts: Array<string> = []
  if (input.lead !== null && input.lead !== '') parts.push(input.lead)
  if (input.review !== null && input.review.rounds > 0) {
    const rounds = input.review.rounds === 1 ? 'one round' : `${input.review.rounds} rounds`
    parts.push(`### Review\n\n${input.review.verdict === 'pass' ? `Passed after ${rounds} of review.` : `Reviewed in ${rounds}.`}`)
    if (input.findings.length > 0)
      parts.push(
        input.findings
          .map((finding) => {
            const where = finding.file === null ? '' : ` \`${finding.file}${finding.line === null ? '' : `:${finding.line}`}\``
            const outcome = finding.state === 'fixed' ? 'Fixed' : finding.state === 'set_aside' ? 'Set aside' : 'Open'
            const reason = finding.state === 'set_aside' && finding.response !== null ? ` (${finding.response})` : ''
            return `- ${outcome}: ${finding.severity}${where}: ${finding.claim}${reason}`
          })
          .join('\n'),
      )
  }
  if (input.issue !== null)
    parts.push(input.issue.sameHost ? `Issue: ${input.issue.key}` : `Issue: [${input.issue.key}](${input.issue.url})`)
  parts.push('<sub>Opened by Althar.</sub>')
  return parts.join('\n\n')
}

/** How a change stands, in a word. */
export const standing = (change: { readonly state: string; readonly draft: boolean }) =>
  change.state === 'open' ? (change.draft ? 'draft' : 'open') : change.state

/** A head's checks, in a line. */
export const checksLine = (sum: ChecksSum) =>
  sum.total === 0
    ? 'No checks have run.'
    : `Checks: ${sum.passed} passed, ${sum.failed} failed, ${sum.running} running${sum.failing.length === 0 ? '' : ` (failed: ${sum.failing.join(', ')})`}.`

/** A comment, as a reading of the pull request lists it: who (or, for Althar's own, `who`), where, its thread, and what. */
export const commentLine = (comment: Comment, who?: string) =>
  `- ${who ?? comment.author.login}${whereOf(comment)}${comment.threadId === null ? '' : ` (thread ${comment.threadId})`}${comment.author.bot ? ' [bot]' : ''}:\n${quoted(unsigned(comment.body))}`

const verdictWords = (verdict: Review['verdict']) =>
  verdict === 'approved' ? 'approved' : verdict === 'changes_requested' ? 'changes requested' : 'commented'

/** A review, as a reading of the pull request lists it. */
export const reviewLine = (review: Review) =>
  `- ${review.author.login} reviewed: ${verdictWords(review.verdict)}${review.body === '' ? '' : `\n${quoted(review.body)}`}`

/** What the lead is told of a comment on its pull request. */
export const commentForLead = (comment: Comment, name: string) =>
  `${comment.author.login} commented on ${name}${whereOf(comment)}${comment.threadId === null ? '' : ` (thread ${comment.threadId})`}:\n${quoted(comment.body)}`

/** What the lead is told of a review that asks something of it. */
export const reviewForLead = (review: Review, name: string) =>
  `${review.author.login} reviewed ${name}: ${verdictWords(review.verdict)}.${review.body === '' ? '' : `\n${quoted(review.body)}`}`

/** What the lead is told when its checks fail: which, the ends of their logs, and what to do. */
export const checksForLead = (sum: ChecksSum, name: string, logs: ReadonlyArray<string>) =>
  [
    `Checks failed on ${name}: ${sum.failing.join(', ')}.`,
    ...logs,
    'Fix what broke and commit it: the person looks at it and pushes it. Or, if it isn’t the task’s to fix, say why.',
  ].join('\n\n')

/** What the lead is told of what it can't read: people outside the repository, whom the person passes on. */
export const outsidersLine = (count: number) =>
  `${count === 1 ? 'One comment' : `${count} comments`} from people who can't write to the repository ${count === 1 ? 'is' : 'are'} left out. On a public repository anyone can comment; the person reads them and passes on what matters.`

const SIGNATURE = '<sub>From Althar'

/**
 * A reply as posted: the lead's words, then a line saying it came from
 * Althar and which agent wrote it. It goes up under the person's own
 * account, so without the line colleagues would take it for theirs.
 */
export const signed = (body: string, by: string | null) => `${body.trimEnd()}\n\n${SIGNATURE}${by === null ? '' : `, by ${by}`}.</sub>`

/** The signature replies carried while Althar was called Charrette, until October 2026. */
const FORMER_SIGNATURE = '<sub>From Charrette'

/** Whether a comment carries Althar's signature, or the one it signed with as Charrette. */
export const fromAlthar = (body: string) => {
  const last = body.trimEnd().split('\n').at(-1) ?? ''
  return last.startsWith(SIGNATURE) || last.startsWith(FORMER_SIGNATURE)
}

/** A comment without Althar's signature, for reading back. */
export const unsigned = (body: string) => (fromAlthar(body) ? body.trimEnd().split('\n').slice(0, -1).join('\n').trimEnd() : body)

/** Files, named in code, the first few of them and how many more. */
export const filesLine = (paths: ReadonlyArray<string>, shown = 8) => {
  const named = paths.slice(0, shown).map((path) => `\`${path}\``)
  return `${named.join(', ')}${paths.length > shown ? ` and ${paths.length - shown} more` : ''}`
}

/** How the lead answers what people said. */
export const answerHint =
  'Answer on the pull request with reply_on_pull_request (in a thread, by its id), or change the code and commit it, for the person to look at and push. If it needs the person, say so.'
