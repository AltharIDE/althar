import { existsSync } from 'node:fs'
import { ChangeRequest, type Check, type CodeHost, type Repository } from '@althar/connectors'
import { Ids, type ProjectId, newId } from '@althar/domain'
import type { Ledger, RevisionConflict, RowNotFound } from '@althar/persistence-sqlite'
import { Cause, Clock, type Crypto, Duration, Effect, Option, Result, Schema, type Scope } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'
import type { Busy } from './Busy'
import { touchCard, touchTask } from './cards'
import {
  type Askable,
  type ChangeSummary,
  type ConflictStanding,
  type LinkRow,
  OFF_FOR_PROJECT,
  OFF_FOR_TASK,
  RERUN_SHOWS,
  type RoundRow,
  RoundWaiting,
  STOPPED_MIDWAY,
  Snapshot,
  type Store,
  checksFailed,
  couldntFetch,
  couldntRead,
  gitSaidOf,
} from './changeRecords'
import { LOGS_TO_LEAD, logForLead, readLog } from './checkLogs'
import { RuntimeConfig } from './Config'
import {
  ATTEMPTS,
  BUSY_UP_TO,
  type Conflict,
  Conflicts,
  Ended,
  type FailedChecks,
  NO_CHECKS_AFTER,
  type Place,
  changeOf,
  fixNoteFor,
  noteFor,
  onlyTheFix,
  onlyTheResolution,
  shortWhereLine,
  unresolved,
  whereLine,
} from './conflicts'
import { envelope } from './envelope'
import { contained } from './Failures'
import { forkOf } from './forks'
import { commitOf, fetchedInto, gitOutcome, namedRemotes } from './git'
import type { InstanceInfo } from './Instance'
import { REPORT_FOR } from './leftRunning'
import type { LiveEvent } from './Live'
import { Policies, resolvesConflictsFor } from './Policies'
import { checksOf, nameOf } from './pullRequestWords'
import { change, fact, timestamp } from './records'
import type { Sessions } from './Sessions'
import { spanOf } from './stallWatch'
import { addItem } from './threads'
import { summarize, words } from './words'

export interface ChangeConflictsDependencies {
  readonly baseEvery: number
  readonly busy: Busy['Service']
  readonly cleanHere: Map<string, { readonly head: string | null; readonly hostSaid: boolean }>
  readonly decodeSnapshot: (input: unknown) => Effect.Effect<Snapshot, Schema.SchemaError>
  readonly fetchedAt: Map<string, { readonly at: number; readonly tip: string }>
  readonly fixingOn: (link: LinkRow) => Effect.Effect<
    {
      linkId: string
      failed: number
      given: boolean
      open: boolean
      stopped: boolean
      failing: boolean
      spoken: boolean
      untold: boolean
      unreached: boolean
      running: boolean
      goes: boolean
      why: string | null
    } | null,
    SqlError.SqlError | Schema.SchemaError,
    SqlClient.SqlClient
  >
  readonly heard: (
    link: LinkRow,
    kind: string,
    id: string,
    payload: Readonly<Record<string, unknown>>,
  ) => Effect.Effect<
    boolean,
    SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict,
    SqlClient.SqlClient | Ledger | Crypto.Crypto
  >
  readonly instance: InstanceInfo
  readonly locked: (taskId: string) => <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  readonly logged: Map<string, string>
  readonly pressed: Set<string>
  readonly provide: <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.Effect<A, E, never>
  readonly push: (
    taskId: string,
    seen: string,
    url?: string,
    by?: 'person' | 'althar' | 'ship',
  ) => Effect.Effect<{ change: ChangeSummary }, unknown, Store>
  readonly ranAgain: (
    link: LinkRow,
    sha: string,
  ) => Effect.Effect<{ at: string; started: boolean; startedId: string; again: string } | null, SqlError.SqlError, SqlClient.SqlClient>
  readonly sayOn: (
    link: LinkRow,
    title: string,
    description?: string,
  ) => Effect.Effect<void, SqlError.SqlError | Schema.SchemaError, SqlClient.SqlClient | Ledger | Crypto.Crypto>
  readonly scope: Scope.Scope
  readonly sessions: Sessions['Service']
  readonly stuckAfter: Duration.Duration
  readonly sweptConflicts: Map<string, string>
  readonly unsent: Map<string, { readonly why: string; readonly checked: boolean }>
  readonly urlsOf: (taskId: string) => Effect.Effect<Snapshot[], SqlError.SqlError, SqlClient.SqlClient>
  readonly wakeNow: (taskId: string | null) => void
  readonly worktreeOf: (
    taskId: string,
    url: string,
  ) => Effect.Effect<
    | { id: string; path: string; branch: string; base: string; baseCommit: string | null; threadId: string; heldAt: string | null }
    | undefined,
    unknown,
    Store
  >
}

export const makeChangeConflicts = (dependencies: ChangeConflictsDependencies) =>
  Effect.gen(function* () {
    const {
      baseEvery,
      busy,
      cleanHere,
      decodeSnapshot,
      fetchedAt,
      fixingOn,
      heard,
      instance,
      locked,
      logged,
      pressed,
      provide,
      push,
      ranAgain,
      sayOn,
      scope,
      sessions,
      stuckAfter,
      sweptConflicts,
      unsent,
      urlsOf,
      worktreeOf,
    } = dependencies

    /* ---- A lead resolving a conflict on its own, where the project says to (conflicts.ts) ---- */

    const decodeConflicts = Schema.decodeUnknownEffect(Schema.fromJsonString(Conflicts))

    const decodeWaiting = Schema.decodeUnknownEffect(Schema.fromJsonString(RoundWaiting))

    const decodeEnded = Schema.decodeUnknownEffect(Schema.fromJsonString(Ended))

    const roundColumns = (sql: SqlClient.SqlClient) =>
      sql`c.id, c.project_id, c.task_id, t.id AS thread_id, c.pull_request_url AS url, c.conflicts, c.attempt, c.state,
            c.failure, c.ended, c.pushed_head, c.asked_sequence, c.updated_at, c.waiting`

    /** The task's round under way, resolving or waiting for its checks: one at most. */
    const underWay = (taskId: string) =>
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) => sql<RoundRow>`
            SELECT ${roundColumns(sql)} FROM conflict_resolutions c JOIN threads t ON t.task_id = c.task_id AND t.kind = 'task'
            WHERE c.task_id = ${taskId} AND c.state IN ('resolving', 'checking')`,
      )

    const roundOf = (where: { readonly id: string } | { readonly threadId: string }) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const columns = roundColumns(sql)
        const [round] =
          'id' in where
            ? yield* sql<RoundRow>`
                  SELECT ${columns} FROM conflict_resolutions c JOIN threads t ON t.task_id = c.task_id AND t.kind = 'task' WHERE c.id = ${where.id}`
            : yield* sql<RoundRow>`
                  SELECT ${columns} FROM conflict_resolutions c JOIN threads t ON t.task_id = c.task_id AND t.kind = 'task'
                  WHERE t.id = ${where.threadId} AND c.state = 'resolving' AND c.waiting IS NULL`
        return round
      })

    /** The task's worktrees here, by their repository's slug. */
    const worktreesOf = (taskId: string) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ slug: string; path: string }>`
            SELECT b.slug, w.path FROM workspaces w JOIN repository_bindings b ON b.id = w.binding_id
            WHERE w.task_id = ${taskId} AND w.device_id = ${instance.deviceId} AND w.access = 'write'`
        return new Map(rows.map((row) => [row.slug, row.path]))
      })

    /** Where each of the round's branches is now. */
    const endedOf = (taskId: string, conflicts: ReadonlyArray<Conflict>) =>
      Effect.gen(function* () {
        const worktrees = yield* worktreesOf(taskId)
        return yield* Effect.forEach(conflicts, (conflict) =>
          Effect.map(commitOf(worktrees.get(conflict.repository) ?? '', 'HEAD').pipe(Effect.orElseSucceed(() => '')), (head) => ({
            repository: conflict.repository,
            head,
          })),
        )
      })

    /**
     * Whether a conflict is the lead's to resolve now, unasked: the task
     * says so, or its project does where the task says nothing, as both do
     * unless the person turned it off; the task is open, its lead idle, and
     * no round is under way. One waiting on the checks of the merge it
     * pushed is under way, unless the branch it merged has moved on and
     * conflicts again (`targets`). A run that ended
     * otherwise than succeeded, failed or cancelled, leaves its lead idle
     * all the same. Not while its run still goes, nor where the person
     * stopped it, where starting its lead would go against them. One the
     * lead couldn't resolve stays the person's while its branches are as it
     * left them and what they conflicted with is where it was (`targets`,
     * where it is now). Forced, as the person's Resolve now is, neither the
     * rules, a stop nor a round handed back holds it.
     */
    const askable = (
      taskId: string,
      url: string | null,
      how: { readonly force?: boolean; readonly targets?: ReadonlyArray<string> } = {},
    ): Effect.Effect<Askable, unknown, Store> =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [task] = yield* sql<{
          projectId: ProjectId
          threadId: string | null
          state: string
          resolveConflicts: number | null
          run: string | null
        }>`
            SELECT k.project_id, k.state, k.resolve_conflicts,
              (SELECT id FROM threads WHERE task_id = k.id AND kind = 'task' LIMIT 1) AS thread_id,
              (SELECT state FROM runs WHERE task_id = k.id ORDER BY created_at DESC, rowid DESC LIMIT 1) AS run
            FROM tasks k WHERE k.id = ${taskId}`
        if (task === undefined || task.state !== 'open') return 'off'
        const force = how.force === true
        // Turned off, it is the person's, and its card says why, with Resolve now beside it.
        if (!force && !resolvesConflictsFor((yield* (yield* Policies).current(task.projectId)).rules, task.resolveConflicts))
          return { why: task.resolveConflicts === 0 ? OFF_FOR_TASK : OFF_FOR_PROJECT, shown: true, off: true }
        const [latest] = yield* sql<{
          id: string
          url: string | null
          state: string
          conflicts: string
          ended: string | null
          failure: string | null
        }>`
            SELECT id, pull_request_url AS url, state, conflicts, ended, failure FROM conflict_resolutions WHERE task_id = ${taskId}
            ORDER BY created_at DESC, rowid DESC LIMIT 1`
        if (latest?.state === 'resolving') return 'resolving'
        // Waiting on the checks of the merge it pushed, the round is under way, unless what that merge brought in has moved
        // on and conflicts again (`targets`): then it is a new conflict, the lead's at once. Not yet known, it is looked for.
        if (latest?.state === 'checking') {
          if (how.targets === undefined) return 'checking'
          const merged = yield* decodeConflicts(latest.conflicts)
          if (merged.every((one) => how.targets?.includes(one.target) === true)) return 'resolving'
        }
        // Its run still going, its lead is at work: looked at again once it ends.
        if (task.run === 'admitted' || task.run === 'running') return { why: 'Its run is still going.', shown: false }
        if (task.run === null) return { why: 'It has no lead yet.', shown: true }
        if (force) return 'yes'
        if (task.run === 'suspended') {
          // Told to go on without its run carried on, its lead is at work all the same: nothing for the person to resolve now.
          const lead = task.threadId === null ? Option.none() : yield* sessions.running(task.threadId)
          if (Option.exists(lead, (session) => session.turnRunning)) return { why: 'Its lead is at work.', shown: false }
          // Whoever stopped it, the person, a command they declined, or Althar: its card says which.
          return { why: 'It’s stopped.', shown: true }
        }
        // One that ended as Althar stopped, as an earlier launch settled it, wasn't the lead's to fail.
        if (latest?.state === 'failed' && latest.url === url && latest.ended !== null && !latest.failure?.startsWith(STOPPED_MIDWAY)) {
          const left = yield* decodeEnded(latest.ended)
          const conflicts = yield* decodeConflicts(latest.conflicts)
          const now = yield* endedOf(taskId, conflicts)
          const still = left.every((one) => now.some((head) => head.repository === one.repository && head.head === one.head))
          // What it conflicted with moved on since: a conflict of its own, the lead's to try again.
          const moved = how.targets !== undefined && conflicts.some((one) => !(how.targets ?? []).includes(one.target))
          if (still && !moved) return 'handed'
        }
        return 'yes'
      })

    /**
     * A task that conflicts wasn't asked of its lead, or one Althar couldn't
     * look at for a conflict (`checked` false), whatever its host says: why,
     * logged, and on its card where the person is to see it.
     */
    const notSent = (taskId: string, why: string, shown = true, checked = true) =>
      Effect.gen(function* () {
        if (logged.get(taskId) !== why) {
          logged.set(taskId, why)
          yield* Effect.logInfo(
            checked ? `A conflict wasn’t sent to its lead: ${why}` : `A task couldn’t be looked at for a conflict: ${why}`,
          ).pipe(Effect.annotateLogs({ taskId }))
        }
        const was = unsent.get(taskId)
        if (shown ? was?.why === why && was.checked === checked : was === undefined) return
        if (shown) unsent.set(taskId, { why, checked })
        else unsent.delete(taskId)
        // Its board card and its task say it too, not only its card in the conversation.
        yield* touchTask(taskId)
      })

    /** Nothing to say of a task's conflict any more: asked of its lead, or it conflicts no more. */
    const forgetUnsent = (taskId: string) =>
      Effect.gen(function* () {
        logged.delete(taskId)
        pressed.delete(taskId)
        if (unsent.delete(taskId)) yield* touchTask(taskId)
      })

    /** What `askable` said, done: the lead asked, or why not kept; whether to ask it. */
    const sayingWhy = (taskId: string, asked: Askable) =>
      Effect.gen(function* () {
        if (asked === 'yes') return true
        // Nothing to say, the task not open, unless they pressed Resolve now: why that went nowhere stays.
        if (asked === 'off') {
          if (!pressed.has(taskId)) yield* forgetUnsent(taskId)
          return false
        }
        if (asked === 'handed') yield* forgetUnsent(taskId)
        else if (asked !== 'resolving' && asked !== 'checking') yield* notSent(taskId, asked.why, asked.shown)
        return false
      })

    /** Where a task's latest round stands, for its card (`Changes.conflictStanding`). */
    const standingOfRound = (taskId: string): Effect.Effect<ConflictStanding | null, unknown, Store> =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [latest] = yield* sql<{ id: string }>`
            SELECT id FROM conflict_resolutions WHERE task_id = ${taskId} ORDER BY created_at DESC, rowid DESC LIMIT 1`
        const round = latest === undefined ? undefined : yield* roundOf({ id: latest.id })
        if (round?.state === 'resolving') return { state: 'resolving', checks: round.pushedHead !== null }
        const said = unsent.get(taskId)
        if (said !== undefined) return { state: said.checked ? 'unsent' : 'unchecked', why: said.why }
        // Waiting on the checks of the merge it pushed: under way, as checks Althar sees through are.
        if (round?.state === 'checking') return { state: 'checking' }
        const handed = round === undefined ? null : yield* handedBackOf(round)
        if (handed !== null) return handed
        return yield* dueOf(taskId)
      })

    /**
     * Its open pull request conflicts, as its host last said, and no round
     * is under way or handed back: whether its lead is about to be asked
     * (`due`), as `askable` decides it, or why not, so its card never offers
     * the person a button for it without saying why, whether or not Althar
     * has looked at it since it launched. Not where its branch here merged
     * cleanly, its host saying it conflicts all the same, as Althar last
     * looked at its head: nothing goes to the lead then. Nor on a pull
     * request Althar no longer listens to.
     */
    const dueOf = (taskId: string): Effect.Effect<ConflictStanding | null, unknown, Store> =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        // Only one Althar still listens to: one it no longer follows will never be looked at, so nothing would come of it.
        const [open] = yield* sql<{ id: string; url: string; head: string | null }>`
            SELECT id, url, json_extract(snapshot, '$.headSha') AS head FROM external_links WHERE task_id = ${taskId} AND kind = 'change'
              AND listening = 1 AND connection_id IS NOT NULL
              AND json_extract(snapshot, '$.state') = 'open' AND json_extract(snapshot, '$.conflicts') = 1
            ORDER BY created_at DESC LIMIT 1`
        if (open === undefined) return null
        const clean = cleanHere.get(open.id)
        if (clean?.hostSaid === true && clean.head === open.head) return null
        const asked = yield* askable(taskId, open.url)
        if (asked === 'off' || asked === 'handed') return null
        if (typeof asked === 'object' && asked.shown) return { state: 'unsent', why: asked.why }
        return { state: 'due' }
      })

    /** A round the lead couldn't see through, still the person's while the branches are as the lead left them. */
    const handedBackOf = (round: RoundRow): Effect.Effect<ConflictStanding | null, unknown, Store> =>
      Effect.gen(function* () {
        const taskId = round.taskId
        if (round.state !== 'failed' || round.ended === null || round.failure === null) return null
        // Still the person's while the branches are as the lead left them, as `askable` reads it.
        const conflicts = yield* decodeConflicts(round.conflicts)
        const left = yield* decodeEnded(round.ended)
        const now = yield* endedOf(taskId, conflicts)
        if (!left.every((one) => now.some((head) => head.repository === one.repository && head.head === one.head))) return null
        const couldnt = round.pushedHead === null ? `resolve the conflict with ${shortWhereLine(conflicts)}` : 'fix the checks on the merge'
        return { state: 'handed_back', why: `The lead couldn’t ${couldnt}. ${round.failure}` }
      })

    /** Where a round is, in its words: its pull request (`PR #1`), or none for merging here. */
    const placeOf = (taskId: string, url: string | null): Effect.Effect<Place, unknown, Store> =>
      Effect.gen(function* () {
        if (url === null) return { change: null }
        const seen = (yield* urlsOf(taskId)).find((one) => one.url === url)
        return { change: seen === undefined ? 'the pull request' : nameOf(seen) }
      })

    /**
     * Whether anything but the round asked the lead since it last did: the
     * person, or what the pull request passes on. What the lead committed
     * may then be for that, and isn't Althar's to push.
     */
    const askedSince = (round: RoundRow) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [other] = yield* sql<{ id: string }>`
            SELECT id FROM user_inputs WHERE thread_id = ${round.threadId} AND sequence > ${round.askedSequence} LIMIT 1`
        return other !== undefined
      })

    /**
     * Asks the lead: quietly, as Althar does, since the thread says it in a
     * notice; a lead that isn't running is started for it, on the agent last
     * on the thread, as an answer starts one (Runs.answered). The round keeps
     * which of the thread's inputs asked it.
     */
    const askLead = (
      round: { readonly id: string; readonly projectId: ProjectId; readonly taskId: string; readonly threadId: string },
      attempt: number,
      body: string,
      why: Readonly<Record<string, unknown>> = {},
    ): Effect.Effect<void, unknown, Store> =>
      Effect.gen(function* () {
        const accepted = yield* sessions.send({
          envelope: yield* envelope('thread.send', { threadId: round.threadId, resolving: round.id, attempt }),
          threadId: round.threadId,
          body,
          quiet: true,
        })
        yield* reviseRound(
          round,
          'conflict_resolution.asked',
          { attempt, askedSequence: accepted.sequence, waiting: null },
          { attempt, ...why },
        )
        if (Option.isSome(yield* sessions.running(round.threadId))) return
        // Started apart, so what holds the task's pull request isn't held while an agent starts.
        yield* Effect.forkIn(
          sessions.startLast(round.threadId).pipe(
            Effect.flatMap((started) =>
              started ? Effect.void : locked(round.taskId)(settleRound(round.id, { why: 'There was no lead to ask.' })),
            ),
            Effect.catchCause((cause) =>
              locked(round.taskId)(settleRound(round.id, { why: `The lead couldn't start. ${summarize(cause)}`.trim() })),
            ),
            provide,
          ),
          scope,
        )
      })

    /**
     * A conflict the lead is to resolve: recorded, said in the thread, and
     * asked of it, once the lead has a place among the agents at work on
     * this machine; until then the round keeps its ask, and waits.
     */
    const beginRound = (
      task: { readonly projectId: ProjectId; readonly taskId: string; readonly threadId: string },
      url: string | null,
      conflicts: ReadonlyArray<Conflict>,
      failed: FailedChecks | null = null,
    ) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        unsent.delete(task.taskId)
        pressed.delete(task.taskId)
        const id = yield* newId(Ids.conflictResolution)
        const place = yield* placeOf(task.taskId, url)
        // Its checks failed too: the lead is asked for both at once.
        const alsoFailed = failed !== null && failed.failing.length > 0 && url !== null ? failed : null
        const body = noteFor(conflicts, place, null, [], alsoFailed)
        const room = yield* busy.enter(
          task.taskId,
          (room) =>
            sql.withTransaction(
              Effect.gen(function* () {
                const at = yield* timestamp
                yield* sql`INSERT INTO conflict_resolutions ${sql.insert({
                  id,
                  projectId: task.projectId,
                  taskId: task.taskId,
                  pullRequestUrl: url,
                  conflicts: JSON.stringify(conflicts),
                  attempt: 1,
                  state: 'resolving',
                  waiting: room ? null : JSON.stringify({ attempt: 1, body, why: {}, since: at } satisfies RoundWaiting),
                  createdAt: at,
                  updatedAt: at,
                })}`
                yield* fact({
                  projectId: task.projectId,
                  aggregateType: 'conflict_resolution',
                  aggregateId: id,
                  revision: 1,
                  type: 'conflict_resolution.started',
                  payload: {
                    url,
                    conflicts: conflicts.map((one) => ({ repository: one.repository, branch: one.branch, files: one.files })),
                    ...(alsoFailed === null ? {} : { failing: alsoFailed.failing }),
                    ...(room ? {} : { waiting: true }),
                  },
                  actorId: instance.systemId,
                })
                return room
              }),
            ),
          // A conflict put to the lead: the work of a task under way.
          { order: 'underway' },
        )
        yield* addItem({ projectId: task.projectId, threadId: task.threadId }, 'notice', {
          source: 'runtime',
          severity: 'info',
          title: `${place.change ?? 'It'} conflicts with ${whereLine(conflicts)}${alsoFailed === null ? '' : `, and ${checksFailed(alsoFailed.failing)}`}.`,
          description:
            alsoFailed === null
              ? room
                ? 'The lead is resolving it.'
                : 'The lead resolves it once an agent is free.'
              : room
                ? 'The lead is resolving both.'
                : 'The lead resolves both once an agent is free.',
        })
        yield* touchCard(task.taskId)
        if (room) yield* askLead({ id, ...task }, 1, body)
      })

    /**
     * Every round that waits for a place to ask its lead, with since when,
     * and what asks it once it has one. One whose ask can't be read is left
     * out, and the rest still wait.
     */
    const roundsWaiting = Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<RoundRow>`
          SELECT ${roundColumns(sql)} FROM conflict_resolutions c JOIN threads t ON t.task_id = c.task_id AND t.kind = 'task'
          JOIN tasks k ON k.id = c.task_id JOIN projects p ON p.id = c.project_id
          WHERE c.state = 'resolving' AND c.waiting IS NOT NULL AND k.state = 'open' AND p.archived_at IS NULL`
      const waiting = yield* Effect.forEach(rows, (round) =>
        decodeWaiting(round.waiting ?? '').pipe(
          Effect.map((waited) => [
            {
              taskId: round.taskId,
              order: 'underway' as const,
              since: waited.since,
              start: provide(locked(round.taskId)(askWaiting(round.id))),
            },
          ]),
          contained('Changes.roundsWaiting', () => []),
        ),
      )
      return waiting.flat()
    })

    /** A round that waited for a place, asked of its lead now it has one; nothing where it no longer waits, as one the person stopped. */
    const askWaiting = (id: string) =>
      Effect.gen(function* () {
        const round = yield* roundOf({ id })
        if (round === undefined || round.state !== 'resolving' || round.waiting === null) return
        const waited = yield* decodeWaiting(round.waiting)
        yield* askLead(round, waited.attempt, waited.body, waited.why)
      })

    /** Changes a round's record, with its fact. */
    const reviseRound = (
      round: { readonly id: string; readonly projectId: ProjectId; readonly taskId: string },
      type: string,
      set: Readonly<Record<string, unknown>>,
      payload: Readonly<Record<string, unknown>> = {},
    ) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.withTransaction(
          Effect.gen(function* () {
            const revision = yield* change('conflict_resolutions', round.id, { ...set, updatedAt: yield* timestamp })
            yield* fact({
              projectId: round.projectId,
              aggregateType: 'conflict_resolution',
              aggregateId: round.id,
              revision,
              type,
              payload,
              actorId: instance.systemId,
            })
          }),
        )
        yield* touchCard(round.taskId)
      })

    /** A round over: resolved, with where its branches are, and what the thread says of it. */
    const endRound = (
      round: RoundRow,
      ended: Ended | null,
      notice: { readonly severity?: 'info' | 'warning'; readonly title: string; readonly description?: string } | null,
      payload: Readonly<Record<string, unknown>> = {},
    ) =>
      Effect.gen(function* () {
        yield* reviseRound(
          round,
          'conflict_resolution.resolved',
          { state: 'resolved', ...(ended === null ? {} : { ended: JSON.stringify(ended) }), settledAt: yield* timestamp },
          payload,
        )
        if (notice !== null)
          yield* addItem({ projectId: round.projectId, threadId: round.threadId }, 'notice', {
            source: 'runtime',
            severity: notice.severity ?? 'info',
            title: notice.title,
            ...(notice.description === undefined ? {} : { description: notice.description }),
          })
      })

    /**
     * Looks at a round once the lead's turn on it is over. Resolving the
     * conflict, it is resolved or not; fixing the checks that failed on what
     * Althar pushed, a fix is committed on top of it or not. Done, it goes
     * on (`resolved`, `fixed`), unless its lead was stopped, when it waits
     * for the person; not, the lead is asked once more with why, unless it
     * was stopped or has been asked enough, and then it is the person's.
     */
    const settleRound = (
      id: string,
      how: { readonly why?: string; readonly stopped?: boolean } = {},
    ): Effect.Effect<void, unknown, Store> =>
      Effect.gen(function* () {
        const round = yield* roundOf({ id })
        if (round === undefined || round.state !== 'resolving') return
        const conflicts = yield* decodeConflicts(round.conflicts)
        const worktrees = yield* worktreesOf(round.taskId)
        const several = conflicts.length > 1
        const failures: Array<string> = []
        // Where all that is left is to commit the merge.
        const uncommitted: Array<Conflict> = []
        for (const conflict of conflicts) {
          const worktree = worktrees.get(conflict.repository)
          // Git failing in one repository is why that one isn't resolved: the round is still settled.
          const left =
            worktree === undefined || !existsSync(worktree)
              ? { why: 'Its worktree is gone.', uncommitted: false }
              : yield* unresolved(worktree, conflict).pipe(
                  contained('Changes.settleRound', (cause) => ({
                    why: `Althar couldn’t read its worktree: ${gitSaidOf(cause)}`,
                    uncommitted: false,
                  })),
                )
          if (left === null) continue
          failures.push(several ? `${conflict.name}: ${left.why}` : left.why)
          if (left.uncommitted) uncommitted.push(conflict)
        }
        const ended = yield* endedOf(round.taskId, conflicts)
        // Asked to fix the checks on what Althar pushed: what it pushed is where a fix goes on top.
        const fixing = round.pushedHead
        if (fixing !== null && failures.length === 0 && ended.every((one) => one.head === fixing))
          failures.push('Nothing was committed to fix them.')
        const place = yield* placeOf(round.taskId, round.url)
        const thread = { projectId: round.projectId, threadId: round.threadId }
        if (failures.length === 0) {
          // Its lead stopped, what it did is the person's to look at: nothing is pushed for it.
          if (how.stopped === true && round.url !== null)
            return yield* endRound(round, ended, {
              title:
                fixing === null
                  ? `The lead resolved the conflict with ${whereLine(conflicts)}.`
                  : 'The lead fixed the checks on the merge.',
              description: `Not pushed to ${changeOf(place)}.`,
            })
          return yield* fixing === null ? resolved(round, conflicts, ended, place) : fixed(round, fixing, ended, place)
        }
        const failure = [...(how.why === undefined ? [] : [how.why]), ...failures].join(' ')
        const what = fixing === null ? `the conflict with ${whereLine(conflicts)}` : `the checks on the merge`
        // A fix for the checks is the lead's one more try already: only resolving the conflict is asked again.
        if (fixing === null && how.why === undefined && round.attempt < ATTEMPTS) {
          yield* addItem(thread, 'notice', {
            source: 'runtime',
            severity: 'info',
            title: `The conflict with ${whereLine(conflicts)} isn’t resolved yet: ${failure}`,
            description: 'The lead is trying once more.',
          })
          // Asked to commit it where that is all that was left, not to resolve it again.
          const note = noteFor(conflicts, place, failure, uncommitted.length === failures.length ? uncommitted : [])
          return yield* askLead(round, round.attempt + 1, note, { failure })
        }
        yield* reviseRound(
          round,
          'conflict_resolution.failed',
          { state: 'failed', failure, ended: JSON.stringify(ended), settledAt: yield* timestamp },
          { failure },
        )
        yield* addItem(thread, 'notice', {
          source: 'runtime',
          severity: 'warning',
          title: `The lead couldn’t ${fixing === null ? 'resolve' : 'fix'} ${what}.`,
          description: failure,
        })
      })

    /**
     * Pushes what a round has, up to `head`, to its pull request: then the
     * round waits for the checks on it. Where it can't, the round is over,
     * and the person pushes it from the card.
     */
    const pushRound = (
      round: RoundRow,
      url: string,
      head: string,
      ended: Ended,
      said: string,
      what: 'the merge' | 'the merge and its fix' | 'the fix',
      place: Place,
    ) =>
      Effect.gen(function* () {
        const pushed = yield* Effect.exit(push(round.taskId, head, url))
        if (pushed._tag === 'Failure') {
          // In the words the task's Push card would have for it.
          const failed = Option.getOrUndefined(Cause.findErrorOption(pushed.cause))
          const why = failed === undefined ? 'The push failed.' : words(failed, (agentId) => agentId).message
          return yield* endRound(round, ended, {
            severity: 'warning',
            title: `${said}, but Althar couldn’t push ${what}.`,
            description: `${why} Push it from ${changeOf(place)}’s card.`,
          })
        }
        const headSha = pushed.value.change.headSha
        yield* reviseRound(
          round,
          'conflict_resolution.pushed',
          { state: 'checking', pushedHead: headSha, ended: JSON.stringify(ended) },
          { head: headSha },
        )
        yield* addItem({ projectId: round.projectId, threadId: round.threadId }, 'notice', {
          source: 'runtime',
          severity: 'info',
          title: `${said}, and pushed ${what} to ${changeOf(place)}.`,
        })
      })

    /** Where a round on a pull request left its one repository's branch here: its worktree, and the commit it is at; none where it is gone. */
    const branchHere = (taskId: string, ended: Ended) =>
      Effect.gen(function* () {
        const worktrees = yield* worktreesOf(taskId)
        const [here] = ended.flatMap((one) => {
          const worktree = worktrees.get(one.repository)
          return worktree === undefined ? [] : [{ worktree, head: one.head }]
        })
        return here
      })

    /**
     * A conflict resolved. Merging here, the person merges again. On a pull
     * request, Althar pushes the merge itself: the one push of a lead's
     * commits that isn't the person's (ADR-030). Only where the pull request
     * had the branch as it was when the lead was asked, the commits since are
     * the merge alone, up to the head it settled at, and nothing else asked
     * the lead meanwhile; otherwise the merge waits for the person to push
     * it with the rest.
     */
    const resolved = (round: RoundRow, conflicts: ReadonlyArray<Conflict>, ended: Ended, place: Place) =>
      Effect.gen(function* () {
        const said = `The lead resolved the conflict with ${whereLine(conflicts)}`
        const [conflict] = conflicts
        const branch = yield* branchHere(round.taskId, ended)
        if (round.url === null || conflict === undefined || branch === undefined)
          return yield* endRound(round, ended, { title: `${said}.`, description: 'Merge it again.' })
        const { worktree, head } = branch
        const others = yield* askedSince(round)
        const made =
          !others && conflict.pushed != null && conflict.pushed === conflict.from
            ? yield* onlyTheResolution(worktree, conflict, head).pipe(Effect.orElseSucceed(() => null))
            : null
        const alone = made !== null && (yield* commitOf(worktree, 'HEAD').pipe(Effect.orElseSucceed(() => ''))) === head
        if (!alone)
          return yield* endRound(round, ended, {
            title: `${said}.`,
            description: `Not pushed to ${changeOf(place)}.`,
          })
        yield* pushRound(round, round.url, head, ended, said, made === 'merge and fix' ? 'the merge and its fix' : 'the merge', place)
      })

    /**
     * The checks that failed on what Althar pushed, fixed: pushed in turn,
     * where the branch has one commit on top of it, the fix, and nothing
     * else asked the lead meanwhile; otherwise the round is over, and the
     * fix waits for the person's push, as any does.
     */
    const fixed = (round: RoundRow, base: string, ended: Ended, place: Place) =>
      Effect.gen(function* () {
        const said = 'The lead fixed the checks on the merge'
        const branch = yield* branchHere(round.taskId, ended)
        const others = yield* askedSince(round)
        const fixes =
          !others && branch !== undefined && (yield* onlyTheFix(branch.worktree, base, branch.head).pipe(Effect.orElseSucceed(() => false)))
        if (!fixes || branch === undefined || round.url === null)
          return yield* endRound(round, ended, {
            title: `${said}.`,
            description: `Not pushed to ${changeOf(place)}.`,
          })
        yield* pushRound(round, round.url, branch.head, ended, said, 'the fix', place)
      })

    /**
     * Where a pull request's target branch is, fetched into the task's
     * workspace at most every few turns, unless `fresh`: the worktrees of a
     * repository share what one fetched. Where it couldn't be fetched, git's
     * failure, which its caller puts in words.
     */
    /** Where the branch a fork's pull request goes into is fetched, where none of its clone's remotes has its parent. */
    const PARENT_FETCHED = 'refs/althar/parent/'

    const baseOf = (
      workspace: { readonly path: string; readonly binding: string },
      host: CodeHost,
      repository: Repository,
      branch: string,
      ref: string,
      fresh: boolean,
    ) =>
      Effect.gen(function* () {
        const key = `${workspace.binding}:${ref}`
        const at = yield* Clock.currentTimeMillis
        const known = fetchedAt.get(key)
        if (!fresh && known !== undefined && at - known.at < baseEvery) return known.tip
        const tip = yield* fetchedInto(
          workspace.path,
          yield* host.pushTarget(repository),
          branch,
          ref.startsWith('refs/') ? ref : `refs/remotes/${ref}`,
        )
        fetchedAt.set(key, { at, tip })
        return tip
      })

    /**
     * Whether an open pull request conflicts with the branch it goes into,
     * worked out here rather than taken from its host, which works it out
     * lazily, says nothing until it has, and needn't say again when only
     * that branch moved: the branch is fetched, at most every few turns
     * unless `fresh` or the host says it conflicts, and merged with the
     * task's branch here without anything moving. Where it conflicts and
     * the lead is to resolve it, the lead is asked; where not, why not is
     * logged and kept for its card. One that merges cleanly here is from
     * before the branch moved, or merged here already and waiting for the
     * person to push. A round waiting on the checks of the merge it pushed
     * is looked past: what it merged moved on and conflicting again, it is
     * over, and the new conflict a round of its own. Checks that failed on
     * the pull request as it is, its lead's to see through (ADR-070), go in
     * the same ask, `failed` where they were just heard, so the lead is
     * asked once for both. Whether a round began.
     */
    const lookAt = (
      link: LinkRow,
      seen: Snapshot,
      now: { readonly target: string; readonly conflicts?: boolean | null | undefined; readonly headSha: string | null },
      host: CodeHost,
      repository: Repository,
      how: { readonly force: boolean; readonly fresh: boolean; readonly sweep?: boolean },
      failed: FailedChecks | null = null,
    ): Effect.Effect<boolean, unknown, Store> =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        // Held for Ship, a conflict waits for it: what the person tried goes up first, and the look after brings the target in.
        if ((yield* worktreeOf(link.taskId, seen.url))?.heldAt != null) return false
        const first = yield* askable(link.taskId, seen.url, { force: how.force })
        if (first === 'off') return pressed.has(link.taskId) ? false : yield* Effect.as(forgetUnsent(link.taskId), false)
        if (first === 'resolving') return false
        // Turned off, nothing is merged here for it: where its host says it conflicts, its card says why it waits for the person.
        if (typeof first === 'object' && first.off === true)
          return now.conflicts === true
            ? yield* Effect.as(notSent(link.taskId, first.why), false)
            : pressed.has(link.taskId)
              ? false
              : yield* Effect.as(forgetUnsent(link.taskId), false)
        const says = now.conflicts === true
        // Where it can't be looked at here, that is said whatever its host says: a host saying it merges cleanly may be out of date.
        // A round waiting on the checks of its merge is under way all the same: it goes on, not the person's. Looked at, what it
        // merged having moved on and conflicting again overtakes it, its host silent or not.
        const couldnt = (why: string) => (first === 'checking' ? Effect.void : notSent(link.taskId, why, true, says))
        const [workspace] = yield* sql<{ path: string; binding: string; slug: string; name: string; threadId: string }>`
            SELECT w.path, b.id AS binding, b.slug, b.display_name AS name, t.id AS thread_id FROM workspaces w
            JOIN repository_bindings b ON b.id = w.binding_id JOIN threads t ON t.task_id = w.task_id AND t.kind = 'task'
            WHERE w.task_id = ${link.taskId} AND w.device_id = ${instance.deviceId} AND w.access = 'write' AND w.state <> 'cleaned'
            ORDER BY w.id = (SELECT c.workspace_id FROM repository_changes c WHERE c.pull_request_url = ${seen.url} LIMIT 1) DESC,
              b.created_at, b.rowid
            LIMIT 1`
        // Without its folder here, nothing can be merged: the card says why nothing happens.
        if (workspace === undefined)
          return yield* Effect.as(couldnt(`Its folder isn’t on this computer, so Althar can’t merge ${now.target} into it here.`), false)
        // Into the repository a fork came from, its branch is that remote's, by whatever name the clone has it; otherwise origin's,
        // as `git fetch` names them. A parent among none of the clone's remotes has its branch fetched beside them, never into
        // origin's, which is the fork's.
        const fork = yield* namedRemotes(workspace.path).pipe(
          Effect.map((remotes) => forkOf(remotes)),
          Effect.orElseSucceed(() => null),
        )
        const remote =
          fork !== null && repository.path.join('/').toLowerCase() === fork.upstream.path.join('/').toLowerCase()
            ? fork.upstream.remote
            : 'origin'
        const ref = remote === null ? `${PARENT_FETCHED}${now.target}` : `${remote}/${now.target}`
        // Where either can't be had, the card says what git said, and the log keeps all of it.
        const fetched = yield* baseOf(workspace, host, repository, now.target, ref, how.fresh || says).pipe(
          Effect.map((tip) => ({ tip })),
          Effect.catchTag('GitFailed', (failed) => Effect.succeed({ failed })),
        )
        if ('failed' in fetched) {
          yield* Effect.logWarning('Could not fetch the branch a pull request goes into', Cause.fail(fetched.failed))
          return yield* Effect.as(couldnt(couldntFetch(now.target, fetched.failed)), false)
        }
        const target = fetched.tip
        const read = yield* commitOf(workspace.path, 'HEAD').pipe(Effect.result)
        if (Result.isFailure(read)) {
          yield* Effect.logWarning('Could not read the branch a pull request comes from', Cause.fail(read.failure))
          return yield* Effect.as(couldnt(couldntRead(read.failure)), false)
        }
        const from = read.success
        const merged = yield* gitOutcome(workspace.path, 'merge-tree', '--write-tree', '--name-only', '--no-messages', target, from)
        if (merged.code === 0) {
          const was = cleanHere.get(link.id)
          cleanHere.set(link.id, { head: now.headSha, hostSaid: says })
          if (was?.head !== now.headSha || was.hostSaid !== says) yield* touchTask(link.taskId)
          return yield* Effect.as(forgetUnsent(link.taskId), false)
        }
        cleanHere.delete(link.id)
        // 1 is git's word for a merge that conflicts; anything else, one it couldn't work out.
        if (merged.code !== 1) return yield* Effect.as(couldnt(`Git couldn’t merge ${now.target} with the branch here.`), false)
        // Found by the sweep, which doesn't ask the host, it goes to a poll of the pull request first: that hears its checks too,
        // so checks that failed meanwhile are asked of the lead with it, once, not after it as the round's. Not taken up there by
        // the next sweep, the poll couldn't ask, and it is asked from here; it is forgotten once a round begins.
        const found = `${target}:${from}`
        if (how.sweep === true && sweptConflicts.get(link.id) !== found) {
          sweptConflicts.set(link.id, found)
          dependencies.wakeNow(link.taskId)
          return false
        }
        if (!(yield* sayingWhy(link.taskId, yield* askable(link.taskId, seen.url, { force: how.force, targets: [target] })))) return false
        // The round that waited on the checks of its merge is overtaken: what it merged moved on, and its checks are no longer
        // what counts.
        if (first === 'checking') yield* overtaken(link.taskId, seen.url)
        const [sent] = yield* sql<{ head: string | null }>`
            SELECT head_commit AS head FROM repository_changes WHERE pull_request_url = ${seen.url} AND project_id = ${link.projectId} LIMIT 1`
        sweptConflicts.delete(link.id)
        yield* beginRound(
          { projectId: link.projectId, taskId: link.taskId, threadId: workspace.threadId },
          seen.url,
          [
            {
              repository: workspace.slug,
              name: workspace.name,
              branch: now.target,
              ref,
              target,
              from,
              pushed: now.headSha ?? sent?.head ?? null,
              files: merged.stdout
                .split('\n')
                .slice(1)
                .filter((line) => line !== ''),
            },
          ],
          failed ?? (yield* failedOn(link, host, repository)),
        )
        return true
      })

    /**
     * The checks that failed on a pull request as Althar last saw it, its
     * head's, where they are its lead's to see through (ADR-070): not
     * those the person took over, brought to them, or out of tries. Which,
     * and the ends of their logs where the host still gives them.
     */
    const failedOn = (link: LinkRow, host: CodeHost, repository: Repository) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [row] = yield* sql<{ snapshot: string }>`SELECT snapshot FROM external_links WHERE id = ${link.id}`
        const snapshot = row === undefined ? null : yield* decodeSnapshot(row.snapshot)
        const checks = snapshot?.checks
        if (snapshot === null || checks == null || checks.sha !== snapshot.headSha || checks.outcome !== 'failed') return null
        if ((yield* fixingOn(link))?.open !== true) return null
        // The ends of their logs, as the lead is told failed checks: read again, the host keeping them; none where it can't.
        const failed = yield* host.checks(repository, checks.sha).pipe(
          Effect.map((all) => all.filter((candidate) => candidate.state === 'failed').slice(0, LOGS_TO_LEAD)),
          Effect.orElseSucceed(() => []),
        )
        const logs = yield* Effect.forEach(failed, (check) =>
          Effect.map(readLog(host, repository, check), logForLead).pipe(Effect.orElseSucceed(() => null)),
        )
        return {
          failing: checks.failing,
          logs: logs.filter((log): log is NonNullable<typeof log> => log !== null),
        } satisfies FailedChecks
      })

    /** A round waiting on the checks of the merge it pushed, over: what it merged moved on, and conflicts again. */
    const overtaken = (taskId: string, url: string) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [waiting] = yield* sql<{ id: string }>`
            SELECT id FROM conflict_resolutions WHERE task_id = ${taskId} AND pull_request_url = ${url} AND state = 'checking' LIMIT 1`
        const round = waiting === undefined ? undefined : yield* roundOf({ id: waiting.id })
        if (round !== undefined) yield* endRound(round, null, null, { overtaken: true })
      })

    /**
     * What the pull request's checks say of what Althar pushed for a round.
     * Passed, or none once they have had time to start, the round is
     * resolved. Failed, the lead is asked to fix them within the round,
     * rather than as failed checks always reach it, and its fix is pushed
     * in turn; once it has been asked enough, the round is the person's.
     * The pull request settled, or moved on past what Althar pushed, ends
     * the round, and what comes after is as ever. Whether the round took
     * the failure, so it isn't told the lead twice.
     */
    const checked = (
      link: LinkRow,
      url: string,
      now: ChangeRequest,
      host: CodeHost,
      repository: Repository,
      /** The checks on its head as this look at the pull request read them, so both go by the same reading. */
      read: ReadonlyArray<Check> | null = null,
    ) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [waiting] = yield* sql<{ id: string }>`
            SELECT id FROM conflict_resolutions WHERE task_id = ${link.taskId} AND pull_request_url = ${url} AND state = 'checking' LIMIT 1`
        const round = waiting === undefined ? undefined : yield* roundOf({ id: waiting.id })
        if (round === undefined || round.pushedHead === null) return false
        const pushedHead = round.pushedHead
        const conflicts = yield* decodeConflicts(round.conflicts)
        const worktrees = yield* worktreesOf(round.taskId)
        const worktree = conflicts.map((conflict) => worktrees.get(conflict.repository)).find((path) => path !== undefined)
        if (now.state !== 'open' || now.headSha === null) return yield* Effect.as(endRound(round, null, null), false)
        if (now.headSha !== pushedHead) {
          // The host may not have read the push yet: what it had before is behind what was pushed.
          const behind =
            worktree !== undefined && (yield* gitOutcome(worktree, 'merge-base', '--is-ancestor', now.headSha, pushedHead)).code === 0
          return behind ? false : yield* Effect.as(endRound(round, null, null), false)
        }
        const place = yield* placeOf(round.taskId, url)
        const where = changeOf(place)
        const all =
          read ??
          (yield* host.checks(repository, now.headSha).pipe(
            Effect.catchIf(
              (error) => error.reason === 'forbidden' || error.reason === 'not_found',
              () => Effect.succeed(null),
            ),
          ))
        // Checks it can't read, or that run too long, Althar can't see through (ADR-041): the round ends, and they are the person's.
        if (all === null) {
          yield* heard(link, 'checks_unreadable', `unreadable:${now.headSha}`, { message: 'Not readable.' })
          yield* taken(round.taskId, 'unreadable')
          return yield* Effect.as(
            endRound(round, null, { severity: 'warning', title: `Can't read the checks on what was pushed to ${where}.` }),
            false,
          )
        }
        const sum = checksOf(now.headSha, all)
        if (sum.outcome === 'running') {
          const ran = (yield* Clock.currentTimeMillis) - Date.parse(round.updatedAt)
          if (ran < Duration.toMillis(stuckAfter)) return false
          yield* heard(link, 'checks_stuck', `stuck:${sum.sha}`, { sha: sum.sha })
          yield* taken(round.taskId, 'stuck')
          return yield* Effect.as(
            endRound(round, null, {
              severity: 'warning',
              title: `The checks on what was pushed to ${where} are still running after ${spanOf(ran)}.`,
            }),
            false,
          )
        }
        if (sum.outcome === 'none') {
          const since = (yield* Clock.currentTimeMillis) - Date.parse(round.updatedAt)
          if (since < Duration.toMillis(NO_CHECKS_AFTER)) return false
          return yield* Effect.as(
            endRound(round, null, { title: `No checks ran on what was pushed to ${where}.`, description: 'Ready to merge.' }),
            false,
          )
        }
        if (sum.outcome === 'passed')
          return yield* Effect.as(endRound(round, null, { title: `The checks passed on ${where}.`, description: 'Ready to merge.' }), false)
        if (sum.failed === 0) {
          // Cancellation blocks the merge, but gives the lead no code failure to fix. As outside a conflict round,
          // retry the cancelled jobs once, then leave them to the person without spending a code-fix attempt.
          const reran = yield* ranAgain(link, sum.sha)
          const cancelled = all.filter((check) => check.state === 'cancelled')
          if (reran === null) {
            const again = (yield* Effect.forEach(cancelled, (check) =>
              host.rerun(repository, check).pipe(Effect.orElseSucceed(() => false)),
            )).some(Boolean)
            if (again) {
              yield* heard(link, 'checks_rerun', `rerun:${sum.sha}`, { sha: sum.sha, cancelled: true })
              yield* sayOn(
                link,
                `Running ${cancelled.length === 1 ? 'a cancelled check' : `${cancelled.length} cancelled checks`} on ${where} again.`,
              )
              return true
            }
          } else if (!reran.started && (yield* Clock.currentTimeMillis) - Date.parse(reran.at) <= Duration.toMillis(RERUN_SHOWS))
            return true
          return yield* Effect.as(
            endRound(round, null, {
              severity: 'warning',
              title: `The checks on ${where} were cancelled.`,
              description: 'Run them again on the host before merging.',
            }),
            false,
          )
        }
        // Failed. The lead committed something else since: the fix goes with it, for the person to push, as failed checks always do.
        const head = worktree === undefined ? '' : yield* commitOf(worktree, 'HEAD').pipe(Effect.orElseSucceed(() => ''))
        if (head !== pushedHead) return yield* Effect.as(endRound(round, null, null, { failing: sum.failing }), false)
        // One may have failed by chance: run again once, as failed checks always are (ADR-041), before the lead is asked, and
        // heard again once the host shows it running, or a while after.
        const reran = yield* ranAgain(link, sum.sha)
        if (reran === null) {
          const failedChecks = all.filter((candidate) => candidate.state === 'failed')
          const again = (yield* Effect.forEach(failedChecks, (check) =>
            host.rerun(repository, check).pipe(Effect.orElseSucceed(() => false)),
          )).some(Boolean)
          if (again) {
            yield* heard(link, 'checks_rerun', `rerun:${sum.sha}`, { sha: sum.sha })
            yield* sayOn(
              link,
              `Running ${sum.failing.length === 1 ? 'a failed check' : `${sum.failing.length} failed checks`} on ${where} again.`,
            )
            return true
          }
        } else if (!reran.started && (yield* Clock.currentTimeMillis) - Date.parse(reran.at) <= Duration.toMillis(RERUN_SHOWS)) return true
        const ended = yield* endedOf(round.taskId, conflicts)
        const thread = { projectId: round.projectId, threadId: round.threadId }
        // Asked enough within the round, or the change's tries at its checks spent across rounds (FIX_ROUNDS): the person's.
        if (round.attempt >= ATTEMPTS || (yield* fixingOn(link))?.given === true) {
          const failure = `The checks failed on it: ${sum.failing.join(', ')}.`
          yield* reviseRound(
            round,
            'conflict_resolution.failed',
            { state: 'failed', failure, ended: JSON.stringify(ended), settledAt: yield* timestamp },
            { failure },
          )
          // Theirs now, as checks its lead brought to them are: this failure, heard again, doesn't wake the lead (`fixesOf`).
          yield* heard(link, 'checks_handed', `handed:${sum.sha}:${yield* timestamp}`, { sha: sum.sha, why: failure })
          yield* addItem(thread, 'notice', {
            source: 'runtime',
            severity: 'warning',
            title: `${checksFailed(sum.failing)} on ${where}.`,
          })
          return true
        }
        // A task stopped or settled meanwhile isn't its lead's to go on with: the failure goes as failed checks always do.
        const [task] = yield* sql<{ state: string; run: string | null }>`
            SELECT k.state, (SELECT state FROM runs WHERE task_id = k.id ORDER BY created_at DESC, rowid DESC LIMIT 1) AS run
            FROM tasks k WHERE k.id = ${round.taskId}`
        if (task?.state !== 'open' || task.run !== 'succeeded')
          return yield* Effect.as(endRound(round, null, null, { failing: sum.failing }), false)
        const logs = yield* Effect.forEach(all.filter((candidate) => candidate.state === 'failed').slice(0, LOGS_TO_LEAD), (check) =>
          Effect.map(readLog(host, repository, check), logForLead),
        )
        // The lead takes a place among the agents at work on this machine to fix them, or the round keeps its ask and waits for one.
        const body = fixNoteFor(place, { failing: sum.failing, logs })
        const why = { failing: sum.failing }
        const room = yield* busy.enter(
          round.taskId,
          (room) =>
            Effect.gen(function* () {
              const since = yield* timestamp
              const waiting = room
                ? {}
                : { waiting: JSON.stringify({ attempt: round.attempt + 1, body, why, since } satisfies RoundWaiting) }
              yield* reviseRound(round, 'conflict_resolution.checks_failed', { state: 'resolving', ...waiting }, why)
              return room
            }),
          // Checks to fix: the work of a task under way.
          { order: 'underway' },
        )
        yield* addItem(thread, 'notice', {
          source: 'runtime',
          severity: 'info',
          title: `${checksFailed(sum.failing)} on ${where}.`,
          description: room ? 'The lead is fixing them.' : 'The lead fixes them once an agent is free.',
        })
        if (room) yield* askLead(round, round.attempt + 1, body, why)
        return true
      })

    /**
     * A round on a pull request Althar no longer listens to: the person's,
     * since nothing it does there is heard. Resolving, what the lead does
     * waits for them; waiting for checks, the checks do.
     */
    const unfollowed = (id: string) =>
      Effect.gen(function* () {
        const round = yield* roundOf({ id })
        if (round === undefined || (round.state !== 'resolving' && round.state !== 'checking')) return
        const where = changeOf(yield* placeOf(round.taskId, round.url))
        if (round.state === 'checking') return yield* endRound(round, null, { title: `No longer following the checks on ${where}.` })
        const conflicts = yield* decodeConflicts(round.conflicts)
        const failure = `Althar stopped listening to ${where}.`
        yield* reviseRound(
          round,
          'conflict_resolution.failed',
          { state: 'failed', failure, ended: JSON.stringify(yield* endedOf(round.taskId, conflicts)), settledAt: yield* timestamp },
          { failure },
        )
        yield* addItem({ projectId: round.projectId, threadId: round.threadId }, 'notice', {
          source: 'runtime',
          severity: 'info',
          title: `No longer following the conflict on ${where}.`,
        })
      })

    /**
     * The person took the task's change into their own hands: they stopped
     * its lead, or pushed to it. It is no longer in Althar's (ADR-040): each
     * of its pull requests says so, for `handsOf` to read.
     */
    const taken = (taskId: string, how: 'stopped' | 'interrupted' | 'pushed' | 'stuck' | 'unreadable') =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const at = yield* timestamp
        for (const link of yield* sql<{ id: string; projectId: string }>`
            SELECT id, project_id FROM external_links WHERE task_id = ${taskId} AND kind = 'change'`)
          yield* sql`INSERT OR IGNORE INTO observations ${sql.insert({
            id: yield* newId(Ids.observation),
            projectId: link.projectId,
            subjectType: 'external_link',
            subjectId: link.id,
            kind: 'taken',
            payload: JSON.stringify({ id: `taken:${at}`, how }),
            source: 'althar',
            observedAt: at,
          })}`
      })

    /**
     * The person stopped or interrupted a task's lead, which `taken` recorded as they did: what it was resolving waits for
     * them, and the checks of a round waiting on them are theirs.
     */
    const stoppedRounds = (taskId: string, how: 'stopped' | 'interrupted') =>
      Effect.gen(function* () {
        for (const round of yield* underWay(taskId)) {
          if (round.state === 'resolving') {
            yield* settleRound(round.id, { why: `You ${how} the lead.`, stopped: true })
            continue
          }
          const place = changeOf(yield* placeOf(round.taskId, round.url))
          yield* endRound(round, null, {
            title: `You ${how} the lead. The checks on ${place} are yours.`,
          })
        }
      })

    /*
     * Rounds waiting for a lead that ended its turn but is still at work,
     * by id: so one is waited for once, though its thread says more meanwhile.
     */
    const holding = new Set<string>()

    const busyUpTo = (yield* RuntimeConfig).idle?.within ?? BUSY_UP_TO

    const reportsWithin = (yield* RuntimeConfig).idle?.reports ?? REPORT_FOR

    /**
     * When the lead's turn ends on a round, or its session goes, the round
     * is looked at: not while more waits for it on the thread, which comes
     * in the next turn, nor while it asks the person something. A turn the
     * person interrupted is theirs to carry on. Nor while the lead is still
     * at work: it left a command running, such as the full tests, and is
     * woken when it ends, or is in a turn of its own after (`Sessions.busy`).
     * The round is looked at once it is done, or after BUSY_UP_TO, as it
     * is: a lead that doesn't finish isn't waited for for ever.
     */
    const look = (event: LiveEvent, waited: boolean): Effect.Effect<void, unknown, Store> =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        if (event._tag !== 'TurnEnded' && event._tag !== 'SessionEnded') return
        if (event._tag === 'TurnEnded' && (event.state === 'interrupted' || event.errorClass === 'usage_limit')) return
        if (event._tag === 'SessionEnded' && event.state === 'superseded') return
        const round = yield* roundOf({ threadId: event.threadId })
        if (round === undefined) return
        const running = yield* sessions.running(event.threadId)
        if (event._tag === 'SessionEnded' && Option.isSome(running)) return
        if (event._tag === 'TurnEnded') {
          const [queued] = yield* sql<{ id: string }>`
              SELECT id FROM user_inputs WHERE thread_id = ${event.threadId} AND state = 'queued' LIMIT 1`
          if (queued !== undefined) return
          // A turn of a session another agent has taken over from is that session's last.
          const [turn] = yield* sql<{ sessionId: string | null }>`
              SELECT provider_session_id AS session_id FROM turn_deliveries WHERE id = ${event.turnId}`
          if (Option.isSome(running) && turn?.sessionId != null && running.value.sessionId !== turn.sessionId) return
        }
        const [asking] = yield* sql<{ id: string }>`
            SELECT id FROM attention_requests WHERE task_id = ${round.taskId} AND kind = 'question' AND state = 'open' LIMIT 1`
        if (asking !== undefined) return
        // Not at once: a lead may report what it left running just after its turn (`REPORT_FOR`).
        if (event._tag === 'TurnEnded' && !waited) return yield* hold(round.id, event)
        // Stopped by the person, it is theirs: it isn't started again to try once more.
        const stopped = event._tag === 'SessionEnded' && event.state === 'completed'
        yield* locked(round.taskId)(
          settleRound(round.id, stopped ? { why: 'The lead was stopped before it resolved it.', stopped: true } : {}),
        )
      })

    /**
     * A round an earlier launch left with its lead at work. Resolved by
     * then, it is settled so; still conflicting, its lead is asked again
     * once it has a place, rather than the round handed to the person for
     * Althar's own stop. One fixing the checks on what Althar pushed, or
     * whose worktree is gone, is settled as it stands.
     */
    const resumeRound = (id: string) =>
      Effect.gen(function* () {
        const round = yield* roundOf({ id })
        if (round === undefined || round.state !== 'resolving') return
        const stopped = STOPPED_MIDWAY
        if (round.pushedHead !== null) return yield* settleRound(id, { why: stopped })
        const conflicts = yield* decodeConflicts(round.conflicts)
        const worktrees = yield* worktreesOf(round.taskId)
        const left = yield* Effect.forEach(conflicts, (conflict) => {
          const worktree = worktrees.get(conflict.repository)
          return worktree === undefined || !existsSync(worktree)
            ? Effect.succeed('gone' as const)
            : unresolved(worktree, conflict).pipe(Effect.orElseSucceed(() => 'gone' as const))
        })
        if (left.includes('gone')) return yield* settleRound(id, { why: stopped })
        if (left.every((one) => one === null)) return yield* settleRound(id)
        const place = yield* placeOf(round.taskId, round.url)
        const waiting: RoundWaiting = {
          attempt: round.attempt,
          body: noteFor(conflicts, place, null),
          why: { restarted: true },
          since: yield* timestamp,
        }
        yield* reviseRound(round, 'conflict_resolution.waiting', { waiting: JSON.stringify(waiting) }, { restarted: true })
        yield* addItem({ projectId: round.projectId, threadId: round.threadId }, 'notice', {
          source: 'runtime',
          severity: 'info',
          title: `Althar quit while the lead was resolving the conflict with ${whereLine(conflicts)}.`,
          description: 'The lead resumes once an agent is free.',
        })
      })

    /**
     * Waits for the lead to be done, apart from the stream of events so
     * that the rounds of other tasks aren't held up, then looks at the
     * round as its turn ending would have: what the thread holds by then
     * is what counts. Its session going meanwhile is looked at when it is.
     */
    const hold = (id: string, event: LiveEvent & { readonly _tag: 'TurnEnded' }) => {
      if (holding.has(id)) return Effect.void
      holding.add(id)
      return Effect.forkIn(
        Effect.sleep(reportsWithin).pipe(
          Effect.andThen(sessions.untilIdle(event.threadId, busyUpTo)),
          Effect.flatMap((done) => (done === 'gone' ? Effect.void : look(event, true))),
          Effect.catchCause((cause) => Effect.logWarning('Could not look at a conflict after the lead was done', cause)),
          Effect.ensuring(Effect.sync(() => holding.delete(id))),
          provide,
        ),
        scope,
      )
    }

    return {
      askable,
      beginRound,
      busyUpTo,
      checked,
      failedOn,
      forgetUnsent,
      look,
      lookAt,
      notSent,
      reportsWithin,
      resumeRound,
      roundsWaiting,
      sayingWhy,
      standingOfRound,
      stoppedRounds,
      taken,
      unfollowed,
    }
  })
