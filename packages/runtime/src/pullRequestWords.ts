import type { Check, Comment, Review } from '@althar/connectors'

import { keepsTemplate, placeSummary, untick } from './conventions'

/*
 * What Althar writes about a task's pull request: its description, as the
 * lead wrote it for a reviewer, and what it tells the lead of what people
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

/**
 * How the lead writes the pull request's description: for whoever reviews
 * it on the code host, who hasn't seen the task in Althar. The step's
 * summary and what the task built are the person's, in Althar; this is the
 * reviewer's.
 */
export const DESCRIPTION_SHAPE =
  "Write it as a thoughtful teammate would for a colleague reviewing the pull request, who hasn't seen your work: short, plain prose, in roughly this shape. Why: the problem or request behind it, and the issue it's for, if any. What changed: the change as a reader should understand it, its behaviour and design, not a list of files. How you approached it: the decisions and trade-offs worth knowing, alternatives you turned down, anything surprising. How it was checked: a sentence or a few bullets on what you tried by hand or saw working, and anything you couldn't check that a reviewer should look at; not the tests you wrote, which are in the diff. Leave out a part with nothing to say, and don't pad: headings only where they help a longer one. Never put in it the review, its rounds or findings, a list of evidence, commands with their exit codes and output, the names of agents or models, or Althar's words for its work (step, round, settle, lead, evidence). Leave screenshots out: they can't go up with the pull request. Althar adds the issue's link and a line saying it opened the pull request, so leave those out too."

/** Something that has something to say: not null, nor blank. */
const said = (text: string | null | undefined) => (text === undefined || text === null || text.trim() === '' ? null : text.trim())

/**
 * The pull request's description: the one the lead wrote for it, then the
 * issue it is for, and who opened it, unless the person turned Althar's
 * credit off. Where the repository has a template, the lead's description
 * is taken where it keeps the template, with every box unticked for the
 * person. Where the lead wrote none, as an older task's didn't, or one that
 * left the template, it is what the task built, as the lead last said it
 * (else its last step's summary): in the template's place for a summary,
 * or under a heading of its own below it.
 */
export const bodyOf = (input: {
  /** What the task built, as the lead last said it: the description where the lead wrote none. */
  readonly built?: string | null
  /** The lead's last step summary, where it never said what the task built. */
  readonly lead: string | null
  readonly issue: { readonly key: string; readonly url: string; readonly sameHost: boolean } | null
  /** The repository's template, if it has one. */
  readonly template?: string | null
  /** The description the lead wrote for the pull request: in the template, where there is one. */
  readonly written?: string | null
  /** Althar is co-author of what it sends, so it says it opened the pull request. On where not said. */
  readonly credit?: boolean
  /** The automation whose run opened it, which it is signed with whatever the credit: nobody watched it being made. */
  readonly automation?: string | null
}) => {
  const parts: Array<string> = []
  const plain = said(input.built) ?? said(input.lead)
  const template = input.template ?? null
  const written = said(input.written)
  if (template === null) {
    const text = written ?? plain
    if (text !== null) parts.push(text)
  } else if (written !== null && keepsTemplate(template, written)) {
    parts.push(untick(written).trim())
  } else {
    const placed = plain === null ? null : placeSummary(template, plain)
    parts.push(untick(placed ?? template).trim())
    if (placed === null && plain !== null) parts.push(`### Summary\n\n${plain}`)
  }
  if (input.issue !== null)
    parts.push(input.issue.sameHost ? `Issue: ${input.issue.key}` : `Issue: [${input.issue.key}](${input.issue.url})`)
  if (input.automation !== undefined && input.automation !== null)
    parts.push(`<sub>Opened by [Althar](https://github.com/AltharIDE/althar)’s ${nameInLine(input.automation)}.</sub>`)
  else if (input.credit !== false) parts.push('<sub>Opened by [Althar](https://github.com/AltharIDE/althar).</sub>')
  return parts.join('\n\n')
}

/** A repository whose pull request the lead hasn't described yet, with its template if it has one. */
export interface Undescribed {
  readonly name: string
  readonly template: { readonly path: string; readonly text: string } | null
}

/**
 * What the lead is told when it finishes without a description for the
 * task's pull request: in the repository's template where it has one, as
 * a teammate fills it, else in the shape a reader wants.
 */
export const descriptionAsk = (undescribed: ReadonlyArray<Undescribed>, several: boolean) => {
  const templated = undescribed.filter((one) => one.template !== null)
  const named = (one: Undescribed) => (several ? `${one.name}'s template` : 'The template')
  return [
    `Write the description of the task's pull request before you finish${several ? `, one for each of ${undescribed.map((one) => one.name).join(', ')}` : ''}. It is for whoever reviews it on the code host, not for the person in Althar, who has your summary. ${DESCRIPTION_SHAPE}`,
    ...(templated.length === 0
      ? []
      : [
          `${several ? `Where a repository has a pull request template, write it in that` : 'The repository has a pull request template, so write it in that'}, as a teammate would: keep every heading and checklist, fill each section in that spirit, and leave every box unticked for the person.`,
        ]),
    `Then call finish_step again with your summary and the description in \`descriptions\`${several ? ', each with its repository' : ''}.`,
    ...templated.map(
      (one) => `${named(one)}, ${one.template?.path ?? ''}:\n~~~~~markdown\n${(one.template?.text ?? '').slice(0, 6000)}\n~~~~~`,
    ),
  ].join('\n\n')
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
    'Fix what broke and commit it, then ask the person to push it with push_to_pull_request. Or, if it isn’t the task’s to fix, say why. read_check_log reads the whole of a check’s log, where its end doesn’t show the cause.',
  ].join('\n\n')

/**
 * What the lead is told when the checks fail on its open pull request,
 * whether or not the person has looked (ADR-040, ADR-068): the checks are its
 * to see through, it decides what broke them, a fix goes up as it pushes, and
 * how many tries are left before the change is the person's.
 */
export const checksForLeadAlone = (sum: ChecksSum, name: string, logs: ReadonlyArray<string>, left: number, base: string) =>
  [
    `Checks failed on ${name}: ${sum.failing.join(', ')}.`,
    ...logs,
    [
      'Their checks are yours to see through, without the person: work out what broke them, then',
      '- where this change broke them, fix it and commit it, then call push_to_pull_request, which pushes a fix for failing checks at once, and the checks run again;',
      '- where one failed by chance (a flaky test, a runner that went away), run it again with rerun_check, once;',
      `- where it is broken on ${base}, or fails for a reason that has nothing to do with this change, as when the same check fails the same way on ${base}'s latest commit (read_default_branch_checks shows its checks): change nothing on the branch to work around it, and call hand_checks_to_person with one short line saying so, such as "Fails on ${base} too: \`test\` times out in limit.test.ts", and what would fix it;`,
      '- where it needs the person to decide, call hand_checks_to_person with what they are to decide.',
    ].join('\n'),
    `${left <= 1 ? 'This is the last try before the change goes to the person.' : `You have ${left} tries before the change goes to the person.`} read_check_log reads the whole of a check's log, where its end doesn't show the cause.`,
  ].join('\n\n')

/**
 * What the lead is told when the checks fail again after its last try
 * (ADR-068): the change is the person's, and it says what it tried and why
 * they still fail, rather than trying again.
 */
export const checksSpentForLead = (sum: ChecksSum, name: string, logs: ReadonlyArray<string>, tries: number) =>
  [
    `Checks failed on ${name} again: ${sum.failing.join(', ')}.`,
    ...logs,
    `That was the last of your ${tries} tries, so the change goes to the person now. Don't change the branch: call hand_checks_to_person with what you tried and why the checks still fail, in a line or two.`,
  ].join('\n\n')

/** Why the checks that fail on a change are the person's, as its card says, where its lead spent its tries and said nothing more. */
export const spentLine = (failing: ReadonlyArray<string>, tries: number) =>
  `${failing.length === 0 ? 'Checks' : failing.join(', ')} still ${failing.length === 1 ? 'fails' : 'fail'} after ${tries} fixes by the lead.`

/** The checks on the default branch's latest commit, as `read_default_branch_checks` tells the lead (ADR-068). */
export const baseChecksForLead = (sum: ChecksSum, base: string, logs: ReadonlyArray<string>) =>
  [
    `The checks on ${base}'s latest commit, ${sum.sha.slice(0, 7)}: ${
      sum.total === 0
        ? `none have run. Some repositories run their checks on pull requests only, so this says nothing of whether ${base} is broken.`
        : `${sum.passed} passed, ${sum.failed} failed, ${sum.running} running.`
    }`,
    ...(sum.total === 0
      ? []
      : [sum.list.map((check) => `- ${check.name}: ${check.state}${check.summary === null ? '' : ` (${check.summary})`}`).join('\n')]),
    ...logs,
  ].join('\n\n')

/** What the lead is told of what it can't read: people outside the repository, whom the person passes on. */
export const outsidersLine = (count: number) =>
  `${count === 1 ? 'One comment' : `${count} comments`} from people who can't write to the repository ${count === 1 ? 'is' : 'are'} left out. On a public repository anyone can comment; the person reads them and passes on what matters.`

const SIGNATURE = '<sub>From Althar'

/** An automation's name as it reads after "Althar's": its first letter small, unless its first word is in capitals. */
export const nameInLine = (name: string) => (/^\p{Lu}\p{Ll}/u.test(name) ? `${name.charAt(0).toLowerCase()}${name.slice(1)}` : name)

/**
 * A reply as posted: the lead's words, then a line saying it came from
 * Althar and which agent wrote it, and the automation whose run it was,
 * where one was: "From Althar's morning review, by Claude Code". It goes up
 * under the person's own account, so without the line colleagues would take
 * it for theirs.
 */
export const signed = (body: string, by: string | null, automation: string | null = null) =>
  `${body.trimEnd()}\n\n${SIGNATURE}${automation === null ? '' : `’s ${nameInLine(automation)}`}${by === null ? '' : `, by ${by}`}.</sub>`

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
