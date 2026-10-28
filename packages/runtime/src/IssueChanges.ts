import {
  type Choice,
  type ChosenField,
  ConnectorFailed,
  fieldsOf,
  type Issue,
  type IssueChange,
  type IssueField,
  type Priority,
  type Product,
  products,
  type Tracker,
  unstarted,
} from '@althar/connectors'
import type { IssueChangesCard } from '@althar/contracts'
import { type ActorId, Ids, type IssueChangeState, newId, type ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { Context, type Crypto, Effect, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from './Connections'
import { envelope } from './envelope'
import { NotFound, OutwardUncertain } from './errors'
import { Instance } from './Instance'
import { changeWords, lineWords, linesOf } from './issueChangeWords'
import { Issues } from './Issues'
import { outward } from './outward'
import { changesIssues, movesIssues, Policies } from './Policies'
import { change, fact, timestamp } from './records'
import { Sessions } from './Sessions'
import { addItem, updateItem } from './threads'
import { type Tool, type ToolAccess, ToolRefused, ToolServer } from './ToolServer'

/*
 * Changes to issues on the person's trackers (docs/architecture/06,
 * "Changing issues"): the coordinator's, on any issue; a task's lead's, on
 * the issue its task came from; and Althar's own, as a task's pull request
 * opens (In Review) or merges (Done). One card holds a change to each of one
 * or more issues: "Move DEV-67 to Done, set DEV-142 to Low".
 *
 * What changes where the issue stands (its status, priority, assignee,
 * labels, project, title, closing it) waits on the person, who applies the
 * card with one press or discards it, unless the project's rules let changes
 * through (`changeIssues`), when it is applied at once and its card is a
 * line saying so. That default is this one place: `waitsOnThePerson`. A
 * comment and a link to a pull request apply at once, either way, and their
 * card is a line too.
 *
 * Names are read against the tracker as the change is proposed, so a card
 * never asks the person to apply what the tracker can't take: a status its
 * team hasn't, someone it can't be assigned to. A change already so is left
 * off, and one with nothing left to change isn't made. Applying calls each
 * tracker outside any transaction, each issue's change as an outward action
 * with its receipt; a change made twice changes nothing more, so one whose
 * answer was lost, or that Althar closed in the middle of, can be applied
 * again. A comment can't: one whose answer was lost says to look first.
 */

/** What an agent asks to change of an issue, in the tracker's names for things: each left out stays as it is. */
export interface Wanted {
  readonly status?: string
  readonly close?: boolean
  readonly priority?: Priority
  /** Someone by name, login or email, or `me` for the person; null for nobody. */
  readonly assignee?: string | null
  readonly labels?: { readonly add?: ReadonlyArray<string>; readonly remove?: ReadonlyArray<string> }
  /** A project or milestone by name; null for none. */
  readonly project?: string | null
  readonly title?: string
}

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
  readonly comment?: string
  readonly link?: { readonly url: string; readonly title: string }
  /** The receipt's key, where it is shared with another action: a pull request's link, which Althar may have made as it opened. */
  readonly receipt?: string
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

/**
 * Whether changes to issues wait on the person's card, by the project's
 * rules: they do, unless the person let them through. A comment or a link
 * never waits. Moving status is an open question (docs/open-questions.md);
 * this is where its answer goes.
 */
export const waitsOnThePerson = (rules: Parameters<typeof changesIssues>[0]): boolean => !changesIssues(rules)

/** How many choices are said to an agent at most. */
const CHOICES = 25

/** What a field is called, said to an agent. */
const FIELD_WORDS: Readonly<Record<IssueField, string>> = {
  status: 'status',
  close: 'closing it',
  priority: 'priority',
  assignee: 'assignee',
  labels: 'labels',
  project: 'project or milestone',
  title: 'title',
}

/** Why a tracker can't change a field, said to an agent: what each product's issues lack, as its adapter says. */
export const gapOf = (product: Product, field: IssueField): string => {
  const name = products[product].name
  if (field === 'priority') return `${name}'s issues have no priority`
  if (field === 'project')
    return product === 'trello'
      ? 'a Trello card’s project is its board'
      : product === 'jira_cloud' || product === 'jira_dc'
        ? 'Jira moves an issue to another project only by its own Move'
        : `${name} has no project for an issue`
  return `Althar can’t change that on ${name} yet`
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** A choice by what was typed for it: its id, its name or another word it answers to, in any case; or the one name it begins. */
const choiceNamed = (choices: ReadonlyArray<Choice>, typed: string): Choice | undefined =>
  choices.find((choice) => same(choice.id, typed) || same(choice.name, typed) || (choice.also ?? []).some((word) => same(word, typed))) ??
  (() => {
    const starting = choices.filter((choice) => choice.name.toLowerCase().startsWith(typed.trim().toLowerCase()))
    return starting.length === 1 ? starting[0] : undefined
  })()

const listed = (names: ReadonlyArray<string>) =>
  names.length === 0
    ? 'none'
    : names.length > CHOICES
      ? `${names.slice(0, CHOICES).join(', ')} and ${names.length - CHOICES} more`
      : names.join(', ')

/** Words that mean the person, for an assignee. */
const ME = /^(me|myself|the person|the user|you)$/i

const decodeEntries = (changes: string) => JSON.parse(changes) as ReadonlyArray<Entry>

/** A card, from its row. */
export const cardOf = (row: Row): IssueChangesCard => ({
  changesId: row.id,
  note: row.note,
  state: row.state,
  error: row.error,
  direct: row.direct === 1,
  issues: decodeEntries(row.changes).map((entry) => ({
    product: entry.product,
    tracker: entry.tracker,
    key: entry.key,
    url: entry.url,
    title: entry.title,
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

/** An issue's change as a tool takes it: by the tracker's names, labels added and taken off in lists of their own. */
const AskedChange = Schema.Struct({
  status: Schema.optional(Schema.String),
  close: Schema.optional(Schema.Boolean),
  priority: Schema.optional(Schema.String),
  assignee: Schema.optional(Schema.NullOr(Schema.String)),
  add_labels: Schema.optional(Schema.Array(Schema.String)),
  remove_labels: Schema.optional(Schema.Array(Schema.String)),
  project: Schema.optional(Schema.NullOr(Schema.String)),
  title: Schema.optional(Schema.String),
})

const ChangesAsked = Schema.Struct({
  changes: Schema.Array(Schema.Struct({ issue: Schema.String, ...AskedChange.fields })),
  note: Schema.optional(Schema.String),
})

const CommentAsked = Schema.Struct({ issue: Schema.optional(Schema.String), body: Schema.String })

const PRIORITIES: ReadonlyArray<Priority> = ['urgent', 'high', 'medium', 'low', 'none']

/** A priority as an agent may say it: Low, low, "no priority", none. */
const priorityOf = (said: string): Priority | undefined => {
  const word = said
    .trim()
    .toLowerCase()
    .replace(/\s+priority$/, '')
  return word === 'no' || word === 'no priority' ? 'none' : PRIORITIES.find((level) => level === word)
}

/** What a tool was asked, as a change. */
const wantedOf = (asked: typeof AskedChange.Type): Effect.Effect<Wanted, ToolRefused> => {
  const priority = asked.priority === undefined ? undefined : priorityOf(asked.priority)
  if (asked.priority !== undefined && priority === undefined)
    return Effect.fail(new ToolRefused({ message: `A priority is one of urgent, high, medium, low or none, not “${asked.priority}”.` }))
  return Effect.succeed({
    ...(asked.status === undefined ? {} : { status: asked.status }),
    ...(asked.close === true ? { close: true } : {}),
    ...(priority === undefined ? {} : { priority }),
    ...(asked.assignee === undefined ? {} : { assignee: asked.assignee }),
    ...(asked.add_labels === undefined && asked.remove_labels === undefined
      ? {}
      : { labels: { add: asked.add_labels ?? [], remove: asked.remove_labels ?? [] } }),
    ...(asked.project === undefined ? {} : { project: asked.project }),
    ...(asked.title === undefined ? {} : { title: asked.title }),
  })
}

const readInput = <A>(schema: Schema.Codec<A, unknown>, input: unknown) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.mapError((error) => new ToolRefused({ message: `Althar couldn't read that: ${error.message}` })),
  )

/** What a card's agent hears once it is made: waiting on the person, or applied at once, and how. */
export const proposedWords = (card: IssueChangesCard): string => {
  const said = card.issues.map((issue) => `${issue.key}: ${issue.changes.map(lineWords).join(', ')}`).join('; ')
  if (!card.direct)
    return `Proposed ${said}. Nothing changes until the person applies it from its card in this thread, or discards it; they see it there, so there's no need to repeat it. You'll hear what they decide.`
  if (card.state === 'applied') return `Done: ${said}. The thread shows it as a line.`
  return `Tried ${said}, and not all of it applied: ${card.issues.flatMap((issue) => (issue.error === null ? [] : [`${issue.key}: ${issue.error}`])).join(' ')} The person can apply it again from its card.`
}

/** The fields an issue's change takes, as JSON Schema: the tracker's own names, which Althar reads against it. */
const changeFields = {
  status: {
    type: 'string',
    description: 'Any of its tracker’s statuses, by name: In Review, Done, Canceled; on GitHub or GitLab, Open or Closed.',
  },
  close: { type: 'boolean', description: 'Close it as done, by its tracker’s own way.' },
  priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low', 'none'] },
  assignee: {
    type: ['string', 'null'],
    description: 'Who it is assigned to, by name, login or email; me for the person; null for nobody.',
  },
  add_labels: { type: 'array', items: { type: 'string' }, description: 'Labels its tracker has, to add.' },
  remove_labels: { type: 'array', items: { type: 'string' }, description: 'Labels to take off.' },
  title: { type: 'string' },
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
     * are proposed in, or applies them at once where the project's rules let
     * changes through. Each name is read against its tracker first: one it
     * hasn't, a field it can't change, or nothing left to change, is
     * refused as `IssueChangeRefused`, before any card is made.
     */
    propose(input: {
      readonly projectId: ProjectId
      readonly threadId: string
      readonly issues: ReadonlyArray<{ readonly target: Target; readonly change: Wanted }>
      readonly note?: string
      readonly by: Proposer
      readonly actorId: ActorId
    }): Effect.Effect<IssueChangesCard, unknown>
    /** Comments on an issue at once, and says so in the thread, as a line. */
    comment(input: {
      readonly projectId: ProjectId
      readonly threadId: string
      readonly target: Target
      readonly body: string
      readonly by: Proposer
      readonly actorId: ActorId
    }): Effect.Effect<IssueChangesCard, unknown>
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
    followPullRequest(taskId: string, event: 'opened' | 'merged', pullRequest: { readonly key: string }): Effect.Effect<void>
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

      /** The choices for a field, or why the tracker can't give them, said to the agent. */
      const choicesOf = (tracker: Tracker, issue: Issue, field: ChosenField, name: string, wanted?: string) =>
        tracker
          .choices(issue, field, wanted)
          .pipe(
            Effect.mapError((error) =>
              refused(`Althar couldn’t ask ${name} what ${issue.key}’s ${FIELD_WORDS[field]} can be: ${error.message}`),
            ),
          )

      /** A name read against the tracker's choices, or a refusal that says what it has. */
      const pick = (choices: ReadonlyArray<Choice>, typed: string, what: string, where: string) => {
        const chosen = choiceNamed(choices, typed)
        return chosen === undefined
          ? Effect.fail(
              refused(`${where} has no ${what} called “${typed.trim()}”. It has: ${listed(choices.map((choice) => choice.name))}.`),
            )
          : Effect.succeed(chosen)
      }

      /**
       * What an agent asked, read against the tracker: each name to the
       * tracker's own, what is so already left off. Refused where a field
       * can't change there, a name isn't the tracker's, or nothing is left.
       */
      const resolve = (
        at: { readonly tracker: Tracker; readonly issue: Issue; readonly product: Product; readonly name: string },
        wanted: Wanted,
      ) =>
        Effect.gen(function* () {
          const { tracker, issue, product, name } = at
          const where = `${issue.key} on ${name}`
          const asked: ReadonlyArray<IssueField> = [
            ...(wanted.status === undefined ? [] : ['status' as const]),
            ...(wanted.close === true ? ['close' as const] : []),
            ...(wanted.priority === undefined ? [] : ['priority' as const]),
            ...(wanted.assignee === undefined ? [] : ['assignee' as const]),
            ...(wanted.labels === undefined || ((wanted.labels.add ?? []).length === 0 && (wanted.labels.remove ?? []).length === 0)
              ? []
              : ['labels' as const]),
            ...(wanted.project === undefined ? [] : ['project' as const]),
            ...(wanted.title === undefined ? [] : ['title' as const]),
          ]
          if (asked.length === 0) return yield* refused(`Say what to change on ${issue.key}.`)
          const cant = asked.find((field) => !tracker.capabilities.changes.includes(field))
          if (cant !== undefined) return yield* refused(`Althar can’t change ${FIELD_WORDS[cant]} on ${name}: ${gapOf(product, cant)}.`)

          const ended = issue.status.category === 'done' || issue.status.category === 'cancelled'
          const status =
            wanted.status === undefined
              ? undefined
              : yield* pick(yield* choicesOf(tracker, issue, 'status', name), wanted.status, 'status', where)
          const assignee =
            wanted.assignee === undefined
              ? undefined
              : wanted.assignee === null
                ? null
                : yield* Effect.gen(function* () {
                    const typed = wanted.assignee ?? ''
                    if (!ME.test(typed.trim()))
                      return yield* pick(yield* choicesOf(tracker, issue, 'assignee', name, typed), typed, 'one to assign', where)
                    // The person, as the connection signs in.
                    const account = yield* tracker.account.pipe(Effect.mapError((error) => refused(error.message)))
                    const choices = yield* choicesOf(tracker, issue, 'assignee', name, account.login)
                    const mine = choices.find(
                      (choice) =>
                        choice.id === account.id ||
                        same(choice.name, account.login) ||
                        (choice.also ?? []).some((word) => same(word, account.login)),
                    )
                    return mine ?? (yield* refused(`${where} can’t be assigned to the account Althar signs in as, ${account.login}.`))
                  })
          const labels =
            wanted.labels === undefined
              ? undefined
              : yield* Effect.gen(function* () {
                  const all = yield* choicesOf(tracker, issue, 'labels', name)
                  // A tracker that makes any label it is given offers the one asked for when asked for it.
                  const label = (typed: string) =>
                    choiceNamed(all, typed) !== undefined
                      ? pick(all, typed, 'label', where)
                      : Effect.flatMap(choicesOf(tracker, issue, 'labels', name, typed), (more) =>
                          pick(more.length === 0 ? all : more, typed, 'label', where),
                        )
                  const has = (choice: Choice) => issue.labels.some((label) => same(label, choice.name))
                  const add = (yield* Effect.forEach(wanted.labels?.add ?? [], label)).filter((choice) => !has(choice))
                  // One it hasn't is nothing to take off.
                  const remove = (yield* Effect.forEach(
                    (wanted.labels?.remove ?? []).filter((typed) => issue.labels.some((label) => same(label, typed))),
                    label,
                  )).filter(has)
                  return add.length === 0 && remove.length === 0 ? undefined : { add, remove }
                })
          const project =
            wanted.project === undefined
              ? undefined
              : wanted.project === null
                ? null
                : yield* pick(yield* choicesOf(tracker, issue, 'project', name), wanted.project, 'project or milestone', where)
          const title = wanted.title?.trim()
          if (title === '') return yield* refused(`Give ${issue.key} a title, not an empty one.`)

          // What is so already is left off.
          const result: IssueChange = {
            ...(status === undefined || same(status.name, issue.status.name) ? {} : { status }),
            ...(wanted.close === true && !ended && status === undefined ? { close: true as const } : {}),
            ...(wanted.priority === undefined || (issue.priority?.level ?? 'none') === wanted.priority
              ? {}
              : { priority: wanted.priority }),
            ...(assignee === undefined ||
            (assignee === null
              ? issue.assignees.length === 0
              : issue.assignees.length === 1 &&
                issue.assignees.some((person) => person.id === assignee.id || same(person.login, assignee.name)))
              ? {}
              : { assignee }),
            ...(labels === undefined ? {} : { labels }),
            ...(project === undefined ? {} : { project }),
            ...(title === undefined || title === issue.title ? {} : { title }),
          }
          if (fieldsOf(result).length === 0)
            return yield* refused(
              `${issue.key} is already as asked: ${issue.status.name}${issue.priority === null ? '' : `, ${issue.priority.name} priority`}${issue.assignees.length === 0 ? ', unassigned' : `, assigned to ${issue.assignees.map((person) => person.name ?? person.login).join(', ')}`}.`,
            )
          return result
        })

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
            // Each issue on its own: what applied stays applied, and what didn't says why.
            const after = yield* Effect.forEach(before, (entry, index) =>
              entry.applied === true
                ? Effect.succeed(entry)
                : Effect.map(Effect.result(applyEntry(row, entry, index)), (made): Entry => {
                    if (made._tag === 'Success') return { ...entry, applied: true, error: null }
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
        change: {},
        applied: null,
        error: null,
        ...more,
      })

      const propose: IssueChanges['Service']['propose'] = (input) =>
        provide(
          Effect.gen(function* () {
            if (input.issues.length === 0) return yield* refused('Name at least one issue to change.')
            const entries = yield* Effect.forEach(input.issues, ({ target, change: wanted }) =>
              Effect.gen(function* () {
                const at = yield* found(input.projectId, target)
                return entryOf(at, { change: yield* resolve(at, wanted) })
              }),
            )
            const keys = entries.map((entry) => `${entry.connectionId}:${entry.ref}`)
            if (new Set(keys).size !== keys.length) return yield* refused('Name each issue once, with everything that changes on it.')
            const direct = !waitsOnThePerson((yield* policies.current(input.projectId)).rules)
            return yield* proposeEntries({
              projectId: input.projectId,
              threadId: input.threadId,
              entries,
              ...(input.note === undefined ? {} : { note: input.note }),
              by: input.by,
              actorId: input.actorId,
              direct,
            })
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

      const followPullRequest: IssueChanges['Service']['followPullRequest'] = (taskId, event, pullRequest) =>
        provide(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const [own] = yield* sql<{ projectId: ProjectId; connectionId: string | null; ref: string; threadId: string | null }>`
              SELECT x.project_id, x.connection_id, x.ref, (SELECT id FROM threads WHERE task_id = x.task_id AND kind = 'task') AS thread_id
              FROM external_links x WHERE x.task_id = ${taskId} AND x.kind = 'issue' ORDER BY x.created_at LIMIT 1`
            if (own === undefined || own.connectionId === null || own.threadId === null) return
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
                    if (review === undefined || same(review.name, issue.status.name)) return undefined
                    // Not back from further along, as a status after In Review would be; only from where work is under way, or hasn't started.
                    return unstarted(issue.status.category) || issue.status.category === 'started' ? { status: review.name } : undefined
                  })
            if (wanted === undefined) return
            // A merged task settles as done, so its card goes where the person reads about the project: the coordinator's thread.
            const [coordinator] =
              event === 'merged'
                ? yield* sql<{ id: string }>`SELECT id FROM threads WHERE project_id = ${own.projectId} AND kind = 'coordinator' LIMIT 1`
                : []
            const [task] = yield* sql<{ slug: string }>`SELECT slug FROM tasks WHERE id = ${taskId}`
            const card = yield* propose({
              projectId: own.projectId,
              threadId: coordinator?.id ?? own.threadId,
              issues: [{ target: { connectionId: own.connectionId, ref: own.ref }, change: wanted }],
              note:
                event === 'merged'
                  ? `${coordinator === undefined ? '' : `${task?.slug ?? 'Its task'}: `}${pullRequest.key} merged.`
                  : `${pullRequest.key} opened.`,
              by: 'althar',
              actorId: instance.systemId,
            })
            yield* Effect.logDebug('Offered to move a task’s issue with its pull request', card.changesId)
          }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not offer to move a task’s issue with its pull request', cause))),
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
                'This task didn’t come from an issue, so it has none of its own to change. For another issue, tell the person what it needs: the coordinator changes it for them.',
            })
          if (own.connectionId === null)
            return yield* new ToolRefused({ message: `The tracker ${own.key} is on isn’t connected to Althar any more.` })
          return { linkId: own.id, key: own.key, target: { connectionId: own.connectionId, ref: own.ref } }
        })

      const actorOf = (access: ToolAccess) => (access.role === 'coordinator' ? instance.coordinatorId : instance.systemId)
      const byOf = (access: ToolAccess): Proposer => (access.role === 'coordinator' ? 'coordinator' : 'lead')

      const commentTool = (access: ToolAccess, value: unknown) =>
        Effect.gen(function* () {
          const asked = yield* readInput(CommentAsked, value)
          const target =
            access.role === 'coordinator'
              ? asked.issue === undefined
                ? yield* new ToolRefused({ message: 'Say which issue, by its key or link, as issue.' })
                : { issue: asked.issue }
              : (yield* ownIssue(access)).target
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
        })

      const changeTool = (access: ToolAccess, value: unknown) =>
        Effect.gen(function* () {
          const own = yield* ownIssue(access)
          const wanted = yield* wantedOf(yield* readInput(AskedChange, value))
          const card = yield* propose({
            projectId: access.projectId as ProjectId,
            threadId: access.threadId,
            issues: [{ target: own.target, change: wanted }],
            by: 'lead',
            actorId: instance.systemId,
          })
          return proposedWords(card)
        })

      const changesTool = (access: ToolAccess, value: unknown) =>
        Effect.gen(function* () {
          const asked = yield* readInput(ChangesAsked, value)
          const card = yield* propose({
            projectId: access.projectId as ProjectId,
            threadId: access.threadId,
            issues: yield* Effect.forEach(asked.changes, ({ issue, ...rest }) =>
              Effect.map(wantedOf(rest), (wanted) => ({ target: { issue }, change: wanted })),
            ),
            ...(asked.note === undefined ? {} : { note: asked.note }),
            by: 'coordinator',
            actorId: instance.coordinatorId,
          })
          return proposedWords(card)
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
          'Comments on the issue this task came from, at once, in Markdown: what the person would want on it, such as what you found or what changed. The thread shows it as a line. Only this task’s own issue.',
          { type: 'object', properties: { body: { type: 'string', description: 'Markdown.' } }, required: ['body'] },
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
          'Proposes a change to the issue this task came from: its status (any of its tracker’s, such as In Review), closing it, its priority, assignee, labels or title. It changes nothing until the person applies it from a card in this thread, unless the project lets changes through; you hear what they decide. Only this task’s own issue: Althar says what its tracker has where a name isn’t one of them.',
          { type: 'object', properties: changeFields },
          changeTool,
        ),
      ])
      yield* toolServer.serve('coordinator', [
        tool(
          'change_issues',
          'Proposes changes to issues on the person’s trackers, by key or link, several on one card: “move DEV-67 to Done, set DEV-142 to Low”. Each can change its status (any of its tracker’s), close it, or set its priority, assignee, labels, project or milestone, or title. Nothing changes until the person applies the card in your thread, unless the project lets changes through; you hear what they decide. Althar reads each name against its tracker, and says what it has where a name isn’t one of them, or what that tracker can’t change.',
          {
            type: 'object',
            properties: {
              changes: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    issue: { type: 'string', description: 'Its key or link: DEV-67, #12, a URL.' },
                    ...changeFields,
                    project: {
                      type: ['string', 'null'],
                      description: 'Its project (Linear) or milestone (GitHub, GitLab), by name; null for none.',
                    },
                  },
                  required: ['issue'],
                },
              },
              note: { type: 'string', description: 'Why, in a sentence, where it helps the person decide.' },
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

      return IssueChanges.of({ propose, comment, link, apply, discard, followPullRequest })
    }),
  )
}
