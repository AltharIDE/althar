import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { git, gitOutcome } from './git'
import { timestamp } from './records'

/*
 * What a pull request Althar opens says of the review its change had before
 * it opened: a seal in its corner, naming the model that reviewed it, in how
 * many passes, at which commit, and the day; and at its end, folded, what
 * changed after review, each with its commits, and what the reviewer raised
 * that the lead kept, each with why. Never how many findings there were.
 *
 * The seal is an image the site draws from its address (packages/ui's seal,
 * apps/site's worker); sealUrl here writes the address it reads, and the
 * desktop's tests hold the two to one format. Only GitHub shows it: the
 * <picture> that picks its ink for a light or a dark page is GitHub's. The
 * section is plain Markdown and HTML that GitHub and GitLab both fold.
 *
 * The person turns both on or off in Settings, and picks the seal's look.
 */

export const SEAL_STYLES = ['ring', 'wax', 'colophon'] as const
export type SealStyle = (typeof SEAL_STYLES)[number]

/** Where the site draws seals. */
export const SEAL_ORIGIN = 'https://althar.ai'
/** How wide a seal shows in a description, in px. */
const SEAL_WIDTH = 150
/** The longest reviewer's name a seal sets; a longer one goes without a seal. */
const MODEL_MAX = 32

/** What the review of a pull request's change was, as its description tells it. */
export interface ReviewRecord {
  /** The model that reviewed it, as people know it: GPT-6.1 Sol. */
  readonly reviewer: string
  /** The model that led the work: Claude Opus 5.5. */
  readonly lead: string
  /** How many times the reviewer read the change. */
  readonly passes: number
  /** The commit the last pass read, as it was sent; null where no commit holds exactly what it read. */
  readonly sha: string | null
  /** The day the last pass ended, as YYYY-MM-DD. */
  readonly date: string
  /** What changed after review, in the lead's words, each with the commit the lead said made it, as it was sent. */
  readonly changed: ReadonlyArray<{ readonly what: string; readonly commits: ReadonlyArray<string> }>
  /** What the reviewer raised that the lead kept as it was, and why. */
  readonly kept: ReadonlyArray<{ readonly point: string; readonly why: string | null }>
}

/** How many passes, in words: 1 pass, 3 passes. */
export const passesOf = (passes: number) => `${passes} ${passes === 1 ? 'pass' : 'passes'}`

const short = (sha: string) => sha.slice(0, 7)

/** Words someone wrote, as a line of the description: on one line, no markup of their own, and not too long to read at a glance. */
export const lineOf = (text: string, max = 240) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  const cut =
    flat.length <= max ? flat : `${flat.slice(0, flat.lastIndexOf(' ', max - 1) > max / 2 ? flat.lastIndexOf(' ', max - 1) : max - 1)}…`
  return cut.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Whether a seal can set this reviewer's name: printable ASCII, and short. */
const sealable = (record: ReviewRecord) =>
  record.reviewer.length > 0 &&
  record.reviewer.length <= MODEL_MAX &&
  /^[\x20-\x7e]+$/.test(record.reviewer) &&
  record.sha !== null &&
  /^[0-9a-f]{7,}$/.test(record.sha)

/** The address the site draws a seal at (packages/ui's sealUrl writes the same). */
export const sealUrl = (style: SealStyle, record: ReviewRecord & { readonly sha: string }, ink: 'light' | 'dark', origin = SEAL_ORIGIN) => {
  const query = new URLSearchParams({ model: record.reviewer, sha: short(record.sha), passes: String(record.passes), date: record.date })
  if (ink === 'dark') query.set('ink', 'dark')
  return `${origin}/seal/${style}.svg?${query.toString()}`
}

/** What the seal says, for whoever can't see it, and the section's folded line. */
const reviewedLine = (record: ReviewRecord) => `Reviewed by ${record.reviewer} in ${passesOf(record.passes)}`

/**
 * The seal, at the head of the description, in its corner: its ink for a
 * light page, and for a dark one, as GitHub picks by the reader's theme.
 * Null where it can't be set.
 */
export const sealOf = (style: SealStyle, record: ReviewRecord, origin = SEAL_ORIGIN): string | null => {
  // A seal names the commit it passed: without one that holds what the last pass read, there is none.
  const sha = record.sha
  if (sha === null || !sealable(record) || record.passes < 1 || record.passes > 99) return null
  const alt = lineOf(`${reviewedLine(record)}, at ${short(sha)}`).replace(/"/g, '&quot;')
  return [
    '<picture>',
    `  <source media="(prefers-color-scheme: dark)" srcset="${sealUrl(style, { ...record, sha }, 'dark', origin)}">`,
    `  <img align="right" width="${SEAL_WIDTH}" alt="${alt}" src="${sealUrl(style, { ...record, sha }, 'light', origin)}">`,
    '</picture>',
  ].join('\n')
}

/** The review, folded at the description's end: what changed after it, what was kept, and who built and reviewed the change. */
export const detailsOf = (record: ReviewRecord) => {
  const at = record.sha === null ? '' : `, at <code>${short(record.sha)}</code>`
  const parts = [`<details>\n<summary>${lineOf(reviewedLine(record))}${at}</summary>`]
  if (record.changed.length > 0)
    parts.push(
      `**What changed after review**\n\n${record.changed
        .map((one) => `- ${lineOf(one.what)}${one.commits.length === 0 ? '' : ` ${one.commits.map(short).join(', ')}`}`)
        .join('\n')}`,
    )
  if (record.kept.length > 0)
    parts.push(
      `**Looked at and kept**\n\n${record.kept.map((one) => `- ${lineOf(one.point)}${one.why === null ? '' : ` — ${lineOf(one.why)}`}`).join('\n')}`,
    )
  parts.push(`<sub>Built by ${lineOf(record.lead)} · Reviewed by ${lineOf(record.reviewer)}</sub>\n</details>`)
  return parts.join('\n\n')
}

/* ---- the setting ------------------------------------------------------------------ */

const REVIEW_SEAL = 'review_seal'
const REVIEW_SEAL_STYLE = 'review_seal_style'

export interface ReviewSealSetting {
  /** Whether pull requests carry the seal and the review section. On unless the person turned it off. */
  readonly on: boolean
  readonly style: SealStyle
}

/** Whether pull requests say how their change was reviewed, and the seal's look. On, as a ring, keeping no rows. */
export const reviewSeal = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<{
    key: string
    value: string
  }>`SELECT key, value FROM settings WHERE key IN (${REVIEW_SEAL}, ${REVIEW_SEAL_STYLE})`
  const value = (key: string) => rows.find((row) => row.key === key)?.value
  const style = value(REVIEW_SEAL_STYLE)
  return {
    on: value(REVIEW_SEAL) !== 'off',
    style: SEAL_STYLES.includes(style as SealStyle) ? (style as SealStyle) : 'ring',
  } satisfies ReviewSealSetting
})

/** Keeps `value` for `key`, or keeps nothing, where it is the default. */
const keep = (key: string, value: string | null) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    if (value === null) return yield* sql`DELETE FROM settings WHERE key = ${key}`.pipe(Effect.asVoid)
    const at = yield* timestamp
    yield* sql`
      INSERT INTO settings ${sql.insert({ key, value, updatedAt: at })}
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  })

/** Turns the review on pull requests on, its default, or off. */
export const setReviewSeal = (on: boolean) => keep(REVIEW_SEAL, on ? null : 'off')

/** The seal's look; a ring is its default. */
export const setReviewSealStyle = (style: SealStyle) => keep(REVIEW_SEAL_STYLE, style === 'ring' ? null : style)

/* ---- the record ------------------------------------------------------------------- */

/** Names a session's model as people know it, from its agent and the model it was on. */
export type SessionNamer = (session: { readonly agentId: string; readonly model: string | null }) => string | null

/**
 * The review a run's change had, in one of its repositories, or null where
 * it had none: no review step, or one skipped before any pass ended. Its
 * commits are as they were sent: `sent` gives what crediting made of each
 * (credit.ts). `end` is the head the run ended on, before crediting.
 */
export const reviewRecordOf = (input: {
  readonly runId: string
  readonly workspaceId: string
  readonly cwd: string
  readonly end: string
  readonly named: SessionNamer
  readonly sent: (commits: ReadonlyArray<string>) => Effect.Effect<ReadonlyMap<string, string>>
}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    // Each pass: a review round whose reviewer said its verdict, the last attempt of each round, with what it read here.
    const attempts = yield* sql<{
      round: number
      endedAt: string | null
      agentId: string | null
      model: string | null
      snapshot: string | null
    }>`
      SELECT n.iteration AS round, a.ended_at, s.agent_id, s.model,
        (SELECT w.commit_sha FROM workspace_snapshots w WHERE w.node_attempt_id = a.id AND w.workspace_id = ${input.workspaceId} LIMIT 1) AS snapshot
      FROM workflow_executions e JOIN nodes n ON n.execution_id = e.id AND n.node_key = 'review'
      JOIN node_attempts a ON a.node_id = n.id LEFT JOIN provider_sessions s ON s.id = a.provider_session_id
      WHERE e.run_id = ${input.runId} AND a.state = 'succeeded' AND json_extract(a.output, '$.verdict') IS NOT NULL
      ORDER BY n.iteration, a.attempt_number`
    const passes = [...new Map(attempts.map((one) => [one.round, one])).values()]
    const last = passes.at(-1)
    if (last === undefined || last.agentId === null) return null
    const reviewer = input.named({ agentId: last.agentId, model: last.model })
    const [led] = yield* sql<{ agentId: string; model: string | null }>`
      SELECT s.agent_id, s.model FROM workflow_executions e JOIN nodes n ON n.execution_id = e.id AND n.node_key IN ('implement', 'settle')
      JOIN node_attempts a ON a.node_id = n.id JOIN provider_sessions s ON s.id = a.provider_session_id
      WHERE e.run_id = ${input.runId} ORDER BY a.admitted_at DESC LIMIT 1`
    const lead = led === undefined ? null : input.named(led)
    if (reviewer === null || lead === null) return null

    // Where each pass started: the head its copy was made on (reviewCopy.ts), which the lead's settling went on from.
    const starts = new Map<number, string | null>()
    for (const pass of passes)
      starts.set(
        pass.round,
        pass.snapshot === null ? null : yield* git(input.cwd, 'rev-parse', `${pass.snapshot}^`).pipe(Effect.orElseSucceed(() => null)),
      )
    const read = last.snapshot === null ? null : yield* reviewedCommit(input.cwd, last.snapshot, input.end)

    const findings = yield* sql<{
      round: number
      claim: string
      state: 'fixed' | 'set_aside'
      response: string | null
      fixedBy: string | null
    }>`
      SELECT n.iteration AS round, f.claim, f.state, f.response,
        (SELECT json_extract(r.payload, '$.commit') FROM record_events r
          WHERE r.aggregate_type = 'finding' AND r.aggregate_id = f.id AND r.type = 'finding.fixed' ORDER BY r.sequence DESC LIMIT 1) AS fixed_by
      FROM findings f JOIN node_attempts a ON a.id = f.review_attempt_id JOIN nodes n ON n.id = a.node_id
      JOIN workflow_executions e ON e.id = n.execution_id
      WHERE e.run_id = ${input.runId} AND f.state IN ('fixed', 'set_aside')
      ORDER BY n.iteration, f.created_at`

    /**
     * The commit the lead said fixed a finding of `round`, where it is one the
     * lead made settling that round: after where the round started, and by
     * where the next started, or the end. Anything else names nothing.
     */
    const fixedBy = (round: number, named: string | null) =>
      Effect.gen(function* () {
        const from = starts.get(round) ?? null
        const next = passes.find((pass) => pass.round > round)
        const to = next === undefined ? input.end : (starts.get(next.round) ?? null)
        if (named === null || !/^[0-9a-f]{7,64}$/.test(named) || from === null || to === null) return []
        const commit = yield* git(input.cwd, 'rev-parse', '--verify', '--quiet', `${named}^{commit}`).pipe(Effect.orElseSucceed(() => null))
        if (commit === null || commit === from) return []
        const within = (older: string, newer: string) =>
          Effect.map(gitOutcome(input.cwd, 'merge-base', '--is-ancestor', older, newer), (answer) => answer.code === 0)
        return (yield* within(from, commit)) && (yield* within(commit, to)) ? [commit] : []
      })

    const changed: Array<{ what: string; commits: ReadonlyArray<string> }> = []
    const kept: Array<{ point: string; why: string | null }> = []
    for (const finding of findings) {
      const response = finding.response?.trim() || null
      if (finding.state === 'set_aside') kept.push({ point: finding.claim, why: response })
      // Fixed without a word on what changed, as a lead may: what the reviewer said, as fixed.
      else changed.push({ what: response ?? `Fixed: ${finding.claim}`, commits: yield* fixedBy(finding.round, finding.fixedBy) })
    }
    const sent = yield* input.sent([...(read === null ? [] : [read]), ...changed.flatMap((one) => one.commits)])
    const asSent = (sha: string) => sent.get(sha) ?? sha
    return {
      reviewer,
      lead,
      passes: passes.length,
      sha: read === null ? null : asSent(read),
      date: (last.endedAt ?? (yield* timestamp)).slice(0, 10),
      changed: changed.map((one) => ({ what: one.what, commits: one.commits.map(asSent) })),
      kept,
    } satisfies ReviewRecord
  })

/**
 * The commit that holds exactly what a review pass read, or null. A pass
 * reads a copy of the worktree (reviewCopy.ts), uncommitted work and all,
 * made as a commit on the head: that head, where nothing was left
 * uncommitted; else the first commit after it, up to `end`, that the lead
 * made of the same files.
 */
export const reviewedCommit = (cwd: string, snapshot: string, end: string) =>
  Effect.gen(function* () {
    const tree = yield* git(cwd, 'rev-parse', `${snapshot}^{tree}`)
    const head = yield* git(cwd, 'rev-parse', `${snapshot}^`)
    if ((yield* git(cwd, 'rev-parse', `${head}^{tree}`)) === tree) return head
    const after = yield* git(cwd, 'log', '--reverse', '--format=%H %T', `${head}..${end}`)
    return (
      after
        .split('\n')
        .map((line) => line.split(' '))
        .find(([, other]) => other === tree)?.[0] ?? null
    )
  }).pipe(Effect.orElseSucceed(() => null))
