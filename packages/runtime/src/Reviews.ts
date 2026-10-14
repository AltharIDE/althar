import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { ConnectorFailed, fromOutside, parseRemote, type PostedReview, type Product, type ReviewEvent } from '@althar/connectors'
import type { ReviewBrief, ReviewDraftCard } from '@althar/contracts'
import { type ActorId, type CommandEnvelope, Ids, newId, type ProjectId, type ReviewDraftState, type ReviewVerdict } from '@althar/domain'
import { Commands, type Ledger } from '@althar/persistence-sqlite'
import { Context, type Crypto, Effect, Layer, Option, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { postCard, touchCard } from './cards'
import { Agents, RuntimeConfig } from './Config'
import { Connections } from './Connections'
import { envelope } from './envelope'
import { NotFound } from './errors'
import { commitOf, fetchRefs, gitOutcome } from './git'
import { Instance } from './Instance'
import { freeSlug, slugify } from './Projects'
import { signed } from './pullRequestWords'
import { change, fact, timestamp } from './records'
import { copyReviewed, type ReviewOf, reviewOf, type Reviewed } from './reviewing'
import { indexTask } from './Search'
import { Sessions } from './Sessions'
import { addItem, updateItem } from './threads'
import { ToolRefused, ToolServer, type ToolAccess } from './ToolServer'

/*
 * Reviews of someone else's pull request (docs/architecture/06, "Reviewing
 * someone else's pull request"). A review is a task: the coordinator starts
 * one (`review_pull_request`), and Althar fetches the pull request's head
 * into a read-only copy of its own, recorded as the task's workspace with
 * access `read`, detached, on no branch: a repository of its own that
 * borrows the person's objects, where git runs with none of the person's
 * config, so no filter or diff driver of theirs runs on its files
 * (`addReadCopy`). The task's lead reads it in reader mode under the reader
 * rules: it runs nothing of it, and, for a pull request from outside the
 * project, reaches no network (Sessions.ts). Nothing Althar sets up a task
 * with (an install, a run) touches the copy.
 *
 * The lead drafts its review with `draft_review`: a verdict, a summary, and
 * comments on lines. The draft is a card in the task's thread, kept in
 * `review_drafts` and written with the card's item in the same transaction,
 * as an issue draft is. Nothing reaches the code host until the person posts
 * it from the card, where they keep or drop each comment and choose the
 * verdict (the lead's is a suggestion, and never Approve for them on an
 * outside pull request); or their own setting posts a review of their team's
 * pull request as soon as it is drafted. Posting marks the draft as being
 * posted first, in the transaction that checks it is still open, so a second
 * press posts nothing more; a host that may have taken it without Althar
 * hearing so leaves it uncertain, never confidently unposted. Posted, the
 * card folds to a line with the review's link, and the task settles.
 */

/** The settings key that posts the team's reviews without asking; no row is its default, off. */
const POST_TEAM = 'post_team_reviews'

/** How long a review task's title may be, as any task's. */
const TITLE_LENGTH = 60
/** How many comments a draft may hold. */
const COMMENTS = 50

/** Why a review couldn't be started, in words the coordinator says to the person. */
export class ReviewRefused extends Schema.TaggedError<ReviewRefused>()('ReviewRefused', { message: Schema.String }) {}

/** A draft that can't take that turn now: posted, discarded, or being posted. */
export class ReviewDraftClosed extends Schema.TaggedError<ReviewDraftClosed>()('ReviewDraftClosed', {
  draftId: Schema.String,
  state: Schema.String,
}) {}

/** A draft that can't be posted or kept as it stands: no verdict chosen, an empty summary, or an empty comment. */
export class ReviewDraftIncomplete extends Schema.TaggedError<ReviewDraftIncomplete>()('ReviewDraftIncomplete', {
  draftId: Schema.String,
  missing: Schema.Literals(['verdict', 'summary', 'comment']),
}) {}

const Severity = Schema.Literals(['blocking', 'major', 'minor', 'nit'])
const Verdict = Schema.Literals(['approve', 'changes', 'comment'])

const Comment = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  line: Schema.Int,
  body: Schema.String,
  severity: Severity,
  kept: Schema.Boolean,
})
type Comment = typeof Comment.Type
const Comments = Schema.fromJsonString(Schema.Array(Comment))

/** What the lead hands `draft_review`. */
const Drafted = Schema.Struct({
  verdict: Verdict,
  summary: Schema.String,
  comments: Schema.optional(
    Schema.Array(Schema.Struct({ path: Schema.String, line: Schema.Int, body: Schema.String, severity: Schema.optional(Severity) })),
  ),
})

interface Row {
  readonly id: string
  readonly projectId: ProjectId
  readonly taskId: string
  readonly threadId: string
  readonly connectionId: string
  readonly product: Product
  readonly repository: string
  readonly number: number
  readonly url: string
  readonly title: string
  readonly author: string
  readonly outside: number
  readonly headCommit: string
  readonly drafter: string | null
  readonly account: string | null
  readonly suggested: ReviewVerdict
  readonly verdict: ReviewVerdict | null
  readonly summary: string
  readonly comments: string
  readonly state: ReviewDraftState
  readonly error: string | null
  readonly reviewUrl: string | null
  readonly decidedAt: string | null
}

/** A draft's card, from its row, and whether its pull request came from a fork. */
const cardOf = (row: Row, fork: boolean): ReviewDraftCard => ({
  draftId: row.id,
  product: row.product,
  repository: row.repository,
  number: row.number,
  url: row.url,
  title: row.title,
  author: row.author,
  outside: row.outside === 1,
  fork,
  drafter: row.drafter,
  account: row.account,
  suggested: row.suggested,
  verdict: row.verdict,
  summary: row.summary,
  comments: Schema.decodeUnknownSync(Comments)(row.comments),
  state: row.state,
  error: row.error,
  review: row.state === 'posted' && row.reviewUrl !== null && row.decidedAt !== null ? { url: row.reviewUrl, at: row.decidedAt } : null,
})

/** What the host calls each verdict a review posts with. */
const EVENTS: Readonly<Record<ReviewVerdict, ReviewEvent>> = { approve: 'approve', changes: 'request_changes', comment: 'comment' }

/** A verdict, as the lead and the coordinator hear it. */
const VERDICT_WORDS: Readonly<Record<ReviewVerdict, string>> = { approve: 'approve', changes: 'request changes', comment: 'comment' }

/** The verdict a draft starts with: the lead's, but never Approve chosen for the person on an outside pull request. */
export const startingVerdict = (suggested: ReviewVerdict, outside: boolean): ReviewVerdict | null =>
  outside && suggested === 'approve' ? null : suggested

/** A path as the pull request names it: from the repository's root, without a leading `./` or `/`. */
const pathOf = (path: string) => path.trim().replace(/^(\.\/|\/)+/, '')

/** The lines of a file each hunk of a diff shows on its new side, from `@@ -a,b +c,d @@`: where a comment can go. */
export const shownLines = (diff: string): ReadonlyArray<readonly [number, number]> =>
  [...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)].flatMap((hunk) => {
    const start = Number(hunk[1])
    const count = hunk[2] === undefined ? 1 : Number(hunk[2])
    return count === 0 ? [] : [[start, start + count - 1] as const]
  })

/**
 * The pull request's facts a review task's brief, the board and its view
 * show (contracts' ReviewBrief): what it is, how big, what the lead's latest
 * draft found and its verdict, and the review once posted. Null for a task
 * that isn't a review. Queries calls it for a task's card and its view.
 */
export const reviewBriefOf = (taskId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const review = yield* reviewOf(taskId)
    if (review === null) return null
    const [latest] = yield* sql<{ verdict: ReviewVerdict | null; comments: string }>`
      SELECT verdict, comments FROM review_drafts WHERE task_id = ${taskId} AND state <> 'discarded'
      ORDER BY created_at DESC, rowid DESC LIMIT 1`
    const [posted] = yield* sql<{ reviewUrl: string; decidedAt: string }>`
      SELECT review_url, decided_at FROM review_drafts WHERE task_id = ${taskId} AND state = 'posted'
      ORDER BY decided_at DESC, rowid DESC LIMIT 1`
    const kept = Option.match(Schema.decodeUnknownOption(Comments)(latest?.comments ?? '[]'), {
      onNone: () => [],
      onSome: (comments) => comments.filter((comment) => comment.kept),
    })
    return {
      product: review.product,
      repository: review.repository.join('/'),
      number: review.number,
      url: review.url,
      title: review.title,
      author: review.author,
      outside: review.outside,
      additions: review.additions,
      deletions: review.deletions,
      findings: kept.length,
      blocking: kept.filter((comment) => comment.severity === 'blocking').length,
      verdict: latest?.verdict ?? null,
      posted: posted === undefined ? null : { url: posted.reviewUrl, at: posted.decidedAt },
    } satisfies ReviewBrief
  })

/** Whether the person has their team's reviews posted without asking: off unless they turned it on. */
export const postTeamReviews = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const [row] = yield* sql<{ value: string }>`SELECT value FROM settings WHERE key = ${POST_TEAM}`
  return row?.value === 'on'
})

/** Turns posting the team's reviews without asking on, or off, its default, which keeps no row. */
export const setPostTeamReviews = (on: boolean) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    if (!on) return yield* sql`DELETE FROM settings WHERE key = ${POST_TEAM}`.pipe(Effect.asVoid)
    const at = yield* timestamp
    yield* sql`
      INSERT INTO settings ${sql.insert({ key: POST_TEAM, value: 'on', updatedAt: at })}
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  })

/** A review task that started, or the one already reviewing that pull request. */
export interface Started {
  readonly taskId: string
  readonly slug: string
  readonly threadId: string
  readonly name: string
  readonly title: string
  readonly author: string
  readonly outside: boolean
  /** It was under way already: nothing new started. */
  readonly already: boolean
  /** The review asked for is over (posted, or the task closed): asked again as the same request, nothing starts. */
  readonly done?: boolean
  /** Its lead started; false where it couldn't, which its thread says. */
  readonly leading: boolean
  /** A review of it posts itself once drafted: the person's setting, for their team's pull request. */
  readonly posts: boolean
}

type Store =
  | SqlClient.SqlClient
  | Instance
  | Ledger
  | Crypto.Crypto
  | Commands
  | Connections
  | Sessions
  | ToolServer
  | RuntimeConfig
  | Agents

export class Reviews extends Context.Service<
  Reviews,
  {
    /**
     * Starts a review task on a pull request, by its link or its number in
     * the project's repository: fetches its head into a read-only copy, opens
     * the task with the person's words, and starts its lead on it. The task
     * already reviewing it, where there is one. `ReviewRefused` says why not.
     */
    start(input: {
      readonly envelope: CommandEnvelope
      readonly projectId: ProjectId
      readonly pullRequest: string
      readonly lead: { readonly agentId: string; readonly model: string | null; readonly effort?: string }
      readonly request?: string
    }): Effect.Effect<Started, unknown>
    /** Changes a draft before it is posted: its verdict, summary, and which comments are kept or what they say. */
    change(
      draftId: string,
      edit: {
        readonly verdict?: ReviewVerdict
        readonly summary?: string
        readonly comments?: ReadonlyArray<{ readonly id: string; readonly kept?: boolean | undefined; readonly body?: string | undefined }>
      },
      actorId: ActorId,
    ): Effect.Effect<void, unknown>
    /** Posts a draft, because the person said to; one that failed, again. The card says how it went. */
    post(draftId: string, actorId: ActorId): Effect.Effect<ReviewDraftCard, unknown>
    /** Discards a draft: nothing is posted. */
    discard(draftId: string, actorId: ActorId): Effect.Effect<void, unknown>
  }
>()('@althar/runtime/Reviews') {
  static readonly layer: Layer.Layer<Reviews, never, Store> = Layer.effect(
    Reviews,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)
      const instance = yield* Instance
      const connections = yield* Connections
      const sessions = yield* Sessions
      const toolServer = yield* ToolServer
      const agents = yield* Agents
      const config = yield* RuntimeConfig

      const refused = (message: string) => new ReviewRefused({ message })

      /* ---- Starting a review ---- */

      /**
       * Where a pull request is: its connection and host, its repository's
       * path, its number, and the project's repository it is on here. By its
       * link, the repository whose remotes name it; by its number, the
       * project's one repository on a connected host.
       */
      const placeOf = (projectId: string, asked: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const bindings = yield* sql<{ id: string; slug: string; name: string; remotes: string; repository: string; projectSlug: string }>`
            SELECT b.id, b.slug, b.display_name AS name, b.remote_fingerprints AS remotes, l.path AS repository, p.slug AS project_slug
            FROM repository_bindings b
            JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
            JOIN projects p ON p.id = b.project_id AND p.archived_at IS NULL
            WHERE b.project_id = ${projectId} AND b.detached_at IS NULL ORDER BY b.created_at, b.rowid`
          const remotesOf = (binding: (typeof bindings)[number]) =>
            Option.getOrElse(Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)))(binding.remotes), () => [])
          const wanted = asked.trim()
          if (/^https?:\/\//i.test(wanted)) {
            const found = yield* connections.resolve(wanted)
            if (found === null)
              return yield* refused(
                'Althar isn’t connected to where that link points, so it can’t read the pull request. The person connects its host in Settings.',
              )
            if (found.ref.kind !== 'change' || found.host === undefined) return yield* refused('That link isn’t a pull request.')
            const ref = found.ref
            const same = (path: ReadonlyArray<string>) => path.join('/').toLowerCase() === ref.path.join('/').toLowerCase()
            const binding = bindings.find((one) =>
              remotesOf(one).some((remote) => {
                const place = parseRemote(remote)
                return place !== null && place.host === ref.host && same(place.path)
              }),
            )
            if (binding === undefined)
              return yield* refused(`That pull request is on ${ref.path.join('/')}, which isn’t one of the project’s repositories.`)
            return { connectionId: found.connectionId, host: found.host, path: ref.path, number: ref.number, binding }
          }
          const number = /^#?(\d+)$/.exec(wanted)?.[1]
          if (number === undefined) return yield* refused('Give the pull request’s link, or its number: #123.')
          const hosted = (yield* Effect.forEach(bindings, (binding) =>
            Effect.map(connections.hostOf(remotesOf(binding)), (host) => (host === null ? [] : [{ ...host, binding }])),
          )).flat()
          const [only] = hosted
          if (only === undefined)
            return yield* refused('The project’s repository isn’t on a host Althar is connected to. The person connects it in Settings.')
          if (hosted.length > 1)
            return yield* refused(
              `Several of the project’s repositories are on a connected host (${hosted.map((one) => one.binding.name).join(', ')}): give the pull request’s link.`,
            )
          return { connectionId: only.connectionId, host: only.host, path: only.path, number: Number(number), binding: only.binding }
        })

      /** Says a host's failure as the coordinator tells the person: a sign-in it didn't take reaches the person through Connections. */
      const hostWords = (error: ConnectorFailed) =>
        refused(
          error.reason === 'not_found'
            ? 'That pull request isn’t there, or Althar’s sign-in can’t see it.'
            : `The host said: ${error.message}`,
        )

      const start: Reviews['Service']['start'] = (input) =>
        provide(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const place = yield* placeOf(input.projectId, input.pullRequest)
            const { host } = place
            if (!host.capabilities.reviews)
              return yield* refused(`Althar reviews GitHub pull requests only, for now; this ${host.words.noun} is elsewhere.`)
            const repository = yield* host.repository(place.path).pipe(Effect.mapError(hostWords))
            const pull = yield* host.changeToReview(repository, place.number).pipe(Effect.mapError(hostWords))
            const name = `${host.words.noun} ${host.words.prefix}${pull.number}`
            if (pull.state !== 'open') return yield* refused(`That ${name} is ${pull.state}, so there’s nothing to review.`)
            const outside = fromOutside(pull)
            const author = pull.author?.login ?? 'ghost'
            // One already reviewing it, still open, is the one: asked twice, nothing starts twice.
            const [already] = yield* sql<{ taskId: string; slug: string; threadId: string }>`
              SELECT k.id AS task_id, k.slug, t.id AS thread_id FROM external_links x
              JOIN tasks k ON k.id = x.task_id JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
              WHERE x.project_id = ${input.projectId} AND x.kind = 'review' AND x.url = ${pull.url} AND k.state = 'open'
              ORDER BY k.created_at DESC LIMIT 1`
            const posts = !outside && (yield* postTeamReviews)
            const words = { title: pull.title, author, outside, name, posts }
            if (already !== undefined) return { ...already, ...words, already: true, leading: false } satisfies Started
            // Only an agent its session holds to reading leads a review (the registry's `reviewing`; Sessions.ts refuses any other
            // there too): one that runs what its sandbox contains without asking could run the pull request's code, a team's too.
            const leading = yield* agents.get(input.lead.agentId).pipe(Effect.mapError(() => refused('Althar has no such agent.')))
            if (leading.definition.reviewing?.outside !== true) {
              const held = agents.list.filter((entry) => entry.definition.reviewing?.outside === true).map((entry) => entry.definition.name)
              return yield* refused(
                `${leading.definition.name} can't be held to reading only: it runs commands its sandbox contains without asking, so it could run this ${name}'s code. Review it with ${held.join(' or ')}.`,
              )
            }

            // Its head and its target, fetched as a push is signed in, into refs of Althar's own: nothing is a branch here.
            const ref = `refs/althar/reviews/${place.path.join('/')}/${pull.number}`
            const target = yield* host.pushTarget(repository).pipe(Effect.mapError(hostWords))
            const fetched = yield* fetchRefs(place.binding.repository, target, [
              { from: `refs/pull/${pull.number}/head`, into: `${ref}/head` },
              { from: `refs/heads/${pull.target}`, into: `${ref}/base` },
            ])
            const head = fetched ? yield* commitOf(place.binding.repository, `${ref}/head`).pipe(Effect.option) : Option.none()
            if (Option.isNone(head)) return yield* refused(`Althar couldn’t fetch the ${name}’s code. Try again, or tell the person.`)
            // Where its change starts: where its head meets its base; or, for histories that never meet, its base.
            const met = yield* gitOutcome(place.binding.repository, 'merge-base', `${ref}/base`, head.value)
            const baseCommit = met.code === 0 ? met.stdout : yield* commitOf(place.binding.repository, `${ref}/base`)

            const reviewed: Reviewed = {
              repository: place.path,
              number: pull.number,
              url: pull.url,
              title: pull.title,
              author,
              member: pull.member,
              fork: pull.fork,
              outside,
              head: head.value,
              base: pull.target,
              baseCommit,
              additions: pull.additions,
              deletions: pull.deletions,
              changedFiles: pull.changedFiles,
              words: host.words,
            }
            const title = (() => {
              const full = `Review ${host.words.prefix}${pull.number}: ${pull.title}`
              // Cut at a word, so it reads as words.
              return full.length <= TITLE_LENGTH ? full : `${full.slice(0, TITLE_LENGTH - 1).replace(/\s+\S*$/, '')}…`
            })()
            const commands = yield* Commands
            // Whether this request made the task now, or its receipt answers for one made before.
            let made = false
            const created = yield* commands.execute({
              envelope: input.envelope,
              projectId: input.projectId,
              result: Schema.Struct({
                taskId: Schema.String,
                slug: Schema.String,
                threadId: Schema.String,
                workspaceId: Schema.String,
                path: Schema.String,
              }),
              handle: Effect.gen(function* () {
                made = true
                const [live] = yield* sql<{ id: string }>`SELECT id FROM projects WHERE id = ${input.projectId} AND archived_at IS NULL`
                if (live === undefined) return yield* new NotFound({ kind: 'project', id: input.projectId })
                const at = yield* timestamp
                const taskId = yield* newId(Ids.task)
                const taken = yield* sql<{ slug: string }>`SELECT slug FROM tasks WHERE project_id = ${input.projectId}`
                const slug = freeSlug(
                  slugify(`review ${pull.number} ${pull.title}`, 'review'),
                  taken.map((row) => row.slug),
                )
                const request = input.request?.trim() ?? ''
                yield* sql`INSERT INTO tasks ${sql.insert({
                  id: taskId,
                  projectId: input.projectId,
                  title,
                  description: '',
                  ...(request === '' ? {} : { request }),
                  slug,
                  state: 'open',
                  createdByActorId: input.envelope.actorId,
                  createdAt: at,
                })}`
                const threadId = yield* newId(Ids.thread)
                yield* sql`INSERT INTO threads ${sql.insert({ id: threadId, projectId: input.projectId, kind: 'task', taskId, createdAt: at })}`
                yield* sql`INSERT INTO task_repository_requirements ${sql.insert({
                  id: yield* newId(Ids.taskRequirement),
                  projectId: input.projectId,
                  taskId,
                  bindingId: place.binding.id,
                  access: 'read',
                  baseRef: pull.target,
                })}`
                // A copy to read, on no branch of its own: the workspace keeps the pull request's branch as its host names it.
                const workspaceId = yield* newId(Ids.workspace)
                const path = join(config.worktreeRoot, place.binding.projectSlug, slug, place.binding.slug)
                yield* sql`INSERT INTO workspaces ${sql.insert({
                  id: workspaceId,
                  projectId: input.projectId,
                  taskId,
                  bindingId: place.binding.id,
                  deviceId: instance.deviceId,
                  access: 'read',
                  path,
                  baseRef: pull.target,
                  branch: pull.fork === null ? pull.source : [...pull.fork.slice(0, 1), pull.source].join(':'),
                  state: 'preparing',
                  createdAt: at,
                })}`
                const linkId = yield* newId(Ids.externalLink)
                yield* sql`INSERT INTO external_links ${sql.insert({
                  id: linkId,
                  projectId: input.projectId,
                  taskId,
                  connectionId: place.connectionId,
                  product: host.product,
                  kind: 'review',
                  externalId: pull.id,
                  ref: `${place.path.join('/')}${host.words.prefix}${pull.number}`,
                  key: `${host.words.short} ${host.words.prefix}${pull.number}`,
                  url: pull.url,
                  snapshot: JSON.stringify(reviewed),
                  createdAt: at,
                  updatedAt: at,
                })}`
                yield* fact({
                  projectId: input.projectId,
                  aggregateType: 'task',
                  aggregateId: taskId,
                  revision: 1,
                  type: 'task.created',
                  payload: { title, reviews: pull.url, outside, repositories: [place.binding.slug] },
                  actorId: input.envelope.actorId,
                  commandId: input.envelope.commandId,
                })
                yield* postCard(input.projectId, taskId)
                // Found by the pull request it reviews, as by its title.
                yield* indexTask(taskId)
                return { taskId, slug, threadId, workspaceId, path }
              }),
            })

            // The same request again, whose task is over (an open one is `already`, above): it stands as it ended. Nothing of it is
            // prepared again, against the head and the copy it read then; a new request makes a review of its own.
            if (!made) return { ...created, ...words, already: true, done: true, leading: false } satisfies Started

            // The copy, once the task is committed: a repository of its own, detached at the head fetched, in a folder of its own.
            let path = created.path
            for (let n = 2; existsSync(path); n += 1) path = `${created.path}-${n}`
            const copied = yield* Effect.exit(copyReviewed(place.binding.repository, path, reviewed))
            yield* sql.withTransaction(
              Effect.gen(function* () {
                const done = copied._tag === 'Success'
                const revision = yield* change(
                  'workspaces',
                  created.workspaceId,
                  done ? { state: 'ready', path, baseCommit } : { state: 'failed' },
                )
                yield* fact({
                  projectId: input.projectId,
                  aggregateType: 'workspace',
                  aggregateId: created.workspaceId,
                  revision,
                  type: done ? 'workspace.ready' : 'workspace.failed',
                  payload: { path, head: head.value, read: true },
                  actorId: instance.systemId,
                })
              }),
            )
            if (copied._tag === 'Failure') {
              yield* addItem({ projectId: input.projectId, threadId: created.threadId }, 'notice', {
                source: 'runtime',
                severity: 'error',
                title: `Althar couldn’t make a copy of the ${name}’s code to read.`,
              })
              return { ...created, ...words, already: false, leading: false } satisfies Started
            }
            // Its lead, told to start: its brief says the rest.
            yield* sessions.send({
              envelope: yield* envelope('thread.send', { threadId: created.threadId, review: pull.url }, undefined, input.envelope.actorId),
              threadId: created.threadId,
              body: `Review ${name}, then draft your review with draft_review.`,
              disposition: 'after_current',
              quiet: true,
            })
            const started = yield* sessions
              .start({
                threadId: created.threadId,
                agentId: input.lead.agentId,
                ...(input.lead.model === null ? {} : { model: input.lead.model }),
                ...(input.lead.effort === undefined ? {} : { effort: input.lead.effort }),
              })
              .pipe(
                Effect.as(true),
                // A lead that couldn't start says why in the task's thread, and the person starts another there.
                Effect.catch((error) => Effect.as(Effect.logWarning('A review’s lead could not start', error), false)),
              )
            return { ...created, ...words, already: false, leading: started } satisfies Started
          }),
        )

      /* ---- The lead's draft ---- */

      const load = (draftId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<Row>`
            SELECT id, project_id, task_id, thread_id, connection_id, product, repository, number, url, title, author, outside, head_commit,
              drafter, account, suggested, verdict, summary, comments, state, error, review_url, decided_at
            FROM review_drafts WHERE id = ${draftId} AND project_id IN (SELECT id FROM projects WHERE archived_at IS NULL)`
          return row === undefined ? yield* new NotFound({ kind: 'review draft', id: draftId }) : row
        })

      /** The card a draft's item shows, read with whether its pull request came from a fork. */
      const cardFor = (row: Row) => Effect.map(reviewOf(row.taskId), (review) => cardOf(row, (review?.fork ?? null) !== null))

      /** Rewrites a draft's card from its row, inside the transaction that changed it. */
      const showCard = (draftId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const row = yield* load(draftId)
          const card = yield* cardFor(row)
          const items = yield* sql<{ id: string }>`
            SELECT id FROM thread_items WHERE thread_id = ${row.threadId} AND kind = 'review_draft' AND json_extract(content, '$.draftId') = ${draftId}`
          for (const item of items) yield* updateItem(row.projectId, item.id, card)
          return card
        })

      /**
       * Changes a draft if it stands as `when` needs, checked and changed in
       * one transaction with its card, so two presses can't both post it;
       * and with whatever else `also` changes, such as the task a posted
       * review settles. Changed, the task's card on the board is told to
       * read again, as its findings and verdict are read from the draft.
       */
      const transition = (
        draftId: string,
        when: (row: Row) => boolean,
        set: (row: Row, at: string) => Readonly<Record<string, unknown>>,
        type: string,
        actorId: ActorId,
        payload?: (row: Row) => unknown,
        also?: (row: Row) => Effect.Effect<void, unknown, Store>,
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const result = yield* sql.withTransaction(
            Effect.gen(function* () {
              const row = yield* load(draftId)
              if (!when(row)) return { changed: false as const, row }
              const at = yield* timestamp
              const revision = yield* change('review_drafts', draftId, { ...set(row, at), updatedAt: at })
              const after = yield* load(draftId)
              yield* fact({
                projectId: row.projectId,
                aggregateType: 'review_draft',
                aggregateId: draftId,
                revision,
                type,
                ...(payload === undefined ? {} : { payload: payload(after) }),
                actorId,
              })
              yield* showCard(draftId)
              if (also !== undefined) yield* also(after)
              return { changed: true as const, row: after }
            }),
          )
          if (result.changed) yield* touchCard(result.row.taskId)
          return result
        })

      /** Settles a review task once its review is posted, in the transaction that records it posted; one not open stays as it is. */
      const settle = (row: Row, actorId: ActorId) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [task] = yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${row.taskId}`
          if (task?.state !== 'open') return
          const at = yield* timestamp
          const revision = yield* change('tasks', row.taskId, { state: 'done', settledAt: at })
          yield* fact({
            projectId: row.projectId,
            aggregateType: 'task',
            aggregateId: row.taskId,
            revision,
            type: 'task.done',
            payload: { reviewed: row.reviewUrl },
            actorId,
          })
        })

      /** Whether a draft can still change, or be posted: waiting on the person, not posted the last time, or perhaps posted. */
      const open = (row: Row) => row.state === 'pending' || row.state === 'failed' || row.state === 'uncertain'
      const closed = (row: Row) => new ReviewDraftClosed({ draftId: row.id, state: row.state })

      /**
       * Why each comment can't go where it is: no such file in the pull
       * request's code, or a line the change doesn't show, which the host
       * would refuse, and the whole review with it.
       */
      const misplaced = (copy: string, baseCommit: string, comments: ReadonlyArray<{ readonly path: string; readonly line: number }>) =>
        Effect.gen(function* () {
          const shown = new Map<string, ReadonlyArray<readonly [number, number]>>()
          const wrong: Array<string> = []
          for (const comment of comments) {
            const where = `${comment.path}:${comment.line}`
            // A path out of the copy is in no pull request.
            if (
              comment.path === '' ||
              comment.path.split('/').includes('..') ||
              !existsSync(join(copy, comment.path)) ||
              comment.line < 1
            ) {
              wrong.push(`${where} isn’t in the pull request’s code`)
              continue
            }
            if (!shown.has(comment.path)) {
              const diff = yield* gitOutcome(
                copy,
                'diff',
                '--unified=3',
                '--no-color',
                '--no-ext-diff',
                '--no-textconv',
                baseCommit,
                'HEAD',
                '--',
                comment.path,
              )
              // A diff git couldn't give shows nothing: every line of it is refused, rather than guessed.
              shown.set(comment.path, shownLines(diff.stdout))
            }
            if (!(shown.get(comment.path) ?? []).some(([from, to]) => comment.line >= from && comment.line <= to))
              wrong.push(`${where} isn’t a line the pull request changes, or shows beside a change`)
          }
          return wrong
        })

      /** The agent on a thread, by name, for "drafted by". */
      const drafterOf = (threadId: string) =>
        Effect.gen(function* () {
          const lead = yield* sessions.running(threadId)
          if (Option.isNone(lead)) return null
          return yield* agents.get(lead.value.agentId).pipe(
            Effect.map((entry) => entry.definition.name),
            Effect.orElseSucceed(() => lead.value.agentId),
          )
        })

      const draft = (access: ToolAccess, input: unknown) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const taskId = access.taskId
          const review = taskId === null ? null : yield* reviewOf(taskId)
          if (taskId === null || review === null)
            return yield* new ToolRefused({
              message: 'This task doesn’t review someone else’s pull request: draft_review is for one that does.',
            })
          const asked = yield* Schema.decodeUnknownEffect(Drafted)(input).pipe(
            Effect.mapError((error) => new ToolRefused({ message: `Althar couldn't read that: ${error.message}` })),
          )
          const summary = asked.summary.trim()
          if (summary === '') return yield* new ToolRefused({ message: 'Write a summary: what the pull request does, and what you found.' })
          const given = (asked.comments ?? []).map((comment) => ({
            path: pathOf(comment.path),
            line: comment.line,
            body: comment.body.trim(),
            severity: comment.severity ?? ('minor' as const),
          }))
          if (given.length > COMMENTS)
            return yield* new ToolRefused({ message: `That’s ${given.length} comments; keep to ${COMMENTS}, the ones that matter most.` })
          if (given.some((comment) => comment.body === ''))
            return yield* new ToolRefused({ message: 'Every comment needs words: say what is wrong, or drop it.' })
          const copies = yield* sql<{ path: string }>`
            SELECT path FROM workspaces WHERE task_id = ${taskId} AND device_id = ${instance.deviceId} AND access = 'read' AND state = 'ready' LIMIT 1`
          for (const copy of copies) {
            const wrong = yield* misplaced(copy.path, review.baseCommit, given)
            if (wrong.length > 0)
              return yield* new ToolRefused({
                message: `${wrong.join('; ')}. GitHub takes comments only on lines the change shows, so it would refuse the whole review. Put each on a line of the change as it now reads, or say it in the summary, and call draft_review again.`,
              })
          }
          const comments: ReadonlyArray<Comment> = yield* Effect.forEach(given, (comment) =>
            Effect.map(newId(Ids.threadItem), (id) => ({ ...comment, id: `c${id.slice(-12)}`, kept: true })),
          )
          const verdict = startingVerdict(asked.verdict, review.outside)
          const drafter = yield* drafterOf(access.threadId)
          const account = yield* accountOf(review)
          // The lead drafting again changes the draft that waits, rather than adding another; one being posted, or perhaps posted, waits on the person.
          const [latest] = yield* sql<{ id: string; state: ReviewDraftState }>`
            SELECT id, state FROM review_drafts WHERE task_id = ${taskId} ORDER BY created_at DESC, rowid DESC LIMIT 1`
          if (latest?.state === 'posting' || latest?.state === 'uncertain')
            return yield* new ToolRefused({
              message:
                latest.state === 'posting'
                  ? 'Your last draft is being posted now. Wait for it, then draft again if the person asks.'
                  : 'Your last draft may be on GitHub already: its answer was lost. Ask the person to look there before you draft again.',
            })
          const content = {
            suggested: asked.verdict,
            verdict,
            summary,
            comments: JSON.stringify(comments),
            headCommit: review.head,
            drafter,
            account,
          }
          let draftId: string
          if (latest !== undefined && (latest.state === 'pending' || latest.state === 'failed')) {
            draftId = latest.id
            yield* transition(
              draftId,
              open,
              () => ({ ...content, state: 'pending', error: null }),
              'review_draft.redrafted',
              instance.systemId,
              () => ({ verdict: asked.verdict, comments: comments.length }),
            )
          } else {
            draftId = yield* newId(Ids.reviewDraft)
            const id = draftId
            yield* sql.withTransaction(
              Effect.gen(function* () {
                const at = yield* timestamp
                yield* sql`INSERT INTO review_drafts ${sql.insert({
                  id,
                  projectId: access.projectId,
                  taskId,
                  threadId: access.threadId,
                  connectionId: review.connectionId,
                  product: review.product,
                  repository: review.repository.join('/'),
                  number: review.number,
                  url: review.url,
                  title: review.title,
                  author: review.author,
                  outside: review.outside ? 1 : 0,
                  ...content,
                  state: 'pending',
                  draftedByActorId: instance.systemId,
                  createdAt: at,
                  updatedAt: at,
                })}`
                yield* fact({
                  projectId: access.projectId as ProjectId,
                  aggregateType: 'review_draft',
                  aggregateId: id,
                  revision: 1,
                  type: 'review_draft.drafted',
                  payload: { url: review.url, verdict: asked.verdict, comments: comments.length, outside: review.outside },
                  actorId: instance.systemId,
                })
                yield* addItem(
                  { projectId: access.projectId as ProjectId, threadId: access.threadId },
                  'review_draft',
                  cardOf(yield* load(id), review.fork !== null),
                )
              }),
            )
            yield* touchCard(taskId)
          }
          const name = `${review.words.noun} ${review.words.prefix}${review.number}`
          const counted = comments.length === 1 ? '1 comment' : `${comments.length} comments`
          // The person's own setting posts their team's reviews at once; an outside one always waits for them.
          if (!review.outside && (yield* postTeamReviews)) {
            const posted = yield* post(draftId, instance.systemId)
            return posted.state === 'posted'
              ? `Posted your review of ${name} (${VERDICT_WORDS[asked.verdict]}, ${counted}): the person posts their team's reviews without asking. Say in a sentence or two what you found.`
              : `Drafted your review of ${name}. The person's setting posts their team's reviews at once, but it didn't post; they see why on its card.`
          }
          return `Drafted your review of ${name} (you suggest ${VERDICT_WORDS[asked.verdict]}, ${counted}). Nothing is posted until the person posts it from its card, where they choose the verdict and keep or drop each comment; they see it there, so don't repeat it. Say in a sentence or two what you found.${verdict === null ? ' It comes from outside the project, so Approve is theirs to choose.' : ''}`
        })

      /** Who a review posts as: the connection's account. */
      const accountOf = (review: ReviewOf) =>
        connections.adapters(review.connectionId).pipe(
          Effect.map((adapters): string | null => adapters.info.account.login),
          Effect.orElseSucceed(() => null),
        )

      /* ---- The person's say ---- */

      const changeDraft: Reviews['Service']['change'] = (draftId, edit, actorId) =>
        provide(
          Effect.gen(function* () {
            const summary = edit.summary?.trim()
            if (summary === '') return yield* new ReviewDraftIncomplete({ draftId, missing: 'summary' })
            if ((edit.comments ?? []).some((comment) => comment.body !== undefined && comment.body.trim() === ''))
              return yield* new ReviewDraftIncomplete({ draftId, missing: 'comment' })
            const result = yield* transition(
              draftId,
              open,
              (now) => {
                const comments = Schema.decodeUnknownSync(Comments)(now.comments).map((comment) => {
                  const asked = edit.comments?.find((one) => one.id === comment.id)
                  return asked === undefined
                    ? comment
                    : { ...comment, kept: asked.kept ?? comment.kept, body: asked.body?.trim() ?? comment.body }
                })
                return {
                  ...(edit.verdict === undefined ? {} : { verdict: edit.verdict }),
                  ...(summary === undefined ? {} : { summary }),
                  comments: JSON.stringify(comments),
                }
              },
              'review_draft.changed',
              actorId,
              (now) => ({ verdict: now.verdict }),
            )
            if (!result.changed) return yield* closed(result.row)
          }),
        )

      /**
       * Whether a failure leaves the review perhaps posted: the host didn't
       * answer in time or at all, or answered with what Althar couldn't read,
       * after it may have taken it. A refusal it answered with posts nothing;
       * nor does a connection that is gone. Anything else is taken to be
       * uncertain, never confidently unposted.
       */
      const uncertain = (error: unknown) =>
        error instanceof ConnectorFailed
          ? error.reason === 'unreachable' || error.reason === 'invalid_response'
          : !(error instanceof NotFound)

      const failureWords = (error: unknown) => {
        if (uncertain(error))
          return 'Its answer was lost, so Althar can’t tell whether GitHub took it. Look on the pull request before you post it again.'
        if (error instanceof ConnectorFailed)
          switch (error.reason) {
            case 'unauthorized':
              return 'GitHub didn’t take Althar’s sign-in. Sign in again in Settings, then try again.'
            case 'forbidden':
              return `GitHub says this account may not review it: ${error.message}`
            case 'rate_limited':
              return 'GitHub asks Althar to wait before trying again.'
            default:
              return error.message
          }
        return 'The connection to GitHub is gone. Connect it again, then try again.'
      }

      const post: Reviews['Service']['post'] = (draftId, actorId) =>
        provide(
          Effect.gen(function* () {
            const before = yield* load(draftId)
            if (open(before) && before.verdict === null) return yield* new ReviewDraftIncomplete({ draftId, missing: 'verdict' })
            const marked = yield* transition(
              draftId,
              (row) => open(row) && row.verdict !== null,
              () => ({ state: 'posting', error: null }),
              'review_draft.posting',
              actorId,
            )
            if (!marked.changed) return marked.row.state === 'posting' ? yield* cardFor(marked.row) : yield* closed(marked.row)
            const row = marked.row
            const verdict = row.verdict ?? row.suggested
            const kept = Schema.decodeUnknownSync(Comments)(row.comments).filter((comment) => comment.kept)
            const made = yield* connections.adapters(row.connectionId).pipe(
              Effect.flatMap((adapters): Effect.Effect<PostedReview, unknown> => {
                const host = adapters.host
                // Wanting its sign-in again, or gone, the host isn't asked: it would refuse.
                if (host === undefined || adapters.info.state !== 'ready')
                  return Effect.fail(new ConnectorFailed({ product: row.product, reason: 'unauthorized', message: '' }))
                return Effect.flatMap(host.repository(row.repository.split('/')), (repository) =>
                  host.postReview(repository, row.number, {
                    event: EVENTS[verdict],
                    body: signed(row.summary, row.drafter),
                    commit: row.headCommit,
                    comments: kept.map((comment) => ({ path: comment.path, line: comment.line, body: comment.body })),
                  }),
                )
              }),
              Effect.result,
            )
            const ended = yield* transition(
              draftId,
              (now) => now.state === 'posting',
              (_, at) =>
                made._tag === 'Success'
                  ? { state: 'posted', reviewRef: made.success.id, reviewUrl: made.success.url ?? row.url, decidedAt: at }
                  : { state: uncertain(made.failure) ? 'uncertain' : 'failed', error: failureWords(made.failure) },
              made._tag === 'Success' ? 'review_draft.posted' : uncertain(made.failure) ? 'review_draft.uncertain' : 'review_draft.failed',
              actorId,
              (now) => (now.state === 'posted' ? { url: now.reviewUrl, verdict, comments: kept.length } : { error: now.error }),
              // Posted, the review task is done, in the same transaction: a crash between them can't leave a posted review open.
              (now) => (now.state === 'posted' ? settle(now, actorId) : Effect.void),
            )
            if (made._tag === 'Failure') yield* Effect.logWarning('A review could not be posted', made.failure)
            return yield* cardFor(ended.row)
          }),
        )

      const discard: Reviews['Service']['discard'] = (draftId, actorId) =>
        provide(
          Effect.gen(function* () {
            const result = yield* transition(
              draftId,
              open,
              (_, at) => ({ state: 'discarded', error: null, decidedAt: at }),
              'review_draft.discarded',
              actorId,
            )
            if (!result.changed) return yield* closed(result.row)
          }),
        )

      // A draft Althar closed while posting may or may not be on GitHub: said so, for the person to look before posting it again.
      yield* provide(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const stuck = yield* sql<{ id: string }>`SELECT id FROM review_drafts WHERE state = 'posting'`
          for (const one of stuck)
            yield* transition(
              one.id,
              (row) => row.state === 'posting',
              () => ({
                state: 'uncertain',
                error: 'Althar closed while posting this. Look on the pull request for it before you post it again.',
              }),
              'review_draft.uncertain',
              instance.systemId,
              (row) => ({ error: row.error }),
            )
        }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not settle the review drafts left being posted', cause))),
      )
      // A review posted whose task an older Althar closed before settling it: settled now, unless it was settled or reopened since.
      yield* provide(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const left = yield* sql<{ draftId: string }>`
            SELECT d.id AS draft_id FROM tasks k
            JOIN review_drafts d ON d.id = (SELECT id FROM review_drafts WHERE task_id = k.id ORDER BY created_at DESC, rowid DESC LIMIT 1)
            JOIN record_events p ON p.aggregate_type = 'review_draft' AND p.aggregate_id = d.id AND p.type = 'review_draft.posted'
            WHERE k.state = 'open' AND d.state = 'posted'
              AND NOT EXISTS (SELECT 1 FROM record_events e WHERE e.aggregate_type = 'task' AND e.aggregate_id = k.id
                AND e.type IN ('task.done', 'task.reopened') AND e.sequence > p.sequence)`
          for (const one of left) {
            const row = yield* load(one.draftId)
            yield* sql.withTransaction(settle(row, instance.systemId))
            yield* touchCard(row.taskId)
          }
        }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not settle the reviews left posted on an open task', cause))),
      )

      // A review's lead reads the pull request and drafts its review, and nothing else: every lead tool that isn't one a review
      // is given (`inReview`) is refused to it, listed or not, as it could change the project or reach outside it (keep how the
      // project runs, which Althar later runs outside any sandbox; reply or push; finish a step). Read from the task each call.
      yield* toolServer.guard('lead', (tool, access) =>
        tool.inReview === true
          ? Effect.succeed(null)
          : provide(reviewOf(access.taskId ?? '')).pipe(
              Effect.map((review) =>
                review === null
                  ? null
                  : `This task reviews someone else’s pull request: you read it, with read_pull_request for what it says, and finish it with draft_review, which the person posts. ${tool.name} isn’t for a review.`,
              ),
              Effect.orElseSucceed(() => 'Althar couldn’t tell whether this task may use that. Try again, or tell the person.'),
            ),
      )

      yield* toolServer.serve('lead', [
        {
          name: 'draft_review',
          inReview: true,
          description:
            "Drafts your review of the pull request this task reviews, once you have read it: your verdict (approve, changes, or comment), a summary of a few lines in Markdown, and comments, each on a line of the change as it now reads (a file's path from the repository's root, and its line number in the new file), with its severity: blocking, major, minor or nit. It posts nothing: the person sees it as a card, keeps or drops each comment, chooses the verdict (yours is a suggestion) and posts it. Called again, it replaces the draft that waits.",
          input: {
            type: 'object',
            properties: {
              verdict: { type: 'string', enum: ['approve', 'changes', 'comment'] },
              summary: { type: 'string', description: 'Markdown: what it does, and what you found.' },
              comments: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    path: { type: 'string', description: "The file's path from the repository's root." },
                    line: { type: 'integer', minimum: 1, description: 'Its line number in the file as the pull request has it.' },
                    body: { type: 'string', description: 'Markdown.' },
                    severity: { type: 'string', enum: ['blocking', 'major', 'minor', 'nit'] },
                  },
                  required: ['path', 'line', 'body', 'severity'],
                },
              },
            },
            required: ['verdict', 'summary'],
          },
          call: (value, access) =>
            provide(draft(access, value)).pipe(
              Effect.catch((error) =>
                error instanceof ToolRefused
                  ? Effect.fail(error)
                  : Effect.andThen(
                      Effect.logWarning('draft_review did not succeed', error),
                      Effect.fail(new ToolRefused({ message: 'Althar could not keep that draft. Try again, or tell the person.' })),
                    ),
              ),
            ),
        },
      ])

      return Reviews.of({ start, change: changeDraft, post, discard })
    }),
  )
}
