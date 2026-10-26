import { type Container, ConnectorFailed, type Issue, type Priority, type Product, products, type Tracker } from '@althar/connectors'
import { type ActorId, Ids, type IssueDraftState, newId, type ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { Context, type Crypto, Effect, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from './Connections'
import { envelope } from './envelope'
import { NotFound } from './errors'
import { Instance } from './Instance'
import { projectRepository } from './Issues'
import { projectTracker } from './projectTracker'
import { change, fact, timestamp } from './records'
import { Sessions } from './Sessions'
import { addItem, updateItem } from './threads'
import { ToolRefused } from './ToolServer'

/*
 * Issues the coordinator, or a task's lead, drafts on the person's connected
 * trackers (docs/architecture/06, "Drafting issues"). A draft is a card in
 * the thread of whoever drafted it: the tracker, where it goes there, its
 * title, body and labels. Nothing reaches the tracker until the person files
 * it from the card, which they may change first; or they discard it. There is
 * no countdown: leaving a draft alone files nothing. A draft that couldn't be
 * filed says why, and can be filed again. A lead is told what became of its
 * draft once the person files or discards it; the coordinator hears it as
 * news before its next turn (coordinatorNews.ts).
 *
 * The draft's row is what it is; its card's item carries the same, written
 * in the same transaction as each change, so a thread reads it as it reads
 * any item. Filing calls the tracker outside any transaction: the draft is
 * marked as being filed first, so a second press files nothing more. Where
 * the tracker may have taken it without Althar hearing so (its answer lost
 * or unreadable, or Althar closed in the middle), the draft is uncertain,
 * not unfiled: the card says to look on the tracker before filing it again,
 * and it is never filed again unasked.
 */

/** What the card shows of a draft: the item's content, and what the coordinator hears. */
export interface DraftCard {
  readonly draftId: string
  readonly product: Product
  /** The tracker, by its product's name: Linear, Jira, GitHub. */
  readonly tracker: string
  /** Where it goes there, by the tracker's name for it. */
  readonly container: string
  readonly title: string
  readonly body: string
  readonly labels: ReadonlyArray<string>
  /** Its priority, where the tracker has priorities; null for the tracker's default. */
  readonly priority: Priority | null
  readonly state: IssueDraftState
  /** Why it wasn't filed, in the tracker's words, while it stands failed. */
  readonly error: string | null
  /** The issue once filed: its key, as the tracker shows it, and its link. */
  readonly issue: { readonly key: string; readonly url: string } | null
}

/**
 * Where a draft should go isn't clear from what was asked: no tracker is
 * connected, several are and none was named (or one was named that isn't),
 * or the tracker has several places for issues and none was named (or one
 * was that it hasn't). `choices` are what can be named instead.
 */
export class IssueTargetNeeded extends Schema.TaggedError<IssueTargetNeeded>()('IssueTargetNeeded', {
  reason: Schema.Literals([
    'no_tracker',
    'tracker_needed',
    'unknown_tracker',
    'container_needed',
    'unknown_container',
    'tracker_gone',
    'tracker_signed_out',
  ]),
  /** What was named and not found. */
  named: Schema.NullOr(Schema.String),
  /** The tracker the draft would go to, for a container to name. */
  tracker: Schema.NullOr(Schema.String),
  choices: Schema.Array(Schema.String),
}) {}

/** A draft that can't take that turn now: it is filed, discarded, or being filed. */
export class DraftClosed extends Schema.TaggedError<DraftClosed>()('DraftClosed', {
  draftId: Schema.String,
  state: Schema.String,
}) {}

/** A title the draft can't be filed with: none at all. */
export class DraftUntitled extends Schema.TaggedError<DraftUntitled>()('DraftUntitled', { draftId: Schema.NullOr(Schema.String) }) {}

/** How long a list of choices may be, said to the coordinator. */
const CHOICES = 20

/**
 * Whether a lead's draft waits for the person to file it from its card. For
 * now every lead's does; where the person lets leads file on their own, this is
 * the one place that changes (`draft_issue` in Coordinator.ts files the draft
 * itself when it is false).
 */
export const leadsNeedTheCard: boolean = true

/**
 * Why a draft can't be made, as the tool's refusal, in words its agent can act
 * on; an error that isn't one of those is passed on as it is.
 */
export const refusedDraft = (error: unknown): unknown => {
  if (error instanceof DraftUntitled) return new ToolRefused({ message: 'Give the issue a title.' })
  if (error instanceof ConnectorFailed)
    return new ToolRefused({ message: `Althar couldn't ask the tracker where issues go: ${error.message}` })
  if (!(error instanceof IssueTargetNeeded)) return error
  const choices = error.choices.join(', ')
  const where = error.tracker ?? 'that tracker'
  switch (error.reason) {
    case 'no_tracker':
      return new ToolRefused({
        message: 'The person has no tracker connected to Althar, so there is nowhere to draft an issue. They connect one in Settings.',
      })
    case 'tracker_needed':
      return new ToolRefused({ message: `Say which tracker it goes on, as tracker: ${choices}.` })
    case 'unknown_tracker':
      return new ToolRefused({ message: `No tracker called ${error.named ?? ''} is connected. Connected: ${choices}.` })
    case 'tracker_gone':
      return new ToolRefused({
        message: `This project's issues go to ${where}, which is no longer connected. The person connects it again in Settings, or binds the project to another in its settings; or name another tracker for this one${choices === '' ? '' : `, as tracker: ${choices}`}.`,
      })
    case 'tracker_signed_out':
      return new ToolRefused({
        message: `This project's issues go to ${where}, which needs signing in again. The person signs in to it again in Settings; or name another tracker for this one${choices === '' ? '' : `, as tracker: ${choices}`}.`,
      })
    case 'container_needed':
      return new ToolRefused({ message: `Say where on ${where} it goes, as container: ${choices}.` })
    case 'unknown_container':
      return new ToolRefused({
        message:
          error.tracker === null
            ? `No connected tracker has anywhere called ${error.named ?? ''} for issues. They have: ${choices}.`
            : error.choices.length === 0
              ? `This account can't file issues anywhere on ${where}.`
              : `${where} has nowhere called ${error.named ?? ''} for issues. It has: ${choices}.`,
      })
  }
}

interface Row {
  readonly id: string
  readonly projectId: ProjectId
  readonly threadId: string
  readonly connectionId: string
  readonly product: Product
  readonly trackerName: string
  readonly container: string
  readonly containerName: string
  readonly title: string
  readonly body: string
  readonly labels: string
  readonly priority: Priority | null
  readonly state: IssueDraftState
  readonly error: string | null
  readonly issueKey: string | null
  readonly issueUrl: string | null
}

const Labels = Schema.fromJsonString(Schema.Array(Schema.String))

/** A draft's card, from its row. */
export const cardOf = (row: Row): DraftCard => ({
  draftId: row.id,
  product: row.product,
  tracker: row.trackerName,
  container: row.containerName,
  title: row.title,
  body: row.body,
  labels: Schema.decodeUnknownSync(Labels)(row.labels),
  priority: row.priority,
  state: row.state,
  error: row.error,
  issue: row.issueKey === null || row.issueUrl === null ? null : { key: row.issueKey, url: row.issueUrl },
})

/** Labels as a person means them: trimmed, without blanks, each once. */
const labelsOf = (labels: ReadonlyArray<string>) => [...new Set(labels.map((label) => label.trim()).filter((label) => label !== ''))]

/** A container as it is named to the coordinator: its key, and its name where that says more. */
const containerWords = (container: Container) =>
  container.key === null || container.key === container.name ? container.name : `${container.key} (${container.name})`

const listed = (choices: ReadonlyArray<string>) =>
  choices.length > CHOICES ? [...choices.slice(0, CHOICES), `and ${choices.length - CHOICES} more`] : choices

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** A container by what was typed for it: its id, its key or its name, in any case. */
const containerNamed = (containers: ReadonlyArray<Container>, typed: string) =>
  containers.find((container) => same(container.id, typed)) ??
  containers.find((container) => container.key !== null && same(container.key, typed)) ??
  containers.find((container) => same(container.name, typed))

/** A connection's host, or a typed one's: acme.atlassian.net from its address, or as typed. */
const hostOf = (address: string) => {
  try {
    return new URL(/^[a-z]+:\/\//i.test(address) ? address : `https://${address}`).hostname.toLowerCase()
  } catch {
    return address.trim().toLowerCase()
  }
}

/** A connected tracker a draft can go to, by the name it is told apart by. */
interface Candidate {
  readonly connectionId: string
  readonly product: Product
  readonly tracker: Tracker
  /**
   * Its product's name, and its workspace, its site, or its site and account,
   * where another connection would share the name: Linear (FNT), Jira
   * (acme.atlassian.net).
   */
  readonly label: string
  readonly host: string
  readonly login: string
  /** The workspace its sign-in reaches, by its key and name, where it reaches one (ADR-059). */
  readonly workspace: { readonly key: string; readonly name: string } | null
}

/**
 * Whether a tracker is the one a person named: by its product (jira_cloud),
 * its service (jira), its name (Jira Data Center), the label it is told
 * apart by, its site's address or host, its account, or its connection.
 */
const trackerNamed = (candidate: Candidate, typed: string) =>
  same(candidate.product, typed) ||
  same(products[candidate.product].service, typed) ||
  same(products[candidate.product].name, typed) ||
  same(candidate.label, typed) ||
  same(candidate.connectionId, typed) ||
  same(candidate.login, typed) ||
  (candidate.workspace !== null && (same(candidate.workspace.key, typed) || same(candidate.workspace.name, typed))) ||
  hostOf(typed) === candidate.host

type Store = SqlClient.SqlClient | Instance | Ledger | Crypto.Crypto | Connections | Sessions

export class IssueDrafts extends Context.Service<
  IssueDrafts,
  {
    /**
     * Drafts an issue, files nothing, and posts its card in the thread it is
     * drafted in: the coordinator's, or a task's. Where it goes: the tracker and container named, or, without
     * them, where the project's issues already come from. Fails with
     * `IssueTargetNeeded` where that isn't clear, `DraftUntitled`, or the
     * tracker's `ConnectorFailed` when asked where issues go.
     */
    draft(input: {
      readonly projectId: ProjectId
      readonly threadId: string
      readonly tracker?: string
      readonly container?: string
      readonly title: string
      readonly body: string
      readonly labels: ReadonlyArray<string>
      /** Its priority; left out, or on a tracker without priorities, it has none, and is filed at the tracker's default. */
      readonly priority?: Priority
      /** The task whose lead drafts it: where its own issue came from is where an unnamed draft goes. */
      readonly taskId?: string
      readonly actorId: ActorId
    }): Effect.Effect<DraftCard, unknown>
    /** Changes what a draft says, before it is filed: `DraftClosed` after, `DraftUntitled` without a title. A priority left out stays; null takes it off. */
    change(
      draftId: string,
      draft: {
        readonly title: string
        readonly body: string
        readonly labels: ReadonlyArray<string>
        readonly priority?: Priority | null
      },
      actorId: ActorId,
    ): Effect.Effect<void, unknown>
    /** Files a draft on its tracker, because the person said to; one that failed, again. The card says how it went; `DraftClosed` once filed or discarded. */
    file(draftId: string, actorId: ActorId): Effect.Effect<DraftCard, unknown>
    /** Discards a draft: nothing is filed. `DraftClosed` once filed, or being filed. */
    discard(draftId: string, actorId: ActorId): Effect.Effect<void, unknown>
  }
>()('@althar/runtime/IssueDrafts') {
  static readonly layer: Layer.Layer<IssueDrafts, never, Store> = Layer.effect(
    IssueDrafts,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const connections = yield* Connections
      const sessions = yield* Sessions
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)

      const load = (draftId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<Row>`
            SELECT id, project_id, thread_id, connection_id, product, tracker_name, container, container_name, title, body, labels, priority,
              state, error, issue_key, issue_url
            FROM issue_drafts WHERE id = ${draftId} AND project_id IN (SELECT id FROM projects WHERE archived_at IS NULL)`
          return row === undefined ? yield* new NotFound({ kind: 'issue draft', id: draftId }) : row
        })

      /** Rewrites a draft's card from its row, inside the transaction that changed it. */
      const showCard = (draftId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const row = yield* load(draftId)
          const [item] = yield* sql<{ id: string }>`
            SELECT id FROM thread_items WHERE thread_id = ${row.threadId} AND kind = 'issue_draft' AND json_extract(content, '$.draftId') = ${draftId}`
          if (item !== undefined) yield* updateItem(row.projectId, item.id, cardOf(row))
          return cardOf(row)
        })

      /**
       * Changes a draft if it stands as `when` needs, checked and changed in
       * one transaction with its card, so two presses can't both file it.
       * The draft as it now is, or undefined where it didn't stand so.
       */
      const transition = (
        draftId: string,
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
              const row = yield* load(draftId)
              if (!when(row)) return { changed: false as const, row }
              const at = yield* timestamp
              const revision = yield* change('issue_drafts', draftId, { ...set(row, at), updatedAt: at })
              const after = yield* load(draftId)
              yield* fact({
                projectId: row.projectId,
                aggregateType: 'issue_draft',
                aggregateId: draftId,
                revision,
                type,
                ...(payload === undefined ? {} : { payload: payload(after) }),
                actorId,
              })
              yield* showCard(draftId)
              return { changed: true as const, row: after }
            }),
          )
        })

      /** Where the project's issues already come from: the newest issue a task came from, or a draft filed, by connection and container. */
      const usual = (projectId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql<{ connectionId: string; container: string; at: string }>`
            SELECT connection_id, coalesce(json_extract(snapshot, '$.container'), '') AS container, created_at AS at
              FROM external_links WHERE project_id = ${projectId} AND kind = 'issue' AND connection_id IS NOT NULL
            UNION ALL
            SELECT connection_id, container_name AS container, decided_at AS at
              FROM issue_drafts WHERE project_id = ${projectId} AND state = 'filed'
            ORDER BY at DESC LIMIT 20`
        })

      /** Where the issue a task came from is, by connection and container: first among where a draft of its lead goes. */
      const ownOf = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql<{ connectionId: string; container: string; at: string }>`
            SELECT connection_id, coalesce(json_extract(snapshot, '$.container'), '') AS container, created_at AS at
              FROM external_links WHERE task_id = ${taskId} AND kind = 'issue' AND connection_id IS NOT NULL
            ORDER BY created_at LIMIT 1`
        })

      /** Every ready tracker, each told apart from another of its name by its site, and its account where they share one. */
      const candidates = Effect.gen(function* () {
        const trackers = yield* connections.trackers
        const infos = yield* connections.list
        const known = trackers.map((one) => {
          const info = infos.find((candidate) => candidate.id === one.connectionId)
          return { ...one, name: products[one.product].name, host: hostOf(info?.webUrl ?? ''), login: info?.account.login ?? '' }
        })
        // In the order of their names, so choices read the same each time they are said.
        const told = known.map((one): Candidate => {
          const named = known.filter((other) => other.name === one.name)
          const hosted = named.filter((other) => other.host === one.host)
          const workspace = one.workspace
          const inWorkspace = workspace === null ? [] : named.filter((other) => other.workspace?.name === workspace.name)
          return {
            connectionId: one.connectionId,
            product: one.product,
            tracker: one.tracker,
            host: one.host,
            login: one.login,
            workspace,
            label:
              named.length === 1
                ? one.name
                : workspace !== null && inWorkspace.length === 1
                  ? `${one.name} (${workspace.name})`
                  : hosted.length === 1
                    ? `${one.name} (${one.host})`
                    : `${one.name} (${one.host}, ${one.login})`,
          }
        })
        return told.toSorted((a, b) => a.label.localeCompare(b.label))
      })

      /**
       * The tracker and container a draft goes to, from what was named and
       * where the project's issues come from. A container named without a
       * tracker, or with one several connections answer to, is looked for on
       * each; found on more than one, which is asked, never guessed.
       */
      const target = (projectId: string, named: { readonly tracker?: string; readonly container?: string }, taskId?: string) =>
        Effect.gen(function* () {
          const trackers = yield* candidates
          const home = yield* projectRepository(projectId).pipe(Effect.orElseSucceed(() => null))
          // The tracker the project is bound to comes first (ADR-059); then, as where a project's issues go is learned, a
          // lead's task came from an issue, perhaps: its follow-ups go beside it.
          const bound = yield* projectTracker(projectId)
          const before = [
            ...(bound === null ? [] : [{ connectionId: bound.connectionId, container: bound.container?.name ?? '', at: '' }]),
            ...(taskId === undefined ? [] : yield* ownOf(taskId)),
            ...(yield* usual(projectId)),
          ]
          const labels = trackers.map((one) => one.label)
          const typed = named.tracker?.trim() === '' ? undefined : named.tracker?.trim()
          const wanted = named.container?.trim() === '' ? undefined : named.container?.trim()
          // Bound to a workspace no longer connected, or needing sign-in again, it waits for that one, never going to another unasked.
          if (bound !== null && typed === undefined && !trackers.some((one) => one.connectionId === bound.connectionId)) {
            const workspace =
              bound.gone?.workspace ?? (yield* connections.list).find((one) => one.id === bound.connectionId)?.workspace?.name ?? null
            return yield* new IssueTargetNeeded({
              reason: bound.gone === null ? 'tracker_signed_out' : 'tracker_gone',
              named: null,
              tracker: workspace === null ? products[bound.product].name : `${products[bound.product].name} (${workspace})`,
              choices: labels,
            })
          }
          const matching = typed === undefined ? trackers : trackers.filter((one) => trackerNamed(one, typed))
          if (matching.length === 0)
            return yield* new IssueTargetNeeded({
              reason: trackers.length === 0 ? 'no_tracker' : 'unknown_tracker',
              named: typed ?? null,
              tracker: null,
              choices: labels,
            })
          /** Of several, the one the project is bound to or its issues come from, then the one its repository is on. */
          const preferred = (among: ReadonlyArray<Candidate>) =>
            before.flatMap((one) => among.filter((candidate) => candidate.connectionId === one.connectionId))[0] ??
            among.find((one) => one.connectionId === home?.connectionId)

          if (wanted !== undefined) {
            // One tracker's failure to say stands where it is the only one asked; of several, those that answer are enough.
            const asked = yield* Effect.forEach(
              matching,
              (candidate) =>
                matching.length === 1
                  ? Effect.map(candidate.tracker.containers(), (containers) => ({ candidate, containers }))
                  : Effect.map(
                      Effect.orElseSucceed(candidate.tracker.containers(), (): ReadonlyArray<Container> => []),
                      (containers) => ({ candidate, containers }),
                    ),
              { concurrency: 4 },
            )
            const found = asked.flatMap(({ candidate, containers }) => {
              const container = containerNamed(containers, wanted)
              return container === undefined ? [] : [{ ...candidate, container }]
            })
            const [only] = found
            if (only !== undefined && found.length === 1) return only
            if (found.length > 1)
              return yield* new IssueTargetNeeded({
                reason: 'tracker_needed',
                named: wanted,
                tracker: null,
                choices: found.map((one) => one.label),
              })
            const [single] = asked
            return yield* new IssueTargetNeeded({
              reason: 'unknown_container',
              named: wanted,
              tracker: asked.length === 1 && single !== undefined ? single.candidate.label : null,
              choices: listed(
                asked.flatMap(({ candidate, containers }) =>
                  containers.map((container) =>
                    asked.length === 1 ? containerWords(container) : `${candidate.label}: ${containerWords(container)}`,
                  ),
                ),
              ),
            })
          }

          const chosen =
            matching.length === 1
              ? matching[0]
              : (preferred(matching) ?? (typed === undefined && trackers.length === 1 ? trackers[0] : undefined))
          if (chosen === undefined)
            return yield* new IssueTargetNeeded({
              reason: 'tracker_needed',
              named: typed ?? null,
              tracker: null,
              choices: matching.map((one) => one.label),
            })
          const containers = yield* chosen.tracker.containers()
          const found =
            (bound?.connectionId === chosen.connectionId && bound.container !== null
              ? (containers.find((one) => one.id === bound.container?.id) ?? containerNamed(containers, bound.container.name))
              : undefined) ??
            (home?.connectionId === chosen.connectionId ? containerNamed(containers, home.path.join('/')) : undefined) ??
            before
              .filter((one) => one.connectionId === chosen.connectionId && one.container !== '')
              .map((one) => containerNamed(containers, one.container))
              .find((one) => one !== undefined) ??
            (containers.length === 1 ? containers[0] : undefined)
          return found === undefined
            ? yield* new IssueTargetNeeded({
                reason: containers.length === 0 ? 'unknown_container' : 'container_needed',
                named: null,
                tracker: chosen.label,
                choices: listed(containers.map(containerWords)),
              })
            : { ...chosen, container: found }
        })

      const draft: IssueDrafts['Service']['draft'] = (input) =>
        provide(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const title = input.title.trim()
            if (title === '') return yield* new DraftUntitled({ draftId: null })
            const where = yield* target(
              input.projectId,
              {
                ...(input.tracker === undefined ? {} : { tracker: input.tracker }),
                ...(input.container === undefined ? {} : { container: input.container }),
              },
              input.taskId,
            )
            // The same title for the same place, waiting in the same thread, is the same draft: an agent that calls again, unsure the
            // first worked, gets the first.
            const [waiting] = yield* sql<{ id: string }>`
              SELECT id FROM issue_drafts
              WHERE thread_id = ${input.threadId} AND state = 'pending' AND lower(title) = ${title.toLowerCase()}
                AND connection_id = ${where.connectionId} AND container = ${where.container.id}`
            if (waiting !== undefined) return cardOf(yield* load(waiting.id))
            const draftId = yield* newId(Ids.issueDraft)
            const labels = labelsOf(input.labels)
            // A tracker without priorities files it at its own default: none is kept to show.
            const priority =
              input.priority === undefined || input.priority === 'none' || !where.tracker.capabilities.changes.includes('priority')
                ? null
                : input.priority
            yield* sql.withTransaction(
              Effect.gen(function* () {
                const at = yield* timestamp
                yield* sql`INSERT INTO issue_drafts ${sql.insert({
                  id: draftId,
                  projectId: input.projectId,
                  threadId: input.threadId,
                  connectionId: where.connectionId,
                  product: where.product,
                  trackerName: where.label,
                  container: where.container.id,
                  containerName: where.container.name,
                  title,
                  body: input.body.trim(),
                  labels: JSON.stringify(labels),
                  priority,
                  state: 'pending',
                  draftedByActorId: input.actorId,
                  createdAt: at,
                  updatedAt: at,
                })}`
                yield* fact({
                  projectId: input.projectId,
                  aggregateType: 'issue_draft',
                  aggregateId: draftId,
                  revision: 1,
                  type: 'issue_draft.drafted',
                  payload: { product: where.product, tracker: where.label, container: where.container.name, title, labels, priority },
                  actorId: input.actorId,
                })
                yield* addItem({ projectId: input.projectId, threadId: input.threadId }, 'issue_draft', cardOf(yield* load(draftId)))
              }),
            )
            return cardOf(yield* load(draftId))
          }),
        )

      /** Whether a draft can still change, or be filed: waiting on the person, not filed the last time, or perhaps filed, for the person to look. */
      const open = (row: Row) => row.state === 'pending' || row.state === 'failed' || row.state === 'uncertain'
      const closed = (row: Row) => new DraftClosed({ draftId: row.id, state: row.state })

      const changeDraft: IssueDrafts['Service']['change'] = (draftId, next, actorId) =>
        provide(
          Effect.gen(function* () {
            const title = next.title.trim()
            if (title === '') return yield* new DraftUntitled({ draftId })
            const result = yield* transition(
              draftId,
              open,
              () => ({
                title,
                body: next.body.trim(),
                labels: JSON.stringify(labelsOf(next.labels)),
                ...(next.priority === undefined ? {} : { priority: next.priority === 'none' ? null : next.priority }),
              }),
              'issue_draft.changed',
              actorId,
              (row) => ({ title: row.title }),
            )
            if (!result.changed) return yield* closed(result.row)
          }),
        )

      /** Why filing failed, in words the card shows. */
      /**
       * Whether a failure leaves the issue perhaps filed: the tracker didn't
       * answer in time or at all, or answered with what Althar couldn't read,
       * after it may have taken the request. A refusal it answered with (signed
       * out, not allowed, not there, too many calls, the request as it stands)
       * files nothing; nor does a connection that is gone. Anything else is
       * taken to be uncertain, never confidently unfiled. A failure while the
       * adapter was still looking things up before it asked to file is
       * uncertain too, which costs the person a look and never a duplicate.
       */
      const uncertain = (error: unknown) =>
        error instanceof ConnectorFailed
          ? error.reason === 'unreachable' || error.reason === 'invalid_response'
          : !(error instanceof NotFound)

      const failureWords = (error: unknown, tracker: string) => {
        if (uncertain(error))
          return `Its answer was lost, so Althar can’t tell whether ${tracker} filed it. Look on ${tracker} before you file it again.`
        if (error instanceof ConnectorFailed)
          switch (error.reason) {
            case 'unauthorized':
              return `${tracker} didn’t take Althar’s sign-in. Sign in again in Settings, then try again.`
            case 'forbidden':
              return `${tracker} says this account may not file issues there${error.message === '' ? '' : `: ${error.message}`}`
            case 'rate_limited':
              return `${tracker} asks Althar to wait before trying again.`
            default:
              return error.message === '' ? `${tracker} refused it.` : error.message
          }
        return `The connection to ${tracker} is gone. Connect it again, then try again.`
      }

      /**
       * Tells a task's lead what the person decided about a draft of its,
       * quietly: in its thread, as input Althar writes. Nothing for the
       * coordinator's drafts, which it hears as news, nor for a task that is
       * over. A lead that isn't running is told all the same: the input waits
       * in its queue and it reads it when it is resumed.
       */
      const tellLead = (row: Row, words: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [thread] = yield* sql<{ id: string }>`
            SELECT t.id FROM threads t JOIN tasks k ON k.id = t.task_id
            WHERE t.id = ${row.threadId} AND t.kind = 'task' AND k.state = 'open'`
          if (thread === undefined) return
          yield* sessions.send({
            envelope: yield* envelope('thread.send', { threadId: thread.id, issueDraft: row.id }, undefined, instance.systemId),
            threadId: thread.id,
            body: words,
            quiet: true,
          })
        }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not tell a lead what became of its issue draft', cause)))

      const file: IssueDrafts['Service']['file'] = (draftId, actorId) =>
        provide(
          Effect.gen(function* () {
            const marked = yield* transition(draftId, open, () => ({ state: 'filing', error: null }), 'issue_draft.filing', actorId)
            if (!marked.changed) return marked.row.state === 'filing' ? cardOf(marked.row) : yield* closed(marked.row)
            const row = marked.row
            const tracker = row.trackerName
            const made = yield* connections.adapters(row.connectionId).pipe(
              Effect.flatMap((adapters): Effect.Effect<Issue, unknown> =>
                adapters.tracker === undefined
                  ? Effect.fail(new NotFound({ kind: 'connection', id: row.connectionId }))
                  : // Wanting its sign-in again, the tracker isn't asked: it would refuse.
                    adapters.info.state !== 'ready'
                    ? Effect.fail(new ConnectorFailed({ product: row.product, reason: 'unauthorized', message: '' }))
                    : adapters.tracker.create(row.container, {
                        title: row.title,
                        body: row.body,
                        labels: Schema.decodeUnknownSync(Labels)(row.labels),
                        ...(row.priority === null ? {} : { priority: row.priority }),
                      }),
              ),
              Effect.result,
            )
            const ended = yield* transition(
              draftId,
              (now) => now.state === 'filing',
              (_, at) =>
                made._tag === 'Success'
                  ? {
                      state: 'filed',
                      issueRef: made.success.ref,
                      issueKey: made.success.key,
                      issueUrl: made.success.url,
                      decidedAt: at,
                    }
                  : { state: uncertain(made.failure) ? 'uncertain' : 'failed', error: failureWords(made.failure, tracker) },
              made._tag === 'Success' ? 'issue_draft.filed' : uncertain(made.failure) ? 'issue_draft.uncertain' : 'issue_draft.failed',
              actorId,
              (now) => (now.state === 'filed' ? { key: now.issueKey, url: now.issueUrl } : { error: now.error }),
            )
            if (made._tag === 'Failure') yield* Effect.logWarning('An issue draft could not be filed', made.failure)
            if (ended.changed && ended.row.state === 'filed') {
              yield* tellLead(
                ended.row,
                `The person filed your issue “${ended.row.title}” on ${tracker}, in ${ended.row.containerName}, as ${ended.row.issueKey ?? ''}: ${ended.row.issueUrl ?? ''}. Refer to it by that key and link.`,
              )
            }
            return cardOf(ended.row)
          }),
        )

      const discard: IssueDrafts['Service']['discard'] = (draftId, actorId) =>
        provide(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const result = yield* transition(
              draftId,
              open,
              (_, at) => ({ state: 'discarded', error: null, decidedAt: at }),
              'issue_draft.discarded',
              actorId,
            )
            if (!result.changed) return yield* closed(result.row)
            // A filing that ended unsure may have reached the tracker, even if a later try failed plainly: discarding closes only the
            // draft here, and the lead isn't told the issue doesn't exist.
            const [unsure] = yield* sql<{ id: string }>`
              SELECT id FROM record_events WHERE aggregate_type = 'issue_draft' AND aggregate_id = ${result.row.id} AND type = 'issue_draft.uncertain' LIMIT 1`
            yield* tellLead(
              result.row,
              unsure === undefined
                ? `The person discarded your issue “${result.row.title}”: nothing was filed, so don't refer to it.`
                : `The person discarded your issue “${result.row.title}” in Althar, but an attempt to file it ended unsure, so it may be on ${result.row.trackerName}, in ${result.row.containerName}, all the same. Don't say it doesn't exist, and look for it with find_issues before you draft it again.`,
            )
          }),
        )

      // A draft Althar closed while filing may or may not be on its tracker: said so, for the person to look before filing it again.
      yield* provide(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const stuck = yield* sql<{ id: string; trackerName: string }>`SELECT id, tracker_name FROM issue_drafts WHERE state = 'filing'`
          for (const draft of stuck)
            yield* transition(
              draft.id,
              (row) => row.state === 'filing',
              () => ({
                state: 'uncertain',
                error: `Althar closed while filing this. Look on ${draft.trackerName} for it before you file it again.`,
              }),
              'issue_draft.uncertain',
              instance.systemId,
              (row) => ({ error: row.error }),
            )
        }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not settle the issue drafts left being filed', cause))),
      )

      return IssueDrafts.of({ draft, change: changeDraft, file, discard })
    }),
  )
}
