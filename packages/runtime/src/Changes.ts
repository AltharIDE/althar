import { createHash } from 'node:crypto'

import {
  type Account,
  ChangeRequest,
  Comment,
  ConnectorFailed,
  hostedOf,
  parseRemote,
  type Person,
  type Product,
  type Repository,
} from '@althar/connectors'
import { type ActorId, Ids, newId, type ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { Cause, Clock, Context, type Crypto, Duration, Effect, Layer, Option, Queue, Schema, Semaphore } from 'effect'
import { SqlClient } from 'effect/sql'

import { touchCard } from './cards'
import { Agents, RuntimeConfig } from './Config'
import { Connections, NotConnected } from './Connections'
import { envelope } from './envelope'
import { CantMerge, ChangedSinceSeen, NotFound } from './errors'
import { conventionsAt, ruleOf, titleFor } from './conventions'
import { commitOf, commitsAhead, gitOutcome, onHead, pushTo, uncommittedFiles } from './git'
import { Instance } from './Instance'
import { applyMerges, planMerge } from './localMerge'
import { outward, reconcileOutward } from './outward'
import {
  answerHint,
  bodyOf,
  checksForLead,
  checksLine,
  checksOf,
  commentForLead,
  commentLine,
  fromAlthar,
  logOf,
  nameOf,
  outsidersLine,
  signed,
  reviewForLead,
  reviewLine,
  standing,
} from './pullRequestWords'
import { change, fact, timestamp } from './records'
import { Policies } from './Policies'
import { Sessions } from './Sessions'
import { addItem } from './threads'
import { ToolRefused, ToolServer, type ToolAccess } from './ToolServer'

/*
 * A task's change on its code host (docs/architecture/06; docs/plans/
 * integrations.md): the pull request it ends with, and listening to it.
 *
 * Publishing pushes what the lead committed on the task's branch, with the
 * connection's token, and opens a draft pull request, or adopts the one
 * already open from the branch. What the lead left uncommitted stays in the
 * worktree, and the step says so. The issue's key leads its title; its body
 * is what the steps reported. Each outward action is recorded as intent
 * first, with its receipt after.
 *
 * Listening asks the code host, while the app runs, what changed: the pull
 * request's state, its checks once they finish, and what people said on it.
 * Each arrives in the task's thread once. Failed checks, and what the person
 * and the repository's own people say, also go to the lead, when one is
 * running, to answer on the pull request or fix. Anyone else on a public
 * repository arrives in the thread only, for the person to pass on. Bots,
 * and Althar's own replies (known by their receipts), aren't passed on. A
 * pull request is asked every 30 seconds while something is happening on
 * it, and every few minutes once it has been quiet a while.
 */

/** What Althar last saw of a change, as its external link keeps it. */
const Snapshot = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  url: Schema.String,
  state: Schema.Literals(['open', 'merged', 'closed']),
  draft: Schema.Boolean,
  headSha: Schema.NullOr(Schema.String),
  additions: Schema.NullOr(Schema.Number),
  deletions: Schema.NullOr(Schema.Number),
  changedFiles: Schema.NullOr(Schema.Number),
  repository: Schema.Array(Schema.String),
  words: Schema.Struct({ noun: Schema.String, short: Schema.String, prefix: Schema.String }),
  checks: Schema.NullOr(
    Schema.Struct({
      sha: Schema.String,
      outcome: Schema.Literals(['none', 'running', 'passed', 'failed']),
      passed: Schema.Number,
      failed: Schema.Number,
      running: Schema.Number,
      total: Schema.Number,
      failing: Schema.Array(Schema.String),
      list: Schema.optional(
        Schema.Array(
          Schema.Struct({
            name: Schema.String,
            state: Schema.Literals(['queued', 'running', 'passed', 'failed', 'skipped', 'cancelled', 'neutral']),
            summary: Schema.NullOr(Schema.String),
          }),
        ),
      ),
    }),
  ),
})
type Snapshot = typeof Snapshot.Type

/** A task's change, as the card, the header and the accept view show it. */
export interface ChangeSummary extends Snapshot {
  readonly linkId: string
  readonly product: Product
  readonly listening: boolean
}

/** The code host a project's repository is on, as its remotes say, and whether Althar is connected to it there. */
export interface Host {
  readonly product: Product
  readonly name: string
  readonly webUrl: string
  readonly connected: boolean
}

/**
 * What publishing did: opened (or adopted) a pull request, pushed the branch
 * only, or found nothing to propose; and the files the lead left uncommitted,
 * which weren't.
 */
export type PublishedOne = (
  | { readonly kind: 'opened'; readonly change: ChangeSummary }
  | { readonly kind: 'pushed'; readonly branch: string }
  | { readonly kind: 'nothing' }
  /** Left on its branch: in a task of several repositories, one on no code host Althar knows. */
  | { readonly kind: 'branch' }
) & { readonly left: ReadonlyArray<string>; readonly repository: string }

/** What publishing did in each of the task's repositories, the project's first first. */
export type Published = ReadonlyArray<PublishedOne>

/** How long a pull request with nothing new counts as quiet, and how much less often a quiet one is asked. */
const QUIET_AFTER = Duration.minutes(10)
const QUIET_SLOWER = 10

/**
 * Whether a listened change is due to be asked again: every turn while
 * something has happened on it lately, every few turns once it is quiet.
 */
export const listenDue = (input: {
  readonly now: number
  readonly polledAt: number | undefined
  readonly newsAt: number
  readonly every: Duration.Duration
}) => {
  if (input.polledAt === undefined) return true
  const every = Duration.toMillis(input.every)
  const quiet = input.now - input.newsAt >= Duration.toMillis(QUIET_AFTER)
  // Half a turn's slack, so a change asked every turn isn't skipped for a few milliseconds.
  return input.now - input.polledAt >= (quiet ? every * QUIET_SLOWER : every) - every / 2
}

/** How many failing checks' logs the lead gets, and how many comments a reading of the pull request shows. */
const LOGS_TO_LEAD = 2
const COMMENTS_SHOWN = 30

const snapshotOf = (
  change: ChangeRequest,
  repository: ReadonlyArray<string>,
  words: Snapshot['words'],
  checks: Snapshot['checks'],
): Snapshot => ({
  number: change.number,
  title: change.title,
  url: change.url,
  state: change.state,
  draft: change.draft,
  headSha: change.headSha,
  additions: change.additions,
  deletions: change.deletions,
  changedFiles: change.changedFiles,
  repository: [...repository],
  words: { noun: words.noun, short: words.short, prefix: words.prefix },
  checks,
})

type Store =
  | SqlClient.SqlClient
  | Instance
  | Ledger
  | Crypto.Crypto
  | Connections
  | Sessions
  | RuntimeConfig
  | ToolServer
  | Agents
  | Policies

interface LinkRow {
  readonly id: string
  readonly projectId: ProjectId
  readonly taskId: string
  readonly connectionId: string | null
  readonly product: Product
  readonly snapshot: string
  readonly cursor: string | null
  readonly listening: number
}

export class Changes extends Context.Service<
  Changes,
  {
    /**
     * Pushes the task's branch and, unless its ending is to push only, opens
     * its pull request (a draft, or for review); nothing, when the branch has
     * no commits to propose.
     */
    publish(input: {
      readonly projectId: ProjectId
      readonly taskId: string
      readonly runId: string
      readonly end: 'draft' | 'ready' | 'none'
    }): Effect.Effect<Published, unknown>
    /**
     * Pushes the task's branch to its open pull request, up to the commit the
     * person saw: theirs to do, after looking at what the lead committed. One
     * that isn't on the branch any more isn't pushed.
     */
    push(taskId: string, head: string, url?: string): Effect.Effect<{ readonly change: ChangeSummary }, unknown>
    /** Marks the task's draft pull request ready for review: the person's to do. */
    markReady(taskId: string, url?: string): Effect.Effect<void, unknown>
    /**
     * Merges the task's pull request at the head the person saw, because
     * they said to, marking a draft ready first; one that moved on since
     * isn't merged. Agents never merge.
     */
    merge(taskId: string, head: string, url?: string): Effect.Effect<void, unknown>
    /**
     * Merges the task's branch into each of its repositories' default
     * branches on this Mac, up to the commit the person saw in each, where it
     * has no pull request: all of them or none, and nothing pushed. Its task
     * settles.
     */
    mergeHere(
      taskId: string,
      heads: ReadonlyArray<{ readonly repository: string; readonly head: string }>,
    ): Effect.Effect<ReadonlyArray<{ readonly repository: string; readonly branch: string; readonly already: boolean }>, unknown>
    /** Replies on the task's pull request, in a comment's thread or its conversation, signed as from Althar and the agent that wrote it. */
    reply(
      taskId: string,
      reply: { readonly body: string; readonly threadId: string | null; readonly by: string | null },
    ): Effect.Effect<ChangeSummary, unknown>
    /** The pull request as it stands, in words for an agent: its state, checks (a failure's log), and what was said. */
    read(taskId: string): Effect.Effect<string, unknown>
    /** The task's changes, as last seen. */
    ofTask(taskId: string): Effect.Effect<ReadonlyArray<ChangeSummary>, unknown>
    /** Asks the code host now, rather than at the next turn of listening. */
    refresh(taskId: string): Effect.Effect<void>
    /** Does something with a task's pull request as one action: one at a time with replying, pushing, marking ready and merging. */
    exclusive<A, E, R>(taskId: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>
    /**
     * How a task of the project ends when its plan doesn't say, worked out
     * once, when the plan is made: as the project's rules say, else a draft
     * pull request where its repository's host is connected, else on its
     * branch. A project that wants a pull request where no host Althar
     * knows is named ends on its branch, as it always has.
     */
    endFor(projectId: string, taskId?: string): Effect.Effect<'draft' | 'ready' | 'none' | null, unknown>
    /**
     * The code host the project's repositories are on, and whether Althar is
     * connected to it: the first connected, else the first Althar knows; null
     * where their remotes name none it knows.
     */
    hostFor(projectId: string): Effect.Effect<Host | null>
  }
>()('@althar/runtime/Changes') {
  static readonly layer: Layer.Layer<Changes, never, Store> = Layer.effect(
    Changes,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const connections = yield* Connections
      const sessions = yield* Sessions
      const toolServer = yield* ToolServer
      const agents = yield* Agents
      const every = (yield* RuntimeConfig).listenEvery ?? Duration.seconds(30)
      /* One thing at a time on a task's pull request: a reply's receipt is kept before listening reads the reply back. */
      const locks = new Map<string, Semaphore.Semaphore>()
      const locked = (taskId: string) => {
        const known = locks.get(taskId)
        if (known !== undefined) return known.withPermits(1)
        const made = Semaphore.makeUnsafe(1)
        locks.set(taskId, made)
        return made.withPermits(1)
      }
      /* When each task's pull request last had news, and when each was last asked: quiet ones are asked less often. */
      const newsAt = new Map<string, number>()
      const polledAt = new Map<string, number>()
      const news = (taskId: string) => Effect.map(Clock.currentTimeMillis, (now) => void newsAt.set(taskId, now))
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)
      const decodeSnapshot = Schema.decodeUnknownEffect(Schema.fromJsonString(Snapshot))

      const linksOf = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql<LinkRow>`
            SELECT id, project_id, task_id, connection_id, product, snapshot, cursor, listening FROM external_links
            WHERE task_id = ${taskId} AND kind = 'change' ORDER BY created_at`
        })

      const summaryOf = (link: LinkRow) =>
        Effect.map(decodeSnapshot(link.snapshot), (snapshot): ChangeSummary => ({
          ...snapshot,
          linkId: link.id,
          product: link.product,
          listening: link.listening === 1,
        }))

      /**
       * The task's open change, and its host: what the person's actions and the
       * lead's tools act on. In a task of several repositories, the one at `url`;
       * without it, the first.
       */
      const current = (taskId: string, url?: string) =>
        Effect.gen(function* () {
          const all = yield* linksOf(taskId)
          const links =
            url === undefined
              ? all
              : yield* Effect.filter(all, (candidate) =>
                  Effect.map(Effect.option(decodeSnapshot(candidate.snapshot)), (seen) => Option.isSome(seen) && seen.value.url === url),
                )
          const link = links.find((candidate) => candidate.connectionId !== null) ?? links[0]
          if (link === undefined) return yield* new NotFound({ kind: 'pull request', id: taskId })
          if (link.connectionId === null) return yield* new NotConnected({ product: link.product, what: 'the task’s pull request' })
          const adapters = yield* connections.adapters(link.connectionId)
          if (adapters.host === undefined) return yield* new NotConnected({ product: link.product, what: 'the task’s pull request' })
          const snapshot = yield* decodeSnapshot(link.snapshot)
          const repository = yield* adapters.host.repository(snapshot.repository)
          return { link, snapshot, host: adapters.host, repository, account: adapters.info.account }
        })

      /** What the steps reported, as the pull request's description: in the repository's template, where it has one. */
      const bodyFor = (
        taskId: string,
        threadId: string,
        issue: { readonly key: string; readonly url: string; readonly sameHost: boolean } | null,
        repository: { readonly slug: string; readonly template: string | null },
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [lead] = yield* sql<{ summary: string }>`
            SELECT json_extract(content, '$.summary') AS summary FROM thread_items WHERE thread_id = ${threadId} AND kind = 'step_result'
              AND json_extract(content, '$.step') IN ('implement', 'settle') ORDER BY sequence DESC LIMIT 1`
          // The lead's latest description in the template, for this repository.
          const [written] =
            repository.template === null
              ? []
              : yield* sql<{ text: string | null }>`
                  SELECT json_extract(content, '$.descriptions.' || json_quote(${repository.slug})) AS text FROM thread_items
                  WHERE thread_id = ${threadId} AND kind = 'step_result'
                    AND json_extract(content, '$.descriptions.' || json_quote(${repository.slug})) IS NOT NULL
                  ORDER BY sequence DESC LIMIT 1`
          const findings = yield* sql<{ severity: string; location: string; claim: string; state: string; response: string | null }>`
            SELECT f.severity, f.location, f.claim, f.state, f.response FROM findings f
            JOIN node_attempts a ON a.id = f.review_attempt_id JOIN nodes n ON n.id = a.node_id
            JOIN workflow_executions e ON e.id = n.execution_id JOIN runs r ON r.id = e.run_id
            WHERE r.task_id = ${taskId} ORDER BY f.created_at`
          const [reviewed] = yield* sql<{ verdict: string | null; rounds: number }>`
            SELECT (SELECT json_extract(content, '$.verdict') FROM thread_items WHERE thread_id = ${threadId} AND kind = 'step_result'
                AND json_extract(content, '$.step') = 'review' ORDER BY sequence DESC LIMIT 1) AS verdict,
              (SELECT count(*) FROM thread_items WHERE thread_id = ${threadId} AND kind = 'step_result'
                AND json_extract(content, '$.step') = 'review') AS rounds`
          return bodyOf({
            lead: lead?.summary ?? null,
            review: reviewed === undefined ? null : reviewed,
            findings: findings.map((finding) => {
              const location = JSON.parse(finding.location) as { file?: string | null; line?: number | null }
              return { ...finding, file: location.file ?? null, line: location.line ?? null }
            }),
            issue,
            template: repository.template,
            written: written?.text ?? null,
          })
        })

      /** The hosts of a project's repositories, or of those a task changes, the first first: null for each on none Althar knows. */
      const hostsFor = (projectId: string, taskId?: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const bindings =
            taskId === undefined
              ? yield* sql<{ remotes: string }>`
                  SELECT remote_fingerprints AS remotes FROM repository_bindings WHERE project_id = ${projectId} AND detached_at IS NULL
                  ORDER BY created_at, rowid`
              : yield* sql<{ remotes: string }>`
                  SELECT b.remote_fingerprints AS remotes FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
                  WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} ORDER BY b.created_at, b.rowid`
          return yield* Effect.forEach(bindings, (binding) =>
            hostOfRemotes(
              Option.getOrElse(Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)))(binding.remotes), () => []),
            ),
          )
        })

      const hostFor = (projectId: string): Effect.Effect<Host | null, never, Store> =>
        Effect.map(
          hostsFor(projectId),
          (hosts) => hosts.find((host) => host?.connected === true) ?? hosts.find((host) => host !== null) ?? null,
        ).pipe(Effect.orElseSucceed(() => null))

      /** The host a repository's remotes are on, and whether Althar is connected to it; null where they name none it knows. */
      const hostOfRemotes = (remotes: ReadonlyArray<string>): Effect.Effect<Host | null, never, Store> =>
        Effect.gen(function* () {
          const connected = yield* connections.hostOf(remotes)
          if (connected !== null) {
            const { info } = yield* connections.adapters(connected.connectionId)
            return { product: info.product, name: info.name, webUrl: info.webUrl, connected: true }
          }
          const hosted = hostedOf(connections.products)
          for (const remote of remotes) {
            const ref = parseRemote(remote)
            const product = ref === null ? undefined : hosted.get(ref.host)
            const info = product === undefined ? undefined : connections.products.find((candidate) => candidate.product === product)
            if (info !== undefined && info.host && ref !== null)
              return { product: info.product, name: info.name, webUrl: `https://${ref.host}`, connected: false }
          }
          return null
        }).pipe(Effect.orElseSucceed(() => null))

      const publish = (input: {
        readonly projectId: ProjectId
        readonly taskId: string
        readonly runId: string
        readonly end: 'draft' | 'ready' | 'none'
      }): Effect.Effect<Published, unknown, Store> =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const tasks = yield* sql<{
            title: string
            name: string
            slug: string
            threadId: string
            workspaceId: string
            path: string
            branch: string
            baseCommit: string | null
            baseRef: string | null
            bindingId: string
            remotes: string
            defaultBase: string | null
          }>`
            SELECT k.title, b.display_name AS name, b.slug, t.id AS thread_id, w.id AS workspace_id, w.path, w.branch, w.base_commit, w.base_ref, b.id AS binding_id,
              b.remote_fingerprints AS remotes, b.default_base_ref AS default_base
            FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
            JOIN workspaces w ON w.task_id = k.id AND w.device_id = ${instance.deviceId}
            JOIN repository_bindings b ON b.id = w.binding_id
            WHERE k.id = ${input.taskId} ORDER BY b.created_at, b.rowid`
          if (tasks.length === 0) return yield* new NotFound({ kind: 'task', id: input.taskId })
          const [bound] = yield* sql<{ n: number }>`
            SELECT count(*) AS n FROM repository_bindings WHERE project_id = ${input.projectId} AND detached_at IS NULL`
          // Each repository on its own: one whose host isn't connected is said once the rest are done, for the person to connect and try again.
          const done: Array<PublishedOne> = []
          let unconnected: NotConnected | undefined
          for (const task of tasks) {
            const one = yield* Effect.exit(publishOne(input, task, { several: tasks.length > 1, ofSeveral: (bound?.n ?? 0) > 1 }))
            if (one._tag === 'Success') done.push({ ...one.value, repository: task.name })
            else {
              const error = Cause.findErrorOption(one.cause)
              if (Option.isSome(error) && error.value instanceof NotConnected) unconnected ??= error.value
              else return yield* Effect.failCause(one.cause)
            }
          }
          if (unconnected !== undefined) return yield* unconnected
          return done
        })

      /** Publishes one of the task's repositories: pushes its branch, and opens or adopts its pull request where the ending says to. */
      const publishOne = (
        input: { readonly projectId: ProjectId; readonly taskId: string; readonly runId: string; readonly end: 'draft' | 'ready' | 'none' },
        task: {
          readonly title: string
          readonly name: string
          readonly slug: string
          readonly threadId: string
          readonly workspaceId: string
          readonly path: string
          readonly branch: string
          readonly baseCommit: string | null
          readonly baseRef: string | null
          readonly bindingId: string
          readonly remotes: string
          readonly defaultBase: string | null
        },
        /** Whether the task changes several repositories, and whether its project has several. */
        { several, ofSeveral }: { readonly several: boolean; readonly ofSeveral: boolean },
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const remotes = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)))(task.remotes)
          const found = yield* connections.hostOf(remotes)
          // In a project of several, one on no host Althar knows ends on its branch. A project of one needs its host, which may be
          // one Althar can't tell by its address until it's connected; so does one on a host it knows but isn't connected to.
          if (found === null) {
            const known = yield* hostOfRemotes(remotes)
            if (known === null && ofSeveral) return { kind: 'branch', left: [] } as const
            return yield* new NotConnected({ product: known?.product ?? 'github', what: remotes[0] ?? 'the repository' })
          }
          const { host } = found
          const repository = yield* host.repository(found.path)
          // The repository as its host names it, not as the remote spells it: Bitbucket Data Center's has `scm/` in front.
          const path = repository.path
          // Althar pushes what the lead committed, never what it left lying in the worktree.
          const left = yield* uncommittedFiles(task.path)
          const base = task.baseCommit ?? task.baseRef ?? repository.defaultBranch
          if ((yield* commitsAhead(task.path, base)) === 0) return { kind: 'nothing', left } as const
          const head = yield* commitOf(task.path, 'HEAD')
          yield* pushTo(task.path, yield* host.pushTarget(repository), task.branch)
          if (input.end === 'none') return { kind: 'pushed', branch: task.branch, left } as const
          const draft = input.end === 'draft' && host.capabilities.drafts
          const [issueLink] = yield* sql<{
            id: string
            product: Product
            key: string
            url: string
            ref: string
            connectionId: string | null
          }>`
            SELECT id, product, key, url, ref, connection_id FROM external_links WHERE task_id = ${input.taskId} AND kind = 'issue' LIMIT 1`
          // A link's spelling of the repository may differ in case from the host's, which GitHub and GitLab don't mind.
          const sameHost =
            issueLink !== undefined &&
            issueLink.product === host.product &&
            issueLink.ref.toLowerCase().startsWith(`${path.join('/').toLowerCase()}#`)
          // The team's conventions, as the task's worktree has them now, under the person's own rule for titles.
          const conventions = yield* conventionsAt(task.path, 'HEAD')
          const rule = ruleOf('title', (yield* (yield* Policies).current(input.projectId)).rules.titlePattern)
          const title = titleFor(rule ?? conventions.title?.pattern ?? null, {
            title: task.title,
            issue: issueLink === undefined ? null : { key: issueLink.key, sameHost },
          })
          const body = yield* bodyFor(
            input.taskId,
            task.threadId,
            issueLink === undefined ? null : { key: issueLink.key, url: issueLink.url, sameHost },
            { slug: task.slug, template: conventions.template?.text ?? null },
          )
          const target = (task.baseRef ?? '').replace(/^origin\//, '') || task.defaultBase || repository.defaultBranch
          const opened = yield* outward({
            projectId: input.projectId,
            subject: { type: 'task', id: input.taskId },
            target: `${host.product}:${path.join('/')}`,
            operation: 'open_change',
            // One per repository: in a task of several, each opens its own; alone, the key it always had.
            key: `open_change:${input.taskId}:${task.branch}${several ? `:${task.bindingId}` : ''}`,
            request: { title, source: task.branch, target, draft },
            retryable: true,
            perform: host.openChange(repository, { title, body, source: task.branch, target, draft }),
            encode: (answer) => answer,
            decode: (kept) => Option.getOrUndefined(Schema.decodeUnknownOption(ChangeRequest)(kept)),
          })
          const snapshot = snapshotOf(opened, path, host.words, null)
          const linkId = yield* sql.withTransaction(
            Effect.gen(function* () {
              const at = yield* timestamp
              const [set] = yield* sql<{ id: string }>`SELECT id FROM change_sets WHERE run_id = ${input.runId}`
              const changeSetId = set?.id ?? (yield* newId(Ids.changeSet))
              if (set === undefined) {
                yield* sql`INSERT INTO change_sets ${sql.insert({ id: changeSetId, projectId: input.projectId, taskId: input.taskId, runId: input.runId, state: 'published', createdAt: at })}`
                yield* fact({
                  projectId: input.projectId,
                  aggregateType: 'change_set',
                  aggregateId: changeSetId,
                  revision: 1,
                  type: 'change_set.published',
                  actorId: instance.systemId,
                })
              }
              const [repositoryChange] = yield* sql<{ id: string }>`
                SELECT id FROM repository_changes WHERE change_set_id = ${changeSetId} AND binding_id = ${task.bindingId}`
              const pullRequestState = opened.state === 'open' ? (opened.draft ? 'draft' : 'ready') : opened.state
              if (repositoryChange === undefined)
                yield* sql`INSERT INTO repository_changes ${sql.insert({
                  id: yield* newId(Ids.repositoryChange),
                  projectId: input.projectId,
                  changeSetId,
                  bindingId: task.bindingId,
                  workspaceId: task.workspaceId,
                  baseCommit: task.baseCommit,
                  headCommit: head,
                  branch: task.branch,
                  pullRequestUrl: opened.url,
                  pullRequestState,
                  createdAt: at,
                  updatedAt: at,
                })}`
              else
                yield* change('repository_changes', repositoryChange.id, {
                  headCommit: head,
                  pullRequestUrl: opened.url,
                  pullRequestState,
                  updatedAt: at,
                })
              const [existing] = yield* sql<{ id: string }>`
                SELECT id FROM external_links WHERE task_id = ${input.taskId} AND kind = 'change' AND product = ${host.product} AND external_id = ${opened.id}`
              const id = existing?.id ?? (yield* newId(Ids.externalLink))
              if (existing === undefined)
                yield* sql`INSERT INTO external_links ${sql.insert({
                  id,
                  projectId: input.projectId,
                  taskId: input.taskId,
                  connectionId: found.connectionId,
                  product: host.product,
                  kind: 'change',
                  externalId: opened.id,
                  ref: `${path.join('/')}${host.words.prefix}${opened.number}`,
                  key: `${host.words.prefix}${opened.number}`,
                  url: opened.url,
                  snapshot: JSON.stringify(snapshot),
                  listening: 1,
                  createdAt: at,
                  updatedAt: at,
                })}`
              else yield* change('external_links', id, { snapshot: JSON.stringify(snapshot), listening: 1, updatedAt: at })
              yield* fact({
                projectId: input.projectId,
                aggregateType: 'external_link',
                aggregateId: id,
                revision: 1,
                type: 'external_link.change_opened',
                payload: { url: opened.url, number: opened.number, draft: opened.draft },
                actorId: instance.systemId,
              })
              return id
            }),
          )
          // The issue it came from gets a link to it, where its tracker has links.
          if (issueLink !== undefined && issueLink.connectionId !== null && !sameHost)
            yield* Effect.gen(function* () {
              const adapters = yield* connections.adapters(issueLink.connectionId ?? '')
              const tracker = adapters.tracker
              if (tracker === undefined || !tracker.capabilities.links) return
              const issue = yield* tracker.issue(issueLink.ref)
              yield* outward({
                projectId: input.projectId,
                subject: { type: 'external_link', id: issueLink.id },
                target: `${tracker.product}:${issueLink.key}`,
                operation: 'link_issue',
                key: `link_issue:${issueLink.id}:${opened.url}`,
                request: { url: opened.url },
                retryable: true,
                perform: tracker.link(issue, { url: opened.url, title: `${nameOf(snapshot)}: ${opened.title}` }),
                encode: () => true,
                decode: () => undefined,
              })
            }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not link the pull request to its issue', cause)))
          yield* touchCard(input.taskId)
          yield* news(input.taskId)
          wakeNow(input.taskId)
          const [row] = yield* linksOf(input.taskId)
          return {
            kind: 'opened',
            change: { ...snapshot, linkId, product: host.product, listening: row?.listening === 1 },
            left,
          } as const
        })

      /** Saves what was seen of a change, and tells the card. */
      const saveSnapshot = (link: LinkRow, snapshot: Snapshot, set: Readonly<Record<string, unknown>> = {}) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const at = yield* timestamp
              const revision = yield* change('external_links', link.id, { snapshot: JSON.stringify(snapshot), updatedAt: at, ...set })
              yield* fact({
                projectId: link.projectId,
                aggregateType: 'external_link',
                aggregateId: link.id,
                revision,
                type: 'external_link.seen',
                payload: { state: snapshot.state, draft: snapshot.draft, checks: snapshot.checks?.outcome ?? null },
                actorId: instance.systemId,
              })
              const pullRequestState = snapshot.state === 'open' ? (snapshot.draft ? 'draft' : 'ready') : snapshot.state
              yield* sql`UPDATE repository_changes SET pull_request_state = ${pullRequestState}, updated_at = ${at}, revision = revision + 1
                WHERE pull_request_url = ${snapshot.url} AND project_id = ${link.projectId}`
            }),
          )
          yield* touchCard(link.taskId)
        })

      const push = (taskId: string, head: string, url?: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const { link, snapshot, host, repository } = yield* current(taskId, url)
          // The worktree of the repository this pull request is from; the task's first, where the record doesn't say.
          const [workspace] = yield* sql<{ path: string; branch: string }>`
            SELECT w.path, w.branch FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId}
            ORDER BY w.id = (SELECT c.workspace_id FROM repository_changes c WHERE c.pull_request_url = ${snapshot.url} LIMIT 1) DESC,
              b.created_at, b.rowid
            LIMIT 1`
          if (workspace === undefined) return yield* new NotFound({ kind: 'task’s worktree', id: taskId })
          // What the person saw, and nothing the lead committed after: one rewritten away since isn't pushed.
          if (!(yield* onHead(workspace.path, head))) return yield* new ChangedSinceSeen({ taskId })
          yield* pushTo(workspace.path, yield* host.pushTarget(repository), workspace.branch, head)
          yield* sql`UPDATE repository_changes SET head_commit = ${head}, updated_at = ${yield* timestamp}, revision = revision + 1
            WHERE pull_request_url = ${snapshot.url} AND project_id = ${link.projectId}`
          yield* news(taskId)
          wakeNow(taskId)
          return { change: yield* summaryOf(link) }
        })

      const markReady = (taskId: string, url?: string) =>
        Effect.gen(function* () {
          const { link, snapshot, host, repository } = yield* current(taskId, url)
          if (!snapshot.draft || snapshot.state !== 'open') return
          const read = yield* host.change(repository, snapshot.number)
          const ready = yield* outward({
            projectId: link.projectId,
            subject: { type: 'external_link', id: link.id },
            target: `${host.product}:${snapshot.repository.join('/')}`,
            operation: 'mark_ready',
            key: `mark_ready:${link.id}`,
            request: { number: snapshot.number },
            retryable: true,
            perform: host.markReady(repository, read),
            encode: (answer) => answer,
            decode: (kept) => Option.getOrUndefined(Schema.decodeUnknownOption(ChangeRequest)(kept)),
          })
          yield* saveSnapshot(link, { ...snapshot, draft: ready.draft, state: ready.state })
        })

      /**
       * Merges the task's pull request at the head the person saw, as they
       * asked: a draft is marked ready first. If it has moved on since, by a
       * push now or while the host merges, it isn't merged, and the person
       * looks again. Read back at once, merged, its task settles.
       */
      const merge = (taskId: string, head: string, url?: string) =>
        Effect.gen(function* () {
          const { link, snapshot, host, repository } = yield* current(taskId, url)
          if (snapshot.state !== 'open') return
          const read = yield* host.change(repository, snapshot.number)
          if (read.state === 'open') {
            if (read.headSha !== head) return yield* new ChangedSinceSeen({ taskId })
            if (read.draft) yield* markReady(taskId)
            yield* outward({
              projectId: link.projectId,
              subject: { type: 'external_link', id: link.id },
              target: `${host.product}:${snapshot.repository.join('/')}`,
              operation: 'merge',
              // A merge at another head is another merge.
              key: `merge:${link.id}:${head}`,
              request: { number: snapshot.number, head },
              retryable: false,
              perform: host.merge(repository, { ...read, headSha: head }).pipe(
                // GitHub says 409 when the head moved while it merged.
                Effect.catchIf(
                  (error) => error instanceof ConnectorFailed && error.status === 409,
                  () => Effect.fail(new ChangedSinceSeen({ taskId })),
                ),
              ),
              encode: (answer) => answer,
              decode: (kept) => Option.getOrUndefined(Schema.decodeUnknownOption(ChangeRequest)(kept)),
            })
          }
          const [now] = (yield* linksOf(taskId)).filter((candidate) => candidate.id === link.id)
          if (now !== undefined) yield* poll(now)
        })

      /**
       * Merges here the task's repositories that have no pull request, into
       * each one's default branch: all of them or none. Those with one merge
       * through it; the task is done once every one is merged, either way.
       */
      const mergeHere = (taskId: string, heads: ReadonlyArray<{ readonly repository: string; readonly head: string }>) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [task] = yield* sql<{ state: string; title: string; projectId: ProjectId; threadId: string }>`
            SELECT k.state, k.title, k.project_id, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
            WHERE k.id = ${taskId}`
          if (task === undefined) return yield* new NotFound({ kind: 'task', id: taskId })
          const cant = (why: CantMerge['why'], detail = '') => new CantMerge({ taskId, why, detail })
          if (task.state !== 'open') return yield* cant('settled')
          const all = yield* sql<{
            slug: string
            name: string
            base: string
            root: string
            worktree: string
            branch: string
            opened: number
          }>`
            SELECT b.slug, b.display_name AS name, coalesce(b.default_base_ref, w.base_ref) AS base, l.path AS root, w.path AS worktree, w.branch,
              EXISTS (SELECT 1 FROM repository_changes c WHERE c.workspace_id = w.id AND c.pull_request_url IS NOT NULL) AS opened
            FROM workspaces w
            JOIN repository_bindings b ON b.id = w.binding_id
            JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId}
            ORDER BY b.created_at, b.rowid`
          const repositories = all.filter((repository) => repository.opened === 0)
          if (repositories.length === 0) return yield* cant('pull_request')
          const several = all.length > 1
          const named = (repository: (typeof repositories)[number], what: string) => (several ? `${repository.name}: ${what}` : what)
          // Worked out for every repository first: one that can't be merged stops them all.
          const plans = yield* Effect.forEach(repositories, (repository) =>
            Effect.gen(function* () {
              const head = heads.find((seen) => seen.repository === repository.slug)?.head
              if (head === undefined || !(yield* onHead(repository.worktree, head))) return yield* cant('changed')
              const plan = yield* planMerge(repository.root, repository.base, head, `Merge ${repository.branch}\n\n${task.title}`)
              return { repository, plan }
            }),
          )
          const conflicts = plans.flatMap(({ repository, plan }) =>
            plan.kind === 'conflicts' ? [named(repository, plan.files.join(', '))] : [],
          )
          if (conflicts.length > 0) return yield* cant('conflicts', conflicts.join('; '))
          const missing = plans.find(({ plan }) => plan.kind === 'missing')
          if (missing !== undefined) return yield* cant('missing', missing.repository.base)
          for (const { plan } of plans)
            if (plan.kind === 'busy')
              return yield* plan.untracked.length > 0
                ? cant('untracked', `${plan.untracked.join(', ')} in ${plan.checkout}`)
                : cant('busy', plan.checkout)
          const refused = yield* applyMerges(
            plans.flatMap(({ repository, plan }) =>
              plan.kind === 'move' ? [{ root: repository.root, branch: repository.base, plan, repository }] : [],
            ),
          )
          if (refused !== null)
            return yield* refused.plan.checkout === null
              ? cant('moved', several ? `${refused.repository.name}’s ${refused.branch}` : refused.branch)
              : cant('busy', refused.plan.checkout)
          const merged = plans.map(({ repository, plan }) => ({
            repository: repository.name,
            branch: repository.base,
            already: plan.kind === 'already',
          }))
          yield* addItem({ projectId: task.projectId, threadId: task.threadId }, 'notice', {
            source: 'runtime',
            severity: 'info',
            title: several
              ? `Merged here: ${merged.map((one) => `${one.repository} into ${one.branch}`).join(', ')}.`
              : `Merged into ${merged[0]?.branch ?? 'its default branch'} here.`,
            description: 'On this Mac only: nothing was pushed.',
          })
          // Merged, its task is done, as a merged pull request's is, once any others it has are merged too.
          yield* settleIfDone(taskId, { actorId: instance.personId, here: merged })
          return merged
        })

      const reply = (
        taskId: string,
        input: { readonly body: string; readonly threadId: string | null; readonly by: string | null; readonly url?: string },
      ) =>
        Effect.gen(function* () {
          const { link, snapshot, host, repository } = yield* current(taskId, input.url)
          const digest = createHash('sha256')
            .update(`${input.threadId ?? ''}\0${input.body}`)
            .digest('hex')
            .slice(0, 32)
          yield* outward({
            projectId: link.projectId,
            subject: { type: 'external_link', id: link.id },
            target: `${host.product}:${snapshot.repository.join('/')}`,
            operation: 'reply',
            key: `reply:${link.id}:${digest}`,
            request: { number: snapshot.number, threadId: input.threadId },
            retryable: false,
            // Posted as the person's account, so it says who wrote it.
            perform: host.reply(repository, snapshot.number, { body: signed(input.body, input.by), threadId: input.threadId }),
            encode: (answer) => answer,
            decode: (kept) => Option.getOrUndefined(Schema.decodeUnknownOption(Comment)(kept)),
          })
          yield* news(taskId)
          return yield* summaryOf(link)
        })

      /** The ids of the replies Althar posted on a change, from their receipts. */
      const repliesOf = (linkId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const rows = yield* sql<{ id: string | number | null }>`
            SELECT json_extract(m.response, '$.id') AS id FROM mutation_receipts m JOIN work_items w ON w.id = m.work_item_id
            WHERE w.subject_type = 'external_link' AND w.subject_id = ${linkId} AND m.operation = 'reply' AND m.response IS NOT NULL`
          return new Set(rows.flatMap((row) => (row.id === null ? [] : [String(row.id)])))
        })

      /**
       * Who said something on a change, for who hears it: Althar, in a
       * reply it posted (by its receipt, or, when that was lost, its
       * signature on the account's own comment); a bot; the person, whose
       * account the connection is; one of the repository's people; or anyone
       * else, as on a public repository.
       */
      const voiceOf = (
        said: { readonly id: string; readonly author: Person; readonly member: boolean; readonly body: string },
        account: Account,
        replies: ReadonlySet<string>,
      ): 'althar' | 'bot' | 'person' | 'member' | 'outsider' => {
        const mine = said.author.id === account.id
        if (replies.has(said.id) || (mine && fromAlthar(said.body))) return 'althar'
        if (said.author.bot) return 'bot'
        if (mine) return 'person'
        return said.member ? 'member' : 'outsider'
      }

      /** A pull request by its repository and number, as the lead names one among several: web#3. */
      const shortNameOf = (snapshot: Snapshot) => `${snapshot.repository.at(-1) ?? ''}${snapshot.words.prefix}${snapshot.number}`

      /** Each of the task's pull requests, read as `readOne` reads one, one after another. */
      const read = (taskId: string) =>
        Effect.gen(function* () {
          const urls = yield* urlsOf(taskId)
          if (urls.length <= 1) return yield* readOne(taskId)
          return (yield* Effect.forEach(urls, (seen) =>
            Effect.map(readOne(taskId, seen.url), (read) => `${shortNameOf(seen)}: ${read}`),
          )).join('\n\n')
        })

      /** The task's pull requests as last seen, oldest first. */
      const urlsOf = (taskId: string) =>
        Effect.flatMap(linksOf(taskId), (links) =>
          Effect.forEach(links, (link) =>
            Effect.map(Effect.option(decodeSnapshot(link.snapshot)), (seen) => (Option.isSome(seen) ? [seen.value] : [])),
          ),
        ).pipe(Effect.map((seen) => seen.flat()))

      const readOne = (taskId: string, url?: string) =>
        Effect.gen(function* () {
          const { link, snapshot, host, repository, account } = yield* current(taskId, url)
          const now = yield* host.change(repository, snapshot.number)
          const lines: Array<string> = [`${nameOf(snapshot)}, "${now.title}" (${standing(now)}): ${now.url}`]
          if (now.headSha !== null) {
            const checks = yield* host.checks(repository, now.headSha)
            const sum = checksOf(now.headSha, checks)
            lines.push(checksLine(sum))
            for (const check of checks.filter((candidate) => candidate.state === 'failed').slice(0, LOGS_TO_LEAD)) {
              const log = yield* host.checkLog(repository, check).pipe(Effect.orElseSucceed(() => null))
              if (log !== null) lines.push(logOf(check.name, log))
            }
          }
          const activity = yield* host.activity(repository, snapshot.number, null)
          const replies = yield* repliesOf(link.id)
          // What anyone else said isn't read to the lead: on a public repository, anyone can comment.
          const reviews = activity.reviews.filter((review) => voiceOf(review, account, replies) !== 'outsider')
          const comments = activity.comments.flatMap((comment) => {
            const voice = voiceOf(comment, account, replies)
            if (voice === 'outsider') return []
            return [{ at: comment.at, text: commentLine(comment, voice === 'althar' ? 'you, through Althar' : undefined) }]
          })
          const outsiders = activity.reviews.length - reviews.length + activity.comments.length - comments.length
          const said = [...reviews.map((review) => ({ at: review.at, text: reviewLine(review) })), ...comments]
            .toSorted((a, b) => (a.at < b.at ? -1 : 1))
            .slice(-COMMENTS_SHOWN)
          lines.push(
            said.length === 0
              ? 'Nobody has said anything on it.'
              : `What people said, oldest first:\n${said.map((entry) => entry.text).join('\n')}`,
          )
          if (outsiders > 0) lines.push(outsidersLine(outsiders))
          return lines.join('\n\n')
        })

      /** Records something heard once; whether it was new. */
      const heard = (link: LinkRow, kind: string, id: string, payload: Readonly<Record<string, unknown>>) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql`INSERT OR IGNORE INTO observations ${sql.insert({
            id: yield* newId(Ids.observation),
            projectId: link.projectId,
            subjectType: 'external_link',
            subjectId: link.id,
            kind,
            payload: JSON.stringify({ ...payload, id }),
            source: link.product,
            observedAt: yield* timestamp,
          })}`
          const [inserted] = yield* sql<{ n: number }>`SELECT changes() AS n`
          return (inserted?.n ?? 0) > 0
        })

      /** An arrival in the task's thread. */
      const arrive = (link: LinkRow, content: Readonly<Record<string, unknown>>) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${link.taskId} AND kind = 'task'`
          if (thread !== undefined)
            yield* addItem({ projectId: link.projectId, threadId: thread.id }, 'arrival', { source: link.product, ...content })
        })

      /** Tells the task's lead, if one is running, what it should hear. */
      const tellLead = (link: LinkRow, parts: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          if (parts.length === 0) return
          const sql = yield* SqlClient.SqlClient
          const [thread] = yield* sql<{ id: string; state: string }>`
            SELECT t.id, k.state FROM threads t JOIN tasks k ON k.id = t.task_id WHERE t.task_id = ${link.taskId} AND t.kind = 'task'`
          if (thread === undefined || thread.state !== 'open' || Option.isNone(yield* sessions.running(thread.id))) return
          yield* sessions.send({
            envelope: yield* envelope('thread.send', { threadId: thread.id, heard: link.id }),
            threadId: thread.id,
            body: parts.join('\n\n'),
            quiet: true,
          })
        })

      /**
       * One turn of listening to a change: its state, its finished checks, and
       * what was said since the cursor. Whether anything happened on it, so
       * a quiet one is asked less often.
       */
      const poll = (link: LinkRow) =>
        Effect.gen(function* () {
          if (link.connectionId === null) return false
          const adapters = yield* connections.adapters(link.connectionId)
          const host = adapters.host
          if (host === undefined) return false
          const account = adapters.info.account
          const before = yield* decodeSnapshot(link.snapshot)
          const repository: Repository = yield* host.repository(before.repository)
          const now = yield* host.change(repository, before.number)
          const name = nameOf(before)
          const forLead: Array<string> = []
          let happened = false
          let checks = before.checks
          if (now.headSha !== null) {
            const sum = checksOf(now.headSha, yield* host.checks(repository, now.headSha))
            const finished = sum.outcome === 'passed' || sum.outcome === 'failed'
            // Checks still running keep the pull request worth asking about.
            if (sum.outcome === 'running') happened = true
            if (
              finished &&
              (before.checks?.sha !== sum.sha || before.checks.outcome !== sum.outcome) &&
              (yield* heard(link, 'checks', `checks:${sum.sha}:${sum.outcome}`, { ...sum }))
            ) {
              happened = true
              yield* arrive(link, {
                kind: 'checks',
                from: null,
                where: name,
                passed: sum.passed,
                failed: sum.failed,
                failing: sum.failing,
                url: now.url,
              })
              if (sum.outcome === 'failed') {
                const logs: Array<string> = []
                const all = yield* host.checks(repository, now.headSha)
                for (const check of all.filter((candidate) => candidate.state === 'failed').slice(0, LOGS_TO_LEAD)) {
                  const log = yield* host.checkLog(repository, check).pipe(Effect.orElseSucceed(() => null))
                  if (log !== null) logs.push(logOf(check.name, log))
                }
                forLead.push(checksForLead(sum, name, logs))
              }
            }
            checks = sum
          }
          const activity = yield* host.activity(repository, before.number, link.cursor)
          const replies = activity.comments.length === 0 ? new Set<string>() : yield* repliesOf(link.id)
          for (const review of activity.reviews) {
            const voice = voiceOf(review, account, replies)
            if (voice === 'althar' || !(yield* heard(link, 'review', `review:${review.id}`, { author: review.author.login }))) continue
            happened = true
            yield* arrive(link, {
              kind: 'review',
              from: review.author.login,
              verdict: review.verdict,
              where: name,
              text: review.body,
              url: review.url,
              outsider: voice === 'outsider',
            })
            if ((voice === 'person' || voice === 'member') && review.verdict !== 'approved') forLead.push(reviewForLead(review, name))
          }
          for (const comment of activity.comments) {
            const voice = voiceOf(comment, account, replies)
            if (voice === 'althar' || voice === 'bot') continue
            if (!(yield* heard(link, 'comment', `comment:${comment.id}`, { author: comment.author.login }))) continue
            happened = true
            yield* arrive(link, {
              kind: 'comment',
              from: comment.author.login,
              where: name,
              text: comment.body,
              path: comment.path,
              line: comment.line,
              url: comment.url,
              outsider: voice === 'outsider',
            })
            if (voice === 'person' || voice === 'member') forLead.push(commentForLead(comment, name))
          }
          if (forLead.some((part) => !part.startsWith('Checks failed'))) forLead.push(answerHint)
          const after = snapshotOf(now, before.repository, before.words, checks)
          if (after.state !== before.state) {
            happened = true
            if (after.state === 'merged') yield* arrive(link, { kind: 'merged', from: null, where: name, url: now.url })
            if (after.state === 'closed') yield* arrive(link, { kind: 'closed', from: null, where: name, url: now.url })
          } else if (before.draft && !after.draft) {
            happened = true
            yield* arrive(link, { kind: 'ready', from: null, where: name, url: now.url })
          }
          const settled = after.state !== 'open'
          yield* saveSnapshot(link, after, {
            cursor: activity.cursor === '' ? link.cursor : activity.cursor,
            polledAt: yield* timestamp,
            ...(settled ? { listening: 0 } : {}),
          })
          if (after.state === 'merged') yield* settleIfDone(link.taskId)
          yield* tellLead(link, forLead)
          return happened
        })

      /**
       * A task is done once each of its repositories is merged: its pull
       * request merged, or, where it has none, its branch in its default branch
       * here. A pull request closed without merging keeps it open, for the
       * person. Not done yet, what is still open is said in the thread.
       */
      const settleIfDone = (
        taskId: string,
        by: {
          readonly actorId: ActorId
          readonly here?: ReadonlyArray<{ readonly repository: string; readonly branch: string; readonly already: boolean }>
        } = { actorId: instance.systemId },
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [task] = yield* sql<{ state: string; projectId: ProjectId; threadId: string }>`
            SELECT k.state, k.project_id, t.id AS thread_id FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
            WHERE k.id = ${taskId}`
          if (task?.state !== 'open') return
          const repositories = yield* sql<{ name: string; path: string; base: string; root: string; opened: number }>`
            SELECT b.display_name AS name, w.path, coalesce(b.default_base_ref, w.base_ref) AS base, l.path AS root,
              EXISTS (SELECT 1 FROM repository_changes c WHERE c.workspace_id = w.id AND c.pull_request_url IS NOT NULL) AS opened
            FROM workspaces w
            JOIN repository_bindings b ON b.id = w.binding_id
            JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId}
            ORDER BY b.created_at, b.rowid`
          // Among several, each pull request is said with its repository.
          const links = yield* linksOf(taskId)
          const open = (yield* Effect.forEach(links, (link) => Effect.option(decodeSnapshot(link.snapshot)))).flatMap((seen) =>
            Option.isSome(seen) && seen.value.state !== 'merged'
              ? [repositories.length > 1 ? `${nameOf(seen.value)} in ${seen.value.repository.at(-1) ?? ''}` : nameOf(seen.value)]
              : [],
          )
          // A repository with no pull request is merged where its branch's head is in its default branch here.
          const unmerged: Array<string> = []
          for (const repository of repositories) {
            if (repository.opened === 1) continue
            const head = yield* commitOf(repository.path, 'HEAD').pipe(Effect.orElseSucceed(() => ''))
            const merged = yield* gitOutcome(repository.root, 'merge-base', '--is-ancestor', head, `refs/heads/${repository.base}`)
            if (head === '' || merged.code !== 0) unmerged.push(repository.name)
          }
          if (open.length > 0 || unmerged.length > 0) {
            yield* addItem({ projectId: task.projectId, threadId: task.threadId }, 'notice', {
              source: 'runtime',
              severity: 'info',
              title: `Not done yet: ${[...open.map((name) => `${name} is still open`), ...unmerged.map((name) => `${name} isn't merged`)].join(', ')}.`,
            })
            return yield* touchCard(taskId)
          }
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const at = yield* timestamp
              const revision = yield* change('tasks', taskId, { state: 'done', settledAt: at })
              yield* fact({
                projectId: task.projectId,
                aggregateType: 'task',
                aggregateId: taskId,
                revision,
                type: 'task.done',
                payload: { merged: true, ...(by.here === undefined ? {} : { here: by.here }) },
                actorId: by.actorId,
              })
            }),
          )
          yield* touchCard(taskId)
        })

      // What an earlier launch was doing outside when it stopped is uncertain until read back or asked for again.
      yield* provide(reconcileOutward).pipe(
        Effect.catchCause((cause) => Effect.logWarning('Could not reconcile what was being done outside', cause)),
      )

      /* Listening: each listened change is asked about when its time comes, sooner when its task asks, later when its service says to wait. */
      const waitUntil = new Map<string, number>()
      const wake = yield* Queue.sliding<string | null>(16)
      const wakeNow = (taskId: string | null) => void Queue.offerUnsafe(wake, taskId)

      const listenOnce = (only: string | null) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const due = yield* sql<LinkRow>`
            SELECT id, project_id, task_id, connection_id, product, snapshot, cursor, listening FROM external_links
            WHERE kind = 'change' AND listening = 1 ${only === null ? sql`` : sql`AND task_id = ${only}`}`
          const now = yield* Clock.currentTimeMillis
          for (const link of due) {
            if (only === null) {
              if ((waitUntil.get(link.id) ?? 0) > now) continue
              // A pull request first seen this launch counts as busy until it has been quiet a while.
              if (!newsAt.has(link.taskId)) newsAt.set(link.taskId, now)
              if (!listenDue({ now, polledAt: polledAt.get(link.id), newsAt: newsAt.get(link.taskId) ?? now, every })) continue
            }
            polledAt.set(link.id, now)
            yield* locked(link.taskId)(poll(link)).pipe(
              Effect.flatMap((happened) => (happened ? news(link.taskId) : Effect.void)),
              Effect.catchCause((cause) =>
                Effect.gen(function* () {
                  const error = Option.getOrUndefined(Cause.findErrorOption(cause))
                  if (error instanceof ConnectorFailed && error.reason === 'rate_limited' && error.retryAt !== undefined)
                    waitUntil.set(link.id, Date.parse(error.retryAt))
                  else waitUntil.set(link.id, now + Duration.toMillis(every) * 4)
                  if (!(error instanceof ConnectorFailed) || error.reason === 'invalid_response')
                    yield* Effect.logWarning('Could not listen to a pull request', cause)
                }),
              ),
            )
          }
        })

      yield* Effect.forkScoped(
        provide(
          Effect.forever(
            Effect.gen(function* () {
              const only = yield* Effect.raceFirst(Queue.take(wake), Effect.as(Effect.sleep(every), null))
              yield* listenOnce(only)
            }),
          ),
        ),
      )

      /* ---- The lead's tools for its pull request ---- */

      const Replied = Schema.Struct({
        body: Schema.String,
        thread_id: Schema.optional(Schema.NullOr(Schema.String)),
        pull_request: Schema.optional(Schema.NullOr(Schema.Union([Schema.Number, Schema.String]))),
      })

      /** A lead's tool: refusals reach it in words; anything else says to try again, and goes to the log. */
      const leadTool = (
        name: string,
        description: string,
        input: Readonly<Record<string, unknown>>,
        call: (taskId: string, input: unknown, access: ToolAccess) => Effect.Effect<string, unknown, Store>,
      ) => ({
        name,
        description,
        input,
        call: (value: unknown, access: ToolAccess) =>
          access.taskId === null
            ? Effect.fail(new ToolRefused({ message: 'This tool is for a task’s lead.' }))
            : provide(call(access.taskId, value, access)).pipe(
                Effect.catch((error) => {
                  if (error instanceof ToolRefused) return Effect.fail(error)
                  if (error instanceof NotFound && error.kind === 'pull request')
                    return Effect.fail(
                      new ToolRefused({
                        message: 'This task has no pull request yet. Althar opens one when the plan’s steps are done.',
                      }),
                    )
                  if (error instanceof NotConnected || (error instanceof NotFound && error.kind === 'connection'))
                    return Effect.fail(
                      new ToolRefused({
                        message: 'Althar isn’t connected to this repository’s host, so it can’t reach the pull request. Tell the person.',
                      }),
                    )
                  if (error instanceof ConnectorFailed)
                    return Effect.fail(new ToolRefused({ message: `The code host said: ${error.message}` }))
                  return Effect.andThen(
                    Effect.logWarning('A pull request tool did not succeed', error),
                    Effect.fail(new ToolRefused({ message: 'Althar could not do that. Try again, or tell the person.' })),
                  )
                }),
              ),
      })

      yield* toolServer.serve('lead', [
        leadTool(
          'read_pull_request',
          "The task's pull request as it stands, or each of them in a task of several repositories: its state, its checks (with the end of a failed check's log), and what people said on it, with each line comment's thread id.",
          { type: 'object', properties: {} },
          (taskId) => read(taskId),
        ),
        leadTool(
          'reply_on_pull_request',
          "Replies on the task's pull request: in a line comment's thread, by its thread id, or in its conversation without one. In a task of several repositories, pull_request names the one to reply on, by its repository and number, as read_pull_request names it: web#3. For answering what people said; a change to the code is a commit, which the person pushes.",
          {
            type: 'object',
            properties: { body: { type: 'string' }, thread_id: { type: 'string' }, pull_request: { type: 'string' } },
            required: ['body'],
          },
          (taskId, input, access) =>
            Effect.gen(function* () {
              const replied = yield* Schema.decodeUnknownEffect(Replied)(input).pipe(
                Effect.mapError((error) => new ToolRefused({ message: `Althar couldn't read that: ${error.message}` })),
              )
              // The reply is signed with the lead's name, as the person's colleagues read it under the person's account.
              const lead = yield* sessions.running(access.threadId)
              const by = Option.isNone(lead)
                ? null
                : yield* agents.get(lead.value.agentId).pipe(
                    Effect.map((entry) => entry.definition.name),
                    Effect.orElseSucceed(() => null),
                  )
              // Among several pull requests, the one it names, by repository and number: numbers repeat across repositories.
              const seen = yield* urlsOf(taskId)
              const asked = replied.pull_request == null ? null : String(replied.pull_request).trim().toLowerCase()
              const matching = seen.filter((candidate) => {
                const short = `${candidate.repository.at(-1) ?? ''}${candidate.words.prefix}${candidate.number}`.toLowerCase()
                return (
                  asked === short ||
                  asked === `${candidate.repository.join('/')}${candidate.words.prefix}${candidate.number}`.toLowerCase() ||
                  asked === String(candidate.number) ||
                  asked === `${candidate.words.prefix}${candidate.number}`
                )
              })
              const [named] = matching
              if (seen.length > 1 && (named === undefined || matching.length > 1))
                return yield* new ToolRefused({
                  message: `This task has several pull requests: ${seen.map(shortNameOf).join(', ')}. Say which with pull_request, as one of those.`,
                })
              const change = yield* locked(taskId)(
                reply(taskId, {
                  body: replied.body,
                  threadId: replied.thread_id ?? null,
                  by,
                  ...(named === undefined ? {} : { url: named.url }),
                }),
              )
              return `Replied on ${nameOf(change)}.`
            }),
        ),
      ])

      return Changes.of({
        publish: (input) => provide(publish(input)),
        push: (taskId, head, url) => provide(locked(taskId)(push(taskId, head, url))),
        markReady: (taskId, url) => provide(locked(taskId)(markReady(taskId, url))),
        exclusive: (taskId, effect) => locked(taskId)(effect),
        merge: (taskId, head, url) => provide(locked(taskId)(merge(taskId, head, url))),
        mergeHere: (taskId, heads) => provide(locked(taskId)(mergeHere(taskId, heads))),
        reply: (taskId, input) => provide(locked(taskId)(reply(taskId, input))),
        read: (taskId) => provide(read(taskId)),
        ofTask: (taskId) => provide(Effect.flatMap(linksOf(taskId), (links) => Effect.forEach(links, summaryOf))),
        // The person looking at the task counts as something happening on it.
        refresh: (taskId) =>
          Effect.andThen(
            news(taskId),
            Effect.sync(() => wakeNow(taskId)),
          ),
        // Worked out from the repositories the task changes, where it says which: one on a connected host opens a draft.
        endFor: (projectId, taskId) =>
          provide(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient
              const [project] = yield* sql<{ id: ProjectId }>`SELECT id FROM projects WHERE id = ${projectId}`
              if (project === undefined) return null
              const hosts = yield* hostsFor(projectId, taskId)
              const wanted = (yield* (yield* Policies).current(project.id)).rules.end
              if (wanted === 'none') return wanted
              if (wanted !== undefined) return hosts.some((host) => host !== null) ? wanted : null
              return hosts.some((host) => host?.connected === true) ? ('draft' as const) : null
            }),
          ),
        hostFor: (projectId) => provide(hostFor(projectId)),
      })
    }),
  )
}
