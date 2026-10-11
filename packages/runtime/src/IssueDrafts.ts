import { type Container, ConnectorFailed, type Issue, type Product, products, type Tracker } from '@althar/connectors'
import { type ActorId, Ids, type IssueDraftState, newId, type ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { Context, type Crypto, Effect, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Connections } from './Connections'
import { NotFound } from './errors'
import { Instance } from './Instance'
import { projectRepository } from './Issues'
import { change, fact, timestamp } from './records'
import { addItem, updateItem } from './threads'

/*
 * Issues the coordinator drafts on the person's connected trackers
 * (docs/architecture/06, "Drafting issues"). A draft is a card in the
 * coordinator's thread: the tracker, where it goes there, its title, body
 * and labels. Nothing reaches the tracker until the person files it from the
 * card, which they may change first; or they discard it. There is no
 * countdown: leaving a draft alone files nothing. A draft that couldn't be
 * filed says why, and can be filed again.
 *
 * The draft's row is what it is; its card's item carries the same, written
 * in the same transaction as each change, so a thread reads it as it reads
 * any item. Filing calls the tracker outside any transaction: the draft is
 * marked as being filed first, so a second press files nothing more, and one
 * Althar closed in the middle of is said to be uncertain, never filed again
 * unasked.
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
  reason: Schema.Literals(['no_tracker', 'tracker_needed', 'unknown_tracker', 'container_needed', 'unknown_container']),
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

interface Row {
  readonly id: string
  readonly projectId: ProjectId
  readonly threadId: string
  readonly connectionId: string
  readonly product: Product
  readonly container: string
  readonly containerName: string
  readonly title: string
  readonly body: string
  readonly labels: string
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
  tracker: products[row.product].name,
  container: row.containerName,
  title: row.title,
  body: row.body,
  labels: Schema.decodeUnknownSync(Labels)(row.labels),
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

/** Whether a tracker is the one a person named: by its product (jira_cloud), its service (jira), or its name (Jira Data Center). */
const trackerNamed = (product: Product, typed: string) =>
  same(product, typed) || same(products[product].service, typed) || same(products[product].name, typed)

type Store = SqlClient.SqlClient | Instance | Ledger | Crypto.Crypto | Connections

export class IssueDrafts extends Context.Service<
  IssueDrafts,
  {
    /**
     * Drafts an issue, files nothing, and posts its card in the coordinator's
     * thread. Where it goes: the tracker and container named, or, without
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
      readonly actorId: ActorId
    }): Effect.Effect<DraftCard, unknown>
    /** Changes what a draft says, before it is filed: `DraftClosed` after, `DraftUntitled` without a title. */
    change(
      draftId: string,
      draft: { readonly title: string; readonly body: string; readonly labels: ReadonlyArray<string> },
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
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)

      const load = (draftId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<Row>`
            SELECT id, project_id, thread_id, connection_id, product, container, container_name, title, body, labels, state, error,
              issue_key, issue_url
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

      /** The tracker and container a draft goes to, from what was named and where the project's issues come from. */
      const target = (projectId: string, named: { readonly tracker?: string; readonly container?: string }) =>
        Effect.gen(function* () {
          const trackers = yield* connections.trackers
          const home = yield* projectRepository(projectId).pipe(Effect.orElseSucceed(() => null))
          const before = yield* usual(projectId)
          const names = [...new Set(trackers.map((one) => products[one.product].name))]
          const typed = named.tracker?.trim() === '' ? undefined : named.tracker?.trim()

          const chosen = ((): { readonly connectionId: string; readonly product: Product; readonly tracker: Tracker } | undefined => {
            if (typed !== undefined) {
              const matching = trackers.filter((one) => trackerNamed(one.product, typed))
              // Of two connections to the same tracker, the one the project's repository or its issues are on.
              return (
                matching.find((one) => one.connectionId === home?.connectionId) ??
                matching.find((one) => before.some((seen) => seen.connectionId === one.connectionId)) ??
                matching[0]
              )
            }
            const seen = before.flatMap((one) => trackers.filter((candidate) => candidate.connectionId === one.connectionId))[0]
            return (
              seen ?? trackers.find((one) => one.connectionId === home?.connectionId) ?? (trackers.length === 1 ? trackers[0] : undefined)
            )
          })()
          if (chosen === undefined)
            return yield* new IssueTargetNeeded({
              reason: trackers.length === 0 ? 'no_tracker' : typed === undefined ? 'tracker_needed' : 'unknown_tracker',
              named: typed ?? null,
              tracker: null,
              choices: names,
            })

          const containers = yield* chosen.tracker.containers()
          const tracker = products[chosen.product].name
          const choices = listed(containers.map(containerWords))
          const wanted = named.container?.trim() === '' ? undefined : named.container?.trim()
          if (wanted !== undefined) {
            const found = containerNamed(containers, wanted)
            return found === undefined
              ? yield* new IssueTargetNeeded({ reason: 'unknown_container', named: wanted, tracker, choices })
              : { ...chosen, container: found }
          }
          const found =
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
                tracker,
                choices,
              })
            : { ...chosen, container: found }
        })

      const draft: IssueDrafts['Service']['draft'] = (input) =>
        provide(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const title = input.title.trim()
            if (title === '') return yield* new DraftUntitled({ draftId: null })
            const where = yield* target(input.projectId, {
              ...(input.tracker === undefined ? {} : { tracker: input.tracker }),
              ...(input.container === undefined ? {} : { container: input.container }),
            })
            // The same title waiting in the same thread is the same draft: an agent that calls again, unsure the first worked, gets the first.
            const [waiting] = yield* sql<{ id: string }>`
              SELECT id FROM issue_drafts WHERE thread_id = ${input.threadId} AND state = 'pending' AND lower(title) = ${title.toLowerCase()}`
            if (waiting !== undefined) return cardOf(yield* load(waiting.id))
            const draftId = yield* newId(Ids.issueDraft)
            const labels = labelsOf(input.labels)
            yield* sql.withTransaction(
              Effect.gen(function* () {
                const at = yield* timestamp
                yield* sql`INSERT INTO issue_drafts ${sql.insert({
                  id: draftId,
                  projectId: input.projectId,
                  threadId: input.threadId,
                  connectionId: where.connectionId,
                  product: where.product,
                  container: where.container.id,
                  containerName: where.container.name,
                  title,
                  body: input.body.trim(),
                  labels: JSON.stringify(labels),
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
                  payload: { product: where.product, container: where.container.name, title, labels },
                  actorId: input.actorId,
                })
                yield* addItem({ projectId: input.projectId, threadId: input.threadId }, 'issue_draft', cardOf(yield* load(draftId)))
              }),
            )
            return cardOf(yield* load(draftId))
          }),
        )

      /** Whether a draft can still change, or be filed: waiting on the person, or not filed the last time. */
      const open = (row: Row) => row.state === 'pending' || row.state === 'failed'
      const closed = (row: Row) => new DraftClosed({ draftId: row.id, state: row.state })

      const changeDraft: IssueDrafts['Service']['change'] = (draftId, next, actorId) =>
        provide(
          Effect.gen(function* () {
            const title = next.title.trim()
            if (title === '') return yield* new DraftUntitled({ draftId })
            const result = yield* transition(
              draftId,
              open,
              () => ({ title, body: next.body.trim(), labels: JSON.stringify(labelsOf(next.labels)) }),
              'issue_draft.changed',
              actorId,
              (row) => ({ title: row.title }),
            )
            if (!result.changed) return yield* closed(result.row)
          }),
        )

      /** Why filing failed, in words the card shows. */
      const failureWords = (error: unknown, tracker: string) => {
        if (error instanceof ConnectorFailed)
          switch (error.reason) {
            case 'unauthorized':
              return `${tracker} didn’t take Althar’s sign-in. Sign in again in Settings, then try again.`
            case 'forbidden':
              return `${tracker} says this account may not file issues there${error.message === '' ? '' : `: ${error.message}`}`
            case 'unreachable':
              return `${tracker} didn’t answer. Try again in a moment.`
            case 'rate_limited':
              return `${tracker} asks Althar to wait before trying again.`
            default:
              return error.message === '' ? `${tracker} refused it.` : error.message
          }
        if (error instanceof NotFound) return `The connection to ${tracker} is gone. Connect it again, then try again.`
        return `Althar couldn’t file it on ${tracker}.`
      }

      const file: IssueDrafts['Service']['file'] = (draftId, actorId) =>
        provide(
          Effect.gen(function* () {
            const marked = yield* transition(draftId, open, () => ({ state: 'filing', error: null }), 'issue_draft.filing', actorId)
            if (!marked.changed) return marked.row.state === 'filing' ? cardOf(marked.row) : yield* closed(marked.row)
            const row = marked.row
            const tracker = products[row.product].name
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
                  : { state: 'failed', error: failureWords(made.failure, tracker) },
              made._tag === 'Success' ? 'issue_draft.filed' : 'issue_draft.failed',
              actorId,
              (now) => (now.state === 'filed' ? { key: now.issueKey, url: now.issueUrl } : { error: now.error }),
            )
            if (made._tag === 'Failure') yield* Effect.logWarning('An issue draft could not be filed', made.failure)
            return cardOf(ended.row)
          }),
        )

      const discard: IssueDrafts['Service']['discard'] = (draftId, actorId) =>
        provide(
          Effect.gen(function* () {
            const result = yield* transition(
              draftId,
              open,
              (_, at) => ({ state: 'discarded', error: null, decidedAt: at }),
              'issue_draft.discarded',
              actorId,
            )
            if (!result.changed) return yield* closed(result.row)
          }),
        )

      // A draft Althar closed while filing may or may not be on its tracker: said so, for the person to look before filing it again.
      yield* provide(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const stuck = yield* sql<{ id: string; product: Product }>`SELECT id, product FROM issue_drafts WHERE state = 'filing'`
          for (const draft of stuck)
            yield* transition(
              draft.id,
              (row) => row.state === 'filing',
              () => ({
                state: 'failed',
                error: `Althar closed while filing this. Look on ${products[draft.product].name} for it before you file it again.`,
              }),
              'issue_draft.failed',
              instance.systemId,
              (row) => ({ error: row.error }),
            )
        }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not settle the issue drafts left being filed', cause))),
      )

      return IssueDrafts.of({ draft, change: changeDraft, file, discard })
    }),
  )
}
