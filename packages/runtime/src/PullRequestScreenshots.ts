import { type PictureReport, type ScreenshotNow, type ScreenshotsOnChange, screenshotsNow } from '@althar/contracts'
import type { ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { Clock, Context, type Crypto, Duration, Effect, Layer, Option, Schema, Scope } from 'effect'
import { SqlClient } from 'effect/sql'

import { Artifacts } from './Artifacts'
import { touchTask } from './cards'
import { type ChangeSummary, Changes, type OnHost } from './Changes'
import { RuntimeConfig } from './Config'
import { Connections } from './Connections'
import { ScreenshotsRefused } from './errors'
import { evidenceOf } from './evidence'
import { contained } from './Failures'
import { Instance } from './Instance'
import { Policies, postsScreenshots } from './Policies'
import { timestamp } from './records'
import {
  changedBetween,
  commentBody,
  earlierAfter,
  isScreenshotsComment,
  type Kept,
  PostedShot,
  postingOf,
  standingOf,
  updatedNote,
} from './screenshotsComment'

/*
 * A task's screenshots on its pull request (ADR-076): the ones its Outputs
 * show as it is now (`screenshotsNow`, which the window draws by too), in
 * one comment Althar writes, and writes anew as they change. The person
 * posts them, leaving out the views they choose, which stay out of that
 * pull request from then on; or, where the project's rules say, Althar posts
 * them on its own as they change, as listening goes round. Each picture is
 * uploaded to the host once, by its digest: the host keeps an upload for
 * good, so one never goes twice. Where reviewers have reviewed since the
 * comment was last written, a line says the screenshots changed, as an edit
 * tells nobody. What Althar posts on its own and couldn't is kept on its
 * card, and tried again a while later.
 */

/** How long after posting on its own failed it is tried again, the screenshots unchanged. */
export const RETRY_AFTER = Duration.minutes(10)

type Store = SqlClient.SqlClient | Instance | Ledger | Crypto.Crypto | Changes | Connections | Artifacts | Policies | RuntimeConfig

export class PullRequestScreenshots extends Context.Service<
  PullRequestScreenshots,
  {
    /** How the task's screenshots stand on each of its open pull requests whose host takes pictures, by its address. */
    onChanges(taskId: string): Effect.Effect<ReadonlyMap<string, ScreenshotsOnChange>>
    /**
     * Puts the task's screenshots, as its Outputs show them now, in the
     * comment on its pull request at `url`, or writes that comment anew;
     * `leftOut` the views the person left out, kept from then on. Without
     * it, those left out before stay out.
     */
    post(input: { readonly taskId: string; readonly url: string; readonly leftOut?: ReadonlyArray<string> }): Effect.Effect<void, unknown>
    /**
     * Posts what changed on each open pull request of a project's tasks, or
     * of one task, where its rules post screenshots on their own: as the
     * rules are newly turned so. Done apart: this returns before any is
     * posted. One that fails says so on its card.
     */
    syncNow(where: { readonly projectId: string } | { readonly taskId: string }): Effect.Effect<void>
  }
>()('@althar/runtime/PullRequestScreenshots') {
  static readonly layer: Layer.Layer<PullRequestScreenshots, never, Store> = Layer.effect(
    PullRequestScreenshots,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const changes = yield* Changes
      const connections = yield* Connections
      const artifacts = yield* Artifacts
      const policies = yield* Policies
      const every = (yield* RuntimeConfig).listenEvery ?? Duration.seconds(30)
      const scope = yield* Scope.Scope
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)
      const decodeShots = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(PostedShot)))
      const decodeKeys = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)))
      const decodeUploads = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)))

      /** The task's screenshots as its Outputs show them now: its lead's reports since it became a change. */
      const nowOf = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const rows = yield* sql<{ id: string; sequence: number; createdAt: string; content: string }>`
            SELECT i.id, i.sequence, i.created_at, i.content FROM thread_items i JOIN threads t ON t.id = i.thread_id AND t.kind = 'task'
            WHERE t.task_id = ${taskId} AND i.kind = 'step_result' AND json_extract(i.content, '$.step') IN ('implement', 'settle')
            ORDER BY i.sequence`
          const [made] = yield* sql<{ at: string | null }>`
            SELECT e.occurred_at AS at FROM record_events e WHERE e.aggregate_type = 'task' AND e.aggregate_id = ${taskId}
              AND e.type = 'task.made_change' ORDER BY e.sequence DESC LIMIT 1`
          const reports = rows.map((row): PictureReport => ({
            id: row.id,
            sequence: row.sequence,
            createdAt: row.createdAt,
            evidence: evidenceOf(parsed(row.content).evidence),
          }))
          // A task with a pull request is a change: its screenshots are those since it became one.
          return screenshotsNow(reports, { change: true, since: made?.at ?? null })
        })

      /** What Althar keeps of a pull request's screenshots, by its link: nothing before they were first posted. */
      const keptOf = (linkId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<{
            commentId: string | null
            commentUrl: string | null
            shown: string
            earlier: string
            leftOut: string
            uploads: string
            postedAt: string | null
            failed: string | null
            updatedAt: string
          }>`SELECT comment_id, comment_url, shown, earlier, left_out, uploads, posted_at, failed, updated_at
              FROM pull_request_pictures WHERE link_id = ${linkId}`
          if (row === undefined) return undefined
          return {
            commentId: row.commentId,
            commentUrl: row.commentUrl,
            shown: Option.getOrElse(decodeShots(row.shown), () => []),
            earlier: Option.getOrElse(decodeShots(row.earlier), () => []),
            leftOut: Option.getOrElse(decodeKeys(row.leftOut), () => []),
            uploads: Option.getOrElse(decodeUploads(row.uploads), () => ({})),
            postedAt: row.postedAt,
            failed: row.failed,
            updatedAt: row.updatedAt,
          } satisfies Kept
        })

      /** Keeps what changed of a pull request's screenshots, as one row per pull request. */
      const keep = (linkId: string, projectId: ProjectId, set: Partial<Omit<Kept, 'updatedAt'>>) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const at = yield* timestamp
          const columns = {
            ...(set.commentId === undefined ? {} : { commentId: set.commentId }),
            ...(set.commentUrl === undefined ? {} : { commentUrl: set.commentUrl }),
            ...(set.shown === undefined ? {} : { shown: JSON.stringify(set.shown) }),
            ...(set.earlier === undefined ? {} : { earlier: JSON.stringify(set.earlier) }),
            ...(set.leftOut === undefined ? {} : { leftOut: JSON.stringify(set.leftOut) }),
            ...(set.uploads === undefined ? {} : { uploads: JSON.stringify(set.uploads) }),
            ...(set.postedAt === undefined ? {} : { postedAt: set.postedAt }),
            ...(set.failed === undefined ? {} : { failed: set.failed }),
            updatedAt: at,
          }
          const [had] = yield* sql<{ revision: number }>`SELECT revision FROM pull_request_pictures WHERE link_id = ${linkId}`
          if (had === undefined) yield* sql`INSERT INTO pull_request_pictures ${sql.insert({ linkId, projectId, ...columns })}`
          else yield* sql`UPDATE pull_request_pictures SET ${sql.update(columns)}, revision = revision + 1 WHERE link_id = ${linkId}`
        })

      /** Whether the project's rules post screenshots on their own. */
      const synced = (projectId: string) =>
        Effect.map(policies.current(projectId as ProjectId), (current) => postsScreenshots(current.rules)).pipe(
          Effect.orElseSucceed(() => false),
        )

      /** The task's open pull requests whose host takes pictures in its conversations, with the project they're in. */
      const openOf = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const links = yield* sql<{ id: string; projectId: ProjectId; connectionId: string | null }>`
            SELECT id, project_id, connection_id FROM external_links WHERE task_id = ${taskId} AND kind = 'change' ORDER BY created_at`
          const all = yield* changes.ofTask(taskId)
          return yield* Effect.forEach(links, (link) =>
            Effect.gen(function* () {
              const change = all.find((one) => one.linkId === link.id)
              if (change === undefined || change.state !== 'open' || link.connectionId === null) return []
              // What the host can do is the connection's own, read here without asking it anything.
              const takes = yield* Effect.map(
                connections.adapters(link.connectionId),
                (adapters) => adapters.host?.capabilities.pictures === true,
              ).pipe(Effect.orElseSucceed(() => false))
              return takes ? [{ linkId: link.id, projectId: link.projectId, change }] : []
            }),
          ).pipe(Effect.map((each) => each.flat()))
        })

      const onChanges = (taskId: string) =>
        Effect.gen(function* () {
          const open = yield* openOf(taskId)
          const shown = new Map<string, ScreenshotsOnChange>()
          if (open.length === 0) return shown
          const now = yield* nowOf(taskId)
          const rules = yield* synced(open[0]?.projectId ?? '')
          for (const one of open) shown.set(one.change.url, standingOf(now, yield* keptOf(one.linkId), rules))
          return shown
        })

      /** Uploads each picture the comment shows that its host hasn't had yet, keeping each as it goes up: one never goes twice. */
      const uploaded = (on: OnHost, posting: ReturnType<typeof postingOf>, kept: Kept | undefined) =>
        Effect.gen(function* () {
          const upload = on.host.uploadPicture
          if (upload === undefined) return yield* refuse('no_pictures', on.change)
          const uploads: Record<string, string> = { ...kept?.uploads }
          for (const shot of posting) {
            if (uploads[shot.digest] !== undefined) continue
            const bytes = yield* artifacts.read(shot.digest)
            if (bytes === null)
              return yield* new ScreenshotsRefused({
                why: 'unkept',
                message: `Althar no longer keeps the picture for “${shot.caption}”. Ask the lead to take it again, or leave it out.`,
              })
            uploads[shot.digest] = yield* upload(on.repository, { bytes, name: shot.name, mediaType: shot.mediaType })
            yield* keep(on.linkId, on.projectId, { uploads })
          }
          return uploads
        })

      /**
       * The comment that shows the screenshots, where there is one: the one
       * Althar keeps, while it is there, else one of the account's own with
       * the mark, as when the record of posting it was lost.
       */
      const commentOf = (on: OnHost, kept: Kept | undefined) =>
        Effect.gen(function* () {
          if (kept?.commentId != null) return kept.commentId
          const activity = yield* on.host.activity(on.repository, on.change.number, null)
          const found = activity.comments.find(
            (comment) => comment.threadId === null && comment.author.id === on.account.id && isScreenshotsComment(comment.body),
          )
          return found?.id ?? null
        })

      const post = (input: { readonly taskId: string; readonly url: string; readonly leftOut?: ReadonlyArray<string> }) =>
        changes.exclusive(
          input.taskId,
          Effect.gen(function* () {
            const on = yield* changes.pullRequest(input.taskId, input.url)
            const edit = on.host.editComment
            if (!on.host.capabilities.pictures || on.host.uploadPicture === undefined || edit === undefined)
              return yield* refuse('no_pictures', on.change)
            const kept = yield* keptOf(on.linkId)
            const leftOut = [...(input.leftOut ?? kept?.leftOut ?? [])]
            // What is left out is kept first: it holds whatever happens to the rest.
            if (input.leftOut !== undefined) yield* keep(on.linkId, on.projectId, { leftOut })
            const posting = postingOf(yield* nowOf(input.taskId), leftOut)
            if (posting.length === 0)
              return yield* new ScreenshotsRefused({
                why: 'none',
                message:
                  leftOut.length > 0
                    ? 'Every screenshot is left out. Choose at least one to post.'
                    : 'There are no screenshots to post yet.',
              })
            const uploads = yield* uploaded(on, posting, kept)
            const head = on.change.headSha
            const shown = posting.map((shot): PostedShot => ({
              key: shot.key,
              caption: shot.caption,
              digest: shot.digest,
              url: uploads[shot.digest] ?? '',
              head,
            }))
            // A view shown again as it was keeps the commit it was taken of.
            const before = new Map((kept?.shown ?? []).map((shot) => [shot.key, shot]))
            const posted = shown.map((shot) => {
              const was = before.get(shot.key)
              return was !== undefined && was.digest === shot.digest ? { ...shot, head: was.head } : shot
            })
            const earlier = earlierAfter(kept?.shown ?? [], kept?.earlier ?? [], posted)
            const body = commentBody({ shown: posted, earlier, head })
            const changed = changedBetween(posting, kept?.shown ?? [])
            const existing = yield* commentOf(on, kept)
            // Written anew where it is still there; posted again where someone deleted it.
            const written =
              existing === null
                ? null
                : yield* edit(on.repository, on.change.number, existing, body).pipe(
                    Effect.map(Option.some),
                    Effect.catchIf(
                      (error) => error.reason === 'not_found',
                      () => Effect.succeed(Option.none()),
                    ),
                  )
            const comment =
              written !== null && Option.isSome(written)
                ? written.value
                : yield* on.host.reply(on.repository, on.change.number, { body, threadId: null })
            const updating = written !== null && Option.isSome(written)
            // An edit tells nobody: reviewers who reviewed since it was last written are told it changed, in a line.
            if (updating && changed > 0 && kept?.postedAt != null) {
              const since = yield* on.host.activity(on.repository, on.change.number, kept.postedAt)
              const reviewed = since.reviews.some((review) => review.author.id !== on.account.id && review.at > (kept.postedAt ?? ''))
              if (reviewed)
                yield* on.host.reply(on.repository, on.change.number, { body: updatedNote(changed, comment.url), threadId: null })
            }
            yield* keep(on.linkId, on.projectId, {
              commentId: comment.id,
              commentUrl: comment.url,
              shown: posted,
              earlier,
              leftOut,
              uploads,
              postedAt: comment.at,
              failed: null,
            })
            yield* touchTask(input.taskId)
          }).pipe(
            // A try that failed is said on the card, until one goes up.
            Effect.tapError((error) =>
              Effect.gen(function* () {
                const at = yield* Effect.option(changes.pullRequest(input.taskId, input.url))
                if (Option.isNone(at)) return
                yield* keep(at.value.linkId, at.value.projectId, { failed: failureWords(error) })
                yield* touchTask(input.taskId)
              }).pipe(Effect.ignore),
            ),
            provide,
          ),
        )

      /** Posts what changed on a task's open pull requests, where its project's rules say: one that fails keeps to itself. */
      const syncTask = (taskId: string, force: boolean) =>
        Effect.gen(function* () {
          const open = yield* openOf(taskId)
          if (open.length === 0 || !(yield* synced(open[0]?.projectId ?? ''))) return
          const now = yield* nowOf(taskId)
          const clock = yield* Clock.currentTimeMillis
          for (const one of open) {
            const kept = yield* keptOf(one.linkId)
            const standing = standingOf(now, kept, true)
            if (standing.standing === 'posted' || (standing.standing === 'unposted' && standing.changed === 0)) continue
            // One that failed waits a while before it is tried again by itself.
            if (!force && kept?.failed != null && Date.parse(kept.updatedAt) + Duration.toMillis(RETRY_AFTER) > clock) continue
            yield* post({ taskId, url: one.change.url }).pipe(contained('Screenshots.sync', () => undefined))
          }
        })

      /** The open tasks with an open pull request, of a project or all. */
      const tasksOf = (projectId: string | null) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const rows = yield* sql<{ taskId: string }>`
            SELECT DISTINCT l.task_id FROM external_links l JOIN tasks k ON k.id = l.task_id
            WHERE l.kind = 'change' AND k.state = 'open' AND json_extract(l.snapshot, '$.state') = 'open'
              AND (${projectId} IS NULL OR l.project_id = ${projectId})`
          return rows.map((row) => row.taskId)
        })

      const syncAll = (projectId: string | null, force: boolean) =>
        Effect.gen(function* () {
          for (const taskId of yield* tasksOf(projectId))
            yield* syncTask(taskId, force).pipe(contained('Screenshots.sync', () => undefined))
        })

      // As listening goes round: what changed goes up where the rules say, and a try that failed again once its wait is over.
      yield* Effect.forkScoped(
        provide(
          Effect.forever(Effect.andThen(Effect.sleep(every), syncAll(null, false).pipe(contained('Screenshots.round', () => undefined)))),
        ),
      )

      return PullRequestScreenshots.of({
        onChanges: (taskId) => provide(onChanges(taskId)).pipe(Effect.orElseSucceed(() => new Map())),
        post: (input) => post(input),
        syncNow: (where) =>
          Effect.asVoid(
            Effect.forkIn(
              provide('projectId' in where ? syncAll(where.projectId, true) : syncTask(where.taskId, true)).pipe(
                contained('Screenshots.sync', () => undefined),
              ),
              scope,
            ),
          ),
      })
    }),
  )
}

const parsed = (content: string): { readonly evidence?: unknown } => {
  try {
    const value: unknown = JSON.parse(content)
    return typeof value === 'object' && value !== null ? value : {}
  } catch {
    return {}
  }
}

const refuse = (why: 'no_pictures', change: ChangeSummary) =>
  new ScreenshotsRefused({
    why,
    message: `${hostName(change.product)} doesn’t take pictures in a ${change.words.noun}’s conversation, so Althar can’t post screenshots there.`,
  })

const hostName = (product: string) =>
  product === 'github' ? 'GitHub' : product === 'gitlab' ? 'GitLab' : product.startsWith('bitbucket') ? 'Bitbucket' : 'This host'

/** A failure in a few words for the card: a refusal's own, else the host's, else that it failed. */
const failureWords = (error: unknown): string => {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' && error.message !== '')
    return error.message.slice(0, 300)
  return 'Posting the screenshots failed.'
}
