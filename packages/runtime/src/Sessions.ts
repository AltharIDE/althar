import { dirname, join } from 'node:path'

import { type CommandEnvelope, Ids, newId, type ProjectId } from '@althar/domain'
import { Commands, type CommandIdReused, Ledger, type RevisionConflict, type RowNotFound } from '@althar/persistence-sqlite'
import {
  type AgentConnection,
  type AgentDefinition,
  type AgentExited,
  type AgentRequestFailed,
  type AgentSession,
  connect,
  type ConfigOption,
  type Question,
  type SessionEvent,
  type StopReport,
} from '@althar/provider-adapters'
import { Cause, Context, Crypto, Deferred, Duration, Effect, Exit, Layer, Option, Queue, Schema, Scope, Semaphore, Stream } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { type Account, Accounts } from './Accounts'
import { Artifacts } from './Artifacts'
import { Agents, type AgentEntry, RuntimeConfig } from './Config'
import { type CoordinatorFolder, coordinatorFolder } from './coordinatorFolder'
import { coordinatorNews, type ModelNamer, modelNamer } from './coordinatorNews'
import { dueForHandover, handoverRecord, notesSection, roomFor } from './handover'
import { notesOf } from './notes'
import {
  AlreadyDelivered,
  EffortUnchanged,
  type GitFailed,
  ModelUnchanged,
  NoSession,
  NotFound,
  SessionFailed,
  SessionRunning,
  TaskRefused,
  type UnknownAgent,
} from './errors'
import { Instance } from './Instance'
import { Limits } from './Limits'
import { Live } from './Live'
import type { Models } from './Models'
import type { Policies } from './Policies'
import { moveSession, Permissions, type RequestContext } from './Permissions'
import { Questions } from './Questions'
import { touchCard } from './cards'
import { change, fact, timestamp } from './records'
import { withRole } from './roles'
import { git } from './git'
import { evidenceFolderOf, reviewCopyOf } from './reviewCopy'
import { Setups } from './Setups'
import type { InputImage } from './sentImages'
import { evidenceForReview } from './evidence'
import { defaultEffortOf } from './preferences'
import { addItem, betweenTurns, type OutputSoFar, recorder, toolItem, transcript } from './threads'
import { commandOfCall, exitCodeIn, type LeftRunning, printedMore, servingAt, type ShownLeftRunning, shownOf, tailOf } from './leftRunning'
import { outputText } from './reading'
import { ToolServer } from './ToolServer'
import { agentSaid, summarize } from './words'

/*
 * Agent sessions on a task's thread (docs/architecture/03). The runtime
 * starts the agent as a process it records, starts a session in the mode
 * that asks, and delivers the thread's input to it one turn at a time.
 * Everything the agent says becomes thread items; every turn, session and
 * process is recorded with how it ended.
 *
 * Input is accepted into the thread's queue first, durably, and delivered
 * after (docs/architecture/01): `after_current` waits for the turn running,
 * `interrupt_and_continue` stops it and goes first.
 */

export type Disposition = 'after_current' | 'interrupt_and_continue'

export const AcceptedInput = Schema.Struct({ inputId: Schema.String, sequence: Schema.Int })
export type AcceptedInput = typeof AcceptedInput.Type

/** One of a task's repositories, in its worktree here. */
interface TaskRepository {
  readonly name: string
  /** What it is to the project, as the person set it. */
  readonly role: string
  readonly worktree: string
  readonly branch: string
  readonly baseRef: string
  readonly baseCommit: string | null
  readonly defaultBranch: string
  /** The folder inside it the project is about, such as one package of a monorepo; null for all of it. */
  readonly within: string | null
}

/**
 * A task's thread: its lead works in the task's worktrees, one per repository
 * it changes, under the project rules. `worktree`, `branch` and the rest are
 * its first repository's; `cwd` is where the lead starts: that worktree (or
 * the folder in it the project is about), or, with several, the task's
 * folder that holds them side by side.
 */
interface TaskThread {
  readonly role: 'task'
  readonly threadId: string
  readonly projectId: ProjectId
  readonly taskId: string
  readonly title: string
  readonly description: string
  /** What the person asked for, in their words, where Althar kept it. */
  readonly request: string | null
  readonly worktree: string
  readonly branch: string
  readonly baseRef: string
  readonly baseCommit: string | null
  readonly defaultBranch: string
  readonly repositories: ReadonlyArray<TaskRepository>
  readonly cwd: string
}

/**
 * The project's coordinator thread (docs/architecture/04): it reads the
 * project's repositories, fresh from their default branch, under the rules of
 * a role that only reads, and changes things only through Althar's tools.
 */
interface CoordinatorThread {
  readonly role: 'coordinator'
  readonly threadId: string
  readonly projectId: ProjectId
  readonly projectName: string
  readonly folder: CoordinatorFolder
}

/**
 * A task's review step (docs/architecture/05): another agent reads the task's
 * worktree under the rules of a role that only reads, and reports what it
 * found through Althar's tool. Its thread spans the review's rounds.
 */
interface ReviewThread {
  readonly role: 'reviewer'
  readonly threadId: string
  readonly projectId: ProjectId
  readonly taskId: string
  readonly title: string
  readonly description: string
  readonly request: string | null
  /** The copy of each repository's worktree it reads, and where it starts, as for the lead. */
  readonly repositories: ReadonlyArray<TaskRepository>
  readonly cwd: string
}

type ThreadContext = TaskThread | CoordinatorThread | ReviewThread

/** Where a thread's agent works. */
const cwdOf = (thread: ThreadContext) => (thread.role === 'coordinator' ? thread.folder.folder : thread.cwd)

/** Every folder a thread's agent works in: a picture an agent points at is read only from inside them. */
const foldersOf = (thread: ThreadContext): ReadonlyArray<string> =>
  thread.role === 'coordinator'
    ? [thread.folder.folder]
    : [...new Set([thread.cwd, ...thread.repositories.map((repository) => repository.worktree)])]

/** Where an agent starts among a task's repositories: in the one, or the folder in it the project is about; among several, the folder that holds them. */
const startIn = (repositories: ReadonlyArray<{ readonly worktree: string; readonly within: string | null }>) => {
  const [first] = repositories
  if (first === undefined) return ''
  return repositories.length === 1 ? join(first.worktree, first.within ?? '') : dirname(first.worktree)
}

/** What the person asked for, in their words, for a brief: where it says more than the task's title and description. */
const askedFor = (thread: { readonly title: string; readonly description: string; readonly request: string | null }) =>
  thread.request === null || thread.request === thread.title || thread.request === `${thread.title}\n\n${thread.description}`
    ? []
    : [`What the person asked for, in their words:\n\n${thread.request}`]

/** A role's Althar tools. */
const toolRoleOf = (thread: ThreadContext) => (thread.role === 'task' ? 'lead' : thread.role)

interface Running {
  readonly sessionId: string
  readonly entry: AgentEntry
  readonly thread: ThreadContext
  /** The account it runs on (ADR-012). */
  readonly account: Account
  readonly agent: AgentSession
  readonly connection: AgentConnection
  readonly scope: Scope.Closeable
  readonly wake: Queue.Queue<void>
  /** Held while a turn is delivered, so stopping waits for the turn to be recorded. */
  readonly delivering: Semaphore.Semaphore
  /** Told once the next turn is under way: the place it was given among the agents at work here is then its session's. */
  begun?: Effect.Effect<void> | undefined
  readonly stopRequest: Deferred.Deferred<StopRequest>
  readonly ended: Deferred.Deferred<void>
  /** The brief the session's first turn starts with, and what it asks for when no input is waiting. */
  brief: { readonly text: string; readonly closing: string } | undefined
  /** Takes back the session's Althar tools. */
  readonly revokeTools: Effect.Effect<void>
  turnRunning: boolean
  stopping: boolean
  /** How full the agent's context is, in tokens, as it last said; null until it says (ACP's usage updates). */
  context: { readonly used: number; readonly size: number } | null
  /** Closes the message being said between turns. */
  settleBetween: Effect.Effect<void, never, Store>
  /** What records its events now: its turn's, or the one between turns. */
  recording: { readonly outputOf: (itemId: string) => OutputSoFar | undefined } | undefined
  /** What it left running in the background, in the order it started them (leftRunning.ts). */
  readonly background: Map<string, LeftRunning>
  /**
   * A coordinator's handover to a fresh session (ADR-031): under way, it
   * takes no more turns; left, it carries on as it is, its agent compacting
   * by itself, as one that couldn't start or that its brief would fill
   * leaves it.
   */
  handover: 'none' | 'under_way' | 'left'
}

/** How often, and for how long, what one left running is read for where it answers. */
const SERVING_EVERY = Duration.millis(500)
const SERVING_TRIES = 240

/** Keeps what the agent last said of its context, from an event it streamed. */
const heardContext = (running: Running, event: SessionEvent) => {
  if (event._tag === 'ContextUsage') running.context = { used: event.used, size: event.size }
}

/** The account asked for, where one was. */
const accountOf = (input: { readonly accountId?: string }) => (input.accountId === undefined ? {} : { accountId: input.accountId })

type StopRequest = { readonly state: 'completed' } | { readonly state: 'superseded'; readonly by: string }

type Store =
  | Artifacts
  | SqlClient.SqlClient
  | Ledger
  | Commands
  | Crypto.Crypto
  | Instance
  | Live
  | Agents
  | Permissions
  | Questions
  | ToolServer
  | RuntimeConfig
  | Accounts
  | Limits
  | Models
  | Setups
  | Policies
type Failure = SqlError.SqlError | Schema.SchemaError | CommandIdReused | RowNotFound | RevisionConflict

/** A turn's input was taken back while the turn was being made: it is made again from what still waits. */
class TakenBack extends Schema.TaggedError<TakenBack>()('TakenBack', {}) {}

const PROMPT_BUDGET = 60_000

const optionValue = (options: ReadonlyArray<ConfigOption>, id: string | undefined) => {
  const value = id === undefined ? undefined : options.find((option) => option.id === id)?.currentValue
  return typeof value === 'string' ? value : null
}

/**
 * Puts a session on the effort for the model it is on: the one asked for, or
 * else the person's default for the model, or else the model's own where the
 * agent names it. One the model doesn't offer goes on to the next, and past
 * the last leaves it at the agent's own; a model without efforts has none.
 */
const settleEffort = (definition: AgentDefinition, agent: AgentSession, asked: string | null) =>
  Effect.gen(function* () {
    const { effort, model, ownEffort } = definition.options
    if (effort === undefined) return
    const on = optionValue(yield* agent.options, model)
    const wanted = [asked, on === null ? null : yield* defaultEffortOf(definition.id, on), ownEffort ?? null]
    for (const level of wanted) {
      if (level === null) continue
      const set = yield* agent.setOption(effort, level).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      )
      if (set) return
    }
  })

/**
 * What a turn says to the agent: the brief when the session is new, then each
 * input, an interrupting one first. With no input waiting, a new session is
 * told what to do by `closing`.
 */
export const promptFor = (
  inputs: ReadonlyArray<{
    readonly body: string
    readonly disposition: string
    /** The agent whose turn it was given to reached its usage limit on it, and may have acted on it first. */
    readonly cutShort?: string
    /** Images the person sent with it that the agent doesn't get: it doesn't take images, or they aren't kept any more. */
    readonly withheld?: number
  }>,
  brief: { readonly text: string; readonly closing: string } | undefined,
  /** What Althar tells the agent first, before what was said: what changed while it wasn't speaking. */
  news: string | null = null,
) => {
  const parts = inputs.map((input) => {
    // Images it doesn't get are said, so it knows they were there and can ask what they show.
    const withheld = input.withheld ?? 0
    const body =
      withheld === 0
        ? input.body
        : `${input.body}${input.body === '' ? '' : '\n\n'}(The person sent ${withheld === 1 ? 'an image' : `${withheld} images`} with this, which Althar couldn't pass on to you.)`
    const said =
      input.disposition === 'interrupt_and_continue'
        ? `The person interrupted your last turn to say:\n\n${body}\n\nTake it into account, and carry on with the task.`
        : body
    // A delivered turn may have acted: what it was given isn't new, and some of it may be done.
    return input.cutShort === undefined
      ? said
      : `${input.cutShort} was working on this when it reached its usage limit, and may have done some of it already. Check what is done before you carry on.\n\n${said}`
  })
  const said = news === null ? parts : [news, ...parts]
  if (brief === undefined) return said.join('\n\n')
  return [brief.text, ...(parts.length === 0 ? [brief.closing] : said)].join('\n\n')
}

/** Why a turn ended in failure, as a class for the record. */
export const errorClassOf = (
  failure: Option.Option<{ readonly _tag: string; readonly failure?: string }>,
  failed: boolean,
): string | undefined => {
  if (Option.isSome(failure)) {
    const error = failure.value
    if (error._tag === 'AgentRequestFailed') return error.failure ?? 'unknown'
    if (error._tag === 'AgentExited') return 'agent_exited'
    if (error._tag === 'TurnInProgress') return 'turn_in_progress'
    return 'unknown'
  }
  return failed ? 'unknown' : undefined
}

/** How often a message's text, as far as it has come, goes to watching clients. */
const STREAM_EVERY = 50

export class Sessions extends Context.Service<
  Sessions,
  {
    /** Starts an agent session on a task's thread, in the task's worktree. */
    start(input: {
      readonly threadId: string
      readonly agentId: string
      readonly model?: string
      /** How hard it thinks, where the agent offers a choice; the agent's own default without one. */
      readonly effort?: string
      /** The account it runs on, where the person picked one; else as `Limits.pick` says. */
      readonly accountId?: string
    }): Effect.Effect<string, SessionRunning | NotFound | UnknownAgent | SessionFailed | GitFailed | TaskRefused | Failure>
    /**
     * Starts the agent last on the thread again, on the model and effort it
     * had, for what waits in its queue: false, and nothing started, where no
     * agent has been on it.
     */
    startLast(
      threadId: string,
    ): Effect.Effect<boolean, SessionRunning | NotFound | UnknownAgent | SessionFailed | GitFailed | TaskRefused | Failure>
    /** Accepts input into the thread's queue, and delivers it when the session can take it. */
    send(input: {
      readonly envelope: CommandEnvelope
      readonly threadId: string
      readonly body: string
      readonly disposition?: Disposition
      /** Images the person sent with it, in the store already (`keepSent`): sent with its words in every turn that delivers it. */
      readonly images?: ReadonlyArray<InputImage>
      /** Input Althar writes, such as findings to settle: delivered, but shown in the thread by what it came from, not as the person's message. */
      readonly quiet?: boolean
    }): Effect.Effect<AcceptedInput, NotFound | Failure>
    /** Takes back a message still waiting its turn, by its thread item: the agent never reads it. One the agent has stays. */
    takeBack(input: {
      readonly envelope: CommandEnvelope
      readonly itemId: string
    }): Effect.Effect<void, NotFound | AlreadyDelivered | Failure>
    /** Changes the session's model; the session and its context carry on. */
    setModel(input: { readonly threadId: string; readonly model: string }): Effect.Effect<void, NoSession | ModelUnchanged | Failure>
    /** How hard the running session's agent thinks, from here on. */
    setEffort(input: { readonly threadId: string; readonly effort: string }): Effect.Effect<void, NoSession | EffortUnchanged | Failure>
    /** Delivers what waits in the thread's queue now, if an agent is on it: after a usage limit resets, say. */
    wake(threadId: string): Effect.Effect<void>
    /** Hands the thread to another agent: a new session, briefed with the thread so far (ADR-005). */
    switchAgent(input: {
      readonly threadId: string
      readonly agentId: string
      readonly model?: string
      readonly effort?: string
      /** What the thread says of the switch, in place of who switched to whom: why it happened. */
      readonly said?: string
      /** What the loop dealt with by switching, for the home: an agent's usage limit, or a step gone quiet. */
      readonly about?: 'limit' | 'stall'
      /** What the person said with it, and any images: the new agent's first turn, after its brief, and never the old one's. */
      readonly message?: { readonly envelope: CommandEnvelope; readonly body: string; readonly images?: ReadonlyArray<InputImage> }
      /** The account it runs on, where the person picked one; else as `Limits.pick` says. */
      readonly accountId?: string
    }): Effect.Effect<string, NotFound | UnknownAgent | SessionFailed | GitFailed | TaskRefused | Failure>
    /** Stops the turn running, if there is one; the session waits for what comes next. */
    interrupt(threadId: string): Effect.Effect<void, NoSession>
    /** Stops the thread's session, after ending its turn. */
    stop(threadId: string): Effect.Effect<void, NoSession>
    /** Stops a command the thread's session left running; it goes from the list. Nothing, where the session or the command is gone already. */
    stopBackground(threadId: string, id: string): Effect.Effect<void, AgentRequestFailed | AgentExited>
    /** Clears one that ended by itself from the list. */
    clearBackground(threadId: string, id: string): Effect.Effect<void>
    /** The session running on a thread, if there is one. */
    running(threadId: string): Effect.Effect<
      Option.Option<{
        readonly sessionId: string
        readonly agentId: string
        readonly accountId: string
        readonly turnRunning: boolean
        /** The agent's process, where it runs as one. */
        readonly pid: number | null
        /** How full its context is, in tokens, as the agent last said; null until it says. */
        readonly context: { readonly used: number; readonly size: number } | null
        /** It is being stopped: on its way out, not one to carry on with. */
        readonly stopping: boolean
        /** What it left running in the background. */
        readonly background: ReadonlyArray<ShownLeftRunning>
      }>
    >
    /** What a command on a thread has printed so far, while it runs: its last lines, and how many came before them. */
    outputSoFar(threadId: string, itemId: string): Effect.Effect<Option.Option<OutputSoFar>>
    /**
     * Every session on a task's threads, its lead's or a step's, with whether
     * it is in a turn and whether something it left running still runs: what
     * counts toward the agents at work on this machine (Busy.ts). Never the
     * coordinator's.
     */
    readonly onTasks: Effect.Effect<
      ReadonlyArray<{
        readonly threadId: string
        readonly taskId: string
        /** A task's reviewer, not its lead. */
        readonly reviewer: boolean
        readonly turnRunning: boolean
        readonly background: boolean
      }>
    >
    /**
     * What a lead's or a reviewer's turns wait for before they are delivered:
     * a place among the agents at work on this machine (Busy.ts). `work`
     * delivers what the thread has queued; the gate runs it now, or once
     * there is a place.
     */
    gateTurns(
      gate: (
        agent: { readonly taskId: string; readonly threadId: string; readonly sessionId: string; readonly review: boolean },
        work: (begun: Effect.Effect<void>) => Effect.Effect<void>,
      ) => Effect.Effect<boolean>,
    ): Effect.Effect<void>
  }
>()('@althar/runtime/Sessions') {
  static readonly layer: Layer.Layer<Sessions, never, Store> = Layer.effect(
    Sessions,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const live = yield* Live
      const permissions = yield* Permissions
      const questions = yield* Questions
      const accounts = yield* Accounts
      const limits = yield* Limits
      const toolServer = yield* ToolServer
      const setups = yield* Setups
      const stopGrace = (yield* RuntimeConfig).stopGrace ?? Duration.seconds(10)
      // Sessions live in a scope of their own, closed only after the finalizer below has stopped each one and recorded it.
      const sessionsScope = yield* Scope.fork(yield* Effect.scope, 'sequential')
      const threads = new Map<string, Running>()
      /* What a lead's or a reviewer's turns wait for, once Busy says (gateTurns): until then, nothing. */
      let gate = (
        _agent: { readonly taskId: string; readonly threadId: string; readonly sessionId: string; readonly review: boolean },
        work: (begun: Effect.Effect<void>) => Effect.Effect<void>,
      ) => Effect.as(work(Effect.void), true)
      const run = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)

      /** Tells watching clients what a session has left running, whole. */
      const toldBackground = (running: Running) =>
        live.publish({ _tag: 'Background', threadId: running.thread.threadId, background: [...running.background.values()].map(shownOf) })

      /** What one has printed: its file, where the agent says, else what came on its tool call. */
      const printedBy = (left: LeftRunning) => (left.outputPath !== null ? tailOf(left.outputPath) : Effect.succeed(left.printed))

      /** What its tool call printed before the agent said it left it running: in the turn still, or kept when the turn ended. */
      const printedBefore = (running: Running, itemId: string | undefined) =>
        itemId === undefined
          ? Effect.succeed('')
          : Option.match(Option.fromNullishOr(running.recording?.outputOf(itemId)), {
              onSome: (soFar) => Effect.succeed(soFar.text),
              onNone: () =>
                outputText(running.thread.threadId, itemId).pipe(
                  Effect.map((kept) => kept.text),
                  Effect.orElseSucceed(() => ''),
                ),
            })

      /** Reads what one prints, now and then, until it says where it answers, ends, or a couple of minutes go by. */
      const watchServing = (running: Running, id: string) =>
        Effect.gen(function* () {
          for (let tries = 0; tries < SERVING_TRIES; tries += 1) {
            const left = running.background.get(id)
            if (left === undefined || left.ended !== null) return
            const url = servingAt(yield* printedBy(left))
            if (url !== null) {
              left.url = url
              return yield* toldBackground(running)
            }
            yield* Effect.sleep(SERVING_EVERY)
          }
        })

      /** Keeps what the agent says of what it left running, from an event it streamed, in a turn or between. */
      const heardBackground = (running: Running, event: SessionEvent) =>
        run(
          Effect.gen(function* () {
            switch (event._tag) {
              case 'BackgroundStarted': {
                // The thread has its tool call already: the agent says what it left running once the call is made.
                const item = event.toolCallId === undefined ? undefined : yield* toolItem(running.sessionId, event.toolCallId)
                running.background.set(event.id, {
                  id: event.id,
                  command: commandOfCall(item?.content, event.name),
                  toolCallId: event.toolCallId ?? null,
                  outputPath: event.outputPath ?? null,
                  printed: yield* printedBefore(running, item?.id),
                  url: null,
                  startedAt: yield* timestamp,
                  ended: null,
                })
                yield* toldBackground(running)
                yield* Effect.forkIn(watchServing(running, event.id), running.scope)
                return
              }
              case 'ToolCallUpdate': {
                const more = event.terminal?.output
                if (more === undefined) return
                for (const left of running.background.values())
                  if (left.toolCallId === event.toolCallId) left.printed = printedMore(left.printed, more)
                return
              }
              case 'BackgroundOutput': {
                const left = running.background.get(event.id)
                if (left !== undefined) left.outputPath = event.outputPath
                return
              }
              case 'BackgroundEnded': {
                const left = running.background.get(event.id)
                if (left === undefined) return
                // Stopped, it goes, whoever stopped it. Ended by itself, it stays, to say how.
                if (event.end === 'stopped') running.background.delete(event.id)
                else {
                  const code = exitCodeIn(yield* printedBy(left)) ?? (event.end === 'completed' ? 0 : null)
                  left.ended = { at: yield* timestamp, code }
                }
                return yield* toldBackground(running)
              }
              default:
                return
            }
          }),
        ).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not keep what an agent left running', cause)))

      /** No agent starts, and nothing is said to one, in a project removed from Althar: a window that hadn't heard yet is told it's gone. */
      const inLiveProject = (threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [removed] = yield* sql<{ projectId: string }>`
            SELECT p.id AS project_id FROM threads t JOIN projects p ON p.id = t.project_id
            WHERE t.id = ${threadId} AND p.archived_at IS NOT NULL`
          if (removed !== undefined) return yield* new NotFound({ kind: 'project', id: removed.projectId })
        })

      /** An abandoned task has no agent on it until it is reopened. */
      const notAbandoned = (threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [abandoned] = yield* sql<{ taskId: string }>`
            SELECT k.id AS task_id FROM threads t JOIN tasks k ON k.id = t.task_id WHERE t.id = ${threadId} AND k.state = 'abandoned'`
          if (abandoned !== undefined) return yield* new TaskRefused({ taskId: abandoned.taskId, why: 'abandoned' })
        })

      const loadThread = (threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [kind] = yield* sql<{ kind: string; projectId: ProjectId; projectName: string }>`
            SELECT t.kind, t.project_id, p.name AS project_name FROM threads t JOIN projects p ON p.id = t.project_id WHERE t.id = ${threadId}`
          if (kind?.kind === 'coordinator')
            return {
              role: 'coordinator',
              threadId,
              projectId: kind.projectId,
              projectName: kind.projectName,
              folder: yield* coordinatorFolder(kind.projectId),
            } satisfies ThreadContext as ThreadContext
          // The task's repositories, each in its worktree here, the first first.
          const repositories = yield* sql<TaskRepository>`
            SELECT b.display_name AS name, b.role, w.path AS worktree, w.branch, w.base_ref, w.base_commit,
              coalesce(b.default_base_ref, w.base_ref) AS default_branch, b.folder AS within
            FROM threads t
            JOIN workspaces w ON w.task_id = t.task_id AND w.device_id = ${instance.deviceId} AND w.state = 'ready'
            JOIN repository_bindings b ON b.id = w.binding_id
            WHERE t.id = ${threadId}
            ORDER BY b.created_at, b.rowid`
          const [task] = yield* sql<{ projectId: ProjectId; taskId: string; title: string; description: string; request: string | null }>`
            SELECT t.project_id, t.task_id, k.title, k.description, k.request FROM threads t JOIN tasks k ON k.id = t.task_id WHERE t.id = ${threadId}`
          const [first] = repositories
          if (task === undefined || first === undefined)
            return yield* new NotFound({ kind: 'task thread with a ready worktree', id: threadId })
          // A reviewer reads a throwaway copy of each of the lead's worktrees, not the worktrees themselves.
          if (kind?.kind === 'step') {
            const copies = repositories.map((repository) => ({ ...repository, worktree: reviewCopyOf(repository.worktree) }))
            return {
              role: 'reviewer',
              threadId,
              ...task,
              repositories: copies,
              cwd: startIn(copies),
            } satisfies ThreadContext as ThreadContext
          }
          return {
            role: 'task',
            threadId,
            ...task,
            worktree: first.worktree,
            branch: first.branch,
            baseRef: first.baseRef,
            baseCommit: first.baseCommit,
            defaultBranch: first.defaultBranch,
            repositories,
            cwd: startIn(repositories),
          } satisfies ThreadContext as ThreadContext
        })

      const sessionFact = (thread: ThreadContext, sessionId: string, revision: number, type: string, payload: unknown = {}) =>
        fact({
          projectId: thread.projectId,
          aggregateType: 'provider_session',
          aggregateId: sessionId,
          revision,
          type,
          payload,
          actorId: instance.systemId,
        })

      /** Records a new session, still starting, on the account it runs on. */
      /** A session, starting; on the model asked for, so it is named by it from the first. */
      const createSession = (thread: ThreadContext, agentId: string, account: Account, model?: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const sessionId = yield* newId(Ids.providerSession)
          yield* sql.withTransaction(
            Effect.gen(function* () {
              // Checked where the session is written: a removal is a transaction too, so it either sees this session and
              // stops it, or came first and this one never starts.
              yield* inLiveProject(thread.threadId)
              yield* sql`INSERT INTO provider_sessions ${sql.insert({
                id: sessionId,
                projectId: thread.projectId,
                threadId: thread.threadId,
                agentId,
                accountId: account.id,
                controllerGeneration: 1,
                state: 'starting',
                ...(model === undefined ? {} : { model }),
                startedAt: yield* timestamp,
              })}`
              yield* sessionFact(thread, sessionId, 1, 'provider_session.starting', { agentId, accountId: account.id })
            }),
          )
          return sessionId
        })

      /**
       * The images sent with each input, from the store, in order, for an
       * agent that takes images; and how many of each it doesn't get: all of
       * them where it doesn't take images, else any no longer kept.
       */
      const imagesFor = (inputIds: ReadonlyArray<string>, takes: boolean) =>
        Effect.gen(function* () {
          const images = new Map<string, Array<{ readonly data: string; readonly mimeType: string }>>()
          const withheld = new Map<string, number>()
          if (inputIds.length === 0) return { images, withheld }
          const sql = yield* SqlClient.SqlClient
          const artifacts = yield* Artifacts
          const rows = yield* sql<{ userInputId: string; sha256: string; mediaType: string }>`
            SELECT ii.user_input_id, a.sha256, a.media_type
            FROM user_input_images ii JOIN artifacts a ON a.id = ii.artifact_id
            WHERE ii.user_input_id IN ${sql.in(inputIds)} ORDER BY ii.user_input_id, ii.position`
          for (const row of rows) {
            const bytes = takes ? yield* artifacts.read(row.sha256) : null
            if (bytes === null) withheld.set(row.userInputId, (withheld.get(row.userInputId) ?? 0) + 1)
            else
              images.set(row.userInputId, [
                ...(images.get(row.userInputId) ?? []),
                { data: Buffer.from(bytes).toString('base64'), mimeType: row.mediaType },
              ])
          }
          return { images, withheld }
        })

      /** Delivers the queued input as one turn, and records it to its end. */
      const deliver = (running: Running) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const { thread } = running
          // A coordinator handing its conversation over takes no more turns. One whose context is filling up hands it over now,
          // between turns, never in one: what waits goes to the fresh session (ADR-031).
          if (running.handover === 'under_way') return false
          if (thread.role === 'coordinator' && running.handover === 'none' && dueForHandover(running.context)) {
            running.handover = 'under_way'
            yield* Effect.forkIn(run(handOver(running)), sessionsScope)
            return false
          }
          const queued = yield* sql<{ id: string; body: string; disposition: string; author: string; shown: number; cutBy: string | null }>`
            SELECT i.id, i.body, i.disposition, a.kind AS author,
              EXISTS (SELECT 1 FROM thread_items ti WHERE ti.user_input_id = i.id) AS shown,
              (SELECT s.agent_id FROM turn_delivery_inputs di JOIN turn_deliveries d ON d.id = di.delivery_id
                JOIN provider_sessions s ON s.id = d.provider_session_id
                WHERE di.user_input_id = i.id AND d.error_class = 'usage_limit' ORDER BY d.requested_at DESC LIMIT 1) AS cut_by
            FROM user_inputs i JOIN actors a ON a.id = i.author_actor_id
            WHERE i.thread_id = ${thread.threadId} AND i.state = 'queued'
            ORDER BY i.disposition = 'interrupt_and_continue' DESC, i.sequence`
          // The images the person sent with each, read from the store for this turn: only an agent that takes images is sent them.
          const sent = yield* imagesFor(
            queued.map((input) => input.id),
            running.connection.info.images,
          )
          // What an agent out of usage was given goes on with word of that, by the name of the agent it went to.
          const agents = yield* Agents
          const inputs = queued.map(({ cutBy, ...input }) => {
            const by = cutBy === null ? undefined : (agents.list.find((entry) => entry.definition.id === cutBy)?.definition.name ?? cutBy)
            const withheld = sent.withheld.get(input.id) ?? 0
            return { ...input, ...(by === undefined ? {} : { cutShort: by }), ...(withheld === 0 ? {} : { withheld }) }
          })
          if (inputs.length === 0 && running.brief === undefined) return false
          // The coordinator speaks when spoken to: its brief waits for the person's first message.
          if (inputs.length === 0 && thread.role === 'coordinator') return false
          // Its copies of the repositories are brought up to date for each turn; offline, it reads what it has.
          if (thread.role === 'coordinator')
            yield* coordinatorFolder(thread.projectId).pipe(
              Effect.catchCause((cause) => Effect.logWarning('Could not refresh the coordinator folder', cause)),
            )
          const brief = running.brief
          // The lead is told how its worktrees were set up, in its brief.
          const setUp = thread.role === 'task' && brief !== undefined ? yield* setups.told(thread.taskId) : null
          const briefed = brief === undefined || setUp === null ? brief : { ...brief, text: `${brief.text}\n\n${setUp}` }
          // The coordinator is told what became of its plans in its models' names, which are read first: asking an agent may take a while.
          const named =
            thread.role === 'coordinator'
              ? yield* modelNamer.pipe(
                  Effect.catchCause((cause) =>
                    Effect.as(Effect.logWarning('Could not read the models to name for the coordinator', cause), null),
                  ),
                )
              : null
          let prompt = promptFor(inputs, briefed)
          const turnId = yield* newId(Ids.turnDelivery)
          const [session] = yield* sql<{
            model: string | null
            effort: string | null
          }>`SELECT model, effort FROM provider_sessions WHERE id = ${running.sessionId}`
          const claimed = yield* sql
            .withTransaction(
              Effect.gen(function* () {
                // The person may have taken some of it back since it was read: then this turn isn't given, and what still waits is read again.
                if (inputs.length > 0) {
                  const still = yield* sql<{
                    id: string
                  }>`SELECT id FROM user_inputs WHERE state = 'queued' AND id IN ${sql.in(inputs.map((input) => input.id))}`
                  if (still.length < inputs.length) return yield* new TakenBack()
                }
                // What became of its plans since it last spoke, which only the cards show the person: read with the turn's record, so none falls between two turns.
                if (thread.role === 'coordinator' && named !== null) {
                  const news = yield* coordinatorNews(thread.threadId, thread.projectId, named).pipe(
                    Effect.catchCause((cause) =>
                      Effect.as(Effect.logWarning('Could not read what changed for the coordinator', cause), null),
                    ),
                  )
                  prompt = promptFor(inputs, briefed, news)
                }
                const at = yield* timestamp
                yield* sql`INSERT INTO turn_deliveries ${sql.insert({
                  id: turnId,
                  projectId: thread.projectId,
                  threadId: thread.threadId,
                  providerSessionId: running.sessionId,
                  controllerGeneration: 1,
                  model: session?.model ?? null,
                  effort: session?.effort ?? null,
                  // What the agent is told, kept so it can always be read back (docs/architecture/03).
                  prompt,
                  state: 'pending',
                  requestedAt: at,
                })}`
                for (const [index, input] of inputs.entries()) {
                  yield* sql`INSERT INTO turn_delivery_inputs ${sql.insert({ projectId: thread.projectId, deliveryId: turnId, userInputId: input.id, position: index + 1 })}`
                }
                yield* fact({
                  projectId: thread.projectId,
                  aggregateType: 'turn_delivery',
                  aggregateId: turnId,
                  revision: 1,
                  type: 'turn_delivery.requested',
                  payload: { inputs: inputs.map((input) => input.id), briefed: brief !== undefined },
                  actorId: instance.systemId,
                })
                return true
              }),
            )
            .pipe(Effect.catchTag('TakenBack', () => Effect.succeed(false)))
          if (!claimed) return true
          // Recorded as delivered before the prompt goes out: after a crash, a delivered turn may have acted.
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const revision = yield* change('turn_deliveries', turnId, { state: 'delivered', deliveredAt: yield* timestamp })
              yield* fact({
                projectId: thread.projectId,
                aggregateType: 'turn_delivery',
                aggregateId: turnId,
                revision,
                type: 'turn_delivery.delivered',
                actorId: instance.systemId,
              })
              for (const input of inputs) {
                const inputRevision = yield* change('user_inputs', input.id, { state: 'delivered' })
                yield* fact({
                  projectId: thread.projectId,
                  aggregateType: 'user_input',
                  aggregateId: input.id,
                  revision: inputRevision,
                  type: 'user_input.delivered',
                  actorId: instance.systemId,
                })
              }
            }),
          )
          running.brief = undefined
          running.turnRunning = true
          const begun = running.begun
          running.begun = undefined
          if (begun !== undefined) yield* begun
          // Images the agent doesn't get are said in the thread as well as to the agent, so none goes missing unsaid.
          const withheld = inputs.reduce((sum, input) => sum + (input.withheld ?? 0), 0)
          if (withheld > 0)
            yield* addItem(
              { projectId: thread.projectId, threadId: thread.threadId, sessionId: running.sessionId, deliveryId: turnId },
              'notice',
              {
                source: 'runtime',
                severity: 'warning',
                title: running.connection.info.images
                  ? withheld === 1
                    ? `An image you sent isn't kept any more, so ${running.entry.definition.name} didn't get it.`
                    : `${withheld} images you sent aren't kept any more, so ${running.entry.definition.name} didn't get them.`
                  : `${running.entry.definition.name} doesn't take images, so ${withheld === 1 ? 'the image' : `the ${withheld} images`} you sent ${withheld === 1 ? "wasn't" : "weren't"} passed on to it.`,
              },
            )
          // A task's card says when its lead or reviewer is at work.
          if (thread.role !== 'coordinator') yield* touchCard(thread.taskId)
          yield* live.publish({
            _tag: 'TurnStarted',
            threadId: thread.threadId,
            turnId,
            // What the person wrote shows in the thread; what Althar writes for them goes quietly.
            byPerson: inputs.some((input) => input.shown === 1),
          })

          const items = recorder({
            projectId: thread.projectId,
            threadId: thread.threadId,
            sessionId: running.sessionId,
            deliveryId: turnId,
            folders: foldersOf(thread),
          })
          // What it was saying between turns ends here: what follows belongs after this turn's input.
          yield* running.settleBetween
          running.recording = items
          let ended: Extract<SessionEvent, { _tag: 'TurnEnded' }> | undefined
          // A failure to record one event doesn't stop the runtime reading the rest of the turn.
          const record = (event: SessionEvent) =>
            items.record(event).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not record an agent event', cause)))
          /*
           * The text being written goes to watching clients whole, at most every
           * STREAM_EVERY, and once more after the last piece, so a long message
           * doesn't cost the square of its length on the way. So does each
           * command's output that grew, as its last lines.
           */
          const streaming = { sentAt: 0, trailing: false }
          const sendOpen = Effect.suspend(() => {
            streaming.sentAt = Date.now()
            const open = items.current()
            const message =
              open === undefined
                ? Effect.void
                : live.publish({
                    _tag: 'Streaming',
                    threadId: thread.threadId,
                    itemId: open.id,
                    kind: open.kind,
                    agentId: running.entry.definition.id,
                    text: open.text,
                  })
            return Effect.andThen(
              message,
              Effect.forEach(items.outputsSoFar(), (output) => live.publish({ _tag: 'Output', threadId: thread.threadId, ...output }), {
                discard: true,
              }),
            )
          })
          const stream = Effect.suspend(() => {
            const wait = STREAM_EVERY - (Date.now() - streaming.sentAt)
            if (wait <= 0) return sendOpen
            if (streaming.trailing) return Effect.void
            streaming.trailing = true
            return Effect.asVoid(
              Effect.forkChild(
                Effect.andThen(
                  Effect.sleep(Duration.millis(wait)),
                  Effect.andThen(
                    Effect.sync(() => {
                      streaming.trailing = false
                    }),
                    sendOpen,
                  ),
                ),
              ),
            )
          })
          const images = inputs.flatMap((input) => sent.images.get(input.id) ?? [])
          const streamed = yield* Stream.runForEach(running.agent.prompt(prompt, images), (event) =>
            Effect.gen(function* () {
              if (event._tag === 'TurnEnded') ended = event
              heardContext(running, event)
              yield* record(event)
              yield* heardBackground(running, event)
              yield* live.publish({ _tag: 'Agent', threadId: thread.threadId, event })
              if (event._tag === 'AgentMessage' || event._tag === 'AgentThought' || event._tag === 'ToolCallUpdate') yield* stream
            }),
          ).pipe(Effect.exit)
          // What the turn left open is kept as far as it came: the message being written, and any command's output.
          yield* items.end.pipe(Effect.catchCause((cause) => Effect.logWarning('Could not record the end of a message', cause)))
          running.turnRunning = false

          const failure = Exit.isFailure(streamed) ? Cause.findErrorOption(streamed.cause) : Option.none()
          const errorClass = errorClassOf(failure, Exit.isFailure(streamed)) ?? ended?.failure?.failure
          // The agent refused the prompt: nothing was delivered, so the input goes back in the queue.
          const refused = errorClass === 'turn_in_progress'
          const state = errorClass !== undefined ? 'failed' : ended?.stopReason === 'cancelled' ? 'interrupted' : 'completed'
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const revision = yield* change('turn_deliveries', turnId, {
                state,
                stopReason: ended?.stopReason ?? null,
                usage: ended?.usage === undefined ? null : JSON.stringify(ended.usage),
                errorClass: errorClass ?? null,
                endedAt: yield* timestamp,
              })
              yield* fact({
                projectId: thread.projectId,
                aggregateType: 'turn_delivery',
                aggregateId: turnId,
                revision,
                type: `turn_delivery.${state}`,
                payload: { stopReason: ended?.stopReason, errorClass },
                actorId: instance.systemId,
              })
              // Refused, nothing was delivered. Out of usage, what the person said waits for the agent that carries on;
              // Althar's own prompts are given again by what carries the work on.
              const back = refused ? inputs : errorClass === 'usage_limit' ? inputs.filter((input) => input.author === 'person') : []
              for (const input of back) {
                const inputRevision = yield* change('user_inputs', input.id, { state: 'queued' })
                yield* fact({
                  projectId: thread.projectId,
                  aggregateType: 'user_input',
                  aggregateId: input.id,
                  revision: inputRevision,
                  type: 'user_input.requeued',
                  actorId: instance.systemId,
                })
              }
            }),
          )
          // A brief the agent never read goes with the next turn: refused, or out of usage before it began.
          if (refused || errorClass === 'usage_limit') running.brief = brief
          if (refused) {
            // Tried again shortly, rather than straight away.
            yield* Effect.forkIn(Effect.delay(Queue.offer(running.wake, undefined), Duration.seconds(1)), running.scope)
          }
          // A prompt the agent failed ends its turn with the agent's error, or the person waits on an answer that isn't coming.
          // A usage limit is said by what carries the work on.
          if (Option.isSome(failure) && failure.value._tag === 'AgentRequestFailed' && errorClass !== 'usage_limit')
            yield* addItem(
              { projectId: thread.projectId, threadId: thread.threadId, sessionId: running.sessionId, deliveryId: turnId },
              'notice',
              {
                source: 'agent',
                severity: 'error',
                title: `${running.entry.definition.name} couldn't answer.`,
                description: failure.value.message,
                failure: errorClass,
              },
            )
          // A step can report mid-turn, so its task is ready only once the turn is over: its card is read again.
          if (thread.role !== 'coordinator') yield* touchCard(thread.taskId)
          const resetsAt =
            Option.isSome(failure) && failure.value._tag === 'AgentRequestFailed' ? failure.value.resetsAt : ended?.failure?.resetsAt
          if (errorClass === 'usage_limit') yield* accountLimited(running, resetsAt)
          yield* live.publish({
            _tag: 'TurnEnded',
            threadId: thread.threadId,
            turnId,
            state,
            ...(errorClass === undefined ? {} : { errorClass }),
            ...(ended === undefined ? {} : { stopReason: ended.stopReason }),
          })
          // Out of usage, nothing more goes to it until what carries the work on says so.
          return !refused && errorClass !== 'usage_limit'
        })

      /** A usage limit belongs to the account the session runs on (docs/architecture/03, ADR-012), not the agent. */
      const accountLimited = (running: Running, resetsAt: string | undefined) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const agentId = running.entry.definition.id
          const accountId = running.account.id
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const [known] = yield* sql<{
                id: string
              }>`SELECT id FROM principals WHERE account_id = ${accountId} ORDER BY observed_at DESC LIMIT 1`
              const principalId = known?.id ?? (yield* newId(Ids.principal))
              if (known === undefined) {
                yield* sql`INSERT INTO principals ${sql.insert({ id: principalId, agentId, accountId, deviceId: instance.deviceId, subjectHint: `${running.entry.definition.name} sign-in`, authMode: 'vendor_cli', observedAt: yield* timestamp })}`
              }
              const id = yield* newId(Ids.accountStatus)
              yield* sql`INSERT INTO account_statuses ${sql.insert({
                id,
                principalId,
                state: 'limited',
                windows: JSON.stringify([{ kind: 'usage', ...(resetsAt === undefined ? {} : { resetsAt }) }]),
                source: 'error',
                observedAt: yield* timestamp,
              })}`
              yield* fact({
                projectId: running.thread.projectId,
                aggregateType: 'account_status',
                aggregateId: id,
                revision: 1,
                type: 'account_status.limited',
                payload: { agentId, accountId, resetsAt },
                actorId: instance.systemId,
              })
            }),
          )
        })

      /** Whether the thread has input waiting to be delivered. */
      const hasQueued = (threadId: string) =>
        run(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const [one] = yield* sql<{ id: string }>`SELECT id FROM user_inputs WHERE thread_id = ${threadId} AND state = 'queued' LIMIT 1`
            return one !== undefined
          }),
        ).pipe(Effect.orElseSucceed(() => true))

      /** Delivers queued input, one turn at a time, until the session stops. */
      const deliveries = (running: Running) =>
        Effect.forever(
          Effect.gen(function* () {
            yield* Queue.take(running.wake)
            // A lead's first turn waits for its worktrees to be set up (Setups.ts), and so has what was said meanwhile. It
            // waits before it holds the turn, so the lead can be stopped meanwhile.
            if (running.thread.role === 'task' && running.brief !== undefined) yield* setups.ready(running.thread.taskId)
            const { thread } = running
            if (thread.role === 'coordinator')
              return yield* running.delivering.withPermits(1)(
                Effect.gen(function* () {
                  while (!running.stopping && (yield* deliver(running))) {
                    // Each turn may leave more input queued, such as what arrived while it ran.
                  }
                }),
              )
            // A lead's or a reviewer's turns, one at a time, each waiting for a place among the agents at work here: what
            // is still queued after one wakes it again, and asks again.
            if (running.stopping || !(running.brief !== undefined || (yield* hasQueued(thread.threadId)))) return
            yield* gate(
              { taskId: thread.taskId, threadId: thread.threadId, sessionId: running.sessionId, review: thread.role === 'reviewer' },
              (begun) =>
                Effect.suspend(() => {
                  if (running.stopping) return Effect.succeed(false)
                  running.begun = begun
                  return run(running.delivering.withPermits(1)(deliver(running)))
                }).pipe(
                  Effect.flatMap((delivered) => (delivered ? Queue.offer(running.wake, undefined) : Effect.succeed(false))),
                  Effect.asVoid,
                  Effect.catchCause((cause) => Effect.logWarning('Could not deliver a turn', cause)),
                  Effect.ensuring(Effect.sync(() => (running.begun = undefined))),
                ),
            )
          }),
        )

      /** Ends a session: closes it and its process, and records how both ended. */
      const supervise = (running: Running) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const outcome = yield* Effect.raceFirst(
            Effect.map(running.connection.closed, () => undefined),
            Deferred.await(running.stopRequest),
          )
          running.stopping = true
          threads.delete(running.thread.threadId)
          yield* running.revokeTools
          yield* permissions.withdrawAll(running.sessionId)
          // What it asked the person stays for them: the answer goes to the agent on the thread next.
          yield* questions.release(running.sessionId)
          yield* Scope.close(running.scope, Exit.void)
          const stop: StopReport | undefined =
            running.connection.process === undefined ? undefined : yield* running.connection.process.stopped
          const exit = yield* running.connection.closed.pipe(Effect.timeoutOption(Duration.seconds(3)))
          const state = outcome === undefined ? 'lost' : outcome.state
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const at = yield* timestamp
              if (running.connection.process !== undefined) {
                const [process] = yield* sql<{
                  id: string
                }>`SELECT id FROM processes WHERE provider_session_id = ${running.sessionId} ORDER BY launched_at DESC LIMIT 1`
                if (process !== undefined) {
                  yield* change('processes', process.id, {
                    state: stop !== undefined && stop.signal !== 'none' ? 'killed' : 'exited',
                    exitCode: Option.isSome(exit) ? exit.value.code : null,
                    signal: stop !== undefined && stop.signal !== 'none' ? stop.signal : Option.isSome(exit) ? exit.value.signal : null,
                    endedAt: at,
                  })
                }
              }
              // A turn cut short by the agent going leaves no end of its own.
              const open = yield* sql<{
                id: string
              }>`SELECT id FROM turn_deliveries WHERE provider_session_id = ${running.sessionId} AND state IN ('pending', 'delivered')`
              for (const turn of open) {
                const revision = yield* change('turn_deliveries', turn.id, { state: 'failed', errorClass: 'agent_exited', endedAt: at })
                yield* fact({
                  projectId: running.thread.projectId,
                  aggregateType: 'turn_delivery',
                  aggregateId: turn.id,
                  revision,
                  type: 'turn_delivery.failed',
                  actorId: instance.systemId,
                })
              }
              const revision = yield* moveSession(running.sessionId, state, {
                endedAt: at,
                ...(outcome?.state === 'superseded' ? { supersededBySessionId: outcome.by } : {}),
              })
              yield* sessionFact(
                running.thread,
                running.sessionId,
                revision,
                `provider_session.${state}`,
                stop === undefined ? {} : { stop },
              )
            }),
          )
          // An agent that goes on its own leaves a line in the thread, so the person knows why nothing is happening.
          if (state === 'lost')
            yield* addItem(
              { projectId: running.thread.projectId, threadId: running.thread.threadId, sessionId: running.sessionId },
              'notice',
              {
                source: 'runtime',
                severity: 'warning',
                title: `${running.entry.definition.name} stopped on its own.`,
                description: {
                  task: 'Start the lead again to carry on; it picks up from the thread.',
                  coordinator: 'Say something to start the coordinator again; it picks up from the thread.',
                  reviewer: 'The review waits; Althar starts the reviewer again when the task resumes.',
                }[running.thread.role],
              },
            )
          yield* live.publish({ _tag: 'SessionEnded', threadId: running.thread.threadId, sessionId: running.sessionId, state })
          yield* Deferred.succeed(running.ended, undefined)
        })

      /**
       * Starts the agent and its session, in the mode that asks, and records
       * its process. The session stays `starting`: it takes over the thread
       * only when `activate` runs, so a failed start leaves the thread as it was.
       */
      const connectSession = (
        thread: ThreadContext,
        sessionId: string,
        entry: AgentEntry,
        account: Account,
        model: string | undefined,
        effort: string | undefined,
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const { definition } = entry
          // In the account's home: its sign-in, not the agent's usual one (ADR-012), with what it shares brought up to date.
          yield* accounts.prepare(account)
          const transport = entry.transport(cwdOf(thread), accounts.env(account))
          const processId = transport._tag === 'Process' ? yield* newId(Ids.process) : undefined
          if (transport._tag === 'Process' && processId !== undefined) {
            // Recorded before it is spawned, so a crash in between leaves a trace to reconcile.
            yield* sql`INSERT INTO processes ${sql.insert({
              id: processId,
              projectId: thread.projectId,
              deviceId: instance.deviceId,
              runtimeInstanceId: instance.id,
              providerSessionId: sessionId,
              purpose: 'agent',
              executable: transport.spec.command,
              argsRedacted: JSON.stringify(transport.spec.args),
              controllerGeneration: 1,
              state: 'launching',
              launchedAt: yield* timestamp,
            })}`
          }
          const requestContext: RequestContext = {
            projectId: thread.projectId,
            threadId: thread.threadId,
            taskId: thread.role === 'coordinator' ? null : thread.taskId,
            sessionId,
            meanings: definition.permissions,
            rules:
              thread.role === 'task'
                ? {
                    role: 'task',
                    context: {
                      worktree: thread.cwd,
                      worktrees: thread.repositories.map((repository) => repository.worktree),
                      defaultBranch: thread.defaultBranch,
                      // A fork's task bound for the repository it came from has that repository's default too.
                      defaultBranches: thread.repositories.flatMap((repository) => [
                        repository.defaultBranch,
                        ...(repository.baseRef.startsWith('upstream/') ? [repository.baseRef.slice('upstream/'.length)] : []),
                      ]),
                      taskBranch: thread.branch,
                    },
                  }
                : { role: 'reader' },
          }
          // Althar's tools for the session's role: the coordinator's plan tasks; a lead's and a reviewer's report their step.
          const tools = yield* toolServer.grant({
            role: toolRoleOf(thread),
            projectId: thread.projectId,
            threadId: thread.threadId,
            sessionId,
            taskId: thread.role === 'coordinator' ? null : thread.taskId,
          })
          const scope = yield* Scope.fork(sessionsScope, 'sequential')
          const started = yield* Effect.exit(
            Effect.gen(function* () {
              const connection = yield* connect({
                transport,
                onPermission: (request) => permissions.decide(requestContext, request),
                permissions: definition.permissions,
                // The lead and the coordinator may ask the person; a reviewer is given no way to, and decides for itself.
                ...(thread.role === 'reviewer'
                  ? {}
                  : {
                      onQuestion: (question: Question) =>
                        questions.ask(
                          { projectId: thread.projectId, threadId: thread.threadId, taskId: requestContext.taskId, sessionId },
                          question,
                        ),
                    }),
              })
              const agent = yield* connection.newSession({
                cwd: cwdOf(thread),
                // The coordinator and a reviewer only read: in the agent's read-only mode where that still lets it call Althar's tools.
                mode: thread.role === 'task' ? definition.modes.ask : definition.modes.reader,
                modeOptionId: definition.options.mode,
                mcpServers: [tools.server],
                ...(definition.sessionMeta === undefined
                  ? {}
                  : { meta: definition.sessionMeta(thread.role === 'task' ? 'lead' : 'reader') }),
              })
              if (model !== undefined) yield* agent.setOption(definition.options.model, model)
              // An effort the model doesn't offer is no reason not to start.
              yield* settleEffort(definition, agent, effort ?? null)
              return { connection, agent }
            }).pipe(Scope.provide(scope)),
          )
          if (Exit.isFailure(started)) {
            yield* Scope.close(scope, Exit.void)
            yield* tools.revoke
            const reason = Cause.pretty(started.cause)
            const summary = summarize(started.cause)
            yield* sql.withTransaction(
              Effect.gen(function* () {
                if (processId !== undefined) yield* change('processes', processId, { state: 'unknown', endedAt: yield* timestamp })
                const revision = yield* moveSession(sessionId, 'failed', { endedAt: yield* timestamp })
                yield* sessionFact(thread, sessionId, revision, 'provider_session.failed', { reason })
              }),
            )
            // The thread says why nothing happened, as well as the call that asked.
            yield* addItem({ projectId: thread.projectId, threadId: thread.threadId, sessionId }, 'notice', {
              source: 'runtime',
              severity: 'error',
              title: `${definition.name} couldn't start.`,
              ...(summary === '' ? {} : { description: summary }),
            })
            return yield* new SessionFailed({ agentId: definition.id, reason, summary })
          }
          const { connection, agent } = started.value
          if (processId !== undefined && connection.process !== undefined) {
            yield* change('processes', processId, {
              pid: connection.process.pid,
              processGroupId: connection.process.pid,
              osStartedAt: connection.process.osStartedAt ?? null,
              environmentDigest: connection.process.environmentDigest,
              state: 'running',
            })
          }
          return { sessionId, entry, account, thread, connection, agent, scope, revokeTools: tools.revoke }
        })

      /** The session takes over the thread: it is recorded as active, and delivers the brief and any waiting input. */
      const activate = (
        connected: Effect.Success<ReturnType<typeof connectSession>>,
        brief: { readonly text: string; readonly closing: string },
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const { sessionId, entry, account, thread, connection, agent, scope, revokeTools } = connected
          const { definition } = entry
          const options = yield* agent.options
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const revision = yield* moveSession(sessionId, 'active', {
                externalSessionId: agent.sessionId,
                model: optionValue(options, definition.options.model),
                effort: optionValue(options, definition.options.effort),
                config: JSON.stringify({ mode: yield* agent.mode, agent: connection.info, options }),
              })
              yield* sessionFact(thread, sessionId, revision, 'provider_session.active', {
                externalSessionId: agent.sessionId,
                mode: yield* agent.mode,
              })
            }),
          )
          const running: Running = {
            sessionId,
            entry,
            account,
            thread,
            agent,
            connection,
            scope,
            wake: yield* Queue.sliding<void>(1),
            delivering: yield* Semaphore.make(1),
            stopRequest: yield* Deferred.make<StopRequest>(),
            ended: yield* Deferred.make<void>(),
            brief,
            revokeTools,
            turnRunning: false,
            stopping: false,
            context: null,
            recording: undefined,
            settleBetween: Effect.void,
            background: new Map(),
            handover: 'none',
          }
          threads.set(thread.threadId, running)
          yield* Effect.forkIn(run(deliveries(running)), scope)
          // What the agent says between turns, such as leaving plan mode, goes to the thread too.
          const between = recorder({ projectId: thread.projectId, threadId: thread.threadId, sessionId, folders: foldersOf(thread) })
          const heard = yield* betweenTurns(between, scope)
          running.settleBetween = heard.close
          // A turn that already started records itself; between turns, this one does.
          running.recording ??= between
          yield* Effect.forkIn(
            run(
              Stream.runForEach(agent.events, (event) =>
                Effect.andThen(
                  Effect.andThen(
                    Effect.andThen(
                      Effect.andThen(
                        Effect.sync(() => heardContext(running, event)),
                        heard.record(event),
                      ).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not record an agent event', cause))),
                      heardBackground(running, event),
                    ),
                    live.publish({ _tag: 'Agent', threadId: thread.threadId, event }),
                  ),
                  // A coordinator that says between turns its context is filling up is handed over now, not at its next turn.
                  Effect.suspend(() =>
                    event._tag === 'ContextUsage' &&
                    thread.role === 'coordinator' &&
                    !running.turnRunning &&
                    dueForHandover(running.context)
                      ? Queue.offer(running.wake, undefined)
                      : Effect.void,
                  ),
                ),
              ),
            ),
            scope,
          )
          yield* Effect.forkIn(run(supervise(running)), sessionsScope)
          const model = optionValue(options, definition.options.model)
          yield* live.publish({
            _tag: 'SessionStarted',
            threadId: thread.threadId,
            sessionId,
            agentId: definition.id,
            ...(model === null ? {} : { model }),
          })
          yield* Queue.offer(running.wake, undefined)
          return sessionId
        })

      /**
       * Ends the turn running, then the session. An agent that doesn't end its
       * turn when asked is stopped with its process, so stopping never waits
       * on it for ever; the turn it was on is recorded as cut short.
       */
      const stopRunning = (running: Running, request: StopRequest) =>
        Effect.gen(function* () {
          running.stopping = true
          // What it asked the person stays for them, though its turn ends now: the answer goes to the agent on the thread next.
          yield* questions.release(running.sessionId)
          const ended = yield* Effect.andThen(
            Effect.ignore(running.agent.interrupt),
            running.delivering.withPermits(1)(Deferred.succeed(running.stopRequest, request)),
          ).pipe(Effect.timeoutOption(stopGrace))
          if (Option.isNone(ended)) {
            yield* Deferred.succeed(running.stopRequest, request)
            yield* Scope.close(running.scope, Exit.void)
          }
          yield* Deferred.await(running.ended)
        })

      /** Start, switch and stop on one thread happen one at a time. */
      const locks = new Map<string, Semaphore.Semaphore>()
      const exclusive = <A, E, R>(threadId: string, effect: Effect.Effect<A, E, R>) =>
        Effect.suspend(() => {
          const lock = locks.get(threadId) ?? Semaphore.makeUnsafe(1)
          locks.set(threadId, lock)
          return lock.withPermits(1)(effect)
        })

      const start = (input: {
        readonly threadId: string
        readonly agentId: string
        readonly model?: string
        readonly effort?: string
        readonly accountId?: string
      }) =>
        exclusive(
          input.threadId,
          Effect.gen(function* () {
            if (threads.has(input.threadId)) return yield* new SessionRunning({ threadId: input.threadId })
            yield* inLiveProject(input.threadId)
            yield* notAbandoned(input.threadId)
            const thread = yield* loadThread(input.threadId)
            const entry = yield* (yield* Agents).get(input.agentId)
            const account = yield* limits.pick({
              agentId: entry.definition.id,
              projectId: thread.projectId,
              threadId: input.threadId,
              ...accountOf(input),
            })
            const sessionId = yield* createSession(thread, entry.definition.id, account, input.model)
            const connected = yield* connectSession(thread, sessionId, entry, account, input.model, input.effort)
            // Every session starts from a brief (ADR-005), even the first on a task.
            return yield* activate(connected, {
              text: yield* briefFor(thread, { kind: 'start' }),
              closing: thread.role === 'reviewer' ? 'Review the change.' : 'Start on the task.',
            })
          }),
        )

      /*
       * A message is taken back only while it waits: not once a turn has it.
       * A turn takes its input in a transaction that checks it still waits,
       * and this one checks no turn has it, so the two can't both have it.
       */
      const takeBack = (input: { readonly envelope: CommandEnvelope; readonly itemId: string }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const commands = yield* Commands
          const [item] = yield* sql<{
            inputId: string
            projectId: ProjectId
          }>`SELECT user_input_id AS input_id, project_id FROM thread_items WHERE id = ${input.itemId} AND user_input_id IS NOT NULL`
          if (item === undefined) return yield* new NotFound({ kind: 'thread item', id: input.itemId })
          yield* commands.execute({
            envelope: input.envelope,
            projectId: item.projectId,
            result: Schema.Void,
            handle: Effect.gen(function* () {
              const [waiting] = yield* sql<{ id: string }>`
                SELECT u.id FROM user_inputs u
                WHERE u.id = ${item.inputId} AND u.state = 'queued'
                  AND NOT EXISTS (SELECT 1 FROM turn_delivery_inputs di JOIN turn_deliveries d ON d.id = di.delivery_id
                    WHERE di.user_input_id = u.id AND d.state = 'pending')`
              if (waiting === undefined) return yield* new AlreadyDelivered({ itemId: input.itemId })
              const revision = yield* change('user_inputs', item.inputId, { state: 'withdrawn' })
              yield* fact({
                projectId: item.projectId,
                aggregateType: 'user_input',
                aggregateId: item.inputId,
                revision,
                type: 'user_input.withdrawn',
                actorId: input.envelope.actorId,
                commandId: input.envelope.commandId,
              })
            }),
          })
        })

      const send = (input: {
        readonly envelope: CommandEnvelope
        readonly threadId: string
        readonly body: string
        readonly disposition?: Disposition
        readonly images?: ReadonlyArray<InputImage>
        readonly quiet?: boolean
      }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const commands = yield* Commands
          const artifacts = yield* Artifacts
          const images = input.images ?? []
          const disposition = input.disposition ?? 'after_current'
          const [thread] = yield* sql<{ projectId: ProjectId }>`SELECT project_id FROM threads WHERE id = ${input.threadId}`
          if (thread === undefined) return yield* new NotFound({ kind: 'thread', id: input.threadId })
          const accepted = yield* commands.execute({
            envelope: input.envelope,
            projectId: thread.projectId,
            result: AcceptedInput,
            handle: Effect.gen(function* () {
              // In the command's transaction, so a removal either came first or sees what was said.
              yield* inLiveProject(input.threadId)
              const inputId = yield* newId(Ids.userInput)
              const [next] = yield* sql<{
                sequence: number
              }>`SELECT coalesce(max(sequence), 0) + 1 AS sequence FROM user_inputs WHERE thread_id = ${input.threadId}`
              const sequence = next?.sequence ?? 1
              yield* sql`INSERT INTO user_inputs ${sql.insert({
                id: inputId,
                projectId: thread.projectId,
                threadId: input.threadId,
                sequence,
                commandId: input.envelope.commandId,
                disposition,
                body: input.body,
                authorActorId: input.envelope.actorId,
                state: 'queued',
                acceptedAt: yield* timestamp,
              })}`
              // Its images, in order, each an artifact the input refers to; their bytes are in the store already.
              const kept = yield* Effect.forEach(images, (image, index) =>
                Effect.gen(function* () {
                  const artifact = {
                    projectId: thread.projectId,
                    sha256: image.sha256,
                    size: image.size,
                    mediaType: image.mediaType,
                    kind: 'image' as const,
                    // A screenshot can show anything on the screen.
                    sensitivity: 'may_contain_secrets' as const,
                  }
                  const artifactId = yield* artifacts.record({ ...artifact, subject: { type: 'user_input', id: inputId, role: 'image' } })
                  yield* sql`INSERT INTO user_input_images ${sql.insert({ projectId: thread.projectId, userInputId: inputId, position: index + 1, artifactId })}`
                  return { artifact, picture: { artifactId, ...image, bytes: image.size } }
                }),
              )
              if (input.quiet !== true) {
                const itemId = yield* addItem(
                  { projectId: thread.projectId, threadId: input.threadId },
                  'user_message',
                  {
                    text: input.body,
                    // As a picture an agent hands back is kept on its item: what it is, and its digest.
                    ...(kept.length === 0
                      ? {}
                      : {
                          pictures: kept.map(({ picture }) => ({
                            artifactId: picture.artifactId,
                            sha256: picture.sha256,
                            mediaType: picture.mediaType,
                            bytes: picture.bytes,
                            width: picture.width,
                            height: picture.height,
                            name: picture.name,
                          })),
                        }),
                  },
                  { userInputId: inputId },
                )
                // The item names them too, so it is one of what refers to them.
                for (const { artifact } of kept)
                  yield* artifacts.record({ ...artifact, subject: { type: 'thread_item', id: itemId, role: 'image' } })
              }
              yield* fact({
                projectId: thread.projectId,
                aggregateType: 'user_input',
                aggregateId: inputId,
                revision: 1,
                type: disposition === 'interrupt_and_continue' ? 'user_input.interrupt_requested' : 'user_input.accepted',
                payload: { disposition, sequence, ...(images.length === 0 ? {} : { images: images.map((image) => image.sha256) }) },
                actorId: input.envelope.actorId,
                commandId: input.envelope.commandId,
              })
              return { inputId, sequence }
            }),
          })
          const running = threads.get(input.threadId)
          if (running !== undefined) {
            // The interruption is asked for after the input is safely queued; the queue puts it first.
            if (disposition === 'interrupt_and_continue' && running.turnRunning)
              yield* Effect.forkIn(Effect.ignore(running.agent.interrupt), sessionsScope)
            yield* Queue.offer(running.wake, undefined)
          }
          return accepted
        })

      const setModel = (input: { readonly threadId: string; readonly model: string }) =>
        Effect.gen(function* () {
          const running = threads.get(input.threadId)
          if (running === undefined) return yield* new NoSession({ threadId: input.threadId })
          const { definition } = running.entry
          const was = optionValue(yield* running.agent.options, definition.options.effort)
          yield* running.agent
            .setOption(definition.options.model, input.model)
            .pipe(
              Effect.mapError(
                (error) => new ModelUnchanged({ agentId: definition.id, model: input.model, summary: agentSaid(error) ?? error.message }),
              ),
            )
          // It keeps its effort where the model offers it, as most agents do by themselves; else the person's default for it, or its own.
          yield* settleEffort(definition, running.agent, was)
          const options = yield* running.agent.options
          // What the agent says it is on now, which is what the thread says too, whatever was asked for.
          const model = optionValue(options, definition.options.model) ?? input.model
          const sql = yield* SqlClient.SqlClient
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const revision = yield* change('provider_sessions', running.sessionId, {
                model,
                effort: optionValue(options, definition.options.effort),
              })
              yield* sessionFact(running.thread, running.sessionId, revision, 'provider_session.model_changed', {
                model,
                ...(model === input.model ? {} : { asked: input.model }),
              })
            }),
          )
          yield* addItem({ projectId: running.thread.projectId, threadId: input.threadId, sessionId: running.sessionId }, 'notice', {
            source: 'runtime',
            severity: 'info',
            title: `Model changed to ${model}.`,
          })
        })

      const setEffort = (input: { readonly threadId: string; readonly effort: string }) =>
        Effect.gen(function* () {
          const running = threads.get(input.threadId)
          if (running === undefined) return yield* new NoSession({ threadId: input.threadId })
          const { definition } = running.entry
          const unchanged = (summary: string) => new EffortUnchanged({ agentId: definition.id, effort: input.effort, summary })
          if (definition.options.effort === undefined) return yield* unchanged('It offers no choice of effort.')
          const options = yield* running.agent
            .setOption(definition.options.effort, input.effort)
            .pipe(Effect.mapError((error) => unchanged(agentSaid(error) ?? error.message)))
          const sql = yield* SqlClient.SqlClient
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const revision = yield* change('provider_sessions', running.sessionId, {
                effort: optionValue(options, definition.options.effort),
              })
              yield* sessionFact(running.thread, running.sessionId, revision, 'provider_session.effort_changed', { effort: input.effort })
            }),
          )
          const named = options
            .find((option) => option.id === definition.options.effort)
            ?.choices.find((choice) => choice.value === input.effort)
          yield* addItem({ projectId: running.thread.projectId, threadId: input.threadId, sessionId: running.sessionId }, 'notice', {
            source: 'runtime',
            severity: 'info',
            title: `Effort changed to ${(named?.name ?? input.effort).toLowerCase()}.`,
          })
        })

      /** The thread so far, for a brief, oldest first, within the prompt's budget. */
      const threadSoFar = (threadId: string) =>
        Effect.map(transcript(threadId, PROMPT_BUDGET), (record) =>
          record.text === ''
            ? []
            : [
                record.omitted > 0
                  ? `The thread so far, oldest first (the ${record.omitted} earliest items are left out):`
                  : 'The thread so far, oldest first:',
                record.text,
              ],
        )

      /**
       * The brief a session starts from (ADR-005): for a task, the task, where
       * its worktree stands (the plan, and the change so far), and the thread;
       * for the coordinator, its role, the project, and the thread.
       */
      const briefFor = (
        thread: ThreadContext,
        why: { readonly kind: 'start' } | { readonly kind: 'takeover'; readonly from: string | undefined },
      ): Effect.Effect<string, SqlError.SqlError, Store> =>
        thread.role === 'coordinator' ? coordinatorBrief(thread) : thread.role === 'reviewer' ? reviewBrief(thread) : taskBrief(thread, why)

      /** A reviewer's brief: the task, how to see the change, what it may do, and how to report. */
      const reviewBrief = (thread: ReviewThread) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [lead] = yield* sql<{ content: string }>`
            SELECT i.content FROM thread_items i JOIN threads t ON t.id = i.thread_id
            WHERE t.task_id = ${thread.taskId} AND t.kind = 'task' AND i.kind = 'step_result'
            ORDER BY i.sequence DESC LIMIT 1`
          const summary = lead === undefined ? '' : ((JSON.parse(lead.content) as { summary?: string }).summary ?? '')
          // The lead's evidence, written beside the copies it reads: what it left uncommitted, or git keeps out, isn't in them.
          const [taskThread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${thread.taskId} AND kind = 'task'`
          const [first] = thread.repositories
          const shown =
            taskThread === undefined || first === undefined
              ? ''
              : yield* evidenceForReview(taskThread.id, evidenceFolderOf(first.worktree)).pipe(Effect.orElseSucceed(() => ''))
          return [
            "You are reviewing another agent's change, in Althar. You only read: you may read files, search, and run commands that only look, such as git diff. You change nothing; the task's lead settles what you find.",
            `The task: ${thread.title}${thread.description === '' ? '' : `\n\n${thread.description}`}`,
            ...askedFor(thread),
            thread.repositories.length === 1
              ? `The change is in ${thread.repositories[0]?.worktree ?? thread.cwd}: a copy of the lead's work as it stood when this round began, which Althar throws away after; nothing you do there reaches the lead. See the change with \`git diff ${thread.repositories[0]?.baseCommit ?? 'HEAD~1'}\` there; new files are in it.`
              : `The change spans several repositories, each copied as the lead's work stood when this round began, side by side in ${thread.cwd}; Althar throws them away after, and nothing you do there reaches the lead. See each one's change with git diff there; new files are in it:\n${thread.repositories.map((repository) => `- ${repository.name}: ${repository.worktree}, \`git diff ${repository.baseCommit ?? 'HEAD~1'}\``).join('\n')}`,
            ...(summary === '' ? [] : [`The lead says:\n${summary}`]),
            ...(shown === '' ? [] : [shown]),
            "Look for what would make the change wrong or unsafe to merge: bugs, missed cases, broken behaviour, security, tests that don't test it. Not style the project doesn't ask for. Where the lead's evidence leaves out something important the change should be seen doing, say so as a minor finding; that alone doesn't fail a review. Then call Althar's report_review tool once: a verdict (pass, or changes_requested), a summary of a few lines, and your findings, each with its severity (blocking, major, minor or nit), where it is, and what is wrong. With no findings worth fixing, the verdict is pass.",
            ...(yield* threadSoFar(thread.threadId)),
          ].join('\n\n')
        })

      const taskBrief = (
        thread: TaskThread,
        why: { readonly kind: 'start' } | { readonly kind: 'takeover'; readonly from: string | undefined },
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          // The project's repositories the task doesn't change, which it may read where the person keeps them.
          const others = yield* sql<{ name: string; role: string; path: string }>`
            SELECT b.display_name AS name, b.role, l.path FROM repository_bindings b
            JOIN repository_locations l ON l.binding_id = b.id AND l.device_id = ${instance.deviceId}
            WHERE b.project_id = ${thread.projectId} AND b.detached_at IS NULL
              AND b.id NOT IN (SELECT w.binding_id FROM workspaces w WHERE w.task_id = ${thread.taskId})
            ORDER BY b.created_at, b.rowid`
          const [plan] = yield* sql<{ content: string }>`
            SELECT content FROM thread_items WHERE thread_id = ${thread.threadId} AND kind = 'plan' ORDER BY sequence DESC LIMIT 1`
          // Whether the task, or else its project, has its lead resolve conflicts on its own: then Althar pushes that merge (ADR-030).
          const [resolves] = yield* sql<{ resolves: number | null }>`
            SELECT coalesce(
              (SELECT resolve_conflicts FROM tasks WHERE id = ${thread.taskId}),
              (SELECT json_extract(rules, '$.resolveConflicts') FROM policies WHERE project_id = ${thread.projectId} ORDER BY revision DESC LIMIT 1)
            ) AS resolves`
          const entries =
            plan === undefined
              ? []
              : ((JSON.parse(plan.content) as { entries?: ReadonlyArray<{ content: string; status: string }> }).entries ?? [])
          const quiet = (effect: Effect.Effect<string, unknown>) => effect.pipe(Effect.orElseSucceed(() => ''))
          const cap = (text: string) => (text.length > 4_000 ? `${text.slice(0, 4_000)}\n…` : text)
          const several = thread.repositories.length > 1
          // Where each repository stands, by name where there are several.
          const states = yield* Effect.forEach(thread.repositories, (repository) =>
            Effect.gen(function* () {
              const changed =
                repository.baseCommit === null ? '' : yield* quiet(git(repository.worktree, 'diff', '--stat', repository.baseCommit))
              const status = yield* quiet(git(repository.worktree, 'status', '--short'))
              const named = (text: string) => (several && text !== '' ? `${repository.name}:\n${text}` : text)
              return { changed: named(changed), status: named(status) }
            }),
          )
          const changed = states.flatMap((state) => (state.changed === '' ? [] : [state.changed])).join('\n')
          const status = states.flatMap((state) => (state.status === '' ? [] : [state.status])).join('\n')
          const where = (repository: TaskRepository) =>
            `${repository.worktree}, on the branch ${repository.branch}, which started from ${repository.baseRef}${repository.baseCommit === null ? '' : ` at ${repository.baseCommit.slice(0, 12)}`}${repository.within === null ? '' : `. The project is its folder ${repository.within}: start there, and change the rest of the repository where the task needs it`}`
          return [
            why.kind === 'start'
              ? several
                ? 'You are working on a task across several repositories, each in a git worktree of its own. Althar keeps its record and answers your permission requests.'
                : 'You are working on a task in a git worktree of its own. Althar keeps its record and answers your permission requests.'
              : `You are taking over a task${why.from === undefined ? '' : ` from ${why.from}`}, in the same ${several ? 'worktrees' : 'worktree'}. Its record so far is below.`,
            `Task: ${thread.title}${thread.description === '' ? '' : `\n\n${thread.description}`}`,
            ...askedFor(thread),
            several
              ? `Its repositories are side by side in ${thread.cwd}, each with its own branch and history; commit in each one you change:\n${thread.repositories.map((repository) => `- ${withRole(repository.name, repository.role)}: ${where(repository)}.`).join('\n')}`
              : `The worktree is ${thread.repositories[0] === undefined ? thread.worktree : `${where(thread.repositories[0])}. The repository is ${withRole(thread.repositories[0].name, thread.repositories[0].role)}`}.`,
            ...(others.length === 0
              ? []
              : [
                  `The project's other repositories, to read but not change (they are the person's own checkouts, on whatever branch they left them): ${others.map((other) => `${withRole(other.name, other.role)}, at ${other.path}`).join('; ')}.`,
                ]),
            // How the step ends: the lead says so, with what the person reads instead of the whole turn.
            "When you have done the task, or can't go further without the person, call Althar's finish_step tool with a summary of a few lines: what you changed, how you checked it, and anything left open. The person reads that summary rather than everything you did.",
            // What the lead shows of its work: evidence that fits the task, and what it couldn't show.
            "As you work, gather evidence that the change does what it should, and hand it with finish_step, each piece with a caption saying what it shows. Choose what fits the task: for a change someone sees, screenshots of the states you changed (the repository's docs may say how to take them); otherwise the test run or command that shows it, with its exit code and output, a response, a log, or a before and after. Where nothing fits, as for a typo or a version bump, a single note saying so is enough. Don't say something works without showing it: what you changed but couldn't show working, and why, goes in `unverified`, which the person reads as what is still theirs to check.",
            // Althar reaches the code host for the task (ADR-011).
            "Commit your work on the task's branch as you go. Don't push, or open or change pull requests, or use gh or glab to change anything on the code host: when the plan's steps are done, Althar pushes the branch and opens the task's pull request, where the repository's host is connected to Althar. Where it isn't, the task ends on its branch, and the person opens its pull request from Althar once they connect the host. After that, read it with Althar's read_pull_request tool, and answer what people say on it with reply_on_pull_request. Commit what you change after: it goes up only when the person pushes it. When they ask you to push, or what you committed should go up, call push_to_pull_request: it shows them the commits with a Push button, and you're told once they've pushed. Never say Althar will push it by itself, or that it's up before you're told. read_issue reads the issue the task came from, or any other.",
            ...(resolves?.resolves === 1
              ? [
                  'This project has you resolve a conflict with the default branch on your own: Althar tells you when it finds one, and what to merge. On a pull request, Althar pushes that merge itself once you commit it, and then a fix you commit on top of it, as one commit, when Althar tells you its checks failed. Nothing else you commit is pushed for you, and you still never push.',
                ]
              : []),
            // Althar runs the project for the person itself (ADR-023): the lead keeps how, when it changes it.
            'Althar runs the project for the person, with no agent, from a command it works out from the repository or keeps for it. If you change how the project runs, such as its dev script, its port or what it needs installed first, keep it with set_run_command.',
            ...(entries.length === 0 ? [] : [`The plan:\n${entries.map((entry) => `- [${entry.status}] ${entry.content}`).join('\n')}`]),
            ...(changed === '' ? [] : [`Changed since the start:\n${cap(changed)}`]),
            ...(status === '' ? [] : [`Not yet committed:\n${cap(status)}`]),
            ...(yield* threadSoFar(thread.threadId)),
          ].join('\n\n')
        })

      /** The coordinator's role: what it does, where it reads the project's repositories, its tools, and how it picks models for work. */
      const coordinatorRole = (thread: CoordinatorThread) => {
        const repositories = thread.folder.repositories
        return [
          `You are the coordinator of the project ${thread.projectName}, in Althar. You talk with the person about the project as a whole: you answer their questions about the code and the work, and you turn the changes they want into tasks. You never change anything yourself, not even a one-line fix: a change is always a task, which its lead, a model you pick, does in a worktree of its own.`,
          repositories.length === 0
            ? 'The project has no repositories yet.'
            : `Your working folder holds read-only copies of the project's repositories, fresh from their default branches:\n${repositories
                .map((repository) =>
                  repository.within === null
                    ? `- ${repository.name}: ${repository.path} (${repository.base})`
                    : `- ${repository.name}, its folder ${repository.within}: ${repository.path} (${repository.base}). That folder is what the project is about; the rest of the repository is in ${repository.root}.`,
                )
                .join(
                  '\n',
                )}\nRead and search them to answer questions and to plan. Anything you write there is thrown away. Commands that change anything, such as installing packages or starting a server, are refused there by Althar, for your role, not by the person. To run the project, use run_project.`,
          [
            "To get a change made, use Althar's tools:",
            `- draft_task, with a title that says what should change in a few words, at most 60 characters, and a description with what the lead needs: the context, where to look, constraints, and what done looks like.${repositories.length > 1 ? ' Name the repositories it changes, as repositories; its lead can still read the others.' : ''}`,
            '- list_models, for the models you can give work to now, with how each scores, whether a plan pays for it, and the efforts it takes.',
            '- propose_plan, for the task you drafted: the model that implements it (its lead) and why, in a sentence, and the model that reviews it, or no review for something trivial; each with an effort where it matters. The reviewer only reads; the lead then settles what it finds. The plan starts on its own after 25 seconds, unless the person changes or holds it.',
            "- run_project, when the person wants to see the project running: Althar runs it itself, with no agent, in a fresh copy of the default branch, or with task in that task's worktree to see what it built. It shows over the composer with where it answers. When Althar can't tell how the project runs, or tells wrong, read the repository and keep how with set_run_command.",
            "- start_task, for something small to do now, with no plan: trying something out, checking how something behaves, a quick look that needs the project's tools. One lead, a quick model is enough; no review, nothing published, and it starts at once. To try what a task has built, ask its lead with message_lead: its branch is in its worktree.",
            '- list_tasks, read_task and read_thread, to see what is under way and how it went. read_thread without a task reads your conversation with the person, back to its start.',
            "- read_issue and find_issues, for the issues on the person's connected trackers and in the project's repository. When the person points at an issue, read it, and draft the task from it with its link or key as draft_task's issue.",
            "- draft_issue, when the person wants something tracked rather than done now, such as a bug you found or follow-up work, as an issue on one of their connected trackers. It files nothing: the person sees it as a card, and files it, changes it or discards it there. Once they file it, you hear its key and link, and a task drafted from it later takes that as draft_task's issue.",
            "- message_lead, to pass something to a task's lead.",
            "- keep_note, list_notes and drop_note, for the project's notes: decisions the person makes in conversation that the code doesn't show, such as \"issue drafts need an approval card, on every tracker\" or \"dependency setup runs outside the sandbox; don't widen the lead's sandbox\". When the person decides something like that, keep it in a sentence, without asking; drop a note they take back. Every session of yours starts with the notes, and the person sees them in the project's settings.",
          ].join('\n'),
          [
            'How to pick a model for a step: call list_models first, and pick by what the step needs, not by who makes the model. Be impartial between makers; go by the scores and the work.',
            '- A large, risky or open-ended change, or one that needs careful reasoning: one of the strongest models.',
            '- A small, well-scoped change, such as a rename, a copy fix or a version bump: a quicker, cheaper model is enough.',
            '- Prefer a model a plan pays for over one paid per use, when they would do the work as well.',
            "- Review with a model from a different maker than the lead's, where one can be used.",
          ].join('\n'),
          [
            "How to set a step's effort: by what the step needs, as one of the efforts list_models gives for its model.",
            '- Open-ended, risky or reasoning-heavy work: a higher effort.',
            '- A small, well-scoped change: a low effort, or leave it out.',
            '- A reviewer: usually leave it out.',
            '- Follow what the person has said they prefer, such as an effort for prototypes.',
            "- When unsure, leave it out: the step starts at the person's default for its model, or else at the model's own.",
          ].join('\n'),
          'Answer questions yourself; changes, and anything to try out, become tasks. Keep your replies short: the person sees each task as a card, so say in a sentence what you planned, and not the plan itself again.',
        ]
      }

      /** The coordinator's brief: its role, the project's notes, and the thread so far. */
      const coordinatorBrief = (thread: CoordinatorThread) =>
        Effect.gen(function* () {
          const notes = yield* notesOf(thread.projectId)
          return [
            ...coordinatorRole(thread),
            ...(notes.length === 0 ? [] : [notesSection(notes)]),
            ...(yield* threadSoFar(thread.threadId)),
          ].join('\n\n')
        })

      /** Names models by what each agent says of them, or by their ids where that can't be read. */
      const byId: ModelNamer = (step) => step.model ?? `${step.agentId}'s default model`

      /**
       * A fresh coordinator session's brief, when Althar hands the
       * conversation over (ADR-031): its role, then what it takes over, from
       * the records rather than the raw thread. And how many tasks are open.
       */
      const handoverBrief = (thread: CoordinatorThread) =>
        Effect.gen(function* () {
          const modelOf = yield* modelNamer.pipe(
            Effect.catchCause((cause) =>
              Effect.as(Effect.logWarning('Could not read the models to name for the coordinator', cause), byId),
            ),
          )
          const record = yield* handoverRecord({
            projectId: thread.projectId,
            threadId: thread.threadId,
            modelOf,
            working: (threadId) => threads.get(threadId)?.turnRunning === true,
          })
          return { text: [...coordinatorRole(thread), ...record.sections].join('\n\n'), open: record.open }
        })

      /**
       * Hands the thread to another agent. The new agent is started first; only
       * once it is ready is the old one stopped, so a switch that fails leaves
       * the old agent working. The brief is written after the old one stops, so
       * it holds everything the old one did. What the person said with the
       * switch is queued once the old one has stopped, so it is the new one's
       * first turn, after the brief, and never the old one's.
       */
      const switchAgent = (input: {
        readonly threadId: string
        readonly agentId: string
        readonly model?: string
        readonly effort?: string
        readonly said?: string
        readonly about?: 'limit' | 'stall'
        readonly accountId?: string
        readonly message?: { readonly envelope: CommandEnvelope; readonly body: string; readonly images?: ReadonlyArray<InputImage> }
      }) =>
        exclusive(
          input.threadId,
          Effect.gen(function* () {
            yield* notAbandoned(input.threadId)
            const thread = yield* loadThread(input.threadId)
            const entry = yield* (yield* Agents).get(input.agentId)
            const previous = threads.get(input.threadId)
            const from = previous?.entry.definition.name
            const account = yield* limits.pick({
              agentId: entry.definition.id,
              projectId: thread.projectId,
              threadId: input.threadId,
              ...accountOf(input),
            })
            const sessionId = yield* createSession(thread, entry.definition.id, account, input.model)
            const connected = yield* connectSession(thread, sessionId, entry, account, input.model, input.effort)
            if (previous !== undefined) yield* stopRunning(previous, { state: 'superseded', by: sessionId })
            yield* addItem({ projectId: thread.projectId, threadId: thread.threadId, sessionId }, 'notice', {
              source: 'runtime',
              severity: 'info',
              title:
                input.said ??
                (from === undefined ? `${entry.definition.name} takes over.` : `Switched from ${from} to ${entry.definition.name}.`),
              ...(input.about === undefined ? {} : { about: input.about }),
            })
            if (input.message !== undefined)
              yield* send({
                envelope: input.message.envelope,
                threadId: input.threadId,
                body: input.message.body,
                ...(input.message.images === undefined ? {} : { images: input.message.images }),
              })
            const brief = yield* briefFor(thread, { kind: 'takeover', from })
            return yield* activate(connected, { text: brief, closing: 'Carry on with the task from where it stands.' })
          }),
        )

      /**
       * Hands the coordinator's conversation to a fresh session once its
       * context is filling up (ADR-031): the same agent, account, model and
       * effort, briefed from Althar's records. It starts between turns: the
       * old session takes no more, and what the person says meanwhile waits
       * for the new one. The new session is started before the old one stops,
       * so a handover that fails leaves the old one carrying on, its agent
       * compacting its context itself as before.
       */
      const handOver = (previous: Running): Effect.Effect<void, never, Store> =>
        exclusive(
          previous.thread.threadId,
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const { thread } = previous
            // Stopped or switched while it waited: nothing is left to hand over.
            if (thread.role !== 'coordinator' || threads.get(thread.threadId) !== previous || previous.stopping) return
            const [session] = yield* sql<{ model: string | null; effort: string | null }>`
              SELECT model, effort FROM provider_sessions WHERE id = ${previous.sessionId}`
            const model = session?.model ?? undefined
            const effort = session?.effort ?? undefined
            // Written first: the old session takes no more turns, so the record already holds everything it did.
            const brief = yield* handoverBrief(thread)
            // A brief that would fill a fresh session as far would only be due again: the old one carries on as it is.
            if (!roomFor(brief.text, previous.context)) {
              yield* Effect.logWarning('The coordinator is left to compact by itself: its brief would fill a fresh session')
              previous.handover = 'left'
              return yield* Queue.offer(previous.wake, undefined)
            }
            const sessionId = yield* createSession(thread, previous.entry.definition.id, previous.account, model)
            const connected = yield* connectSession(thread, sessionId, previous.entry, previous.account, model, effort)
            yield* stopRunning(previous, { state: 'superseded', by: sessionId })
            yield* addItem({ projectId: thread.projectId, threadId: thread.threadId, sessionId }, 'notice', {
              source: 'runtime',
              severity: 'info',
              title:
                brief.open === 0
                  ? 'Started a fresh session.'
                  : `Started a fresh session; picked up ${brief.open} open ${brief.open === 1 ? 'task' : 'tasks'}.`,
            })
            yield* activate(connected, { text: brief.text, closing: 'Carry the conversation on from where it stands.' })
          }),
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.andThen(
              Effect.logWarning('Could not hand the coordinator to a fresh session', cause),
              // It carries on as it is, with what waited for it.
              Effect.suspend(() => {
                if (threads.get(previous.thread.threadId) !== previous) return Effect.void
                previous.handover = 'left'
                return Queue.offer(previous.wake, undefined)
              }),
            ),
          ),
        )

      // Quitting stops every session the way `stop` does: the turn ends, the process stops, and both are recorded.
      yield* Effect.addFinalizer(() =>
        Effect.forEach(
          [...threads.values()],
          (running) => Effect.ignore(stopRunning(running, { state: 'completed' }).pipe(Effect.timeout(Duration.seconds(15)))),
          {
            concurrency: 'unbounded',
            discard: true,
          },
        ),
      )

      const startLast = (threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [last] = yield* sql<{ agentId: string; model: string | null; effort: string | null }>`
            SELECT agent_id, model, effort FROM provider_sessions WHERE thread_id = ${threadId} ORDER BY started_at DESC LIMIT 1`
          if (last === undefined) return false
          yield* start({
            threadId,
            agentId: last.agentId,
            ...(last.model === null ? {} : { model: last.model }),
            ...(last.effort === null ? {} : { effort: last.effort }),
          })
          return true
        })

      return Sessions.of({
        start: (input) => run(start(input)),
        startLast: (threadId) => run(startLast(threadId)),
        send: (input) => run(send(input)),
        takeBack: (input) => run(takeBack(input)),
        setModel: (input) => run(setModel(input)),
        setEffort: (input) => run(setEffort(input)),
        wake: (threadId) =>
          Effect.suspend(() => {
            const running = threads.get(threadId)
            return running === undefined ? Effect.void : Queue.offer(running.wake, undefined).pipe(Effect.asVoid)
          }),
        switchAgent: (input) => run(switchAgent(input)),
        interrupt: (threadId) =>
          Effect.suspend(() => {
            const running = threads.get(threadId)
            return running === undefined ? Effect.fail(new NoSession({ threadId })) : Effect.ignore(running.agent.interrupt)
          }),
        stop: (threadId) =>
          exclusive(
            threadId,
            Effect.suspend(() => {
              const running = threads.get(threadId)
              return running === undefined ? Effect.fail(new NoSession({ threadId })) : stopRunning(running, { state: 'completed' })
            }),
          ),
        running: (threadId) =>
          Effect.sync(() => {
            const running = threads.get(threadId)
            return running === undefined
              ? Option.none()
              : Option.some({
                  sessionId: running.sessionId,
                  agentId: running.entry.definition.id,
                  accountId: running.account.id,
                  turnRunning: running.turnRunning,
                  pid: running.connection.process?.pid ?? null,
                  context: running.context,
                  stopping: running.stopping,
                  background: [...running.background.values()].map(shownOf),
                })
          }),
        stopBackground: (threadId, id) =>
          Effect.gen(function* () {
            const running = threads.get(threadId)
            const left = running?.background.get(id)
            if (running === undefined || left === undefined) return
            // Ended by itself, there is nothing to stop. Gone already as the agent tells it, it goes from the list all the same.
            if (left.ended === null) yield* running.agent.stopBackground(id)
            running.background.delete(id)
            yield* toldBackground(running)
          }),
        clearBackground: (threadId, id) =>
          Effect.gen(function* () {
            const running = threads.get(threadId)
            if (running === undefined || running.background.get(id)?.ended == null) return
            running.background.delete(id)
            yield* toldBackground(running)
          }),
        outputSoFar: (threadId, itemId) => Effect.sync(() => Option.fromNullishOr(threads.get(threadId)?.recording?.outputOf(itemId))),
        gateTurns: (next) =>
          Effect.sync(() => {
            gate = next
          }),
        onTasks: Effect.sync(() =>
          [...threads.values()].flatMap((running) =>
            running.thread.role === 'coordinator'
              ? []
              : [
                  {
                    threadId: running.thread.threadId,
                    taskId: running.thread.taskId,
                    reviewer: running.thread.role === 'reviewer',
                    turnRunning: running.turnRunning,
                    background: [...running.background.values()].some((left) => left.ended === null),
                  },
                ],
          ),
        ),
      })
    }),
  )
}
