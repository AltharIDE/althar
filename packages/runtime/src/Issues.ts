import {
  type Container,
  ConnectorFailed,
  type Issue,
  type IssueComment,
  type IssueState,
  linksIn,
  looksLikeJira,
  parseLink,
  type Product,
  products,
  type Started,
  type StatusCategory,
  type Tracker,
} from '@althar/connectors'
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
import { projectTracker } from './projectTracker'
import { indexTask } from './Search'
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

/** A link, unfurled where it was pasted: an issue or a change, as its service has it, with the address as the message has it (`pasted`), which can differ from the service's own (`url`). */
export type Unfurl =
  | {
      readonly kind: 'issue'
      readonly product: Product
      readonly key: string
      readonly title: string
      readonly url: string
      readonly pasted: string
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
      readonly pasted: string
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
/** How many issues a key range reads at most. */
const RANGE = 50
/** How many of an issue's latest comments a read says. */
const COMMENTS = 10
/** How long a comment is said at most, in characters. */
const COMMENT_LENGTH = 800

/** An issue as a read finds it: its summary, its description, where it is read through, and all its tracker said of it. */
export type IssueRead = IssueSummary & { readonly body: string; readonly connectionId: string; readonly issue: Issue }

/** What a search for issues is narrowed to, as an agent says it. Each left out narrows nothing; with none, the person's open ones. */
export interface IssueSearch {
  readonly text?: string
  /** The tracker, by name: Linear, Jira, GitHub, or a workspace's. */
  readonly tracker?: string
  /** Where on it, by key or name: a team, a project, a repository, a list. */
  readonly container?: string
  readonly state?: IssueState
  readonly mine?: boolean
  /** A run of keys, DEV-170..DEV-185 or #10..#20, read one by one. */
  readonly keys?: string
  readonly limit?: number
}

/** What a search found, and each tracker it couldn't read, in a line: never said as none found. */
export interface IssuesFound {
  readonly issues: ReadonlyArray<IssueSummary>
  readonly failed: ReadonlyArray<string>
}

/** A run of keys as typed: DEV-170..DEV-185, DEV-170..185, #10..#20, 10 to 20. */
export const keyRange = (typed: string): ReadonlyArray<string> | null => {
  const match = /^\s*(#?)([A-Za-z][A-Za-z0-9]*-)?(\d+)\s*(?:\.\.\.?|–|—|to)\s*#?([A-Za-z][A-Za-z0-9]*-)?(\d+)\s*$/i.exec(typed)
  if (match === null) return null
  const [, hash = '', prefix = '', first = '', second, last = ''] = match
  if (second !== undefined && second.toUpperCase() !== prefix.toUpperCase()) return null
  const from = Number(first)
  const to = Number(last)
  if (to < from || to - from >= RANGE) return null
  return Array.from({ length: to - from + 1 }, (_, index) => `${prefix === '' ? hash || '#' : prefix.toUpperCase()}${from + index}`)
}

/** Whether an issue is open, closed or either, as a search asks. */
const inState = (state: IssueState, category: StatusCategory) =>
  state === 'all' || (state === 'closed') === (category === 'done' || category === 'cancelled')

/** What a failure to read says, in a line: the tracker's own words where it gave some. */
const failedWords = (error: unknown) =>
  error instanceof ConnectorFailed
    ? error.reason === 'unauthorized'
      ? 'it didn’t take Althar’s sign-in'
      : error.message.replace(/[\s.]+$/, '') || error.reason
    : 'something went wrong'

const day = (at: string) => at.slice(0, 10)

/**
 * An issue as an agent reads it: its key and title, where it stands, who
 * has it and its labels, what it is in and part of, its description, and
 * its latest comments, or why they couldn't be read.
 */
export const issueWords = (read: IssueRead, comments: ReadonlyArray<IssueComment> | string): string => {
  const { issue } = read
  const facts = [
    issue.assignees.length === 0 ? 'Unassigned' : `Assigned to ${issue.assignees.map((person) => person.name ?? person.login).join(', ')}`,
    ...(issue.labels.length === 0 ? [] : [`labels ${issue.labels.join(', ')}`]),
    ...(issue.project == null ? [] : [`project ${issue.project.name}`]),
    ...(issue.milestone == null ? [] : [`milestone ${issue.milestone.name}`]),
    ...(issue.cycle == null ? [] : [`cycle ${issue.cycle}`]),
    ...(issue.parent == null ? [] : [`part of ${issue.parent.key} (${issue.parent.title})`]),
    ...(issue.type == null ? [] : [`type ${issue.type}`]),
    ...(issue.components === undefined || issue.components.length === 0 ? [] : [`components ${issue.components.join(', ')}`]),
    ...(issue.estimate == null ? [] : [`estimate ${issue.estimate}`]),
    ...(issue.due == null ? [] : [`due ${issue.due}`]),
  ]
  return [
    `${read.key}: ${read.title}`,
    `${read.status.name}${read.priority === null || read.priority.level === 'none' ? '' : `, ${read.priority.name} priority`}${read.container === null ? '' : `, in ${read.container}`}. ${read.url}`,
    `${facts.join('; ')}.`,
    read.body === '' ? 'No description.' : read.body,
    typeof comments === 'string'
      ? `Its comments couldn’t be read: ${comments}.`
      : comments.length === 0
        ? 'No comments.'
        : `Its latest comments, oldest first:\n${comments
            .map((one) => {
              const body = one.body.length > COMMENT_LENGTH ? `${one.body.slice(0, COMMENT_LENGTH)}…` : one.body
              return `- ${one.author?.name ?? one.author?.login ?? 'Someone'}, ${day(one.at)}: ${body.replace(/\n+/g, ' ')}`
            })
            .join('\n')}`,
  ].join('\n\n')
}

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

/** Why an issue couldn't be read, said to an agent: not on any connected tracker, or its tracker's failure, never one for the other. */
export const readRefusal = (error: unknown, wanted: string): string =>
  error instanceof NotFound ||
  error instanceof NotConnected ||
  error instanceof NotAnIssue ||
  (error instanceof ConnectorFailed && error.reason === 'not_found')
    ? `Althar can’t read ${wanted === '' ? 'that issue' : wanted}: no connected tracker has it.`
    : `Reading ${wanted === '' ? 'it' : wanted} failed: ${failedWords(error)}. Try again, or tell the person.`

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
    /**
     * An issue by its link, or its key on a connected tracker: for tools, and
     * for a task that comes from one. `NotFound` where no tracker has it; a
     * tracker's own failure where it couldn't be read, never said as not found.
     */
    read(text: string, projectId?: string): Effect.Effect<IssueRead, unknown>
    /** An issue read for an agent, with its latest comments: in words. */
    words(text: string, projectId: string): Effect.Effect<string, unknown>
    /** Issues found as an agent narrows them, on the project's trackers or one named; each tracker that couldn't be read said. */
    find(projectId: string, search: IssueSearch): Effect.Effect<IssuesFound, unknown>
    /** Says whether a task does only part of its issue, so its merge comments on the issue rather than closing it. */
    setPart(taskId: string, partOf: boolean): Effect.Effect<void, unknown>
    /** The person's open issues, on every connected tracker, or the project's own where it is bound to one; a code host's only in the project's repository. */
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
              pasted: link,
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
            pasted: link,
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

      const readOf = (text: string, projectId?: string): Effect.Effect<IssueRead, unknown, Store> =>
        Effect.gen(function* () {
          const wanted = text.trim()
          if (/^https?:\/\//.test(wanted)) {
            const found = yield* connections.resolve(wanted)
            // A link to a tracker not connected names it where its address can (a Jira Cloud site's does), or its path
            // (a Jira on a company's own domain, `/browse/PAY-12`).
            if (found === null)
              return yield* new NotConnected({
                product: parseLink(wanted)?.product ?? (looksLikeJira(wanted) ? 'jira_cloud' : 'linear'),
                what: wanted,
              })
            // A pull request's link, given for an issue, says so in its host's words.
            if (found.ref.kind !== 'issue') return yield* new NotAnIssue({ link: wanted, what: found.host?.words.noun ?? 'pull request' })
            if (found.tracker === undefined) return yield* new NotConnected({ product: found.ref.product, what: wanted })
            const issue = yield* found.tracker.issue(found.ref.ref)
            return { ...summaryOf(found.ref.product, issue), body: issue.body, connectionId: found.connectionId, issue }
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
              return { ...summaryOf(filed.product, issue), body: issue.body, connectionId: filed.connectionId, issue }
            }
          }
          // #12: an issue in the project's repository.
          const number = /^#?(\d+)$/.exec(wanted)?.[1]
          if (number !== undefined && projectId !== undefined) {
            const host = yield* projectRepository(projectId)
            const adapters = host === null ? undefined : yield* connections.adapters(host.connectionId)
            if (host === null || adapters?.tracker === undefined) return yield* new NotConnected({ product: 'github', what: wanted })
            const issue = yield* adapters.tracker.issue(`${host.path.join('/')}#${number}`)
            return { ...summaryOf(adapters.info.product, issue), body: issue.body, connectionId: host.connectionId, issue }
          }
          // MER-231, or a Trello card's short link: the project's own tracker first, where it is bound to one (ADR-059), then
          // whichever has it, each reading its own keys as typed.
          const bound = projectId === undefined ? null : yield* projectTracker(projectId)
          const trackers = (yield* connections.trackers).toSorted(
            (a, b) => Number(b.connectionId === bound?.connectionId) - Number(a.connectionId === bound?.connectionId),
          )
          // Not found on any, it is nowhere; a tracker that couldn't be read is said, never taken for not having it.
          let failed: ConnectorFailed | undefined
          for (const { connectionId, product, tracker } of trackers) {
            if (product === 'github' || product === 'gitlab') continue
            const read = yield* Effect.result(tracker.issue(wanted))
            if (read._tag === 'Success')
              return { ...summaryOf(product, read.success), body: read.success.body, connectionId, issue: read.success }
            if (read.failure.reason !== 'not_found' && read.failure.reason !== 'rejected') failed ??= read.failure
          }
          return yield* failed ?? new NotFound({ kind: 'issue', id: wanted })
        })

      const words = (text: string, projectId: string) =>
        Effect.gen(function* () {
          const read = yield* readOf(text, projectId)
          const adapters = yield* Effect.result(connections.adapters(read.connectionId))
          const tracker = adapters._tag === 'Success' ? adapters.success.tracker : undefined
          const comments =
            tracker === undefined
              ? 'its tracker isn’t connected'
              : yield* tracker.comments(read.issue, COMMENTS).pipe(Effect.catch((error) => Effect.succeed(failedWords(error))))
          return issueWords(read, comments)
        })

      /** The trackers a search looks on: the one named, or the project's own and its repository's, as its issues are listed. */
      const searched = (projectId: string, named: string | undefined) =>
        Effect.gen(function* () {
          const all = yield* connections.trackers
          const host = yield* projectRepository(projectId).pipe(Effect.orElseSucceed(() => null))
          if (named !== undefined && named.trim() !== '') {
            const typed = named.trim().toLowerCase()
            const found = all.filter(
              (one) =>
                one.product === typed ||
                products[one.product].service === typed ||
                products[one.product].name.toLowerCase() === typed ||
                one.workspace?.key.toLowerCase() === typed ||
                one.workspace?.name.toLowerCase() === typed ||
                `${products[one.product].name} (${one.workspace?.name ?? ''})`.toLowerCase() === typed,
            )
            return { trackers: found, host, named: true }
          }
          const bound = yield* projectTracker(projectId)
          return {
            trackers: all.filter(
              ({ connectionId, product }) =>
                (bound === null || connectionId === bound.connectionId || connectionId === host?.connectionId) &&
                // A code host's issues are searched in the project's own repository, unless it is named.
                (!(product === 'github' || product === 'gitlab') || connectionId === host?.connectionId),
            ),
            host,
            named: false,
          }
        })

      const find = (projectId: string, search: IssueSearch) =>
        Effect.gen(function* () {
          const limit = Math.max(1, Math.min(search.limit ?? LISTED, 100))
          const narrowed =
            search.text !== undefined || search.container !== undefined || search.state !== undefined || search.keys !== undefined
          // Nothing asked, the person's open issues, as before: asked for more, everyone's.
          const state: IssueState = search.state ?? 'open'
          const mine = search.mine ?? !narrowed
          if (search.keys !== undefined) {
            const keys = keyRange(search.keys)
            if (keys === null) return yield* new NotFound({ kind: 'key range', id: search.keys })
            const read = yield* Effect.forEach(keys, (key) => Effect.result(readOf(key, projectId)), { concurrency: 5 })
            const failed = [
              ...new Set(
                read.flatMap((one) => (one._tag === 'Failure' && !(one.failure instanceof NotFound) ? [failedWords(one.failure)] : [])),
              ),
            ]
            return {
              issues: read.flatMap((one) =>
                one._tag === 'Success' &&
                inState(state, one.success.status.category) &&
                (search.text === undefined || `${one.success.title}\n${one.success.body}`.toLowerCase().includes(search.text.toLowerCase()))
                  ? [summaryOf(one.success.product, one.success.issue)]
                  : [],
              ),
              failed: failed.map((why) => `Some of ${search.keys ?? ''} couldn’t be read: ${why}.`),
            }
          }
          const { trackers, host, named } = yield* searched(projectId, search.tracker)
          if (named && trackers.length === 0) return { issues: [], failed: [`No tracker called ${search.tracker ?? ''} is connected.`] }
          const lists = yield* Effect.forEach(
            trackers,
            ({ connectionId, product, tracker }) =>
              Effect.gen(function* () {
                const name = products[product].name
                const container = yield* containerFor(tracker, search.container, product, connectionId === host?.connectionId ? host : null)
                if (container === null) return { issues: [], failed: [`${name} has nowhere called ${search.container ?? ''} for issues.`] }
                const issues = yield* tracker.find({
                  ...(search.text === undefined || search.text.trim() === '' ? {} : { text: search.text.trim() }),
                  ...(container === undefined ? {} : { container: container.id }),
                  state,
                  ...(mine ? { mine } : {}),
                  limit,
                })
                return { issues: issues.map((issue) => summaryOf(product, issue)), failed: [] }
              }).pipe(
                Effect.catch((error) =>
                  Effect.succeed({ issues: [], failed: [`Couldn’t search ${products[product].name}: ${failedWords(error)}.`] }),
                ),
              ),
            { concurrency: 'unbounded' },
          )
          return {
            issues: lists
              .flatMap((one) => one.issues)
              .toSorted((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
              .slice(0, limit),
            failed: lists.flatMap((one) => one.failed),
          }
        })

      /**
       * Where a search looks on a tracker: the container named, by its key,
       * name or id; or, for a code host, the project's repository there.
       * Null where the tracker has none by that name; undefined for its whole.
       */
      const containerFor = (
        tracker: Tracker,
        named: string | undefined,
        product: Product,
        host: { readonly path: ReadonlyArray<string> } | null,
      ): Effect.Effect<Container | null | undefined, ConnectorFailed> =>
        Effect.gen(function* () {
          const typed = named?.trim()
          if (typed === undefined || typed === '') {
            const path = host?.path.join('/')
            return (product === 'github' || product === 'gitlab') && path !== undefined ? { id: path, key: path, name: path } : undefined
          }
          // A repository is its own path, listed or not.
          if ((product === 'github' || product === 'gitlab') && typed.includes('/')) return { id: typed, key: typed, name: typed }
          const same = (a: string | null, b: string) => a !== null && a.trim().toLowerCase() === b.toLowerCase()
          const all = yield* tracker.containers()
          return (
            all.find((one) => same(one.id, typed)) ??
            all.find((one) => same(one.key, typed)) ??
            all.find((one) => same(one.name, typed)) ??
            null
          )
        })

      const setPart = (taskId: string, partOf: boolean) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [link] = yield* sql<{ id: string; projectId: ProjectId; key: string; partOf: number }>`
            SELECT id, project_id, key, part_of FROM external_links WHERE task_id = ${taskId} AND kind = 'issue' ORDER BY created_at LIMIT 1`
          if (link === undefined) return yield* new NotFound({ kind: 'task issue', id: taskId })
          if ((link.partOf === 1) === partOf) return
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const at = yield* timestamp
              const revision = yield* change('external_links', link.id, { partOf: partOf ? 1 : 0, updatedAt: at })
              yield* fact({
                projectId: link.projectId,
                aggregateType: 'external_link',
                aggregateId: link.id,
                revision,
                type: 'external_link.issue_part',
                payload: { key: link.key, partOf },
                actorId: instance.personId,
              })
            }),
          )
          yield* touchCard(taskId)
        })

      const mine = (projectId: string) =>
        Effect.gen(function* () {
          const host = yield* projectRepository(projectId)
          // A project bound to a tracker lists its issues there alone, beside its own repository's (ADR-059).
          const bound = yield* projectTracker(projectId)
          const trackers = (yield* connections.trackers).filter(
            ({ connectionId }) => bound === null || connectionId === bound.connectionId || connectionId === host?.connectionId,
          )
          const lists = yield* Effect.forEach(
            trackers,
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
          const issue = yield* readOf(input.issue, input.projectId)
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const at = yield* timestamp
              const [existing] = yield* sql<{ id: string }>`
                SELECT id FROM external_links WHERE task_id = ${input.taskId} AND kind = 'issue' AND product = ${issue.product} AND external_id = ${issue.ref}`
              if (existing !== undefined) {
                const { body: _body, connectionId: _connection, issue: _issue, ...kept } = issue
                yield* change('external_links', existing.id, { snapshot: JSON.stringify(kept), updatedAt: at })
                return
              }
              const id = yield* newId(Ids.externalLink)
              const { body: _body, connectionId, issue: _issue, ...kept } = issue
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
              yield* indexTask(input.taskId)
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
              // GitHub's and GitLab's have no In Progress of their own: their issues are left as they are, and nothing is said.
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

      // A task's lead and its reviewers can read the issue it came from, or any other; it only reads, so a review's lead too.
      const readIssueTool = {
        name: 'read_issue',
        inReview: true,
        description:
          'An issue on a connected tracker, or in the project’s repository: its title, status, assignees, labels, project, milestone, parent and the like, its description, and its latest comments. Takes its link or its key.',
        input: { type: 'object', properties: { issue: { type: 'string' } }, required: ['issue'] },
        call: (value: unknown, access: { readonly projectId: string }) =>
          provide(
            Effect.gen(function* () {
              const wanted =
                typeof value === 'object' && value !== null && 'issue' in value && typeof value.issue === 'string' ? value.issue : ''
              return yield* words(wanted, access.projectId)
            }),
          ).pipe(
            Effect.mapError(
              (error) =>
                new ToolRefused({
                  message: readRefusal(
                    error,
                    typeof value === 'object' && value !== null && 'issue' in value && typeof value.issue === 'string' ? value.issue : '',
                  ),
                }),
            ),
          ),
      }
      const toolServer = yield* ToolServer
      yield* toolServer.serve('lead', [readIssueTool])
      yield* toolServer.serve('reviewer', [readIssueTool])

      return Issues.of({
        unfurlInput: (commandId) =>
          provide(unfurlInput(commandId)).pipe(
            Effect.catchCause((cause) => Effect.logWarning('Could not unfurl a message’s links', cause)),
          ),
        read: (text, projectId) => provide(readOf(text, projectId)),
        words: (text, projectId) => provide(words(text, projectId)),
        find: (projectId, search) => provide(find(projectId, search)),
        setPart: (taskId, partOf) => provide(setPart(taskId, partOf)),
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
