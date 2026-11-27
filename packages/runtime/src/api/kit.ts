import { homedir } from 'node:os'

import { type AccountStatus, type MessageSender, ApiError, type SentFile, type SentImage, type LineComment } from '@althar/contracts'
import { ActorId, type ProjectId } from '@althar/domain'
import { type Database, Ledger } from '@althar/persistence-sqlite'
import { Cause, Clock, Context, type Crypto, Effect, Option, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import type { Account, Accounts } from '../Accounts'
import { Artifacts } from '../Artifacts'
import { FileRefused, NotFound } from '../errors'
import { contained, Failures } from '../Failures'
import { Agents, RuntimeConfig } from '../Config'
import { bringBackThen } from '../bringBack'
import { Folders } from '../Folders'
import { Instance } from '../Instance'
import type { PlanUsage } from '../PlanUsage'
import { Issues } from '../Issues'
import { Limits } from '../Limits'
import type { Models } from '../Models'
import type { ModelFacts } from '../ModelFacts'
import type { Installs } from '../Installs'
import { CurrentClient } from '../ClientContext'
import { Queries } from '../Queries'
import { lagLogged, slowCall } from '../lag'
import { timestamp } from '../records'
import { Setups } from '../Setups'
import * as Runtime from '../Runtime'
import { checkFiles, copyFiles, type InputFile } from '../sentFiles'
import { type InputImage, keepSent } from '../sentImages'
import { SignIns } from '../SignIns'
import { endingOf } from '../signInEnding'
import { expected, words } from '../words'
import { Elsewhere } from '../Elsewhere'
import { openWords } from '../elsewhere/open'

/** The issues a task is made from, each once, in the order given: issue first, then issues. */
export const issuesOf = (issue: string | undefined, issues: ReadonlyArray<string> | undefined): ReadonlyArray<string> => {
  const all = [...(issue === undefined ? [] : [issue]), ...(issues ?? [])].map((one) => one.trim()).filter((one) => one !== '')
  return all.filter((one, index) => all.findIndex((other) => other.toLowerCase() === one.toLowerCase()) === index)
}

/** What the person asked for, as a task they made says it: what they wrote, or, from an issue, which the thread shows, what they added to it. */
export const requestOf = (title: string, description: string | undefined, issue: string | undefined): { readonly request?: string } => {
  const words = issue === undefined ? [title, description ?? ''].filter((part) => part.trim() !== '').join('\n\n') : (description ?? '')
  return words.trim() === '' ? {} : { request: words }
}

/** Authority attached by the host to this connection. */
export const ConnectionSender = Context.Reference<MessageSender>('@althar/runtime/ConnectionSender', {
  defaultValue: () => ({ kind: 'internal' }),
})

/**
 * What every area's handlers share on one connection: who is calling (`sender`, `identity`, `actorId`), how a call
 * answers the window (`api`), how a command is said (`envelope`), and the helpers more than one area uses. Built once a
 * connection, before the areas. Each area reads the services it needs itself: the kit reads only what its own helpers use.
 */
export const apiKit = Effect.gen(function* () {
  const context = yield* Effect.context<Instance | Crypto.Crypto>()
  type QueryServices =
    | SqlClient.SqlClient
    | Database.ReadLane
    | RuntimeConfig
    | Accounts
    | Agents
    | Installs
    | Limits
    | ModelFacts
    | Models
    | PlanUsage
    | SignIns
  const queryContext = yield* Effect.context<QueryServices>()
  const sender = yield* ConnectionSender
  const artifacts = yield* Artifacts
  const queries = yield* Queries
  const folders = yield* Folders
  const signIns = yield* SignIns
  const limits = yield* Limits
  const elsewhere = yield* Elsewhere
  const instance = yield* Instance
  const identity = (yield* CurrentClient) ?? {
    homeId: instance.homeId,
    actorId: instance.personId,
    deviceId: instance.deviceId,
    role: sender.kind,
  }
  const connectionAdmin = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    identity.actorId === instance.personId && (identity.role !== 'socket' || identity.deviceId === instance.deviceId)
      ? effect
      : Effect.fail(
          new ApiError({ reason: 'Forbidden', message: 'Pair and remove devices from a window over SSH, or on the home itself.' }),
        )
  const actorId = yield* Effect.orDie(Schema.decodeUnknownEffect(ActorId)(identity.actorId))
  const sql = yield* SqlClient.SqlClient
  const ledger = yield* Ledger
  // What bringing a task's removed folder back needs (ADR-056).
  const folderStore = yield* Effect.context<SqlClient.SqlClient | Ledger | Instance | Crypto.Crypto>()
  const setups = yield* Setups
  /**
   * A task's folder about to open, or to take files sent to its lead:
   * brought back first, where it was removed to free the disk or deleted by
   * hand, and set up again; then `then`, and the task kept as opened, before
   * anything can remove it again, which holds it back from removal for a day
   * and restarts its wait (ADR-056).
   */
  const holdingFolder = <A, E>(taskId: string, then: Effect.Effect<A, E>) =>
    Effect.gen(function* () {
      const opened = Effect.flatMap(timestamp, (at) => sql`UPDATE tasks SET opened_at = ${at} WHERE id = ${taskId}`)
      const held = bringBackThen(
        taskId,
        actorId,
        Effect.tap(then, () => opened),
      )
      const { back, value } = yield* Effect.provideContext(held, folderStore)
      if (back) yield* setups.begin(taskId)
      return value
    })
  const agents = yield* Agents
  const config = yield* RuntimeConfig
  // The person's home on this computer, where they keep code: what a window on another computer finds folders in.
  const personHome = config.elsewhere?.home ?? homedir()
  const issues = yield* Issues
  /** Where the change feed stands, read before what a snapshot shows, so a client watching from it misses nothing. */
  const cursorNow = Effect.map(
    sql<{ cursor: number }>`SELECT coalesce(max(cursor), 0) AS cursor FROM change_log`,
    ([row]) => row?.cursor ?? 0,
  )
  const envelope = (type: string, payload: unknown, commandId: string) =>
    Effect.provideContext(Runtime.envelope(type, payload, commandId), context)
  const agentName = (agentId: string) => agents.list.find((entry) => entry.definition.id === agentId)?.definition.name ?? agentId
  /** The images sent with a message to a thread, read, checked and kept in the thread's project's store, in order. */
  const keptFor = (threadId: string, images: ReadonlyArray<SentImage>) =>
    Effect.gen(function* () {
      const [thread] = yield* sql<{ projectId: ProjectId }>`SELECT project_id FROM threads WHERE id = ${threadId}`
      if (thread === undefined) return yield* new NotFound({ kind: 'thread', id: threadId })
      return yield* keepSent(thread.projectId, images)
    }).pipe(Effect.provideService(Artifacts, artifacts), Effect.provideService(SqlClient.SqlClient, sql))
  /** What a message's command says of its images: their digests, in order, where it has any; nothing where it has none, as before images. */
  const imagesSaid = (kept: ReadonlyArray<InputImage>) => (kept.length === 0 ? {} : { images: kept.map((image) => image.sha256) })
  /** The files sent with a message to a thread, measured and copied where its agent reads, in order. */
  const filesFor = (threadId: string, files: ReadonlyArray<SentFile> | undefined) =>
    files === undefined || files.length === 0
      ? Effect.succeed([])
      : Effect.gen(function* () {
          const provided = <A, E>(effect: Effect.Effect<A, E, Folders | SqlClient.SqlClient | RuntimeConfig | Instance>) =>
            effect.pipe(
              Effect.provideService(Folders, folders),
              Effect.provideService(SqlClient.SqlClient, sql),
              Effect.provideService(RuntimeConfig, config),
              Effect.provideService(Instance, instance),
            )
          // Checked first: a message refused for its files brings nothing back, and sets nothing up.
          const checked = yield* provided(checkFiles(threadId, files))
          const copied = provided(copyFiles(threadId, checked))
          const [thread] = yield* sql<{ taskId: string | null }>`
              SELECT task_id FROM threads WHERE id = ${threadId} AND kind <> 'coordinator'`
          if (thread?.taskId == null) return yield* copied
          // Its task's folder comes back first, as for its agent starting, and is held for its lead to read them (ADR-056).
          return yield* holdingFolder(thread.taskId, copied).pipe(
            Effect.catchTag('TaskRefused', (refused) =>
              Effect.fail(new FileRefused({ reason: refused.why === 'folder_in_way' ? 'in_way' : 'gone', name: null })),
            ),
          )
        })
  /** What a message's command says of its files: how many, never their names or paths; nothing where it has none. */
  const filesSaid = (kept: ReadonlyArray<InputFile>) => (kept.length === 0 ? {} : { files: kept.length })
  /** A message's comments on the diff, kept with the files as they are now (decisions: desktop-app § Comments on the diff); none where it has none. */
  const commentsFor = (threadId: string, comments: ReadonlyArray<LineComment> | undefined) =>
    comments === undefined || comments.length === 0 ? Effect.succeed([]) : queries.keepLineComments(threadId, comments)
  const commentsSaid = (kept: ReadonlyArray<unknown>) => (kept.length === 0 ? {} : { comments: kept.length })
  const failures = yield* Failures
  /** The call being answered, by the name the RPC server gives its span: `Status`, `ListProjects`. */
  const callName = Effect.currentSpan.pipe(
    Effect.map((span) => span.name.replace(/^RpcServer\./, '')),
    Effect.map((name) => (/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : 'call')),
    Effect.orElseSucceed(() => 'call'),
  )
  /**
   * A call's failure as the window gets it: in words; and, when it isn't
   * the person's to put right, in the log and reported, by the call's name.
   */
  // A window's call is the person's: its git commands start before the background's (spawner.ts). One that takes long
  // says so in a development build's log (lag.ts).
  const timedCall = lagLogged()
    ? <A, E, R>(effect: Effect.Effect<A, E, R>) => slowCall(callName, effect)
    : <A, E, R>(effect: Effect.Effect<A, E, R>) => effect
  /**
   * Refused, in the composer's words, while another process has a conversation brought into the thread open
   * (elsewhere/open.ts): the window puts the message back in the composer, and the person sends it again once it's closed.
   */
  const closedElsewhere = (threadId: string) =>
    Effect.flatMap(elsewhere.openElsewhere(threadId), (open) =>
      open === null ? Effect.void : Effect.fail(new ApiError({ reason: 'OpenElsewhere', why: open, message: openWords(open) })),
    )
  const api = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, ApiError, Exclude<R, QueryServices>> =>
    Effect.provideContext(
      Effect.catchCause(timedCall(effect), (cause) => {
        if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt
        const error = Cause.findErrorOption(cause)
        // Refused by the call itself, in the window's own words already: as it is, and nothing went wrong.
        if (Option.isSome(error) && error.value instanceof ApiError) return Effect.fail(error.value)
        const said = words(Option.getOrUndefined(error), agentName)
        const told =
          Option.isSome(error) && expected.has(said.reason)
            ? Effect.void
            : Effect.andThen(
                Effect.logWarning('A call from the window did not succeed', cause),
                Effect.flatMap(callName, (call) => failures.report(cause, call)),
              )
        return Effect.andThen(told, Effect.fail(new ApiError(said)))
      }),
      queryContext,
    )
  /**
   * A change the person made to what is installed, recorded as their own act under the window's command id (as a
   * rule's revision is): the store's installs.json says what is installed now, the record who changed it and to
   * what. Recording it tells the window's feed that the skill changed.
   */
  const skillAct = (commandId: string, id: string, act: string, payload: Readonly<Record<string, unknown>>) =>
    Effect.gen(function* () {
      const type = `skill.${act}`
      const said = yield* envelope(type, { id, ...payload }, commandId)
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const [last] = yield* sql<{ revision: number | null }>`
              SELECT max(aggregate_revision) AS revision FROM record_events WHERE aggregate_type = 'skill' AND aggregate_id = ${id}`
          yield* ledger.record({
            aggregateType: 'skill',
            aggregateId: id,
            aggregateRevision: (last?.revision ?? 0) + 1,
            type,
            payload,
            actorId: said.actorId,
            commandId: said.commandId,
          })
        }),
      )
    })
  /** The issue a task comes from, read before the task is made, so its key can go in the task's branch. */
  const issueFor = (projectId: string, issue: string | undefined) =>
    issue === undefined ? Effect.succeed(undefined) : issues.read(issue, projectId)
  /* An account as the window shows it: signed in, checked at most once a minute, paid for how, and out until when. One whose check failed shows as unknown; the others are shown as they are. */
  const accountStatus = (account: Account, recheck: boolean) =>
    Effect.gen(function* () {
      const check = yield* signIns.account(account, recheck)
      const out = yield* limits.outAccount(account.id)
      const providers = yield* signIns.providers(account, check)
      const ending = endingOf(check.endsAt, yield* Clock.currentTimeMillis)
      return {
        id: account.id,
        name: account.name,
        home: account.home,
        signIn: check.status,
        paidBy: check.paidBy,
        outUntil: Option.getOrNull(Option.map(out, (each) => each.until)),
        adoptedFrom: account.adoptedFrom,
        ...(account.signInHost === undefined ? {} : { signInHost: account.signInHost }),
        ...(check.endsAt === undefined ? {} : { endsAt: check.endsAt, endsSoon: ending !== undefined && ending !== 'later' }),
        ...(providers === undefined ? {} : { providers }),
      } satisfies AccountStatus
    }).pipe(
      contained(
        'Status.account',
        (): AccountStatus => ({
          id: account.id,
          name: account.name,
          home: account.home,
          signIn: 'unknown',
          paidBy: 'unknown',
          outUntil: null,
          adoptedFrom: account.adoptedFrom,
          ...(account.signInHost === undefined ? {} : { signInHost: account.signInHost }),
        }),
        account.agentId,
      ),
    )
  return {
    sender,
    identity,
    actorId,
    api,
    envelope,
    connectionAdmin,
    holdingFolder,
    personHome,
    cursorNow,
    keptFor,
    imagesSaid,
    filesFor,
    filesSaid,
    commentsFor,
    commentsSaid,
    closedElsewhere,
    skillAct,
    issueFor,
    accountStatus,
  }
})

/** What `apiKit` gives each area's handlers. */
export type ApiKit = Effect.Success<typeof apiKit>
