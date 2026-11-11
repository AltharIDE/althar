import {
  changeTable,
  type ChosenField,
  type Choice,
  ConnectorFailed,
  fieldsOf,
  type Issue,
  type IssueChange,
  type Product,
  products,
  type Tracker,
  unstarted,
} from '@althar/connectors'
import type { IssueChangesCard } from '@althar/contracts'
import { type ActorId, Ids, type IssueChangeState, newId, type ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { Clock, Context, type Crypto, Duration, Effect, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from './Connections'
import { envelope } from './envelope'
import { taskShown } from './evidence'
import { NotFound, OutwardUncertain } from './errors'
import { Instance } from './Instance'
import { changeWords, lineWords, linesOf } from './issueChangeWords'
import { anything, AskedFields, fieldSchema, readFields, type Wanted, wantedFields } from './issueFields'
import { Issues, keyRange } from './Issues'
import { outward } from './outward'
import { movesIssues, Policies } from './Policies'
import { change, fact, timestamp } from './records'
import { Sessions } from './Sessions'
import { addItem, updateItem } from './threads'
import { POOL, type Tool, type ToolAccess, ToolRefused, ToolServer } from './ToolServer'

export type { Wanted } from './issueFields'

/*
 * Changes to issues on the person's trackers (docs/architecture/06,
 * "Changing issues"): the coordinator's and a task's lead's, on any issue
 * (a lead's own, the one its task came from, where it names none); and
 * Althar's own, as a task's pull request opens (In
 * Review) or merges (Done, or a comment where the task did only part of its
 * issue). One card holds a change to each of one or more issues: "Move
 * DEV-67 to Done, set DEV-142 to Low".
 *
 * What changes where the issue stands (its status, priority, assignees,
 * labels, project, milestone, cycle, parent, estimate, type, components,
 * due date, title, description, closing it) waits on the person, who applies
 * the card with one press or discards it; or it is applied at once, and its
 * card is a line saying so, where its agent says to (`atOnce`), as the
 * person's note says or they just asked (DEV-182): there is no switch for
 * it. A comment and a link to a pull request apply at once, and their card
 * is a line too. So do the moves of a task's own issue with its pull request
 * (In Review as it opens, Done as it merges) where the project moves issues
 * along with its tasks (`moveIssues`); one the tracker refuses makes a card
 * with the reason, to try again.
 *
 * Names are read against the tracker as the change is proposed, field by
 * field (issueFields.ts), so a card never asks the person to apply what the
 * tracker can't take: a status its team hasn't, someone it can't be
 * assigned to. What can't be read is left off and said; what is so already
 * is left off too; the rest goes ahead, so a batch is never all or nothing.
 * Applying calls each tracker outside any transaction, each issue's change
 * as an outward action with its receipt; a change made twice changes
 * nothing more, so one whose answer was lost, or that Althar closed in the
 * middle of, can be applied again. A comment can't: one whose answer was
 * lost says to look first.
 */

/** Who proposes a card: told apart for what each hears of it after. */
export type Proposer = 'coordinator' | 'lead' | 'althar'

/** One issue on a card, as it is kept: where it is, what it was read as, what changes, and how applying it went. */
interface Entry {
  readonly connectionId: string
  readonly product: Product
  readonly tracker: string
  readonly ref: string
  readonly key: string
  readonly url: string
  readonly title: string
  readonly change: IssueChange
  /** Its status as it stood when the change was read, in its tracker's words. */
  readonly from?: string
  /** Its status once the change applied, as its tracker answered. */
  readonly became?: string
  /** The pull request that moved it, and the task's title: what its note links to. */
  readonly why?: { readonly url: string; readonly task: string }
  readonly comment?: string
  readonly link?: { readonly url: string; readonly title: string }
  /** The receipt's key, where it is shared with another action: a pull request's link, which Althar may have made as it opened. */
  readonly receipt?: string
  /** Whether its tracker gives an issue one assignee or several, for how its people read. */
  readonly assignees?: 'one' | 'many'
  readonly applied: boolean | null
  readonly error: string | null
}

interface Row {
  readonly id: string
  readonly projectId: ProjectId
  readonly threadId: string
  readonly changes: string
  readonly note: string | null
  readonly state: IssueChangeState
  readonly error: string | null
  readonly direct: number
  readonly proposedBy: Proposer
}

/** Why a change can't be proposed, in words its agent can act on. */
export class IssueChangeRefused extends Schema.TaggedError<IssueChangeRefused>()('IssueChangeRefused', {
  message: Schema.String,
}) {}

/** A card that can't take that turn now: applied, discarded, or being applied. */
export class ChangesClosed extends Schema.TaggedError<ChangesClosed>()('ChangesClosed', {
  changesId: Schema.String,
  state: Schema.String,
}) {}

/** What a proposal made: its card, where anything was left to change, and what was left off or so already, said per issue. */
export interface Proposed {
  readonly card: IssueChangesCard | null
  /** What wasn't changed and why, a line each: `DEV-67: no status called Shipped. It has: …`. */
  readonly left: ReadonlyArray<string>
  /** What was so already, a line each: `DEV-67: status Done`. */
  readonly already: ReadonlyArray<string>
}

/**
 * An entry as this version reads it. One kept before DEV-182 has no
 * `assignees`: its assignee was the one person put on in place of the
 * others, and on GitHub and GitLab its project was the issue's milestone.
 */
const current = (entry: Entry): Entry => {
  if (entry.assignees !== undefined) return entry
  const old = entry.change as Omit<IssueChange, 'assignee'> & { readonly assignee?: Choice | null }
  const host = entry.product === 'github' || entry.product === 'gitlab'
  const { project, assignee, ...rest } = old
  return {
    ...entry,
    assignees: entry.product === 'linear' || entry.product === 'jira_cloud' || entry.product === 'jira_dc' ? 'one' : 'many',
    change: {
      ...rest,
      ...(project === undefined ? {} : host ? { milestone: project } : { project }),
      ...(assignee === undefined ? {} : { assignee: assignee === null ? null : { add: [assignee], remove: [] } }),
    },
  }
}

const decodeEntries = (changes: string) => (JSON.parse(changes) as ReadonlyArray<Entry>).map(current)

/** What a card's note links to and whose task it is, where a pull request moved its issue. */
const whyOf = (entries: ReadonlyArray<Entry>) => {
  const why = entries.find((entry) => entry.why !== undefined)?.why
  return why === undefined ? {} : { noteUrl: why.url, task: why.task }
}

/** A card, from its row. */
export const cardOf = (row: Row): IssueChangesCard => ({
  changesId: row.id,
  note: row.note,
  ...whyOf(decodeEntries(row.changes)),
  state: row.state,
  error: row.error,
  direct: row.direct === 1,
  issues: decodeEntries(row.changes).map((entry) => ({
    product: entry.product,
    tracker: entry.tracker,
    key: entry.key,
    url: entry.url,
    title: entry.title,
    from: entry.from ?? null,
    became: entry.became ?? null,
    changes: linesOf(entry),
    applied: entry.applied,
    error: entry.error,
  })),
})

/** Whether a failure leaves it unknown if the tracker made the change: its answer, not the request, was lost. */
const lost = (error: unknown) =>
  error instanceof OutwardUncertain ||
  (error instanceof ConnectorFailed && (error.reason === 'unreachable' || error.reason === 'invalid_response'))

/** Why applying an issue's change failed, in words its card shows. */
const failureWords = (error: unknown, tracker: string, comment: boolean): string => {
  if (lost(error))
    return comment
      ? `Its answer was lost, so Althar can’t tell whether ${tracker} took the comment. Look on ${tracker} before you try again.`
      : `Its answer was lost, so it may have changed on ${tracker}. Applying again is safe.`
  if (error instanceof ConnectorFailed)
    switch (error.reason) {
      case 'unauthorized':
        return `${tracker} didn’t take Althar’s sign-in. Sign in again in Settings, then try again.`
      case 'forbidden':
        return `${tracker} says this account may not change it${error.message === '' ? '.' : `: ${error.message}`}`
      case 'not_found':
        return `${tracker} doesn’t have it any more, or this account can’t see it.`
      case 'rate_limited':
        return `${tracker} asks Althar to wait before trying again.`
      default:
        return error.message === '' ? `${tracker} refused it.` : error.message
    }
  return `The connection to ${tracker} is gone. Connect it again, then try again.`
}

type Store = SqlClient.SqlClient | Instance | Ledger | Crypto.Crypto | Connections | Sessions | Issues | Policies | ToolServer

/** An issue's change as a tool takes it: by the tracker's names, labels and people added and taken off in lists of their own. */
const AskedChange = Schema.Struct({
  ...AskedFields.fields,
  close: Schema.optional(Schema.Boolean),
  unassign: Schema.optional(Schema.Array(Schema.String)),
  add_labels: Schema.optional(Schema.Array(Schema.String)),
  remove_labels: Schema.optional(Schema.Array(Schema.String)),
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
})

/**
 * A lead's change: to its own issue, or others by key or link; the same
 * change to several (`issues`), or a change of its own to each (`changes`).
 */
const LeadChange = Schema.Struct({
  ...AskedChange.fields,
  issue: Schema.optional(Schema.String),
  issues: Schema.optional(Schema.Array(Schema.String)),
  changes: Schema.optional(Schema.Array(Schema.Struct({ issue: Schema.String, ...AskedChange.fields }))),
  at_once: Schema.optional(Schema.Boolean),
})

/** How many issues one change, or one comment, goes to at most. */
const BATCH = 50

/** From how many issues on a card applying it is paced to its trackers' limits. */
const PACED_FROM = 10

/**
 * How long applying waits between one issue and the next on a tracker, in a
 * batch that big: GitHub asks a second between writes (its secondary limits),
 * Trello allows a hundred calls in ten seconds a token, and Jira Cloud counts
 * calls' cost a while; the others' limits hold a batch at once.
 */
const PACE: Readonly<Partial<Record<Product, number>>> = { github: 1_000, trello: 150, jira_cloud: 100 }

/** How long a tracker that asks Althar to wait is waited for, in a batch, before its issue is said not to have changed. */
const WAITED = 60_000

/** Keys as typed, a run of them read as its keys. */
const keysIn = (typed: ReadonlyArray<string>) => typed.flatMap((one) => keyRange(one) ?? [one.trim()]).filter((one) => one !== '')

const ChangesAsked = Schema.Struct({
  changes: Schema.Array(Schema.Struct({ issue: Schema.String, ...AskedChange.fields })),
  note: Schema.optional(Schema.String),
  at_once: Schema.optional(Schema.Boolean),
})

const CommentAsked = Schema.Struct({
  issue: Schema.optional(Schema.String),
  issues: Schema.optional(Schema.Array(Schema.String)),
  body: Schema.String,
})

/** What a tool was asked, as a change. */
const wantedOf = (asked: typeof AskedChange.Type): Effect.Effect<Wanted, ToolRefused> =>
  Effect.map(wantedFields(asked), (fields) => ({
    ...fields,
    ...(asked.close === true ? { close: true } : {}),
    ...(asked.unassign === undefined || asked.unassign.length === 0 ? {} : { unassign: asked.unassign }),
    ...(asked.add_labels === undefined && asked.remove_labels === undefined
      ? {}
      : { labels: { add: asked.add_labels ?? [], remove: asked.remove_labels ?? [] } }),
    ...(asked.title === undefined ? {} : { title: asked.title }),
    ...(asked.description === undefined ? {} : { description: asked.description }),
  }))

const readInput = <A>(schema: Schema.Codec<A, unknown>, input: unknown) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError((error) => new ToolRefused({ message: `Althar couldn't read that: ${error.message}` })),
  )

/** What a card's agent hears once it is made: waiting on the person, or applied at once, and how; and what was left off or so already. */
export const proposedWords = (proposed: Proposed): string => {
  const { card } = proposed
  const rest = [
    ...(proposed.left.length === 0 ? [] : [`Not changed: ${proposed.left.join(' ')}`]),
    ...(proposed.already.length === 0 ? [] : [`Already so: ${proposed.already.join('; ')}.`]),
  ]
  if (card === null)
    return [
      'Nothing changed.',
      ...(proposed.left.length === 0 ? [] : [proposed.left.join(' ')]),
      ...(proposed.already.length === 0 ? [] : [`Already so: ${proposed.already.join('; ')}.`]),
    ].join(' ')
  const said = card.issues.map((issue) => `${issue.key}: ${issue.changes.map(lineWords).join(', ')}`).join('; ')
  const made = !card.direct
    ? `Proposed ${said}. Nothing changes until the person applies it from its card in this thread, or discards it; they see it there, so there's no need to repeat it. You'll hear what they decide.`
    : card.state === 'applied'
      ? `Done: ${said}. The thread shows it as a line.`
      : `Tried ${said}, and not all of it applied: ${card.issues.flatMap((issue) => (issue.error === null ? [] : [`${issue.key}: ${issue.error}`])).join(' ')} The person can apply it again from its card.`
  return [made, ...rest].join(' ')
}

/** The fields an issue's change takes, as JSON Schema: the tracker's own names, which Althar reads against it. */
const changeFields = {
  ...fieldSchema,
  close: { type: 'boolean', description: 'Close it as done, by its tracker’s own way.' },
  unassign: { type: 'array', items: { type: 'string' }, description: 'People to take off it, by name, login or email.' },
  add_labels: { type: 'array', items: { type: 'string' }, description: 'Labels its tracker has, to add.' },
  remove_labels: { type: 'array', items: { type: 'string' }, description: 'Labels to take off.' },
  title: { type: 'string' },
  description: { type: 'string', description: 'Its description anew, in Markdown, in place of what it says now.' },
}

/** Applied at once, rather than as a card: what the person's note says, or what they just said. */
const atOnceField = {
  type: 'boolean',
  description:
    'Apply it at once rather than as a card for the person, where the project’s notes say issues are changed at once, or the person just said to. Left out, it waits on their card.',
}

/** An issue as its tracker has it now, with where it is. */
interface Found {
  readonly connectionId: string
  readonly product: Product
  /** Its tracker, by its product's name. */
  readonly name: string
  readonly tracker: Tracker
  readonly issue: Issue
}

/** An issue to change: by its key or link, as an agent names it; or by where it is, as a task's own issue is kept. */
export type Target = { readonly issue: string } | { readonly connectionId: string; readonly ref: string }

export class IssueChanges extends Context.Service<
  IssueChanges,
  {
    /**
     * Proposes changes to one or more issues, as a card in the thread they
     * are proposed in, or applies them at once where `direct` says. Each
     * name is read against its tracker first, field by field: one it
     * hasn't, a field it can't change, and what is so already, are left off
     * and said, and the rest goes ahead. No card where nothing is left to
     * change on any issue.
     */
    propose(input: {
      readonly projectId: ProjectId
      readonly threadId: string
      readonly issues: ReadonlyArray<{ readonly target: Target; readonly change: Wanted }>
      readonly note?: string
      /** Where the pull request is and whose task it is, as the note links it: a pull request's move of its task's issue. */
      readonly why?: { readonly url: string; readonly task: string }
      /** Applied at once rather than waiting on the person's card: as their note says or they just asked, or a move the project lets through. */
      readonly direct?: boolean
      readonly by: Proposer
      readonly actorId: ActorId
    }): Effect.Effect<Proposed, unknown>
    /** Comments on an issue at once, and says so in the thread, as a line. */
    comment(input: {
      readonly projectId: ProjectId
      readonly threadId: string
      readonly target: Target
      readonly body: string
      readonly by: Proposer
      readonly actorId: ActorId
    }): Effect.Effect<IssueChangesCard, unknown>
    /**
     * Comments the same on several issues, on one card: at once, or, where
     * `direct` is false, once the person applies it. Each that can't be read
     * is left off and said; what applied, and what didn't, each issue says.
     */
    commentOnEach(input: {
      readonly projectId: ProjectId
      readonly threadId: string
      readonly targets: ReadonlyArray<Target>
      readonly body: string
      readonly direct: boolean
      readonly by: Proposer
      readonly actorId: ActorId
    }): Effect.Effect<{ readonly card: IssueChangesCard | null; readonly left: ReadonlyArray<string> }, unknown>
    /** Links a pull request to an issue at once, where its tracker has links, and says so in the thread, as a line. */
    link(input: {
      readonly projectId: ProjectId
      readonly threadId: string
      readonly target: Target
      readonly link: { readonly url: string; readonly title: string }
      readonly receipt: string
      readonly by: Proposer
      readonly actorId: ActorId
    }): Effect.Effect<IssueChangesCard, unknown>
    /** Applies a card's changes, because the person said to; those that didn't apply, again. `ChangesClosed` once applied or discarded. */
    apply(changesId: string, actorId: ActorId): Effect.Effect<IssueChangesCard, unknown>
    /** Discards a card: nothing changes. `ChangesClosed` once applied, or being applied. */
    discard(changesId: string, actorId: ActorId): Effect.Effect<void, unknown>
    /**
     * Offers to move the issue a task came from along with its pull
     * request, where the project moves issues (`moveIssues`): to its
     * tracker's review status as it opens, in the task's thread; to done as
     * it merges, in the coordinator's, since a merged task settles. Nothing
     * where the tracker has no such status, or the issue is there or past it
     * already. Never fails: what it meets is logged.
     */
    followPullRequest(
      taskId: string,
      event: 'opened' | 'merged',
      pullRequest: { readonly key: string; readonly url: string },
    ): Effect.Effect<void>
  }
>()('@althar/runtime/IssueChanges') {
  static readonly layer: Layer.Layer<IssueChanges, never, Store> = Layer.effect(
    IssueChanges,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const connections = yield* Connections
      const sessions = yield* Sessions
      const issues = yield* Issues
      const policies = yield* Policies
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)
      const refused = (message: string) => new IssueChangeRefused({ message })

      const load = (changesId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<Row>`
            SELECT id, project_id, thread_id, changes, note, state, error, direct, proposed_by FROM issue_changes
            WHERE id = ${changesId} AND project_id IN (SELECT id FROM projects WHERE archived_at IS NULL)`
          return row === undefined ? yield* new NotFound({ kind: 'issue changes', id: changesId }) : row
        })

      /** Rewrites a card from its row, inside the transaction that changed it. */
      const showCard = (changesId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const row = yield* load(changesId)
          const [item] = yield* sql<{ id: string }>`
            SELECT id FROM thread_items WHERE thread_id = ${row.threadId} AND kind = 'issue_changes' AND json_extract(content, '$.changesId') = ${changesId}`
          if (item !== undefined) yield* updateItem(row.projectId, item.id, cardOf(row))
        })

      /** Changes a card if it stands as `when` needs, checked and changed in one transaction with its card, so two presses can't both apply it. */
      const transition = (
        changesId: string,
        when: (row: Row) => boolean,
        set: (row: Row, at: string) => Readonly<Record<string, unknown>>,
        type: string,
        actorId: ActorId,
        payload?: (row: Row) => unknown,
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              const row = yield* load(changesId)
              if (!when(row)) return { changed: false as const, row }
              const at = yield* timestamp
              const revision = yield* change('issue_changes', changesId, { ...set(row, at), updatedAt: at })
              const after = yield* load(changesId)
              yield* fact({
                projectId: row.projectId,
                aggregateType: 'issue_change',
                aggregateId: changesId,
                revision,
                type,
                ...(payload === undefined ? {} : { payload: payload(after) }),
                actorId,
              })
              yield* showCard(changesId)
              return { changed: true as const, row: after }
            }),
          )
        })

      /** An issue as its tracker has it now, with where it is: by its key or link, or where a task keeps it. */
      const found = (projectId: ProjectId, target: Target): Effect.Effect<Found, unknown, Store> =>
        Effect.gen(function* () {
          const where =
            'issue' in target
              ? yield* issues.read(target.issue, projectId).pipe(
                  Effect.map((read) => ({ connectionId: read.connectionId, ref: read.ref })),
                  Effect.mapError(() =>
                    refused(`Althar can’t find ${target.issue} on a connected tracker, or in the project’s repository.`),
                  ),
                )
              : target
          const adapters = yield* connections
            .adapters(where.connectionId)
            .pipe(Effect.mapError(() => refused('The tracker that issue is on isn’t connected to Althar any more.')))
          const tracker = adapters.tracker
          if (tracker === undefined) return yield* refused('That connection has no issues Althar can change.')
          const name = products[adapters.info.product].name
          const issue = yield* tracker
            .issue(where.ref)
            .pipe(Effect.mapError((error) => refused(`Althar couldn’t read it on ${name}: ${error.message}`)))
          return { connectionId: where.connectionId, product: adapters.info.product, name, tracker, issue }
        })

      /**
       * What an agent asked of an issue, read against its tracker, field by
       * field. A batch reads each field's choices once for issues in the same
       * place (a team, board, project or repository): not Jira's statuses or
       * labels, which are each issue's own.
       */
      const resolve = (at: Found, wanted: Wanted, read: Map<string, Effect.Effect<ReadonlyArray<Choice>, ConnectorFailed>>) =>
        readFields(
          {
            tracker: at.tracker,
            product: at.product,
            name: at.name,
            issue: at.issue,
            // A code host's issue is `owner/repo#12`: a parent's `#7` is in its repository.
            ...(at.issue.ref.includes('#') ? { repository: at.issue.ref.slice(0, at.issue.ref.lastIndexOf('#')) } : {}),
            choices: (field: ChosenField, typed?: string) => {
              const own = (at.product === 'jira_cloud' || at.product === 'jira_dc') && (field === 'status' || field === 'labels')
              const asked = at.tracker.choices(at.issue, field, typed)
              if (own || at.issue.container === null) return asked
              const key = `${at.connectionId}\u0000${at.issue.container}\u0000${field}\u0000${typed ?? ''}`
              const kept = read.get(key)
              if (kept !== undefined) return kept
              return Effect.tap(asked, (choices) => Effect.sync(() => read.set(key, Effect.succeed(choices))))
            },
          },
          wanted,
        )

      /** Makes a card, its row and its item, in one transaction. */
      const make = (input: {
        readonly projectId: ProjectId
        readonly threadId: string
        readonly entries: ReadonlyArray<Entry>
        readonly note?: string
        readonly by: Proposer
        readonly actorId: ActorId
        readonly direct: boolean
      }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const changesId = yield* newId(Ids.issueChange)
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const at = yield* timestamp
              yield* sql`INSERT INTO issue_changes ${sql.insert({
                id: changesId,
                projectId: input.projectId,
                threadId: input.threadId,
                changes: JSON.stringify(input.entries),
                note: input.note?.trim() === '' ? null : (input.note?.trim() ?? null),
                state: 'pending',
                direct: input.direct ? 1 : 0,
                proposedBy: input.by,
                proposedByActorId: input.actorId,
                createdAt: at,
                updatedAt: at,
              })}`
              yield* fact({
                projectId: input.projectId,
                aggregateType: 'issue_change',
                aggregateId: changesId,
                revision: 1,
                type: 'issue_change.proposed',
                payload: { by: input.by, changes: changeWords(input.entries) },
                actorId: input.actorId,
              })
              yield* addItem({ projectId: input.projectId, threadId: input.threadId }, 'issue_changes', cardOf(yield* load(changesId)))
            }),
          )
          return changesId
        })

      /** What applying does to one issue: its change, its comment or its link, as an outward action with its receipt. */
      const applyEntry = (row: Row, entry: Entry, index: number) =>
        Effect.gen(function* () {
          const adapters = yield* connections.adapters(entry.connectionId)
          const tracker = adapters.tracker
          if (tracker === undefined) return yield* new NotFound({ kind: 'connection', id: entry.connectionId })
          // Wanting its sign-in again, the tracker isn't asked: it would refuse.
          if (adapters.info.state !== 'ready')
            return yield* new ConnectorFailed({ product: entry.product, reason: 'unauthorized', message: '' })
          const subject = { type: 'issue_change', id: row.id }
          const target = `${entry.product}:${entry.key}`
          if (entry.comment !== undefined)
            return yield* outward({
              projectId: row.projectId,
              subject,
              target,
              operation: 'comment_issue',
              key: `issue_change:${row.id}:${index}`,
              request: { length: entry.comment.length },
              // Twice would post it twice.
              retryable: false,
              perform: Effect.as(
                Effect.flatMap(tracker.issue(entry.ref), (issue) => tracker.comment(issue, entry.comment ?? '')),
                true,
              ),
              encode: () => true,
              // Done once, it is done: asked again, its receipt answers.
              decode: () => true,
            })
          if (entry.link !== undefined)
            return yield* outward({
              projectId: row.projectId,
              subject,
              target,
              operation: 'link_issue',
              key: entry.receipt ?? `issue_change:${row.id}:${index}`,
              request: { url: entry.link.url },
              retryable: true,
              perform: Effect.as(
                Effect.flatMap(tracker.issue(entry.ref), (issue) => tracker.link(issue, entry.link ?? { url: '', title: '' })),
                true,
              ),
              encode: () => true,
              // Done once, it is done: asked again, its receipt answers.
              decode: () => true,
            })
          return yield* outward({
            projectId: row.projectId,
            subject,
            target,
            operation: 'change_issue',
            key: `issue_change:${row.id}:${index}`,
            request: { fields: fieldsOf(entry.change) },
            // Made twice, a change changes nothing more.
            retryable: true,
            perform: Effect.flatMap(tracker.issue(entry.ref), (issue) =>
              Effect.map(tracker.update(issue, entry.change), (after) => ({ status: after.status })),
            ),
            encode: (answer: { readonly status: Issue['status'] }) => answer,
            decode: (kept) => kept as { readonly status: Issue['status'] },
          })
        })

      /**
       * An issue's change applied in a batch: after a pause its tracker's
       * limits ask for, where the batch is big; and once more after the wait
       * a tracker asks for, where it says how long and that isn't long.
       */
      const pacedEntry = (row: Row, entry: Entry, index: number, paced: boolean) =>
        Effect.gen(function* () {
          const pause = PACE[entry.product] ?? 0
          if (paced && index > 0 && pause > 0) yield* Effect.sleep(Duration.millis(pause))
          return yield* applyEntry(row, entry, index).pipe(
            Effect.catchIf(
              (error) => error instanceof ConnectorFailed && error.reason === 'rate_limited' && error.retryAt !== undefined,
              (error) =>
                Effect.gen(function* () {
                  const wait = Date.parse((error as ConnectorFailed).retryAt ?? '') - (yield* Clock.currentTimeMillis)
                  if (Number.isNaN(wait) || wait > WAITED) return yield* Effect.fail(error)
                  yield* Effect.sleep(Duration.millis(Math.max(0, wait)))
                  return yield* applyEntry(row, entry, index)
                }),
            ),
          )
        })

      /**
       * Tells a task's lead what the person decided about a card of its,
       * quietly: in its thread, as input Althar writes. Nothing for the
       * coordinator's, which it hears as news, or Althar's own; nor for a
       * task that is over.
       */
      const tellLead = (row: Row, words: string) =>
        Effect.gen(function* () {
          if (row.proposedBy !== 'lead') return
          const sql = yield* SqlClient.SqlClient
          const [thread] = yield* sql<{ id: string }>`
            SELECT t.id FROM threads t JOIN tasks k ON k.id = t.task_id
            WHERE t.id = ${row.threadId} AND t.kind = 'task' AND k.state = 'open'`
          if (thread === undefined) return
          yield* sessions.send({
            envelope: yield* envelope('thread.send', { threadId: thread.id, issueChanges: row.id }, undefined, instance.systemId),
            threadId: thread.id,
            body: words,
            quiet: true,
          })
        }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not tell a lead what became of its issue changes', cause)))

      /** The issue a task came from, as its card shows it, read again where a card changed its status. */
      const refreshOwn = (row: Row, entry: Entry, status: Issue['status']) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [link] = yield* sql<{ id: string; snapshot: string }>`
            SELECT x.id, x.snapshot FROM external_links x JOIN threads t ON t.task_id = x.task_id
            WHERE t.id = ${row.threadId} AND x.kind = 'issue' AND x.connection_id = ${entry.connectionId} AND x.ref = ${entry.ref}`
          if (link === undefined) return
          const at = yield* timestamp
          yield* change('external_links', link.id, {
            snapshot: JSON.stringify({ ...(JSON.parse(link.snapshot) as Record<string, unknown>), status }),
            updatedAt: at,
          })
        }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not show a task’s issue as it now stands', cause)))

      const open = (row: Row) => row.state === 'pending' || row.state === 'failed'
      const closed = (row: Row) => new ChangesClosed({ changesId: row.id, state: row.state })

      const apply: IssueChanges['Service']['apply'] = (changesId, actorId) =>
        provide(
          Effect.gen(function* () {
            const marked = yield* transition(changesId, open, () => ({ state: 'applying', error: null }), 'issue_change.applying', actorId)
            if (!marked.changed) return marked.row.state === 'applying' ? cardOf(marked.row) : yield* closed(marked.row)
            const row = marked.row
            const before = decodeEntries(row.changes)
            // Each issue on its own: what applied stays applied, and what didn't says why. A big batch is paced to its trackers.
            const paced = before.length >= PACED_FROM
            const after = yield* Effect.forEach(before, (entry, index) =>
              entry.applied === true
                ? Effect.succeed(entry)
                : Effect.map(Effect.result(pacedEntry(row, entry, index, paced)), (made): Entry => {
                    if (made._tag === 'Success')
                      return {
                        ...entry,
                        applied: true,
                        error: null,
                        ...(typeof made.success === 'object' && made.success !== null && 'status' in made.success
                          ? { became: made.success.status.name }
                          : {}),
                      }
                    return { ...entry, applied: false, error: failureWords(made.failure, entry.tracker, entry.comment !== undefined) }
                  }),
            )
            const failed = after.filter((entry) => entry.applied !== true)
            if (failed.length > 0)
              yield* Effect.logWarning(
                'Not every issue change applied',
                failed.map((entry) => entry.error),
              )
            const ended = yield* transition(
              changesId,
              (now) => now.state === 'applying',
              (_, at) => ({
                changes: JSON.stringify(after),
                state: failed.length === 0 ? 'applied' : 'failed',
                error:
                  failed.length === 0
                    ? null
                    : failed.length === after.length
                      ? (failed[0]?.error ?? 'It didn’t apply.')
                      : `${failed.map((entry) => entry.key).join(', ')} didn’t change.`,
                ...(failed.length === 0 ? { decidedAt: at } : {}),
              }),
              failed.length === 0 ? 'issue_change.applied' : 'issue_change.failed',
              actorId,
              (now) => ({ changes: changeWords(decodeEntries(now.changes)), error: now.error }),
            )
            // A task's own issue shows as it now stands.
            for (const entry of after)
              if (entry.applied === true && fieldsOf(entry.change).some((field) => field === 'status' || field === 'close')) {
                const now = yield* Effect.result(
                  Effect.flatMap(connections.adapters(entry.connectionId), (adapters) =>
                    adapters.tracker === undefined
                      ? Effect.succeed(undefined)
                      : Effect.map(adapters.tracker.issue(entry.ref), (one) => one.status),
                  ),
                )
                if (now._tag === 'Success' && now.success !== undefined) yield* refreshOwn(row, entry, now.success)
              }
            // What it applied at once, its lead heard from its tool already.
            if (ended.changed && row.direct === 0)
              yield* tellLead(
                ended.row,
                ended.row.state === 'applied'
                  ? `The person applied your change to the issue: ${changeWords(after)}.`
                  : `Your change to the issue didn’t all apply: ${ended.row.error ?? ''} The person can apply it again from its card.`,
              )
            return cardOf(ended.row)
          }),
        )

      const discard: IssueChanges['Service']['discard'] = (changesId, actorId) =>
        provide(
          Effect.gen(function* () {
            const result = yield* transition(
              changesId,
              open,
              (_, at) => ({ state: 'discarded', error: null, decidedAt: at }),
              'issue_change.discarded',
              actorId,
            )
            if (!result.changed) return yield* closed(result.row)
            yield* tellLead(
              result.row,
              `The person discarded your change to the issue (${changeWords(decodeEntries(result.row.changes))}): nothing changed on the tracker. Don't propose it again unless they ask.`,
            )
          }),
        )

      /** Makes a card, and applies it at once where it doesn't wait on the person. */
      const proposeEntries = (input: {
        readonly projectId: ProjectId
        readonly threadId: string
        readonly entries: ReadonlyArray<Entry>
        readonly note?: string
        readonly by: Proposer
        readonly actorId: ActorId
        readonly direct: boolean
      }) =>
        Effect.gen(function* () {
          const changesId = yield* make(input)
          if (!input.direct) return cardOf(yield* load(changesId))
          return yield* apply(changesId, input.actorId)
        })

      const entryOf = (at: Found, more: Partial<Entry>): Entry => ({
        connectionId: at.connectionId,
        product: at.product,
        tracker: at.name,
        ref: at.issue.ref,
        key: at.issue.key,
        url: at.issue.url,
        title: at.issue.title,
        from: at.issue.status.name,
        assignees: at.tracker.capabilities.assignees,
        change: {},
        applied: null,
        error: null,
        ...more,
      })

      const propose: IssueChanges['Service']['propose'] = (input) =>
        provide(
          Effect.gen(function* () {
            if (input.issues.length === 0) return yield* refused('Name at least one issue to change.')
            // Each issue on its own: one that can't be read, or has nothing left to change, leaves the others to go ahead.
            const choices = new Map<string, Effect.Effect<ReadonlyArray<Choice>, ConnectorFailed>>()
            const read = yield* Effect.forEach(input.issues, ({ target, change: wanted }) =>
              Effect.gen(function* () {
                const at = yield* Effect.result(found(input.projectId, target))
                const named = 'issue' in target ? target.issue : target.ref
                if (at._tag === 'Failure')
                  return {
                    left: [at.failure instanceof IssueChangeRefused ? at.failure.message : `${named}: Althar couldn’t read it.`],
                    already: [],
                  }
                const fields = yield* resolve(at.success, wanted, choices)
                const key = at.success.issue.key
                return {
                  entry: anything(fields.change)
                    ? entryOf(at.success, { change: fields.change, ...(input.why === undefined ? {} : { why: input.why }) })
                    : undefined,
                  left: fields.left.map((why) => `${key}: ${why}.`),
                  already: fields.already.map((what) => `${key}: ${what}`),
                }
              }),
            )
            const entries = read.flatMap((one) => ('entry' in one && one.entry !== undefined ? [one.entry] : []))
            const keys = entries.map((entry) => `${entry.connectionId}:${entry.ref}`)
            if (new Set(keys).size !== keys.length) return yield* refused('Name each issue once, with everything that changes on it.')
            const left = read.flatMap((one) => one.left)
            const already = read.flatMap((one) => one.already)
            if (entries.length === 0) return { card: null, left, already }
            const card = yield* proposeEntries({
              projectId: input.projectId,
              threadId: input.threadId,
              entries,
              ...(input.note === undefined ? {} : { note: input.note }),
              by: input.by,
              actorId: input.actorId,
              direct: input.direct === true,
            })
            return { card, left, already }
          }),
        )

      const comment: IssueChanges['Service']['comment'] = (input) =>
        provide(
          Effect.gen(function* () {
            const body = input.body.trim()
            if (body === '') return yield* refused('Write the comment: it is empty.')
            const at = yield* found(input.projectId, input.target)
            return yield* proposeEntries({
              projectId: input.projectId,
              threadId: input.threadId,
              entries: [entryOf(at, { comment: body })],
              by: input.by,
              actorId: input.actorId,
              direct: true,
            })
          }),
        )

      const commentOnEach: IssueChanges['Service']['commentOnEach'] = (input) =>
        provide(
          Effect.gen(function* () {
            const body = input.body.trim()
            if (body === '') return yield* refused('Write the comment: it is empty.')
            const read = yield* Effect.forEach(input.targets, (target) => Effect.result(found(input.projectId, target)))
            const entries = read.flatMap((one) => (one._tag === 'Success' ? [entryOf(one.success, { comment: body })] : []))
            const left = read.flatMap((one, index) => {
              if (one._tag === 'Success') return []
              const target = input.targets[index]
              const named = target === undefined ? 'it' : 'issue' in target ? target.issue : target.ref
              return [one.failure instanceof IssueChangeRefused ? one.failure.message : `${named}: Althar couldn’t read it.`]
            })
            const keys = entries.map((entry) => `${entry.connectionId}:${entry.ref}`)
            if (new Set(keys).size !== keys.length) return yield* refused('Name each issue once.')
            if (entries.length === 0) return { card: null, left }
            const card = yield* proposeEntries({
              projectId: input.projectId,
              threadId: input.threadId,
              entries,
              by: input.by,
              actorId: input.actorId,
              direct: input.direct,
            })
            return { card, left }
          }),
        )

      const link: IssueChanges['Service']['link'] = (input) =>
        provide(
          Effect.gen(function* () {
            const at = yield* found(input.projectId, input.target)
            if (!at.tracker.capabilities.links)
              return yield* refused(
                `${at.name}'s issues take no links: a pull request that names ${at.issue.key} in its title, branch or description is linked to it already.`,
              )
            return yield* proposeEntries({
              projectId: input.projectId,
              threadId: input.threadId,
              entries: [entryOf(at, { link: input.link, receipt: input.receipt })],
              by: input.by,
              actorId: input.actorId,
              direct: true,
            })
          }),
        )

      /** What a task built, as its lead last said it, else its title: what a merge that did part of an issue says landed. */
      const landed = (threadId: string, title: string) =>
        Effect.map(
          Effect.orElseSucceed(taskShown(threadId), () => ({ built: null })),
          ({ built }) => (built === null || built.trim() === '' ? title : built.trim()),
        )

      const followPullRequest: IssueChanges['Service']['followPullRequest'] = (taskId, event, pullRequest) =>
        provide(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const [own] = yield* sql<{
              projectId: ProjectId
              connectionId: string | null
              ref: string
              threadId: string | null
              partOf: number
            }>`
              SELECT x.project_id, x.connection_id, x.ref, x.part_of,
                (SELECT id FROM threads WHERE task_id = x.task_id AND kind = 'task') AS thread_id
              FROM external_links x WHERE x.task_id = ${taskId} AND x.kind = 'issue' ORDER BY x.created_at LIMIT 1`
            if (own === undefined || own.connectionId === null || own.threadId === null) return
            const [task] = yield* sql<{ title: string }>`SELECT title FROM tasks WHERE id = ${taskId}`
            // A merged task settles as done, so what it says goes where the person reads about the project: the coordinator's thread.
            const [coordinator] =
              event === 'merged'
                ? yield* sql<{ id: string }>`SELECT id FROM threads WHERE project_id = ${own.projectId} AND kind = 'coordinator' LIMIT 1`
                : []
            // A task that did only part of its issue leaves it open: its merge says on the issue what landed, whether or not issues move.
            if (event === 'merged' && own.partOf === 1) {
              const words = yield* landed(own.threadId, task?.title ?? '')
              const card = yield* comment({
                projectId: own.projectId,
                threadId: coordinator?.id ?? own.threadId,
                target: { connectionId: own.connectionId, ref: own.ref },
                body: `Part of this landed in [${pullRequest.key}](${pullRequest.url}), merged:\n\n${words}`,
                by: 'althar',
                actorId: instance.systemId,
              })
              yield* Effect.logDebug('Said on a task’s issue what part of it landed', card.changesId)
              return
            }
            if (!movesIssues((yield* policies.current(own.projectId)).rules)) return
            const at = yield* found(own.projectId, { connectionId: own.connectionId, ref: own.ref })
            const { issue, tracker } = at
            // Done or cancelled already, it is left as it is.
            if (issue.status.category === 'done' || issue.status.category === 'cancelled') return
            const wanted: Wanted | undefined =
              event === 'merged'
                ? tracker.capabilities.changes.includes('close')
                  ? { close: true }
                  : undefined
                : yield* Effect.gen(function* () {
                    if (!tracker.capabilities.changes.includes('status')) return undefined
                    // Its tracker's own review status, where it has one; one in review already is left as it is.
                    const review = (yield* tracker.choices(issue, 'status')).find((choice) => /\breview\b/i.test(choice.name))
                    if (review === undefined || review.name.trim().toLowerCase() === issue.status.name.trim().toLowerCase())
                      return undefined
                    // Not back from further along, as a status after In Review would be; only from where work is under way, or hasn't started.
                    return unstarted(issue.status.category) || issue.status.category === 'started' ? { status: review.name } : undefined
                  })
            if (wanted === undefined) return
            const proposed = yield* propose({
              projectId: own.projectId,
              threadId: coordinator?.id ?? own.threadId,
              issues: [{ target: { connectionId: own.connectionId, ref: own.ref }, change: wanted }],
              note: `${pullRequest.key} ${event}`,
              why: { url: pullRequest.url, task: task?.title ?? '' },
              // The project moves issues along with its tasks: it doesn't wait on the person. A move the tracker refuses stays a card to try again.
              direct: true,
              by: 'althar',
              actorId: instance.systemId,
            })
            yield* Effect.logDebug('Moved a task’s issue with its pull request', proposed.card?.changesId ?? proposed.left.join(' '))
          }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not move a task’s issue with its pull request', cause))),
        )

      // A card Althar closed while applying may have applied in part: said so, and applying it again is safe.
      yield* provide(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const stuck = yield* sql<{ id: string }>`SELECT id FROM issue_changes WHERE state = 'applying'`
          for (const card of stuck)
            yield* transition(
              card.id,
              (row) => row.state === 'applying',
              () => ({ state: 'failed', error: 'Althar closed while applying these. Applying them again is safe.' }),
              'issue_change.failed',
              instance.systemId,
              (row) => ({ error: row.error }),
            )
        }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not settle the issue changes left being applied', cause))),
      )

      /** A tool: what it was asked, done, and anything that isn't a refusal said as Althar not managing it. */
      const tool = (
        name: string,
        description: string,
        input: Readonly<Record<string, unknown>>,
        call: (access: ToolAccess, input: unknown) => Effect.Effect<string, unknown, Store>,
      ): Tool => ({
        name,
        description,
        input,
        call: (value, access) =>
          provide(call(access, value)).pipe(
            Effect.catch((error) =>
              error instanceof ToolRefused
                ? Effect.fail(error)
                : error instanceof IssueChangeRefused
                  ? Effect.fail(new ToolRefused({ message: error.message }))
                  : Effect.andThen(
                      Effect.logWarning('An issue tool did not succeed', error),
                      Effect.fail(new ToolRefused({ message: 'Althar could not do that. Try again, or tell the person.' })),
                    ),
            ),
          ),
      })

      /** The issue a lead's task came from, or why it has none. */
      const ownIssue = (access: ToolAccess) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [own] = yield* sql<{ id: string; connectionId: string | null; ref: string; key: string }>`
            SELECT id, connection_id, ref, key FROM external_links WHERE task_id = ${access.taskId ?? ''} AND kind = 'issue'
            ORDER BY created_at LIMIT 1`
          if (own === undefined)
            return yield* new ToolRefused({
              message:
                'This task didn’t come from an issue, so it has none of its own to change. Name the one you mean, by its key or link, as issue.',
            })
          if (own.connectionId === null)
            return yield* new ToolRefused({ message: `The tracker ${own.key} is on isn’t connected to Althar any more.` })
          return { linkId: own.id, key: own.key, target: { connectionId: own.connectionId, ref: own.ref } }
        })

      /**
       * Where an issue a lead names is: any of the project's trackers' issues,
       * whichever task it came from, as the coordinator's are (the person's
       * note of 11 Nov: whose an issue is is no reason to hold a change to
       * it). Refused where no tracker has it.
       */
      const leadScope = (access: ToolAccess, named: string) =>
        Effect.map(
          issues
            .read(named, access.projectId)
            .pipe(Effect.mapError(() => new ToolRefused({ message: `Althar can’t find ${named} on a connected tracker.` }))),
          (read) => ({ target: { connectionId: read.connectionId, ref: read.ref }, key: read.key }),
        )

      /** The issue a lead changes or comments on where it names none: its task's own. */
      const leadTarget = (access: ToolAccess) => Effect.map(ownIssue(access), (own) => own.target)

      const actorOf = (access: ToolAccess) => (access.role === 'coordinator' ? instance.coordinatorId : instance.systemId)
      const byOf = (access: ToolAccess): Proposer => (access.role === 'coordinator' ? 'coordinator' : 'lead')

      /**
       * Where a lead's issues are, each the lead's own to change or not, and
       * each it named that no tracker has, said: by their keys or links, runs
       * of keys read as their keys. At most a batch.
       */
      const leadScopes = (access: ToolAccess, named: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          if (named.length > BATCH)
            return yield* new ToolRefused({ message: `That is ${named.length} issues: name at most ${BATCH} at once.` })
          const read = yield* Effect.forEach(named, (one) => Effect.result(leadScope(access, one)), { concurrency: 4 })
          return {
            // Each as it was named, or undefined where no tracker has it.
            scopes: read.map((one) => (one._tag === 'Success' ? one.success : undefined)),
            unknown: read.flatMap((one) => (one._tag === 'Failure' ? [one.failure.message] : [])),
          }
        })

      /**
       * The issues named, by where they are, with a line for each no tracker
       * has: a lead's, as the coordinator's, any of the project's.
       */
      const mayChange = (access: ToolAccess, named: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          if (access.role === 'coordinator')
            return { allowed: named.map((one, index) => ({ index, target: { issue: one } as Target })), said: [] }
          const { scopes, unknown } = yield* leadScopes(access, named)
          return {
            allowed: scopes.flatMap((one, index) => (one === undefined ? [] : [{ index, target: one.target }])),
            said: unknown,
          }
        })

      /** What a lead's comments came to, on one card: each said posted or not, and a card waiting on the person said as such. */
      const commentedWords = (made: { readonly card: IssueChangesCard | null; readonly left: ReadonlyArray<string> }) => {
        const card = made.card
        if (card !== null && !card.direct)
          return [
            `The comment on ${card.issues.map((issue) => issue.key).join(', ')} waits on its card in this thread until the person posts it, or discards it. You'll hear what they decide.`,
            ...made.left,
          ]
        const posted = card?.issues.filter((issue) => issue.applied === true).map((issue) => issue.key) ?? []
        return [
          ...(posted.length === 0 ? [] : [`Commented on ${posted.join(', ')}. The thread shows it as a line.`]),
          ...(card?.issues ?? []).flatMap((issue) =>
            issue.applied === true ? [] : [`${issue.key}: not posted: ${issue.error ?? card?.error ?? ''}`],
          ),
          ...made.left,
        ]
      }

      const commentTool = (access: ToolAccess, value: unknown) =>
        Effect.gen(function* () {
          const asked = yield* readInput(CommentAsked, value)
          const several = asked.issues !== undefined && asked.issues.length > 0
          if (access.role === 'coordinator' && !several && asked.issue === undefined)
            return yield* new ToolRefused({ message: 'Say which issue, by its key or link, as issue.' })
          // The coordinator's, or the lead's task's own: posted at once, as before.
          if (!several && (access.role === 'coordinator' || asked.issue === undefined || asked.issue.trim() === '')) {
            const target = access.role === 'coordinator' ? { issue: asked.issue ?? '' } : yield* leadTarget(access)
            const card = yield* comment({
              projectId: access.projectId as ProjectId,
              threadId: access.threadId,
              target,
              body: asked.body,
              by: byOf(access),
              actorId: actorOf(access),
            })
            const [issue] = card.issues
            return card.state === 'applied'
              ? `Commented on ${issue?.key ?? 'it'}. The thread shows it as a line.`
              : `The comment on ${issue?.key ?? 'it'} wasn't posted: ${issue?.error ?? card.error ?? ''}`
          }
          // The same comment on each, at once.
          const names = keysIn([...(asked.issue === undefined ? [] : [asked.issue]), ...(asked.issues ?? [])])
          // One named alone that no tracker has is refused, as before.
          if (names.length === 1 && access.role !== 'coordinator') yield* leadScope(access, names[0] ?? '')
          const { allowed, said } = yield* mayChange(access, names)
          const commented =
            allowed.length === 0
              ? []
              : commentedWords(
                  yield* commentOnEach({
                    projectId: access.projectId as ProjectId,
                    threadId: access.threadId,
                    targets: allowed.map((one) => one.target),
                    body: asked.body,
                    direct: true,
                    by: byOf(access),
                    actorId: actorOf(access),
                  }),
                )
          return [...commented, ...said].join('\n')
        })

      const changeTool = (access: ToolAccess, value: unknown) =>
        Effect.gen(function* () {
          const { issue, issues: several, changes: each, at_once: atOnce, ...asked } = yield* readInput(LeadChange, value)
          const named = keysIn([...(issue === undefined ? [] : [issue]), ...(several ?? [])])
          const wanted = yield* wantedOf(asked)
          // None named: its task's own, as before.
          if (named.length === 0 && (each ?? []).length === 0)
            return proposedWords(
              yield* propose({
                projectId: access.projectId as ProjectId,
                threadId: access.threadId,
                issues: [{ target: yield* leadTarget(access), change: wanted }],
                direct: atOnce === true,
                by: 'lead',
                actorId: instance.systemId,
              }),
            )
          // The same change to each named, or each its own, on one card, as its agent says (at_once).
          const asks = [
            ...named.map((one) => ({ issue: one, change: wanted })),
            ...(yield* Effect.forEach(each ?? [], ({ issue: one, ...rest }) =>
              Effect.map(wantedOf(rest), (change) => ({ issue: one, change })),
            )),
          ]
          // One named alone that no tracker has is refused, as before.
          if (asks.length === 1) yield* leadScope(access, asks[0]?.issue ?? '')
          const { allowed, said } = yield* mayChange(
            access,
            asks.map((one) => one.issue),
          )
          const proposed =
            allowed.length === 0
              ? []
              : [
                  proposedWords(
                    yield* propose({
                      projectId: access.projectId as ProjectId,
                      threadId: access.threadId,
                      issues: allowed.map((one) => ({ target: one.target, change: asks[one.index]?.change ?? wanted })),
                      direct: atOnce === true,
                      by: 'lead',
                      actorId: instance.systemId,
                    }),
                  ),
                ]
          return [...proposed, ...said].join('\n')
        })

      const changesTool = (access: ToolAccess, value: unknown) =>
        Effect.gen(function* () {
          const asked = yield* readInput(ChangesAsked, value)
          return proposedWords(
            yield* propose({
              projectId: access.projectId as ProjectId,
              threadId: access.threadId,
              issues: yield* Effect.forEach(asked.changes, ({ issue, ...rest }) =>
                Effect.map(wantedOf(rest), (wanted) => ({ target: { issue }, change: wanted })),
              ),
              ...(asked.note === undefined ? {} : { note: asked.note }),
              direct: asked.at_once === true,
              by: 'coordinator',
              actorId: instance.coordinatorId,
            }),
          )
        })

      /** Links the task's pull requests to its issue: each at once, with the receipt Althar's own link of it as it opened has. */
      const linkTool = (access: ToolAccess) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const own = yield* ownIssue(access)
          const pulls = yield* sql<{ url: string; key: string; snapshot: string }>`
            SELECT url, key, snapshot FROM external_links WHERE task_id = ${access.taskId ?? ''} AND kind = 'change' ORDER BY created_at`
          if (pulls.length === 0)
            return yield* new ToolRefused({
              message: `This task has no pull request yet. Althar links it to ${own.key} itself as it opens it.`,
            })
          const said: Array<string> = []
          for (const pull of pulls) {
            const title = (JSON.parse(pull.snapshot) as { readonly title?: string }).title ?? pull.key
            const card = yield* link({
              projectId: access.projectId as ProjectId,
              threadId: access.threadId,
              target: own.target,
              link: { url: pull.url, title: `${pull.key}: ${title}` },
              receipt: `link_issue:${own.linkId}:${pull.url}`,
              by: 'lead',
              actorId: instance.systemId,
            })
            said.push(
              card.state === 'applied'
                ? `Linked ${pull.key} to ${own.key}.`
                : `Couldn't link ${pull.key} to ${own.key}: ${card.issues[0]?.error ?? card.error ?? ''}`,
            )
          }
          return said.join(' ')
        })

      const toolServer = yield* ToolServer
      yield* toolServer.serve('lead', [
        tool(
          'comment_on_issue',
          `Comments on an issue at once, in Markdown: what the person would want on it, such as what you found or what changed. The thread shows it as a line. The issue this task came from unless you name another, by key or link: any of the project's trackers'. The same comment on several as issues (keys, links, runs of keys), at most ${BATCH}, each said posted or not.`,
          {
            type: 'object',
            properties: {
              body: { type: 'string', description: 'Markdown.' },
              issue: { type: 'string', description: 'Its key or link, where it isn’t this task’s own issue.' },
              issues: { type: 'array', items: { type: 'string' }, description: `Several, by key, link or run of keys: at most ${BATCH}.` },
            },
            required: ['body'],
          },
          commentTool,
        ),
        tool(
          'link_pull_request',
          'Links this task’s pull request to the issue it came from, at once, where its tracker takes links (Linear, Jira, Trello); GitHub and GitLab link a pull request that names the issue already. Althar links it itself as it opens it: for one opened another way, or one that wasn’t linked.',
          { type: 'object', properties: {} },
          (access) => linkTool(access),
        ),
        tool(
          'change_issue',
          `Changes an issue: its status (any of its tracker’s, such as In Review), closing it, its priority, assignees, labels, project, milestone, cycle, parent, estimate, type, components, due date, title or description. As a card the person applies in this thread, unless at_once: where the project’s notes say issues are changed at once, or the person just said to. You hear what they decide. The issue this task came from unless you name another, any of the project's trackers'. Several at once: the same change to each of issues (keys, links, runs of keys such as DEV-180..DEV-195, as find_issues finds them), or a change of its own to each in changes; at most ${BATCH}. Althar reads each name against its tracker, changes what it can, paces a big batch to the tracker’s limits, and says for each issue what changed, what didn’t and why.\n\n${changeTable()}`,
          {
            type: 'object',
            properties: {
              issue: { type: 'string', description: 'Its key or link, where it isn’t this task’s own issue.' },
              issues: {
                type: 'array',
                items: { type: 'string' },
                description: `Several to change alike, by key, link or run of keys: at most ${BATCH}.`,
              },
              ...changeFields,
              changes: {
                type: 'array',
                description: 'Several, each changed its own way.',
                items: {
                  type: 'object',
                  properties: { issue: { type: 'string', description: 'Its key or link.' }, ...changeFields },
                  required: ['issue'],
                },
              },
              at_once: atOnceField,
            },
          },
          changeTool,
        ),
      ])
      // Leads and the coordinator alike (ADR-097).
      yield* toolServer.serve(POOL, [
        tool(
          'change_issues',
          `Changes issues on the person’s trackers, by key or link, several on one card: “move DEV-67 to Done, set DEV-142 to Low”. Each can change its status (any of its tracker’s), close it, or set its priority, assignees, labels, project, milestone, cycle, parent, estimate, type, components, due date, title or description. As a card the person applies in your thread, unless at_once: where the project’s notes say issues are changed at once, or the person just said to. You hear what they decide. Althar reads each name against its tracker, changes what it can, paces a big batch to the tracker’s limits, and says what it couldn’t and why: a name it hasn’t, with what it has, or a field that tracker hasn’t.\n\n${changeTable()}`,
          {
            type: 'object',
            properties: {
              changes: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { issue: { type: 'string', description: 'Its key or link: DEV-67, #12, a URL.' }, ...changeFields },
                  required: ['issue'],
                },
              },
              note: { type: 'string', description: 'Why, in a sentence, where it helps the person decide.' },
              at_once: atOnceField,
            },
            required: ['changes'],
          },
          changesTool,
        ),
        tool(
          'comment_on_issue',
          'Comments on an issue on the person’s trackers, at once, in Markdown, by its key or link. The thread shows it as a line. Only when the person asks for a comment, or agrees to one.',
          {
            type: 'object',
            properties: { issue: { type: 'string', description: 'Its key or link.' }, body: { type: 'string', description: 'Markdown.' } },
            required: ['issue', 'body'],
          },
          commentTool,
        ),
      ])

      return IssueChanges.of({ propose, comment, commentOnEach, link, apply, discard, followPullRequest })
    }),
  )
}
