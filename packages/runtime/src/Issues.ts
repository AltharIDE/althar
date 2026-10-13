import { ConnectorFailed, type Issue, linksIn, parseLink, type Product, type Started, type StatusCategory } from '@althar/connectors'
import { Ids, newId, type ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { Cause, Context, type Crypto, Effect, Layer, Option, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { touchCard } from './cards'
import { Connections, NotConnected } from './Connections'
import { NotAnIssue, NotFound, OutwardUncertain } from './errors'
import { Instance } from './Instance'
import { outward } from './outward'
import { movesIssues, Policies } from './Policies'
import { change, fact, timestamp } from './records'
import { addItem, updateItem } from './threads'
import { ToolRefused, ToolServer } from './ToolServer'

/*
 * Issues, and links to things on connected services (docs/architecture/06;
 * docs/plans/integrations.md). A link the person pastes in a message unfurls
 * there: the issue's key, title and status, or the pull request's. A task can
 * come from an issue, which it keeps as a link of its own; its branch and its
 * pull request carry the issue's key, so the tracker's own Git integration
 * finds them. As the task starts, Althar moves its issue to the tracker's
 * In Progress, where the tracker has one and the project's rules say to:
 * once, never back from further along, and never at the task's cost.
 */

/** A link, unfurled where it was pasted: an issue or a change, as its service has it. */
export type Unfurl =
  | {
      readonly kind: 'issue'
      readonly product: Product
      readonly key: string
      readonly title: string
      readonly url: string
      readonly status: { readonly name: string; readonly category: StatusCategory }
      readonly priority: { readonly level: string; readonly name: string } | null
      readonly container: string | null
    }
  | {
      readonly kind: 'change'
      readonly product: Product
      readonly key: string
      readonly title: string
      readonly url: string
      readonly state: 'draft' | 'open' | 'merged' | 'closed'
      readonly repository: string
    }

/** An issue as a picker lists it: which service, and what it is. */
export interface IssueSummary {
  readonly product: Product
  readonly ref: string
  readonly key: string
  readonly title: string
  readonly url: string
  readonly status: { readonly name: string; readonly category: StatusCategory }
  readonly priority: { readonly level: string; readonly name: string } | null
  readonly container: string | null
  readonly updatedAt: string
}

/** How many links in one message are unfurled. */
const UNFURLED = 5
/** How many of someone's issues a picker lists. */
const LISTED = 50

const summaryOf = (product: Product, issue: Issue): IssueSummary => ({
  product,
  ref: issue.ref,
  key: issue.key,
  title: issue.title,
  url: issue.url,
  status: issue.status,
  priority: issue.priority,
  container: issue.container,
  updatedAt: issue.updatedAt,
})

type Store = SqlClient.SqlClient | Instance | Ledger | Crypto.Crypto | Connections | ToolServer | Policies

/** The repository a project's tasks change, as its host has it, through a ready connection: where `#12` lives. */
export const projectRepository = (projectId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [binding] = yield* sql<{ remotes: string }>`
      SELECT remote_fingerprints AS remotes FROM repository_bindings WHERE project_id = ${projectId} AND detached_at IS NULL ORDER BY created_at LIMIT 1`
    if (binding === undefined) return null
    const remotes = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)))(binding.remotes)
    return yield* (yield* Connections).hostOf(remotes)
  })

export class Issues extends Context.Service<
  Issues,
  {
    /** Unfurls the links in what the person said, on the item that shows it. */
    unfurlInput(commandId: string): Effect.Effect<void>
    /** An issue by its link, or its key on a connected tracker: for tools, and for a task that comes from one. */
    read(text: string, projectId?: string): Effect.Effect<IssueSummary & { readonly body: string; readonly connectionId: string }, unknown>
    /** The person's open issues, on every connected tracker; a code host's only in the project's repository. */
    mine(projectId: string): Effect.Effect<ReadonlyArray<IssueSummary>, unknown>
    /** Ties a task to the issue it came from. */
    attach(input: { readonly projectId: ProjectId; readonly taskId: string; readonly issue: string }): Effect.Effect<IssueSummary, unknown>
    /** The issue a task came from, as last seen. */
    ofTask(taskId: string): Effect.Effect<IssueSummary | null, unknown>
    /**
     * Moves the issue a task came from to its tracker's In Progress, as the
     * task's first step starts: in the background, once. It says how that
     * went in the task's thread; nothing it meets fails the task.
     */
    started(taskId: string): Effect.Effect<void>
  }
>()('@althar/runtime/Issues') {
  static readonly layer: Layer.Layer<Issues, never, Store> = Layer.effect(
    Issues,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const connections = yield* Connections
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)
      const scope = yield* Effect.scope

      const unfurl = (link: string) =>
        Effect.gen(function* () {
          const found = yield* connections.resolve(link)
          if (found === null) return null
          if (found.ref.kind === 'issue') {
            if (found.tracker === undefined) return null
            const issue = yield* found.tracker.issue(found.ref.ref)
            return {
              kind: 'issue',
              product: found.ref.product,
              key: issue.key,
              title: issue.title,
              url: issue.url,
              status: issue.status,
              priority: issue.priority,
              container: issue.container,
            } satisfies Unfurl
          }
          if (found.host === undefined) return null
          const repository = yield* found.host.repository(found.ref.path)
          const change = yield* found.host.change(repository, found.ref.number)
          return {
            kind: 'change',
            product: found.ref.product,
            key: `${found.host.words.short} ${found.host.words.prefix}${change.number}`,
            title: change.title,
            url: change.url,
            state: change.state === 'open' && change.draft ? 'draft' : change.state,
            repository: found.ref.path.join('/'),
          } satisfies Unfurl
        }).pipe(Effect.orElseSucceed(() => null))

      const unfurlInput = (commandId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [said] = yield* sql<{ itemId: string; projectId: ProjectId; body: string }>`
            SELECT i.id AS item_id, i.project_id, u.body FROM user_inputs u JOIN thread_items i ON i.user_input_id = u.id
            WHERE u.command_id = ${commandId} LIMIT 1`
          if (said === undefined) return
          const links = linksIn(said.body).slice(0, UNFURLED)
          if (links.length === 0) return
          const unfurled = (yield* Effect.forEach(links, unfurl, { concurrency: 3 })).filter((found) => found !== null)
          if (unfurled.length > 0) yield* updateItem(said.projectId, said.itemId, { text: said.body, links: unfurled })
        })

      const read = (text: string, projectId?: string) =>
        Effect.gen(function* () {
          const wanted = text.trim()
          if (/^https?:\/\//.test(wanted)) {
            const found = yield* connections.resolve(wanted)
            // A link to a tracker not connected names it where its address can (a Jira Cloud site's does).
            if (found === null) return yield* new NotConnected({ product: parseLink(wanted)?.product ?? 'linear', what: wanted })
            // A pull request's link, given for an issue, says so in its host's words.
            if (found.ref.kind !== 'issue') return yield* new NotAnIssue({ link: wanted, what: found.host?.words.noun ?? 'pull request' })
            if (found.tracker === undefined) return yield* new NotConnected({ product: found.ref.product, what: wanted })
            const issue = yield* found.tracker.issue(found.ref.ref)
            return { ...summaryOf(found.ref.product, issue), body: issue.body, connectionId: found.connectionId }
          }
          // An issue the coordinator drafted and the person filed, by its key: through the connection that filed it. A repository's
          // #12 is the project's own repository's, below; another repository's is read by its link.
          if (projectId !== undefined && !wanted.startsWith('#')) {
            const sql = yield* SqlClient.SqlClient
            const [filed] = yield* sql<{ connectionId: string; product: Product; ref: string }>`
              SELECT connection_id, product, issue_ref AS ref FROM issue_drafts
              WHERE project_id = ${projectId} AND state = 'filed' AND upper(issue_key) = ${wanted.toUpperCase()}
              ORDER BY decided_at DESC LIMIT 1`
            const tracker = filed === undefined ? undefined : (yield* connections.adapters(filed.connectionId)).tracker
            if (filed !== undefined && tracker !== undefined) {
              const issue = yield* tracker.issue(filed.ref)
              return { ...summaryOf(filed.product, issue), body: issue.body, connectionId: filed.connectionId }
            }
          }
          // #12: an issue in the project's repository.
          const number = /^#?(\d+)$/.exec(wanted)?.[1]
          if (number !== undefined && projectId !== undefined) {
            const host = yield* projectRepository(projectId)
            const adapters = host === null ? undefined : yield* connections.adapters(host.connectionId)
            if (host === null || adapters?.tracker === undefined) return yield* new NotConnected({ product: 'github', what: wanted })
            const issue = yield* adapters.tracker.issue(`${host.path.join('/')}#${number}`)
            return { ...summaryOf(adapters.info.product, issue), body: issue.body, connectionId: host.connectionId }
          }
          // MER-231, or a Trello card's short link: whichever tracker has it, each reading its own keys as typed.
          for (const { connectionId, product, tracker } of yield* connections.trackers) {
            if (product === 'github' || product === 'gitlab') continue
            const issue = yield* tracker.issue(wanted).pipe(Effect.orElseSucceed(() => null))
            if (issue !== null) return { ...summaryOf(product, issue), body: issue.body, connectionId }
          }
          return yield* new NotFound({ kind: 'issue', id: wanted })
        })

      const mine = (projectId: string) =>
        Effect.gen(function* () {
          const host = yield* projectRepository(projectId)
          const lists = yield* Effect.forEach(
            yield* connections.trackers,
            ({ connectionId, product, tracker }) => {
              // A code host's issues are listed for the project's own repository only.
              const listed =
                product === 'github' || product === 'gitlab'
                  ? host?.connectionId === connectionId
                    ? tracker.mine({ container: host.path.join('/'), limit: LISTED })
                    : Effect.succeed([])
                  : tracker.mine({ limit: LISTED })
              // One tracker that can't answer leaves the others' issues listed.
              return listed.pipe(
                Effect.map((issues) => issues.map((issue) => summaryOf(product, issue))),
                Effect.orElseSucceed((): ReadonlyArray<IssueSummary> => []),
              )
            },
            { concurrency: 'unbounded' },
          )
          return lists
            .flat()
            .toSorted((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
            .slice(0, LISTED)
        })

      const attach = (input: { readonly projectId: ProjectId; readonly taskId: string; readonly issue: string }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const issue = yield* read(input.issue, input.projectId)
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const at = yield* timestamp
              const [existing] = yield* sql<{ id: string }>`
                SELECT id FROM external_links WHERE task_id = ${input.taskId} AND kind = 'issue' AND product = ${issue.product} AND external_id = ${issue.ref}`
              if (existing !== undefined) {
                yield* change('external_links', existing.id, { snapshot: JSON.stringify(issue), updatedAt: at })
                return
              }
              const id = yield* newId(Ids.externalLink)
              const { body: _body, connectionId, ...kept } = issue
              yield* sql`INSERT INTO external_links ${sql.insert({
                id,
                projectId: input.projectId,
                taskId: input.taskId,
                connectionId,
                product: issue.product,
                kind: 'issue',
                externalId: issue.ref,
                ref: issue.ref,
                key: issue.key,
                url: issue.url,
                snapshot: JSON.stringify(kept),
                createdAt: at,
                updatedAt: at,
              })}`
              yield* fact({
                projectId: input.projectId,
                aggregateType: 'external_link',
                aggregateId: id,
                revision: 1,
                type: 'external_link.issue_attached',
                payload: { key: issue.key, url: issue.url },
                actorId: instance.personId,
              })
            }),
          )
          yield* touchCard(input.taskId)
          return issue
        })

      const ofTask = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [link] = yield* sql<{ product: Product; ref: string; key: string; url: string; snapshot: string }>`
            SELECT product, ref, key, url, snapshot FROM external_links WHERE task_id = ${taskId} AND kind = 'issue' ORDER BY created_at LIMIT 1`
          if (link === undefined) return null
          const kept = JSON.parse(link.snapshot) as Partial<IssueSummary>
          return {
            product: link.product,
            ref: link.ref,
            key: link.key,
            url: link.url,
            title: kept.title ?? link.key,
            status: kept.status ?? { name: 'Todo', category: 'todo' },
            priority: kept.priority ?? null,
            container: kept.container ?? null,
            updatedAt: kept.updatedAt ?? '',
          } satisfies IssueSummary
        })

      /** What kept an issue where it was, in a line: the tracker's own words where it gave some. */
      const whyNot = (error: unknown) =>
        error instanceof ConnectorFailed
          ? error.message.replace(/[\s.]+$/, '')
          : error instanceof NotConnected
            ? `Althar isn’t connected to ${error.product} any more`
            : error instanceof OutwardUncertain
              ? 'its answer was lost, so it may or may not have moved'
              : 'something went wrong'

      const start = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [link] = yield* sql<{
            id: string
            projectId: ProjectId
            ref: string
            key: string
            snapshot: string
            connectionId: string | null
            threadId: string | null
          }>`
            SELECT x.id, x.project_id, x.ref, x.key, x.snapshot, x.connection_id,
              (SELECT id FROM threads WHERE task_id = x.task_id AND kind = 'task') AS thread_id
            FROM external_links x WHERE x.task_id = ${taskId} AND x.kind = 'issue' ORDER BY x.created_at LIMIT 1`
          if (link === undefined || link.connectionId === null || link.threadId === null) return
          if (!movesIssues((yield* (yield* Policies).current(link.projectId)).rules)) return
          // Once: a task started again, by a plan after its first, leaves its issue to the person.
          const [before] = yield* sql<{ id: string }>`
            SELECT id FROM record_events WHERE aggregate_type = 'external_link' AND aggregate_id = ${link.id}
              AND type IN ('external_link.issue_started', 'external_link.issue_start_failed') LIMIT 1`
          if (before !== undefined) return
          const connectionId = link.connectionId
          const exit = yield* Effect.exit(
            Effect.gen(function* () {
              const { tracker } = yield* connections.adapters(connectionId)
              // GitHub's, GitLab's and Trello's have no In Progress of their own: their issues are left as they are, and nothing is said.
              if (tracker === undefined || !tracker.capabilities.starts) return null
              // As it is now, not as it was when the task was drafted: one someone started meanwhile is left as it is.
              const issue = yield* tracker.issue(link.ref)
              return yield* outward({
                projectId: link.projectId,
                subject: { type: 'external_link', id: link.id },
                target: `${tracker.product}:${link.key}`,
                operation: 'start_issue',
                key: `start_issue:${link.id}`,
                request: { from: issue.status.name },
                // Moving it again moves nothing: one already started is left as it is.
                retryable: true,
                perform: tracker.start(issue),
                encode: (answer: Started) => answer,
                decode: (kept) => kept as Started,
              })
            }),
          )
          if (exit._tag === 'Success' && exit.value === null) return
          const failure = exit._tag === 'Failure' ? Option.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined
          const started = exit._tag === 'Success' ? exit.value : null
          const at = yield* timestamp
          yield* sql.withTransaction(
            Effect.gen(function* () {
              // The card shows the issue as it is now.
              const kept = JSON.parse(link.snapshot) as Record<string, unknown>
              const revision = yield* change(
                'external_links',
                link.id,
                started === null ? { updatedAt: at } : { snapshot: JSON.stringify({ ...kept, status: started.status }), updatedAt: at },
              )
              yield* fact({
                projectId: link.projectId,
                aggregateType: 'external_link',
                aggregateId: link.id,
                revision,
                type: started === null ? 'external_link.issue_start_failed' : 'external_link.issue_started',
                payload:
                  started === null
                    ? { key: link.key, error: whyNot(failure) }
                    : { key: link.key, moved: started.moved, status: started.status },
                actorId: instance.systemId,
              })
              // One already started, or past it, is left without a word.
              if (started !== null && !started.moved) return
              yield* addItem({ projectId: link.projectId, threadId: link.threadId ?? '' }, 'notice', {
                source: 'runtime',
                severity: 'info',
                title:
                  started === null
                    ? `Couldn’t move ${link.key} to In Progress: ${whyNot(failure)}`
                    : `Moved ${link.key} to ${started.status.name}`,
                description: null,
              })
            }),
          )
          if (exit._tag === 'Failure' && !(failure instanceof ConnectorFailed))
            yield* Effect.logWarning('Could not move an issue to In Progress', exit.cause)
          yield* touchCard(taskId)
        })

      // A task's lead and its reviewers can read the issue it came from, or any other.
      const readIssueTool = {
        name: 'read_issue',
        description:
          'An issue on a connected tracker, or in the project’s repository: its title, status and description. Takes its link or its key.',
        input: { type: 'object', properties: { issue: { type: 'string' } }, required: ['issue'] },
        call: (value: unknown, access: { readonly projectId: string }) =>
          provide(
            Effect.gen(function* () {
              const wanted =
                typeof value === 'object' && value !== null && 'issue' in value && typeof value.issue === 'string' ? value.issue : ''
              const issue = yield* read(wanted, access.projectId)
              return [
                `${issue.key}: ${issue.title}`,
                `${issue.status.name}${issue.container === null ? '' : `, in ${issue.container}`}. ${issue.url}`,
                issue.body === '' ? 'No description.' : issue.body,
              ].join('\n\n')
            }),
          ).pipe(Effect.mapError(() => new ToolRefused({ message: 'Althar can’t read that issue: no connected tracker has it.' }))),
      }
      const toolServer = yield* ToolServer
      yield* toolServer.serve('lead', [readIssueTool])
      yield* toolServer.serve('reviewer', [readIssueTool])

      return Issues.of({
        unfurlInput: (commandId) =>
          provide(unfurlInput(commandId)).pipe(
            Effect.catchCause((cause) => Effect.logWarning('Could not unfurl a message’s links', cause)),
          ),
        read: (text, projectId) => provide(read(text, projectId)),
        mine: (projectId) => provide(mine(projectId)),
        attach: (input) => provide(attach(input)),
        ofTask: (taskId) => provide(ofTask(taskId)),
        started: (taskId) =>
          Effect.asVoid(
            Effect.forkIn(
              provide(start(taskId)).pipe(
                Effect.catchCause((cause) => Effect.logWarning('Could not move a task’s issue to In Progress', cause)),
              ),
              scope,
            ),
          ),
      })
    }),
  )
}
