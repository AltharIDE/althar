import type { Check, Comment, Review } from '@althar/connectors'

import { keepsTemplate, placeSummary, untick } from './conventions'

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

/** A piece of evidence, as the description lists it: as the step result keeps it. */
export interface EvidenceLine {
  readonly kind: string
  readonly caption: string
  readonly picture: unknown
  readonly command: string | null
  readonly exit: number | null
  readonly text: string | null
}

/** How many lines of what a command printed, or a text, the description quotes: its end. */
export const EVIDENCE_LINES = 12

const EVIDENCE_WORDS: Readonly<Record<string, string>> = {
  screenshot: 'Screenshot',
  recording: 'Recording',
  command: 'Command',
  test_run: 'Test run',
  response: 'Response',
  log: 'Log',
  note: 'Note',
}

/** The end of a text, fenced and indented under its list item; a fence its text can't close. */
const quotedEnd = (text: string) => {
  const lines = text.replace(/\n+$/, '').split('\n')
  const end = lines.slice(-EVIDENCE_LINES)
  const fence = '~'.repeat(Math.max(4, ...end.map((line) => (/^\s*(~+)/.exec(line)?.[1]?.length ?? 0) + 1)))
  return [`${lines.length > end.length ? '  …\n' : ''}  ${fence}`, ...end.map((line) => `  ${line}`), `  ${fence}`].join('\n')
}

/**
 * What the lead showed, as the description says it: each piece with its
 * caption; a command with what it ran, its exit code and the end of what it
 * printed. Pictures aren't hosted with the pull request, so a screenshot is
 * named, and said to be in Althar. Then what it couldn't show.
 */
export const evidenceText = (evidence: ReadonlyArray<EvidenceLine>, unverified: ReadonlyArray<string>) => {
  const parts: Array<string> = []
  if (evidence.length > 0) {
    const lines = evidence.map((piece) => {
      const word = EVIDENCE_WORDS[piece.kind] ?? 'Evidence'
      const ran =
        piece.command === null ? '' : `: \`${piece.command.replace(/`/g, "'")}\`${piece.exit === null ? '' : `, exit ${piece.exit}`}`
      const head = `- ${word}: ${piece.caption}${ran}`
      if (piece.picture !== null && piece.picture !== undefined) return head
      return piece.text === null || piece.text.trim() === '' ? head : `${head}\n${quotedEnd(piece.text)}`
    })
    const pictured = evidence.some((piece) => piece.picture !== null && piece.picture !== undefined)
    parts.push(['### Evidence', lines.join('\n'), ...(pictured ? ['Screenshots are in Althar, on the task.'] : [])].join('\n\n'))
  }
  if (unverified.length > 0) parts.push(`### Unverified\n\n${unverified.map((line) => `- ${line}`).join('\n')}`)
  return parts.join('\n\n')
}

/**
 * The pull request's description: what the task built, as the lead last
 * said it (else its last step's summary), what it showed of its change working, how review went, the issue it is for, and who opened
 * it, unless the person turned Althar's credit off. Where the repository has
 * a template, it's written in that: the lead's own description where it keeps the
 * template, with every box unticked, under what the task built, which may be
 * newer; else the template with that in its place for a summary, or under a
 * heading of its own below.
 */
export const bodyOf = (input: {
  /** What the task built, as the lead last said it: the description leads with it, template or not. */
  readonly built?: string | null
  /** The lead's last step summary, where it never said what the task built. */
  readonly lead: string | null
  readonly review: { readonly rounds: number; readonly verdict: string | null } | null
  readonly findings: ReadonlyArray<FindingLine>
  /** What the lead showed of its change working, and what it couldn't. */
  readonly evidence?: ReadonlyArray<EvidenceLine>
  readonly unverified?: ReadonlyArray<string>
  readonly issue: { readonly key: string; readonly url: string; readonly sameHost: boolean } | null
  /** The repository's template, and the description the lead wrote in it. */
  readonly template?: string | null
  readonly written?: string | null
  /** Althar is co-author of what it sends, so it says it opened the pull request. On where not said. */
  readonly credit?: boolean
}) => {
  const parts: Array<string> = []
  const built = input.built !== undefined && input.built !== null && input.built !== '' ? input.built : null
  const lead = built ?? (input.lead !== null && input.lead !== '' ? input.lead : null)
  const template = input.template ?? null
  const written = input.written ?? null
  if (template === null) {
    if (lead !== null) parts.push(lead)
  } else if (written !== null && keepsTemplate(template, written)) {
    if (built !== null) parts.push(built)
    parts.push(untick(written).trim())
  } else {
    const placed = lead === null ? null : placeSummary(template, lead)
    parts.push(untick(placed ?? template).trim())
    if (placed === null && lead !== null) parts.push(`### Summary\n\n${lead}`)
  }
  const shown = evidenceText(input.evidence ?? [], input.unverified ?? [])
  if (shown !== '') parts.push(shown)
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
  if (input.credit !== false) parts.push('<sub>Opened by [Althar](https://github.com/AltharIDE/althar).</sub>')
  return parts.join('\n\n')
}

/** What the lead is told when it finishes without a description in a repository's pull request template. */
export const templateAsk = (
  unwritten: ReadonlyArray<{ readonly name: string; readonly path: string; readonly text: string }>,
  several: boolean,
) =>
  [
    `The task's pull request is described in the repository's template, so write its description before you finish${several ? `, one for each of ${unwritten.map((template) => template.name).join(', ')}` : ''}. Write it as a teammate would: keep every heading and checklist, fill each section from what you did and how you checked it, and leave every box unticked for the person. Then call finish_step again with your summary and the description in \`descriptions\`${several ? ', each with its repository' : ''}.`,
    ...unwritten.map(
      (template) =>
        `${several ? `${template.name}'s template` : 'The template'}, ${template.path}:\n~~~~~markdown\n${template.text.slice(0, 6000)}\n~~~~~`,
    ),
  ].join('\n\n')

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
    'Fix what broke and commit it, then ask the person to push it with push_to_pull_request. Or, if it isn’t the task’s to fix, say why.',
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
  'Answer on the pull request with reply_on_pull_request (in a thread, by its id), or change the code, commit it, and ask the person to push it with push_to_pull_request. If it needs the person, say so.'
