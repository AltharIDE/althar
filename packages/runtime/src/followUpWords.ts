import { Option, Schema } from 'effect'

import { titleWords } from './pullRequestWords'

/*
 * What a pull request that follows another says of itself. A next pull
 * request, after the last merged or closed (ADR-034), is named by the one it
 * follows, `After #763:`, and then says what it does: the lead's own words
 * with its fix, else its fix's commit, else the finding it answers. Its
 * description is the lead's where it wrote one; where it wrote none, the
 * finding and the commits, so it never opens with nothing.
 */

/** A finding of a review after a merge, as its reviewer reported it and the follow-up answers it. */
export const Answers = Schema.Struct({
  severity: Schema.String,
  file: Schema.NullOr(Schema.String),
  line: Schema.NullOr(Schema.Number),
  claim: Schema.String,
  title: Schema.optional(Schema.NullOr(Schema.String)),
})
export type Answers = typeof Answers.Type

const decodeAnswers = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Answers)))

/** The findings a review after a merge kept, as JSON: none where it kept none, or nothing readable. */
export const answersOf = (json: string | null | undefined): ReadonlyArray<Answers> =>
  json === null || json === undefined ? [] : Option.getOrElse(decodeAnswers(json), (): ReadonlyArray<Answers> => [])

/** A commit of the follow-up: its subject, and what its message says below it. */
export interface FixCommit {
  readonly subject: string
  readonly body: string
}

/** The first sentence of a finding's claim, for a title where its reviewer gave none. */
const firstSentence = (text: string) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  const end = flat.search(/[.!?](?:\s|$)/)
  return end === -1 ? flat : flat.slice(0, end)
}

/**
 * The words for a follow-up's title, before `After #763:`: the lead's, else
 * its first commit's subject, else the first finding's title or the start of
 * what it claims. Null where none says anything. Cut at a word where it is
 * longer than `limit`.
 */
export const followUpWords = (
  input: {
    readonly written?: string | null | undefined
    readonly commits: ReadonlyArray<FixCommit>
    readonly findings: ReadonlyArray<Answers>
  },
  agents: ReadonlyArray<string>,
  key: string | null,
  limit: number,
): string | null => {
  const [commit] = input.commits
  const [finding] = input.findings
  const candidates = [
    input.written,
    commit?.subject,
    finding === undefined ? null : finding.title == null || finding.title.trim() === '' ? firstSentence(finding.claim) : finding.title,
  ]
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue
    const words = titleWords(candidate, agents, key)
    if (words === '') continue
    if (words.length <= limit) return words
    const cut = words.slice(0, limit - 1)
    const at = cut.lastIndexOf(' ')
    return `${(at > limit / 2 ? cut.slice(0, at) : cut).trimEnd()}…`
  }
  return null
}

const where = (finding: Answers) =>
  finding.file === null ? '' : ` (\`${finding.file}${finding.line === null ? '' : `:${finding.line}`}\`)`

const flat = (text: string) => text.replace(/\s+/g, ' ').trim()

/**
 * A follow-up's description where its lead wrote none: why (the finding it
 * answers, naming the pull request it follows), and what changed (its
 * commits), in plain prose. The pull request it follows is named as its host
 * does (`#763`), which the host links.
 */
export const followUpBody = (input: {
  /** The pull request it follows, as its host names it: `#763`. */
  readonly follows: string
  /** How the pull request it follows ended: merged, or closed without merging. */
  readonly state?: 'merged' | 'closed'
  readonly findings: ReadonlyArray<Answers>
  readonly commits: ReadonlyArray<FixCommit>
}): string => {
  const parts: Array<string> = []
  const { findings, commits } = input
  const ended = input.state === 'closed' ? 'was closed without merging' : 'merged'
  if (findings.length === 0) parts.push(`Follows ${input.follows}, which ${ended}, with more work on the same task.`)
  else {
    const lines = findings.map((finding) => {
      const title = finding.title == null || flat(finding.title) === '' ? '' : `${flat(finding.title)}: `
      return `- ${title}${flat(finding.claim)}${where(finding)}`
    })
    parts.push(
      `The review after ${input.follows} ${input.state === 'closed' ? 'closed' : 'merged'} found ${findings.length === 1 ? 'a problem' : `${findings.length} problems`} in it. This answers ${findings.length === 1 ? 'it' : 'them'}:\n\n${lines.join('\n')}`,
    )
  }
  if (commits.length > 0) {
    const lines = commits.map((commit) => `- ${flat(commit.subject)}${flat(commit.body) === '' ? '' : `: ${flat(commit.body)}`}`)
    parts.push(`${commits.length === 1 ? 'What changed:' : 'What changed, commit by commit:'}\n\n${lines.join('\n')}`)
  }
  return parts.join('\n\n')
}
