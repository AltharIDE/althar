import { type Issue, linksIn, type Product, type StatusCategory } from '@charrette/connectors'
import { Ids, newId, type ProjectId } from '@charrette/domain'
import type { Ledger } from '@charrette/persistence-sqlite'
import { Context, type Crypto, Effect, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { touchCard } from './cards'
import { Connections, NotConnected } from './Connections'
import { NotFound } from './errors'
import { Instance } from './Instance'
import { change, fact, timestamp } from './records'
import { updateItem } from './threads'
import { ToolRefused, ToolServer } from './ToolServer'

/*
 * Issues, and links to things on connected services (docs/architecture/06;
 * docs/plans/integrations.md). A link the person pastes in a message unfurls
 * there: the issue's key, title and status, or the pull request's. A task can
 * come from an issue, which it keeps as a link of its own; its branch and its
 * pull request carry the issue's key, so the tracker's own Git integration
 * finds them. Charrette moves no issue's status (an open question).
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

/** A key as a branch has it: MER-231 is mer-231, GitHub's #12 is issue-12. */
export const branchKey = (key: string) => (key.startsWith('#') ? `issue-${key.slice(1)}` : key.toLowerCase().replace(/[^a-z0-9-]+/g, '-'))

type Store = SqlClient.SqlClient | Instance | Ledger | Crypto.Crypto | Connections | ToolServer

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
  }
>()('@charrette/runtime/Issues') {
  static readonly layer: Layer.Layer<Issues, never, Store> = Layer.effect(
    Issues,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const connections = yield* Connections
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)

      /** The repository a project's tasks change, as its host has it: where `#12` lives. */
      const repositoryOf = (projectId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [binding] = yield* sql<{ remotes: string }>`
            SELECT remote_fingerprints AS remotes FROM repository_bindings WHERE project_id = ${projectId} AND detached_at IS NULL ORDER BY created_at LIMIT 1`
          if (binding === undefined) return null
          const remotes = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Array(Schema.String)))(binding.remotes)
          return yield* connections.hostOf(remotes)
        })

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
            if (found === null || found.ref.kind !== 'issue' || found.tracker === undefined)
              return yield* new NotConnected({ product: 'linear', what: wanted })
            const issue = yield* found.tracker.issue(found.ref.ref)
            return { ...summaryOf(found.ref.product, issue), body: issue.body, connectionId: found.connectionId }
          }
          // #12: an issue in the project's repository.
          const number = /^#?(\d+)$/.exec(wanted)?.[1]
          if (number !== undefined && projectId !== undefined) {
            const host = yield* repositoryOf(projectId)
            const adapters = host === null ? undefined : yield* connections.adapters(host.connectionId)
            if (host === null || adapters?.tracker === undefined) return yield* new NotConnected({ product: 'github', what: wanted })
            const issue = yield* adapters.tracker.issue(`${host.path.join('/')}#${number}`)
            return { ...summaryOf(adapters.info.product, issue), body: issue.body, connectionId: host.connectionId }
          }
          // MER-231: whichever tracker has it.
          for (const { connectionId, product, tracker } of yield* connections.trackers) {
            if (product === 'github' || product === 'gitlab') continue
            const issue = yield* tracker.issue(wanted.toUpperCase()).pipe(Effect.orElseSucceed(() => null))
            if (issue !== null) return { ...summaryOf(product, issue), body: issue.body, connectionId }
          }
          return yield* new NotFound({ kind: 'issue', id: wanted })
        })

      const mine = (projectId: string) =>
        Effect.gen(function* () {
          const host = yield* repositoryOf(projectId)
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
          ).pipe(Effect.mapError(() => new ToolRefused({ message: 'Charrette can’t read that issue: no connected tracker has it.' }))),
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
      })
    }),
  )
}
