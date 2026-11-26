import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, posix, relative, sep } from 'node:path'
import { type ProjectWorker, type WorkerUnfit, workerName, workerNameOf, workerUnfitWords } from '@althar/contracts'
import { WORKER_REPOSITORY_FOLDER } from '@althar/worker-protocol/agent-runs'
import { Ids, type RecordEventId, type Timestamp, newId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import {
  AgentRequestFailed,
  AgentStartFailed,
  OptionUnavailable,
  type Question,
  type SessionEvent,
  type SessionOptions,
  type StopReport,
  adapterNode,
  connect,
  inFlatpakSandbox,
  skillsIn,
} from '@althar/provider-adapters'
import { Cause, Clock, Data, Deferred, Duration, Effect, Exit, Option, Queue, type Schema, Scope, Semaphore, Stream } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'
import type { Account, Accounts } from './Accounts'
import { heldSkillsFor, serversFor } from './agentTools'
import { touchCard } from './cards'
import { type AgentEntry, RuntimeConfig, type RuntimeOptions, SIGNED_OUT_GIT_CONFIG } from './Config'
import { redact } from './diagnostics'
import { SessionFailed } from './errors'
import type { FailuresService } from './Failures'
import type { InstanceInfo } from './Instance'
import { type LeftRunning, stillBusy } from './leftRunning'
import type { Limits } from './Limits'
import type { Live } from './Live'
import { WORK, workOf } from './machine'
import { type Permissions, type RequestContext, moveSession } from './Permissions'
import type { Policies } from './Policies'
import { processes, treeOf } from './ports'
import { guardEnv, guardHolds } from './pushGuard'
import type { Questions } from './Questions'
import type { Setups } from './Setups'
import { change, fact, timestamp } from './records'
import {
  type Brief,
  LEFT_STOPS_WITHIN,
  type Running,
  SESSION_START_TIMEOUT,
  StartTimedOut,
  type StopRequest,
  type Store,
  type ThreadContext,
  agentLost,
  cwdOf,
  foldersOf,
  heardContext,
  heldFor,
  offSwitchedOff,
  onlyReads,
  optionValue,
  settleEffort,
  skillsSaid,
  toolRoleOf,
  upFrontSaid,
} from './sessionState'
import { recordPlaces, sweepPlaces } from './sandboxLeftovers'
import { type RunSkills, refusalOf, runSkills } from './Skills'
import { blockGoalAfterDisconnect } from './threadGoals'
import { addItem, betweenTurns, recorder } from './threads'
import type { ToolServer } from './ToolServer'
import { ToolRefused } from './toolErrors'
import { taskWorker, type WorkerExecution } from './workerExecution'
import { workerSkillFiles } from './workerSkills'
import { workerStdioMcp } from './workerMcp'
import { startsAgain } from './startAgain'
import { needsAcross, needsOn, toolsToInstall } from './toolNeeds'
import { folderGoneWords, signInEndedWords, summarize } from './words'

export interface SessionConnectionsDependencies {
  readonly accounts: Accounts['Service']
  readonly asideState: (
    taskId: string,
  ) => Effect.Effect<{ aside: boolean; brought: boolean; unsaid: boolean }, SqlError.SqlError, SqlClient.SqlClient>
  readonly betweenAgents: Duration.Duration
  readonly deliveries: (running: Running) => Effect.Effect<never, SqlError.SqlError, Store>
  readonly failures: FailuresService
  readonly heardBackground: (running: Running, event: SessionEvent) => Effect.Effect<void>
  readonly heardPlan: (running: Running, event: SessionEvent) => Effect.Effect<void>
  readonly heardWork: (running: Running, event: SessionEvent) => Effect.Effect<void>
  readonly instance: InstanceInfo
  readonly limits: Limits['Service']
  readonly live: Live['Service']
  readonly permissions: Permissions['Service']
  readonly policies: Policies['Service']
  readonly questions: Questions['Service']
  /** Forgets what Althar holds of an agent, its sign-in as last checked and the models it offers, so both are read again. */
  readonly refreshAgent: (agentId: string) => Effect.Effect<void>
  readonly quietFor: Duration.Duration
  readonly run: <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.Effect<A, E>
  readonly runtimeConfig: RuntimeOptions
  readonly sessionFact: (
    thread: ThreadContext,
    sessionId: string,
    revision: number,
    type: string,
    payload?: unknown,
  ) => Effect.Effect<
    { readonly sequence: number; readonly id: RecordEventId; readonly occurredAt: Timestamp },
    SqlError.SqlError | Schema.SchemaError,
    Ledger
  >
  readonly sessionsScope: Scope.Closeable
  readonly sessionsSql: SqlClient.SqlClient
  readonly setups: Setups['Service']
  /** Whether the account's usage was last read as needing its sign-in again (PlanUsage). */
  readonly signInFault: (accountId: string) => Effect.Effect<boolean>
  readonly skillsConfig: RuntimeOptions['skills']
  readonly stopGrace: Duration.Duration
  readonly stopTrees: (running: Running, trees: ReadonlyArray<ReadonlyArray<number>>) => Effect.Effect<void>
  readonly threads: Map<string, Running>
  readonly toolServer: ToolServer['Service']
  readonly treeOfLeft: (running: Running, left: LeftRunning) => Effect.Effect<readonly number[]>
  readonly wakeFor: Duration.Duration
}

/** A first start that failed in a way that may pass: started again, once, afresh (`connectSession`). */
class StartAgain extends Data.TaggedError('StartAgain')<{}> {}

/** A first start whose agent's own program isn't there yet, or is of another version: looked for again a while (`connectSession`). */
class ProgramArriving extends Data.TaggedError('ProgramArriving')<{ readonly check: () => string | undefined }> {}

/**
 * How long a start waits for the program Althar brings for its agent, and
 * how often it looks: an install of Althar unpacks Claude Code's 364 MB in
 * minutes, and one under way when a start comes is usually done well within
 * a minute of it. A start never waits on it longer; a broken install is said
 * then, as it stands.
 */
const PROGRAM_WAIT = { every: Duration.seconds(3), within: Duration.minutes(1) }

/** The agent's whole answer to the request that failed its start, with any credential in it taken out, for the log and the record. */
const answerOf = (cause: Cause.Cause<unknown>): string | undefined => {
  const found = Cause.findErrorOption(cause)
  return Option.isSome(found) && found.value instanceof AgentRequestFailed && found.value.raw !== undefined
    ? redact(found.value.raw)
    : undefined
}

/** The variables a launch inherits from Althar's own environment, as `process.ts` hands them on. */
const inherited = (names: ReadonlyArray<string> | undefined): Record<string, string> =>
  Object.fromEntries((names ?? []).flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name]!]])))

export const makeSessionConnections = (dependencies: SessionConnectionsDependencies) => {
  const {
    accounts,
    betweenAgents,
    deliveries,
    failures,
    heardBackground,
    heardPlan,
    heardWork,
    instance,
    limits,
    live,
    permissions,
    policies,
    questions,
    quietFor,
    refreshAgent,
    run,
    runtimeConfig,
    sessionFact,
    sessionsScope,
    sessionsSql,
    setups,
    signInFault,
    skillsConfig,
    stopGrace,
    stopTrees,
    threads,
    toolServer,
    treeOfLeft,
    wakeFor,
  } = dependencies

  /**
   * Whether a start failed because the agent doesn't offer the step's model while its account's usage reads as needing its
   * sign-in again: a signed-out Codex lists fewer models, and its `login status` may still say it is signed in, so the model
   * missing is how its ended sign-in shows. Said as the sign-in, whose call offers signing in again, not as the model.
   */
  const signedOutRefusal = (cause: Cause.Cause<unknown>, definition: AgentEntry['definition'], account: Account) => {
    const error = Cause.findErrorOption(cause)
    return Option.isSome(error) && error.value instanceof OptionUnavailable && error.value.configId === definition.options.model
      ? signInFault(account.id)
      : Effect.succeed(false)
  }

  /**
   * Ends a session: closes it and its process, and records how both ended.
   * However recording it goes, its process is closed, the thread hears it
   * ended and whoever waits on it stops waiting: nothing is left holding
   * the session, nor stopping it, for ever.
   */
  const supervise = (running: Running) => {
    let ended: string | undefined
    let interrupted = false
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const outcome = yield* Effect.raceFirst(
        Effect.map(running.connection.closed, () => undefined),
        Deferred.await(running.stopRequest),
      )
      ended = outcome === undefined ? 'lost' : outcome.state
      running.stopping = true
      if (threads.get(running.thread.threadId) === running) threads.delete(running.thread.threadId)
      yield* running.revokeTools
      yield* permissions.withdrawAll(running.sessionId)
      // What it asked the person stays for them: the answer goes to the agent on the thread next.
      yield* questions.release(running.sessionId)
      yield* Scope.close(running.scope, Exit.void)
      const stop: StopReport | undefined = running.connection.process === undefined ? undefined : yield* running.connection.process.stopped
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
            state: string
          }>`SELECT id, state FROM turn_deliveries WHERE provider_session_id = ${running.sessionId} AND state IN ('pending', 'delivered')`
          // The prompt's exit handler may have recorded its failure before supervision got here.
          const [last] = yield* sql<{ state: string; errorClass: string | null }>`
                SELECT state, error_class FROM turn_deliveries WHERE provider_session_id = ${running.sessionId}
                ORDER BY requested_at DESC, rowid DESC LIMIT 1`
          interrupted = open.length > 0 || (last?.state === 'failed' && last.errorClass === 'agent_exited')
          for (const turn of open) {
            const stoppedBeforeDispatch = turn.state === 'pending' && outcome !== undefined
            const turnState = stoppedBeforeDispatch ? 'interrupted' : 'failed'
            const errorClass = stoppedBeforeDispatch ? null : 'agent_exited'
            yield* Effect.logWarning('Turn ended').pipe(
              Effect.annotateLogs({
                turn: turn.id,
                thread: running.thread.threadId,
                session: running.sessionId,
                agent: running.entry.definition.id,
                state: turnState,
                errorClass,
              }),
            )
            const revision = yield* change('turn_deliveries', turn.id, { state: turnState, errorClass, endedAt: at })
            yield* fact({
              projectId: running.thread.projectId,
              aggregateType: 'turn_delivery',
              aggregateId: turn.id,
              revision,
              type: `turn_delivery.${turnState}`,
              actorId: instance.systemId,
            })
          }
          const revision = yield* moveSession(running.sessionId, state, {
            endedAt: at,
            ...(outcome?.state === 'superseded' ? { supersededBySessionId: outcome.by } : {}),
          })
          yield* sessionFact(running.thread, running.sessionId, revision, `provider_session.${state}`, {
            ...(stop === undefined ? {} : { stop }),
            ...(outcome?.state === 'completed' ? { reason: outcome.reason } : {}),
          })
          if (state === 'lost' && running.thread.role === 'task' && running.thread.helper === undefined)
            yield* blockGoalAfterDisconnect(running.thread.threadId, running.sessionId)
        }),
      )
      // Its process has gone: what its sandbox left where nothing was takes nothing of the person's (sandboxLeftovers.ts).
      yield* sweepPlaces()
      // An idle disconnect lost no work. Only an interrupted turn needs a warning and a way out.
      if (state === 'lost' && interrupted)
        yield* addItem({ projectId: running.thread.projectId, threadId: running.thread.threadId, sessionId: running.sessionId }, 'notice', {
          source: 'runtime',
          severity: 'error',
          failure: 'agent_exited',
          title: `${running.entry.definition.name} stopped on its own.`,
          description: {
            task: 'Start the lead again to carry on.',
            coordinator: 'Say something to start it again.',
            reviewer: 'The review waits until the task resumes.',
          }[running.thread.role],
        })
      yield* (state === 'lost' && interrupted ? Effect.logWarning : Effect.logInfo)('Agent stopped').pipe(
        Effect.annotateLogs({
          agent: running.entry.definition.id,
          session: running.sessionId,
          thread: running.thread.threadId,
          state,
          ...(Option.isSome(exit) ? { exitCode: exit.value.code ?? 'none', signal: exit.value.signal ?? 'none' } : {}),
        }),
      )
      // One that went on its own is reported (ADR-047), by its agent and how its process ended: never what it wrote.
      if (state === 'lost' && interrupted)
        yield* failures.report(Cause.die(agentLost(running.entry.definition.id, exit)), 'agent', running.entry.definition.id)
    }).pipe(
      Effect.ensuring(
        Effect.suspend(() =>
          Effect.andThen(
            Effect.andThen(
              Scope.close(running.scope, Exit.void),
              ended === undefined
                ? Effect.void
                : Effect.andThen(
                    live.publish({
                      _tag: 'SessionEnded',
                      threadId: running.thread.threadId,
                      sessionId: running.sessionId,
                      state: ended,
                    }),
                    // Its task is between agents a moment (`betweenAgents`), under way: once that is over, its card is read again.
                    running.thread.role === 'coordinator'
                      ? Effect.void
                      : Effect.forkIn(run(Effect.ignore(Effect.delay(touchCard(running.thread.taskId), betweenAgents))), sessionsScope),
                  ),
            ),
            Deferred.succeed(running.ended, undefined),
          ),
        ),
      ),
    )
  }

  /**
   * Starts the agent and its session, in the mode that asks, and records
   * its process. The session stays `starting`: it takes over the thread
   * only when `activate` runs, so a failed start leaves the thread as it was.
   */
  const connectOnce = (
    thread: ThreadContext,
    sessionId: string,
    entry: AgentEntry,
    account: Account,
    model: string | undefined,
    effort: string | undefined,
    first: boolean,
  ) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { definition } = entry
      // A review's lead only reads, as the coordinator and a reviewer do, and loads nothing of the repository's own settings,
      // hooks or plugins (the pull request's to write); offline, for a pull request from outside the project.
      const reads = onlyReads(thread)
      // Trusted fully, by the person's word or as the team's, it runs as the team's code does: no longer untrusted or offline.
      const untrusted = thread.role === 'task' && thread.review !== null && thread.trust !== 'full'
      const offline = thread.role === 'task' && thread.review?.outside === true && thread.trust !== 'full'
      const selectedWorker = thread.role !== 'task' ? null : yield* taskWorker(thread.taskId)
      // The worker as it is now, with what its own check found: whether its agents' sandbox starts there, and its tools.
      const placedOn =
        selectedWorker === null ? undefined : runtimeConfig.workers?.list(thread.projectId).find((one) => one.workerId === selectedWorker)
      const startWithin = selectedWorker === null ? SESSION_START_TIMEOUT : Duration.minutes(15)
      // Local providers use the account's home. An enrolled worker uses its own provider sign-in.
      if (selectedWorker === null) yield* accounts.prepare(account)
      // The session's own scope, from here, so whatever it is given goes with it.
      const scope = yield* Scope.fork(sessionsScope, 'sequential')
      // Selected skills load in every ordinary role, on agents whose registry says how, in the session's own folder.
      // Offline outside reviews omit executable plugins. Nothing goes in the repository, the account's home or
      // the person's own folders. A failure here costs the session its skills, not its start: the thread says so once it has
      // started, and what Althar didn't expect is reported, by the agent (ADR-047).
      // The person's skills turned off for this role or this project (ADR-097): left out of Althar's selection, and held
      // back in the agent itself where it loads them from its own folders, its plugins or the repository.
      const turnedOff = yield* heldSkillsFor(toolRoleOf(thread), thread.projectId).pipe(
        Effect.provideService(RuntimeConfig, runtimeConfig),
        Effect.provideService(SqlClient.SqlClient, sessionsSql),
      )
      const heldSkills = turnedOff.agent.length === 0 ? {} : { heldSkills: turnedOff.agent }
      const workerCanLoadSkills = thread.role === 'task' && definition.skills?.via.kind !== 'env'
      const setUp: { readonly skills: RunSkills | undefined; readonly failed?: string } =
        !offline && skillsConfig !== undefined && definition.skills !== null
          ? yield* runSkills(skillsConfig, definition, sessionId, foldersOf(thread), turnedOff.names).pipe(
              Effect.tap((run) => (run === undefined ? Effect.void : Scope.addFinalizer(scope, run.release.pipe(Effect.ignore)))),
              Effect.map((run) => ({ skills: run })),
              Effect.catchCause((cause) =>
                Cause.hasInterruptsOnly(cause)
                  ? Effect.interrupt
                  : Effect.gen(function* () {
                      yield* Effect.logWarning('Could not set up skills for the session', cause)
                      const refused = refusalOf(cause)
                      if (refused === undefined) yield* failures.report(cause, 'skills', definition.id)
                      return { skills: undefined, failed: refused?.message ?? "Althar couldn't lay them out. Its log has the details." }
                    }),
              ),
            )
          : { skills: undefined }
      const { skills } = setUp
      // Whose work it is, in its environment, so all it starts is counted as that work's however it runs (MachineLoad.ts).
      const work = workOf({
        kind: thread.role === 'coordinator' ? 'coordinator' : 'task',
        projectId: thread.projectId,
        taskId: thread.role === 'coordinator' ? null : thread.taskId,
      })
      // A lead's git runs Althar's guard, which stops at git itself what can't be undone from the task (pushGuard.ts, ADR-071).
      const guarded =
        selectedWorker === null && thread.role === 'task' && !reads && guardHolds
          ? yield* guardEnv({
              sessionId,
              taskBranch: thread.branch,
              defaultBranches: [thread.defaultBranch, ...thread.repositories.map((repository) => repository.defaultBranch)],
              // The branches its work goes into too (ADR-093): a task never pushes straight onto those either.
              towards: thread.repositories.flatMap((repository) => (repository.toward === null ? [] : [repository.toward])),
              // Only the task's own repositories: a scratch one in its temp folder is the lead's to do with as it likes.
              repositories: [thread.cwd, ...thread.repositories.map((repository) => repository.worktree)],
              count: SIGNED_OUT_GIT_CONFIG,
            })
          : {}
      const web = !offline ? ((yield* policies.current(thread.projectId)).rules.leadsReachWeb ?? true) : false
      const transportOptions: SessionOptions = {
        web,
        ...(definition.native === 'copilot'
          ? {
              nativeProcesses: {
                starting: (command: string) =>
                  Effect.runPromise(
                    run(
                      Effect.gen(function* () {
                        const id = yield* newId(Ids.process)
                        yield* sql`INSERT INTO processes ${sql.insert({
                          id,
                          projectId: thread.projectId,
                          deviceId: instance.deviceId,
                          runtimeInstanceId: instance.id,
                          providerSessionId: sessionId,
                          purpose: 'other',
                          executable: command,
                          argsRedacted: '[]',
                          controllerGeneration: 1,
                          state: 'launching',
                          launchedAt: yield* timestamp,
                        })}`
                        return id
                      }),
                    ),
                  ),
                started: (
                  id: string,
                  process: { readonly pid: number; readonly osStartedAt?: string; readonly environmentDigest: string },
                ) =>
                  Effect.runPromise(
                    run(
                      change('processes', id, {
                        pid: process.pid,
                        processGroupId: process.pid,
                        osStartedAt: process.osStartedAt ?? null,
                        environmentDigest: process.environmentDigest,
                        state: 'running',
                      }).pipe(Effect.asVoid),
                    ),
                  ),
                stopped: (id: string, report?: { readonly signal: string; readonly survivors: boolean }) =>
                  Effect.runPromise(
                    run(
                      Effect.gen(function* () {
                        yield* change('processes', id, {
                          state:
                            report === undefined
                              ? 'unknown'
                              : report.survivors
                                ? 'running'
                                : report.signal === 'none'
                                  ? 'exited'
                                  : 'killed',
                          endedAt: report?.survivors ? null : yield* timestamp,
                          signal: report?.signal ?? null,
                        })
                      }),
                    ),
                  ),
              },
            }
          : {}),
        ...(untrusted ? { untrusted } : {}),
        ...(untrusted && offline ? { offline } : {}),
        ...(skills === undefined ? {} : { skills: skills.folder }),
        ...heldSkills,
      }
      const transport = entry.transport(
        cwdOf(thread),
        { ...accounts.env(account), [WORK]: work, ...guarded, ALTHAR_WORKER: sessionId },
        transportOptions,
      )
      const processId = selectedWorker === null && transport._tag === 'Process' ? yield* newId(Ids.process) : undefined
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
        // Where its sandbox may leave a placeholder that isn't there now, taken away once it has gone (sandboxLeftovers.ts).
        yield* recordPlaces(processId, foldersOf(thread), definition.id).pipe(
          Effect.catchCause((cause) => Effect.logWarning('Could not record where its sandbox may leave placeholders', cause)),
        )
      }
      // Read again once the agent is spawned, before it asks anything: the rules then know its temp folder.
      let requestContext: RequestContext = {
        projectId: thread.projectId,
        threadId: thread.threadId,
        taskId: thread.role === 'coordinator' ? null : thread.taskId,
        sessionId,
        meanings: definition.permissions,
        rules:
          thread.role === 'coordinator'
            ? {
                role: 'task',
                context: {
                  worktree: thread.folder.folder,
                  defaultBranch: thread.folder.repositories[0]?.base ?? 'main',
                  defaultBranches: thread.folder.repositories.map((repository) => repository.base),
                  readOnly: true,
                },
              }
            : thread.role === 'task' && !reads
              ? {
                  role: 'task',
                  context: {
                    worktree: thread.cwd,
                    worktrees: thread.repositories.map((repository) => repository.worktree),
                    // Local, the person's own checkouts: what isn't committed there is theirs too (ADR-091).
                    shared: thread.repositories.filter((repository) => repository.local === 1).map((repository) => repository.worktree),
                    defaultBranch: thread.defaultBranch,
                    // A fork's task bound for the repository it came from has that repository's default too, by whatever name
                    // its clone has that remote: a worktree's base is always on a remote, where it could be fetched.
                    defaultBranches: thread.repositories.flatMap((repository) => [
                      repository.defaultBranch,
                      ...(repository.baseRef.startsWith('upstream/')
                        ? [repository.baseRef.slice('upstream/'.length)]
                        : repository.local !== 1 && !repository.baseRef.startsWith('origin/') && repository.baseRef.includes('/')
                          ? [repository.baseRef.slice(repository.baseRef.indexOf('/') + 1)]
                          : []),
                      ...(repository.toward === null ? [] : [repository.toward]),
                    ]),
                    taskBranch: thread.branch,
                    // Its git stops what can't be undone whatever runs it, so a Never of only that needn't read the rest (rules.ts).
                    ...(selectedWorker === null && guardHolds ? { guarded: true } : {}),
                    // On a worker, running as root there asks the person first.
                    ...(selectedWorker === null
                      ? {}
                      : { worker: placedOn === undefined ? workerNameOf(selectedWorker) : workerName(placedOn) }),
                  },
                }
              : {
                  role: 'reader',
                  web,
                  cwd: cwdOf(thread),
                  ...(offline ? { offline } : {}),
                },
      }
      // What a lead's sandbox lets through from the start, as the rules stand now; nothing for a role that only reads.
      const upFront =
        selectedWorker === null &&
        requestContext.rules.role === 'task' &&
        definition.upFront === true &&
        definition.sessionMeta !== undefined
          ? yield* permissions
              .upFront(thread.projectId, thread.role === 'coordinator' ? null : thread.taskId, requestContext.rules.context)
              .pipe(Effect.orElseSucceed(() => undefined))
          : undefined
      const sessionOptions: SessionOptions = {
        web,
        ...(untrusted
          ? { untrusted, ...(offline ? { offline } : {}) }
          : thread.role === 'coordinator'
            ? {
                contained: { folder: thread.folder.folder, reads: thread.folder.reads },
                ...(upFront === undefined ? {} : { sandbox: upFront }),
              }
            : upFront === undefined
              ? {}
              : { sandbox: upFront }),
        ...(skills === undefined ? {} : { skills: skills.folder }),
        ...heldSkills,
        // On a worker, its sandbox is the worker's to say; one that hasn't found it starts takes no work (below).
        ...(selectedWorker === null ? {} : { sandboxStarts: placedOn?.readiness?.sandbox.starts === true }),
      }
      // A sandbox probe describes the machine running it. A worker starts its own provider process.
      const waiting = selectedWorker === null ? definition.ready?.() : undefined
      if (waiting !== undefined) yield* Effect.promise(() => waiting)
      // Where the session's sandbox holds its shell commands, what it holds runs without being read (ADR-071).
      const hold = selectedWorker === null ? definition.holds?.(reads ? 'reader' : 'lead', sessionOptions) : undefined
      let held: RequestContext = hold === undefined ? requestContext : { ...requestContext, sandbox: hold }
      // Althar's tools for the session's role: the coordinator's plan tasks; a lead's and a reviewer's report their step.
      let remote: WorkerExecution | undefined
      const tools = yield* toolServer.grant(
        {
          role: toolRoleOf(thread),
          projectId: thread.projectId,
          threadId: thread.threadId,
          sessionId,
          taskId: thread.role === 'coordinator' ? null : thread.taskId,
        },
        selectedWorker === null
          ? undefined
          : Effect.suspend(() =>
              remote === undefined
                ? Effect.fail(new ToolRefused({ message: 'The worker is disconnected.' }))
                : Effect.mapError(remote.checkpoint, (error) => new ToolRefused({ message: error.message })),
            ),
      )
      // What the launch's environment holds: whether it drives the person's own copy rather than the one Althar brings.
      const launchEnv = transport._tag === 'Process' ? { ...inherited(transport.spec.inheritEnv), ...transport.spec.env } : {}
      const drivenBy = definition.cli?.drivenBy
      const ownCopy = drivenBy !== undefined && launchEnv[drivenBy] !== undefined
      // The program Althar brings for it, there and of the version its adapter needs, before it is spawned (bundledPrograms.ts).
      const check = selectedWorker === null && definition.program !== undefined ? () => definition.program?.(launchEnv) : undefined
      const program = check?.()
      const started = yield* Effect.exit(
        Effect.gen(function* () {
          if (program !== undefined) return yield* new AgentStartFailed({ command: definition.name, reason: program })
          if (untrusted && definition.untrustedRepositories === false)
            return yield* new AgentRequestFailed({
              method: 'session/new',
              failure: 'invalid_request',
              message:
                'This custom agent has not been configured to ignore untrusted repository hooks and settings. Choose another agent for this review.',
            })
          let agentCwd = cwdOf(thread)
          let homeWorktree: string | undefined
          if (selectedWorker !== null) {
            const refuse = (reason: string) => new AgentStartFailed({ command: definition.name, reason })
            const platform = runtimeConfig.workers
            if (
              platform === undefined ||
              thread.role !== 'task' ||
              thread.review !== null ||
              (transport._tag === 'InProcess' && definition.source !== 'bundled')
            )
              return yield* refuse('This agent or task can’t run on a worker.')
            if (thread.repositories.length === 0 || thread.repositories.some((repository) => repository.local === 1))
              return yield* refuse('A worker needs the task in a worktree of its own, not Local.')
            // It takes work only where its own check found its agents' sandbox starts, and this agent started there once;
            // a worker that hasn't said, or found otherwise, takes none, and says why, before anything opens there.
            // The worker that receives the run is checked again as it does (agentRuns.ts, `requireReady`), in case it was
            // replaced meanwhile.
            const refusal = workerRefusal(placedOn, selectedWorker, definition.id)
            if (refusal !== undefined) return yield* refuse(refusal)
            const assets =
              !workerCanLoadSkills || skills === undefined || skills.given.length === 0
                ? []
                : yield* Effect.tryPromise({
                    try: () => workerSkillFiles(skills.folder),
                    catch: () => refuse('Althar couldn’t read the skills chosen for it.'),
                  })
            if (thread.helper !== undefined) {
              if (platform.openHelper === undefined) return yield* refuse('This home can’t start helpers on a worker.')
              const directory = relative(thread.worktree, agentCwd).split(sep).join('/')
              remote = yield* platform.openHelper({
                workerId: selectedWorker,
                projectId: thread.projectId,
                providerId: definition.id,
                worktree: thread.helper.copyOf ?? thread.worktree,
                ...(thread.helper.copyOf === undefined ? {} : { copy: thread.worktree }),
                toolPort: toolServer.port,
                directory,
                ...(assets.length === 0 ? {} : { skills: assets }),
              })
              homeWorktree = thread.worktree
              agentCwd = posix.join(remote.path, directory)
            } else {
              const rows = yield* sql<{
                id: string
                path: string
              }>`SELECT id, path FROM workspaces WHERE task_id = ${thread.taskId} AND access = 'write'`
              const workspace = rows.find((row) => row.path === thread.worktree)
              if (workspace === undefined) return yield* refuse(`Its folder on ${workerNameOf(selectedWorker)} isn’t ready yet.`)
              const grouped = thread.repositories.length > 1
              const root = grouped ? dirname(thread.worktree) : thread.worktree
              const repositories = []
              if (grouped) {
                for (const repository of thread.repositories) {
                  const bound = rows.find((row) => row.path === repository.worktree)
                  const directory = basename(repository.worktree)
                  if (bound === undefined || dirname(repository.worktree) !== root || !WORKER_REPOSITORY_FOLDER.test(directory))
                    return yield* refuse(`Its repositories on ${workerNameOf(selectedWorker)} aren’t ready yet.`)
                  repositories.push({ workspaceId: bound.id, worktree: bound.path, directory })
                }
              }
              const plans = yield* Effect.forEach(
                grouped ? repositories.map((entry) => entry.workspaceId) : [workspace.id],
                (workspaceId) => setups.workerPlan(thread.taskId, workspaceId).pipe(Effect.map((plan) => ({ workspaceId, plan }))),
              ).pipe(Effect.mapError(() => refuse(`Althar couldn’t work out the setup for its folder on ${workerNameOf(selectedWorker)}.`)))
              const layouts = plans.flatMap(({ workspaceId, plan }) => (plan?.spec === undefined ? [] : [{ workspaceId, ...plan.spec }]))
              // What the task's files need that the worker lacks and installs itself, into its own folder, before the setup: read
              // in each repository's folder, as its setup runs there.
              const across = yield* Effect.promise(() =>
                needsAcross(
                  thread.repositories.map((one) => ({
                    name: one.name,
                    folder: one.within === null ? one.worktree : join(one.worktree, one.within),
                  })),
                ),
              )
              // Two repositories pinning versions of a tool that can't be one install: it doesn't go to a worker, which has one.
              if ('conflict' in across) return yield* refuse(across.conflict)
              const tools = toolsToInstall(needsOn(across.needs, placedOn?.readiness))
              const commands = grouped && layouts.length > 0 ? { repositories: layouts } : plans[0]?.plan?.spec
              const setup = tools.length === 0 ? commands : { ...(commands ?? { directory: '', commands: [] }), tools }
              remote = yield* platform.open({
                workerId: selectedWorker,
                projectId: thread.projectId,
                workspaceId: workspace.id,
                providerId: definition.id,
                worktree: thread.worktree,
                toolPort: toolServer.port,
                ...(setup === undefined ? {} : { setup }),
                ...(grouped ? { repositories } : {}),
                ...(assets.length === 0 ? {} : { skills: assets }),
              })
              for (const { workspaceId, plan } of plans) {
                if (plan !== undefined) yield* plan.record(grouped ? remote.repositorySetup?.[workspaceId] : remote.setup)
              }
              homeWorktree = root
              agentCwd = posix.join(remote.path, ...relative(root, agentCwd).split(sep))
            }
          }
          const activeWorker = remote
          const localRoot = homeWorktree
          const connection = yield* connect({
            transport: activeWorker?.transport ?? transport,
            ...(activeWorker === undefined ? {} : { checkpoint: activeWorker.checkpoint }),
            onPermission: (request) =>
              permissions.decide(
                held,
                activeWorker === undefined || localRoot === undefined
                  ? request
                  : {
                      ...request,
                      paths: request.paths.map((path) =>
                        path === activeWorker.path || path.startsWith(activeWorker.path + '/')
                          ? join(localRoot, ...path.slice(activeWorker.path.length).split('/').filter(Boolean))
                          : path,
                      ),
                    },
              ),
            permissions: definition.permissions,
            ...(definition.failsInText === undefined ? {} : { failsInText: definition.failsInText }),
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
          // The person's own servers ticked for this role, whichever of their agents' settings they were found in (ADR-097).
          // A repository's own `.mcp.json` is given only where the repository is the person's: an outside author's never loads its MCP config.
          const configured = yield* serversFor(
            toolRoleOf(thread),
            thread.projectId,
            connection.info.mcp.http,
            !(thread.role === 'task' && thread.review?.outside === true && thread.trust !== 'full'),
          ).pipe(Effect.provideService(RuntimeConfig, runtimeConfig), Effect.provideService(SqlClient.SqlClient, sessionsSql))
          const unavailableMcp: string[] = []
          const persons =
            activeWorker === undefined
              ? configured
              : (yield* Effect.forEach(configured, (server) =>
                  Effect.gen(function* () {
                    if (server.type === 'stdio') {
                      const command = workerStdioMcp(server, activeWorker.localMcp)
                      if (command !== null) return [command]
                      unavailableMcp.push(server.name)
                      return []
                    }
                    const mounted = yield* toolServer.mountWorkerServer(server, activeWorker.toolPort)
                    if (mounted === null) {
                      unavailableMcp.push(server.name)
                      return []
                    }
                    yield* Scope.addFinalizer(scope, mounted.revoke)
                    return [mounted.server]
                  }),
                )).flat()
          const localTools = tools.server
          if (activeWorker !== undefined && localTools.type !== 'http')
            return yield* new AgentStartFailed({ command: definition.name, reason: 'The home couldn’t give the worker Althar’s tools.' })
          const mcp =
            activeWorker === undefined || localTools.type !== 'http'
              ? localTools
              : { ...localTools, url: 'http://127.0.0.1:' + activeWorker.toolPort + '/mcp' }
          const effectiveSkills = activeWorker === undefined ? skills?.folder : activeWorker.skillsPath
          const { skills: _homeSkills, ...otherOptions } = sessionOptions
          const effectiveSessionOptions = { ...otherOptions, ...(effectiveSkills === undefined ? {} : { skills: effectiveSkills }) }
          const agent = yield* connection.newSession({
            cwd: agentCwd,
            // The coordinator, a reviewer and a review's lead only read: in the agent's read-only mode where that still lets it call
            // Althar's tools, offline where the agent lets Althar take its network away (the registry says what each is held to).
            mode: reads && thread.role !== 'coordinator' ? definition.modes.reader : definition.modes.ask,
            modeOptionId: definition.options.mode,
            // What would approve without asking stays off; and a role that only reads stays in its mode, whatever the agent does.
            ...heldFor(definition, reads && thread.role !== 'coordinator'),
            mcpServers: [mcp, ...persons],
            ...(definition.skills?.via.kind === 'directory' && effectiveSkills !== undefined
              ? { additionalDirectories: [effectiveSkills] }
              : {}),
            ...(definition.sessionMeta === undefined
              ? {}
              : { meta: definition.sessionMeta(reads ? 'reader' : 'lead', effectiveSessionOptions) }),
          })
          if (model !== undefined) yield* agent.setOption(definition.options.model, model)
          else
            yield* offSwitchedOff(
              definition,
              agent,
              limits.modelFor({ agentId: definition.id, projectId: thread.projectId }).pipe(Effect.orElseSucceed(() => null)),
            )
          // An effort the model doesn't offer is no reason not to start.
          yield* settleEffort(definition, agent, effort ?? null)
          return { connection, agent, unavailableMcp }
        }).pipe(
          Scope.provide(scope),
          Effect.timeoutOption(startWithin),
          Effect.flatMap((result) => {
            if (Option.isNone(result)) {
              return Effect.fail(new StartTimedOut({ agentId: definition.id, agentName: definition.name, after: startWithin }))
            }
            return Effect.succeed(result.value)
          }),
        ),
      )
      if (Exit.isFailure(started)) {
        yield* Scope.close(scope, Exit.void)
        yield* tools.revoke
        // The whole answer, its code and all its data (failures.ts' rawOf), is the log's and the record's; the person reads words.
        const answer = answerOf(started.cause)
        yield* Effect.logWarning(first ? 'Agent could not start' : 'Agent could not start again', started.cause).pipe(
          Effect.annotateLogs({
            agent: definition.id,
            session: sessionId,
            thread: thread.threadId,
            ...(answer === undefined ? {} : { answer }),
          }),
        )
        const reason = answer === undefined ? Cause.pretty(started.cause) : `${Cause.pretty(started.cause)}\nIt answered: ${answer}`
        // A folder gone from under it fails its start as a missing command would (ENOENT): said as the folder, never
        // that an agent that is there isn't installed.
        const folder = cwdOf(thread)
        const signInEnded = existsSync(folder) && (yield* signedOutRefusal(started.cause, entry.definition, account))
        // Its own program missing, or of another version, as while an install of Althar is still under way: looked for again a
        // while, before anything is said.
        if (first && program !== undefined && check !== undefined) return yield* new ProgramArriving({ check })
        // One that may pass starts again once, afresh, by itself: what Althar holds of the agent read again first.
        if (first && program === undefined && existsSync(folder) && !signInEnded && startsAgain(started.cause)) {
          if (processId !== undefined) yield* change('processes', processId, { state: 'unknown', endedAt: yield* timestamp })
          return yield* new StartAgain()
        }
        const summary = existsSync(folder)
          ? signInEnded
            ? signInEndedWords
            : // Whose copy to put right: Althar's, unless this launch drives the person's own (Codex's `CODEX_PATH`).
              summarize(started.cause, { bundled: definition.source === 'bundled' && !ownCopy })
          : folderGoneWords(folder)
        yield* sql.withTransaction(
          Effect.gen(function* () {
            if (processId !== undefined) yield* change('processes', processId, { state: 'unknown', endedAt: yield* timestamp })
            const revision = yield* moveSession(sessionId, 'failed', { endedAt: yield* timestamp })
            yield* sessionFact(thread, sessionId, revision, 'provider_session.failed', { reason })
          }),
        )
        yield* sweepPlaces()
        // The thread says why nothing happened, as well as the call that asked.
        yield* addItem({ projectId: thread.projectId, threadId: thread.threadId, sessionId }, 'notice', {
          source: 'runtime',
          severity: 'error',
          title: `${definition.name} couldn't start.`,
          ...(summary === '' ? {} : { description: summary }),
        })
        return yield* new SessionFailed({ agentId: definition.id, reason, summary })
      }
      const { connection, agent, unavailableMcp } = started.value
      yield* Effect.logInfo('Agent started').pipe(
        Effect.annotateLogs({
          agent: definition.id,
          session: sessionId,
          thread: thread.threadId,
          ...(connection.process === undefined ? {} : { pid: connection.process.pid }),
          adapter: `${connection.info.name} ${connection.info.version ?? ''}`.trim(),
        }),
      )
      if (processId !== undefined && connection.process !== undefined) {
        yield* change('processes', processId, {
          pid: connection.process.pid,
          processGroupId: connection.process.pid,
          osStartedAt: connection.process.osStartedAt ?? null,
          environmentDigest: connection.process.environmentDigest,
          state: 'running',
        })
      }
      // Skills it should have had and didn't get are said in the thread, as the other things a start couldn't do are.
      if (unavailableMcp.length > 0) {
        yield* addItem({ projectId: thread.projectId, threadId: thread.threadId, sessionId }, 'notice', {
          source: 'runtime',
          severity: 'warning',
          // Named by the worker it started on: one server by its name, several listed.
          ...(unavailableMcp.length === 1
            ? { title: `${unavailableMcp[0]} isn’t on ${workerNameOf(selectedWorker ?? '')}.`, description: null }
            : {
                title: `${unavailableMcp.length} of its MCP servers aren’t on ${workerNameOf(selectedWorker ?? '')}.`,
                description: unavailableMcp.join(', '),
              }),
        })
      }
      const skillsUnable = selectedWorker !== null && !workerCanLoadSkills && (skills?.given.length ?? 0) > 0
      if (setUp.failed !== undefined || skillsUnable) {
        yield* addItem({ projectId: thread.projectId, threadId: thread.threadId, sessionId }, 'notice', {
          source: 'runtime',
          severity: 'warning',
          title: `${definition.name} started without its skills.`,
          // On a worker, an agent that takes its skills from an environment variable has none, whatever the worker's version.
          description:
            setUp.failed ?? 'It can’t load skills on a worker. To give it its skills, run it on the home, or choose another lead.',
        })
      }
      // A skill this agent can't use is shown as a difference from the others, not hidden.
      if (skills !== undefined && skills.omitted.length > 0) {
        yield* addItem({ projectId: thread.projectId, threadId: thread.threadId, sessionId }, 'notice', {
          source: 'runtime',
          severity: 'info',
          title: `${definition.name} wasn't given ${skills.omitted.length === 1 ? 'a skill' : `${skills.omitted.length} skills`} it can't use.`,
          description: skills.omitted.map(({ id, missing }) => `${id} needs ${missing.join(', ')}`).join('; '),
        })
      }
      // Where its launch made it a temp folder of its own, the rules read `$TMPDIR` in its commands as that.
      const temp = connection.process?.temp
      if (temp !== undefined && held.rules.role === 'task')
        held = { ...held, rules: { ...held.rules, context: { ...held.rules.context, temp } } }
      // Where its agent records where its shell is, the rules read a relative path from there, not from where it started.
      if (definition.shellFolder !== undefined && held.rules.role === 'task')
        held = {
          ...held,
          shell: definition.shellFolder(
            accounts.env(account)[definition.home.variable] ?? definition.home.usual(process.env, homedir()),
            cwdOf(thread),
            agent.sessionId,
          ),
        }
      return {
        sessionId,
        entry,
        account,
        thread,
        connection,
        agent,
        scope,
        revokeTools: tools.revoke,
        requestContext: held,
        skills: skillsUnable ? undefined : skills,
        upFront,
      }
    })

  /**
   * Starts the agent and its session, as `connectOnce` does, and once more,
   * afresh, where its first start failed in a way that may pass: its adapter
   * stopped, or it failed for no reason Althar can act on. Before the second,
   * what Althar holds of the agent (its sign-in as last checked, the models it
   * offers) is forgotten, so both are read again, and the second start is a
   * new process of its adapter, with probes of its own. Nothing waits on the
   * person: a start that fails again says why, as any does.
   */
  const connectSession = (
    thread: ThreadContext,
    sessionId: string,
    entry: AgentEntry,
    account: Account,
    model: string | undefined,
    effort: string | undefined,
  ) =>
    connectOnce(thread, sessionId, entry, account, model, effort, true).pipe(
      Effect.catchTag('ProgramArriving', ({ check }) =>
        Effect.gen(function* () {
          const { every, within } = runtimeConfig.programWait ?? PROGRAM_WAIT
          yield* Effect.logInfo('Waiting for the agent’s own program, which isn’t there yet').pipe(
            Effect.annotateLogs({ agent: entry.definition.id, session: sessionId, problem: check() ?? '' }),
          )
          // Looked for again every so often, for a bounded while; then started either way, and said as it stands.
          const tries = Math.max(1, Math.ceil(Duration.toMillis(within) / Math.max(1, Duration.toMillis(every))))
          for (let tried = 0; tried < tries && check() !== undefined; tried++) yield* Effect.sleep(every)
          return yield* connectOnce(thread, sessionId, entry, account, model, effort, false).pipe(
            Effect.catchTags({ StartAgain: (again) => Effect.die(again), ProgramArriving: (again) => Effect.die(again) }),
          )
        }),
      ),
      Effect.catchTag('StartAgain', () =>
        Effect.gen(function* () {
          yield* Effect.logInfo('Starting the agent again, afresh').pipe(
            Effect.annotateLogs({ agent: entry.definition.id, session: sessionId, thread: thread.threadId }),
          )
          yield* refreshAgent(entry.definition.id)
          return yield* connectOnce(thread, sessionId, entry, account, model, effort, false).pipe(
            Effect.catchTags({ StartAgain: (again) => Effect.die(again), ProgramArriving: (again) => Effect.die(again) }),
          )
        }),
      ),
    )

  type Connected = Effect.Success<ReturnType<typeof connectSession>>

  /**
   * Lets go of a session that started but never took over its thread, as
   * when its brief couldn't be written: its process stops, its tools are
   * taken back, and it is recorded as ended, so it holds no place.
   */
  const discard = (connected: Connected, cause: Cause.Cause<unknown>) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { sessionId, thread, connection, entry } = connected
      yield* Scope.close(connected.scope, Exit.void)
      yield* connected.revokeTools
      const stop = connection.process === undefined ? undefined : yield* connection.process.stopped
      yield* Effect.logWarning('Agent started but could not take over its thread', cause).pipe(
        Effect.annotateLogs({ agent: entry.definition.id, session: sessionId, thread: thread.threadId }),
      )
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const at = yield* timestamp
          const [process] = yield* sql<{
            id: string
          }>`SELECT id FROM processes WHERE provider_session_id = ${sessionId} ORDER BY launched_at DESC LIMIT 1`
          if (process !== undefined)
            yield* change('processes', process.id, {
              state: stop !== undefined && stop.signal !== 'none' ? 'killed' : 'exited',
              endedAt: at,
            })
          const [session] = yield* sql<{ state: string }>`SELECT state FROM provider_sessions WHERE id = ${sessionId}`
          // Recorded as active already, it went; still starting, it failed.
          const state = session?.state === 'starting' ? 'failed' : session?.state === 'active' ? 'lost' : undefined
          if (state === undefined) return
          const revision = yield* moveSession(sessionId, state, { endedAt: at })
          yield* sessionFact(thread, sessionId, revision, `provider_session.${state}`, { reason: Cause.pretty(cause) })
        }),
      )
      yield* sweepPlaces()
    }).pipe(Effect.catchCause((left) => Effect.logWarning('Could not let go of a session that never took over', left)))

  /** Runs what comes between a session starting and its taking over the thread; should it fail, the session is let go. */
  const beforeTakingOver =
    (connected: Connected) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.onError(effect, (cause) => discard(connected, cause))

  /** The session takes over the thread: it is recorded as active, and delivers the brief and any waiting input. */
  /**
   * `adopt` is told of the session as it takes the thread, before anything else can reach it: a switch gives it the lead the
   * person picked while it started, so its first turn runs on that.
   */
  const activate = (connected: Connected, brief: Brief, blockedInputs?: ReadonlySet<string>, adopt?: (running: Running) => void) => {
    // Once it is supervised, ending it is supervise's: before, a failure lets it go here.
    let supervised = false
    return Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const { sessionId, entry, account, thread, connection, agent, scope, revokeTools, requestContext, skills, upFront } = connected
      // How long it took to start, from its row to now: what its first turn counts as starting or handing over.
      const [made] = yield* sql<{ startedAt: string }>`SELECT started_at FROM provider_sessions WHERE id = ${sessionId}`
      const opened = made === undefined ? 0 : Math.max(0, (yield* Clock.currentTimeMillis) - Date.parse(made.startedAt))
      const { definition } = entry
      const options = yield* agent.options
      // An aside's lead, briefed lightly; started with + and nothing said yet, its brief waits for the person's first words.
      const asideNow = thread.role === 'task' ? yield* dependencies.asideState(thread.taskId) : { aside: false, unsaid: false }
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
            // The skills it was given, fixed for the session: each by id and the version's tree hash (ADR-008).
            ...(skills === undefined ? {} : { skills: skills.given }),
          })
        }),
      )
      const openedAt = yield* Clock.currentTimeMillis
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
        stopRecorded: yield* Deferred.make<void>(),
        ended: yield* Deferred.make<void>(),
        // A lead is told what its sandbox lets through from the start, and how a command runs outside it, and of the
        // skills it was given.
        // An aside is told what its sandbox lets through once it becomes work, with a lead's whole brief: a quick word needs none.
        brief: {
          ...brief,
          text: [
            brief.text,
            ...(upFront === undefined || asideNow.aside ? [] : [upFrontSaid(upFront)]),
            ...(skills === undefined || skills.given.length === 0 ? [] : [skillsSaid(skills.given)]),
          ].join('\n\n'),
        },
        revokeTools,
        requestContext,
        turnRunning: false,
        deliveryHeld: null,
        blockedInputs,
        promptSent: null,
        stopping: false,
        context: null,
        recording: undefined,
        stoppedByPerson: false,
        settleBetween: Effect.void,
        listeningBefore: yield* Deferred.make<ReadonlySet<number>>().pipe(
          Effect.tap((before) => Deferred.succeed(before, new Set<number>())),
        ),
        background: new Map(),
        callsOpen: new Set(),
        workedAt: null,
        wakeAt: null,
        handover: 'none',
        turnStartedAt: null,
        turnEndedAt: null,
        openedAt,
        idleTouchedAt: openedAt,
        nextLead: undefined,
        leadLock: Semaphore.makeUnsafe(1),
        settingLead: false,
        leadHeld: false,
        moved: false,
        before: { session: opened, starting: brief.starting ?? 'start', place: 0 },
        ...(asideNow.aside ? { aside: { sandbox: upFront === undefined ? null : upFrontSaid(upFront) } } : {}),
        ...(asideNow.unsaid ? { waitsForWords: true } : {}),
      }
      adopt?.(running)
      threads.set(thread.threadId, running)
      // Stop descendants before the agent exits and they are reparented, including detached commands that never reported an output file.
      yield* Scope.addFinalizer(
        scope,
        Effect.gen(function* () {
          const pid = running.connection.process?.pid
          if (pid !== undefined && process.platform !== 'win32') {
            const descendants = [...treeOf(yield* processes(), [pid])].filter((child) => child !== pid)
            return yield* stopTrees(running, [descendants])
          }
          const open = [...running.background.values()].filter((left) => left.ended === null)
          yield* stopTrees(running, yield* Effect.forEach(open, (left) => treeOfLeft(running, left), { concurrency: 'unbounded' }))
        }).pipe(Effect.timeout(LEFT_STOPS_WITHIN), Effect.ignore),
      )
      yield* Effect.forkIn(run(deliveries(running)), scope)
      // What the agent says between turns, such as leaving plan mode, goes to the thread too.
      const between = recorder({
        projectId: thread.projectId,
        threadId: thread.threadId,
        sessionId,
        folders: foldersOf(thread),
        sandboxed: requestContext.sandbox !== undefined,
        ...(thread.role === 'task' ? { lead: definition.name, leadId: definition.id } : {}),
      })
      const heard = yield* betweenTurns(between, scope)
      running.settleBetween = heard.close
      // A turn that already started records itself; between turns, this one does.
      running.recording ??= between
      // An agent that doesn't say what it could see: read where it reads, out on the device as a Flatpak's home is the device's by path (ADR-027). A review's lead loads none of the repository's.
      if (thread.role === 'task' && thread.review === null && definition.skillFolders !== undefined) {
        const launched = definition.launch(adapterNode())
        yield* between
          .record({
            _tag: 'SkillsSeen',
            skills: skillsIn(
              definition.skillFolders({
                env: launched.onDevice === undefined ? process.env : {},
                homeDir: homedir(),
                cwd: thread.cwd,
                inSandbox: inFlatpakSandbox(launched),
              }),
            ),
          })
          .pipe(Effect.catchCause((cause) => Effect.logWarning('Could not record the skills an agent could see', cause)))
      }
      yield* Effect.forkIn(
        run(
          Stream.runForEach(agent.events, (event) =>
            Effect.suspend(() => {
              if (event._tag === 'AgentFailure' && event.connectionLost === true && !running.turnRunning) {
                running.stopping = true
                return Effect.asVoid(Deferred.succeed(running.stopRequest, { state: 'lost' }))
              }
              return Effect.gen(function* () {
                heardContext(running, event)
                yield* Effect.andThen(heardPlan(running, event), heard.record(event)).pipe(
                  Effect.catchCause((cause) => Effect.logWarning('Could not record an agent event', cause)),
                )
                yield* Effect.andThen(heardWork(running, event), heardBackground(running, event))
                yield* live.publish({ _tag: 'Agent', threadId: thread.threadId, event })
              })
            }),
          ),
        ),
        scope,
      )
      yield* Effect.forkIn(run(supervise(running)), sessionsScope)
      supervised = true
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
    }).pipe(
      Effect.onError((cause) =>
        Effect.suspend(() => {
          if (supervised) return Effect.void
          if (threads.get(connected.thread.threadId)?.sessionId === connected.sessionId) threads.delete(connected.thread.threadId)
          return discard(connected, cause)
        }),
      ),
    )
  }

  /**
   * Ends the turn running, then the session. An agent that doesn't end its
   * turn when asked is stopped with its process, so stopping never waits
   * on it for ever; the turn it was on is recorded as cut short.
   */
  const stopRunning = (running: Running, request: StopRequest) =>
    Effect.gen(function* () {
      running.stopping = true
      if (running.stopIntent === undefined) {
        running.stopIntent = request
        yield* run(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            yield* sql.withTransaction(
              Effect.gen(function* () {
                const [session] = yield* sql<{ state: string }>`SELECT state FROM provider_sessions WHERE id = ${running.sessionId}`
                if (session === undefined) return
                const revision = yield* change('provider_sessions', running.sessionId, { state: session.state })
                yield* sessionFact(running.thread, running.sessionId, revision, 'provider_session.stop_requested', request)
              }),
            )
          }).pipe(
            Effect.catchCause((cause) => Effect.logError('Could not persist session stop intent', cause)),
            Effect.ensuring(Deferred.succeed(running.stopRecorded, undefined)),
            Effect.uninterruptible,
          ),
        )
      }
      yield* Deferred.await(running.stopRecorded)
      const intent = running.stopIntent
      // What it asked the person stays for them, though its turn ends now: the answer goes to the agent on the thread next.
      yield* questions.release(running.sessionId)
      const ended = yield* Effect.andThen(
        Effect.suspend(() => {
          const sent = running.promptSent
          return sent === null ? Effect.void : Effect.andThen(Deferred.await(sent), Effect.ignore(running.agent.interrupt))
        }),
        running.delivering.withPermits(1)(Deferred.succeed(running.stopRequest, intent)),
      ).pipe(Effect.timeoutOption(stopGrace))
      if (Option.isNone(ended)) {
        yield* Deferred.succeed(running.stopRequest, intent)
        yield* Scope.close(running.scope, Exit.void)
      }
      yield* Deferred.await(running.ended)
    })

  /** Whether a thread's agent is still at work, though its turn may have ended (`Sessions.busy`). */
  const busyNow = (threadId: string) =>
    Effect.gen(function* () {
      const running = threads.get(threadId)
      if (running === undefined) return false
      return stillBusy(
        {
          turnRunning: running.turnRunning,
          background: [...running.background.values()],
          callsOpen: running.callsOpen.size,
          workedAt: running.workedAt,
          wakeAt: running.wakeAt,
        },
        yield* Clock.currentTimeMillis,
        quietFor,
        wakeFor,
      )
    })

  return { activate, beforeTakingOver, busyNow, connectSession, stopRunning }
}

/**
 * What keeps a worker from taking an agent's run, from its own check (ADR-103): it hasn't said, its sandbox can't start,
 * or the agent couldn't start there; none where its check found both start. Not whether it is busy: placement says that.
 */
export const unreadyFor = (worker: ProjectWorker, agentId: string): WorkerUnfit | undefined => {
  const readiness = worker.readiness
  if (readiness === undefined) return { kind: 'unchecked' }
  if (!readiness.sandbox.starts)
    return {
      kind: 'sandbox',
      problem: readiness.sandbox.problem,
      ...(readiness.sandbox.fix === undefined ? {} : { fix: readiness.sandbox.fix }),
    }
  const started = readiness.agents?.find((agent) => agent.providerId === agentId)
  return started?.starts === true
    ? undefined
    : { kind: 'agentStarts', agentId, ...(started?.problem === undefined ? {} : { problem: started.problem }) }
}

/**
 * Why a run doesn't open on its worker, in words, or none: one not connected to the project now (nothing is known of it,
 * so nothing opens there), or one its own check didn't find ready for this agent (`unreadyFor`).
 */
export const workerRefusal = (placedOn: ProjectWorker | undefined, workerId: string, agentId: string): string | undefined => {
  if (placedOn === undefined) return workerUnfitWords({ kind: 'gone' }, workerNameOf(workerId))
  const refusal = unreadyFor(placedOn, agentId)
  return refusal === undefined ? undefined : workerUnfitWords(refusal, workerName(placedOn))
}
