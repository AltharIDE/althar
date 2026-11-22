import { ConnectorFailed } from '@althar/connectors'
import type { MessageSender } from '@althar/contracts'
import {
  type CommandEnvelope,
  Ids,
  type InvalidTransition,
  type NodeAttemptId,
  type ProjectId,
  type RunState,
  newId,
  runLifecycle,
  transition,
} from '@althar/domain'
import type { CommandIdReused, Ledger, RevisionConflict, RowNotFound } from '@althar/persistence-sqlite'
import { Cause, Clock, type Crypto, Duration, Effect, Option, Queue, type Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'
import type { Artifacts } from './Artifacts'
import type { Busy, Order } from './Busy'
import { touchCard } from './cards'
import type { Changes } from './Changes'
import { NotConnected } from './Connections'
import type { Connectivity } from './Connectivity'
import { envelope } from './envelope'
import {
  AttentionClosed,
  type GitFailed,
  NotFound,
  NotHeld,
  NothingToWaitFor,
  type SessionFailed,
  type SessionRunning,
  type TaskRefused,
  type UnknownAgent,
} from './errors'
import { type ExternalWait, type Observation, externalWaitOf, observeExternal, waitOutcome, waitTime } from './externalWaits'
import { backoff, contained } from './Failures'
import type { Instance, InstanceInfo } from './Instance'
import { type Limits, type Out, capitalized, outStep, whenWords } from './Limits'
import type { Questions } from './Questions'
import { change, fact, timestamp } from './records'
import type { LimitedStep } from './runCapacity'
import {
  type Finding,
  Hold,
  type Lead,
  type Place,
  type PlanParameters,
  type PlanStep,
  RECONNECTED,
  RESTART_GRACE,
  type RoundBack,
  type RoundInput,
  type RunRow,
  type RunStopped,
  type Store,
  type StuckAnswer,
  type StuckInfo,
  type StuckWhy,
  type TaskEnd,
  decodeHold,
} from './runRecords'
import type { Sessions } from './Sessions'
import { standInOf, whenBack } from './standIn'
import { addItem } from './threads'
import { ToolRefused } from './ToolServer'
import { summarize } from './words'

/** A step a restart stopped, to carry on once the launch is up. */
interface Interrupted {
  readonly current: RunRow
  readonly attemptId: string
  readonly nodeId: string
  readonly nodeKey: string
  readonly iteration: number
  readonly ranOn: string | null
  readonly ranModel: string | null
}

/** A step waiting for a place, including its node's configuration. */
export interface Placed extends Omit<Interrupted, 'current'> {
  readonly taskId: string
  readonly config: string
}

interface RunRecoveryDependencies {
  readonly admit: (
    run: RunRow,
    key: 'implement' | 'review' | 'settle' | 'publish',
    iteration: number,
    config: unknown,
    input?: unknown,
  ) => Effect.Effect<
    { nodeId: string; attemptId: NodeAttemptId },
    SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict | RunStopped,
    SqlClient.SqlClient | Crypto.Crypto | Ledger
  >
  readonly asking: (threadId: string) => Effect.Effect<boolean, SqlError.SqlError, SqlClient.SqlClient>
  readonly atWork: (taskId: string) => Effect.Effect<boolean, SqlError.SqlError, SqlClient.SqlClient>
  readonly backWhereItWas: (
    run: RunRow,
    back: RoundBack,
    why?: 'nothing_new' | 'abandoned',
    committed?: boolean,
  ) => Effect.Effect<
    void,
    SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict | InvalidTransition,
    SqlClient.SqlClient | Ledger
  >
  readonly begin: (
    run: RunRow,
    attemptId: string,
    sessionId: string,
    threadId: string,
    fresh?: boolean,
  ) => Effect.Effect<boolean, SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict, SqlClient.SqlClient | Ledger>
  readonly busy: Busy['Service']
  readonly changes: Changes['Service']
  readonly conclude: (run: RunRow) => Effect.Effect<void, unknown, SqlClient.SqlClient | Instance | Crypto.Crypto | Ledger>
  readonly connectivity: Connectivity['Service']
  readonly currentRun: (taskId: string) => Effect.Effect<RunRow | undefined, SqlError.SqlError, SqlClient.SqlClient>
  readonly externalEvery: number
  readonly externalInstructions: (
    threadId: string,
  ) => Effect.Effect<{ total: number; queued: number }, SqlError.SqlError, SqlClient.SqlClient>
  readonly finish: (
    run: RunRow,
    state: 'succeeded' | 'failed' | 'cancelled',
  ) => Effect.Effect<void, SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict, SqlClient.SqlClient | Ledger>
  readonly going: (run: RunRow) => Effect.Effect<boolean, SqlError.SqlError, SqlClient.SqlClient>
  readonly holdsChanged: Queue.Queue<void, never>
  readonly instance: InstanceInfo
  readonly keptAnswers: (taskId: string) => Effect.Effect<readonly { id: string }[], SqlError.SqlError, SqlClient.SqlClient>
  readonly leadOn: (
    run: RunRow,
    agentId?: string,
    model?: string | null,
    said?: string,
    effort?: string | null,
    accountId?: string,
    about?: 'limit' | 'stall',
    attemptId?: string | null,
  ) => Effect.Effect<
    string,
    | SessionRunning
    | NotFound
    | UnknownAgent
    | SessionFailed
    | GitFailed
    | TaskRefused
    | SqlError.SqlError
    | Schema.SchemaError
    | CommandIdReused
    | RowNotFound
    | RevisionConflict,
    SqlClient.SqlClient | Crypto.Crypto | Ledger
  >
  readonly limits: Limits['Service']
  readonly modelOnStep: (
    taskId: string,
    step: StuckInfo['step'],
    agentId: string,
  ) => Effect.Effect<string | null, SqlError.SqlError, SqlClient.SqlClient>
  readonly openToSettle: (
    run: RunRow,
  ) => Effect.Effect<
    { line?: number; file?: string; claim: string; title?: string; id: string; severity: 'major' | 'blocking' | 'minor' | 'nit' }[],
    SqlError.SqlError,
    SqlClient.SqlClient
  >
  readonly outOfUsage: (
    on: LimitedStep,
    agentId: string,
    accountId: string | null,
  ) => Effect.Effect<void, unknown, SqlClient.SqlClient | Instance | Crypto.Crypto | Ledger | Artifacts>
  readonly provide: <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.Effect<A, E>
  readonly questions: Questions['Service']
  readonly quietly: (
    run: RunRow,
    attempt: { readonly id: string; readonly nodeId: string; readonly nodeKey: string; readonly input: string },
    turnId?: string,
  ) => Effect.Effect<
    boolean,
    SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict | InvalidTransition,
    SqlClient.SqlClient | Ledger
  >
  readonly rest: (taskId: string) => Effect.Effect<void, never, SqlClient.SqlClient>
  readonly review: (
    run: RunRow,
    round: number,
    settled?: string,
    reviewer?: string,
    model?: string | null,
    accountId?: string,
    resumed?: Lead,
    order?: Order,
    effort?: string | null,
  ) => Effect.Effect<
    void | { nodeId: string; attemptId: NodeAttemptId },
    unknown,
    SqlClient.SqlClient | Instance | Crypto.Crypto | Ledger | Artifacts
  >
  readonly roundStartOf: (run: RunRow) => Effect.Effect<RoundInput | undefined, SqlError.SqlError, SqlClient.SqlClient>
  readonly sayOut: (
    threadId: string,
    projectId: ProjectId,
    title: string,
    about?: 'limit' | 'stall',
    handover?: boolean,
  ) => Effect.Effect<string, SqlError.SqlError | Schema.SchemaError, SqlClient.SqlClient | Crypto.Crypto | Ledger>
  readonly serviceOf: (agentId: string) => Effect.Effect<{ readonly name: string; readonly url: string } | undefined>
  readonly sessions: Sessions['Service']
  readonly settledBefore: (run: RunRow) => Effect.Effect<string | undefined, SqlError.SqlError, SqlClient.SqlClient>
  readonly settling: (findings: ReadonlyArray<Finding & { readonly id: string }>) => string
  readonly startOf: (
    taskId: string,
  ) => Effect.Effect<
    { heads: Record<string, string>; uncommitted: Record<string, readonly string[]>; digest: string },
    SqlError.SqlError,
    SqlClient.SqlClient
  >
  readonly stepOf: (key: string) => StuckInfo['step']
  readonly stepsOf: (run: RunRow) => Effect.Effect<
    {
      implement: PlanStep | undefined
      review: PlanStep | undefined
      end: TaskEnd | null
      here: boolean
      publishes: boolean
      ships: PlanParameters['ships']
    },
    Schema.SchemaError
  >
  readonly stuck: (
    run: RunRow,
    attempt: { readonly id: string } | null,
    asked: StuckInfo,
  ) => Effect.Effect<
    void,
    SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict,
    SqlClient.SqlClient | Crypto.Crypto | Ledger
  >
  readonly unstuck: (
    run: RunRow,
  ) => Effect.Effect<void, SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict, SqlClient.SqlClient | Ledger>
  readonly waitForPlace: (
    run: Pick<RunRow, 'projectId'>,
    attemptId: string,
    place: Place,
    since?: string,
  ) => Effect.Effect<void, SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict, SqlClient.SqlClient | Ledger>
}

export const makeRunRecovery = (dependencies: RunRecoveryDependencies) =>
  Effect.gen(function* () {
    const {
      admit,
      asking,
      atWork,
      backWhereItWas,
      begin,
      busy,
      changes,
      conclude,
      connectivity,
      currentRun,
      externalEvery,
      externalInstructions,
      finish,
      going,
      holdsChanged,
      instance,
      keptAnswers,
      leadOn,
      limits,
      modelOnStep,
      openToSettle,
      outOfUsage,
      provide,
      questions,
      quietly,
      rest,
      review,
      roundStartOf,
      sayOut,
      serviceOf,
      sessions,
      settledBefore,
      settling,
      startOf,
      stepOf,
      stepsOf,
      stuck,
      unstuck,
      waitForPlace,
    } = dependencies

    /**
     * The person's answer to a step that needs them. Telling sends their
     * words to the step's agent, started again if it went. Handing the step
     * over runs it again on that agent, on the account and model picked
     * where one was: the lead's steps in its thread, a review as a new
     * round. Waiting holds a step a usage limit stopped until the reset.
     * Abandoning stops the run; for a review, the task goes on without it
     * and is ready.
     */
    const answerStuck = (input: {
      readonly envelope: CommandEnvelope
      readonly attentionId: string
      readonly answer: StuckAnswer
      readonly sender?: MessageSender | undefined
    }) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const { answer } = input
        const call = yield* sql.withTransaction(
          Effect.gen(function* () {
            const [row] = yield* sql<{ projectId: ProjectId; taskId: string; attemptId: string | null; payload: string; state: string }>`
                SELECT project_id, task_id, node_attempt_id AS attempt_id, payload, state FROM attention_requests
                WHERE id = ${input.attentionId} AND kind = 'stuck'`
            if (row === undefined) return yield* new NotFound({ kind: 'attention_request', id: input.attentionId })
            if (row.state !== 'open') return yield* new AttentionClosed({ attentionId: input.attentionId })
            // Going on without opening the pull request doesn't finish a task whose lead is still at work.
            if (answer.kind === 'abandon' && (JSON.parse(row.payload) as StuckInfo).step === 'publish' && (yield* atWork(row.taskId)))
              return yield* new ToolRefused({
                message: 'Its lead is still at work, so the task isn’t finished: the pull request opens when the lead’s work is done.',
              })
            // Only a reset that is known can be waited for.
            if (answer.kind === 'wait' && (JSON.parse(row.payload) as StuckInfo).limit?.resetsAt == null)
              return yield* new NothingToWaitFor({ attentionId: input.attentionId })
            // An account picked is one of the agent's own, still there; otherwise the call stays open.
            if (answer.kind === 'retry' && answer.accountId !== undefined) {
              const [owner] = yield* sql<{ agentId: string }>`
                  SELECT agent_id FROM agent_accounts WHERE id = ${answer.accountId} AND removed_at IS NULL`
              if (owner?.agentId !== answer.agentId) return yield* new NotFound({ kind: 'account', id: answer.accountId })
            }
            const at = yield* timestamp
            const revision = yield* change('attention_requests', input.attentionId, { state: 'answered', answeredAt: at })
            yield* fact({
              projectId: row.projectId,
              aggregateType: 'attention_request',
              aggregateId: input.attentionId,
              revision,
              type: 'attention_request.answered',
              payload: answer,
              actorId: input.envelope.actorId,
              commandId: input.envelope.commandId,
            })
            const decisionId = yield* newId(Ids.decision)
            yield* sql`INSERT INTO decisions ${sql.insert({
              id: decisionId,
              projectId: row.projectId,
              attentionRequestId: input.attentionId,
              outcome: 'answer',
              reason:
                answer.kind === 'tell'
                  ? answer.note
                  : answer.kind === 'retry'
                    ? `Hand the step to ${answer.agentId}`
                    : answer.kind === 'wait'
                      ? 'Wait for the reset'
                      : 'Abandon',
              decidedByActorId: input.envelope.actorId,
              decidedAt: at,
            })}`
            yield* fact({
              projectId: row.projectId,
              aggregateType: 'decision',
              aggregateId: decisionId,
              revision: 1,
              type: 'decision.made',
              payload: answer,
              actorId: input.envelope.actorId,
              commandId: input.envelope.commandId,
            })
            return row
          }),
        )
        const current = yield* currentRun(call.taskId)
        if (current === undefined) return
        const info = JSON.parse(call.payload) as StuckInfo
        if (answer.kind === 'wait') return yield* waitForReset(current, call.attemptId, info, input.envelope)
        // Not half applied: where carrying on fails before the step is under way, the call is open again, to answer anew.
        yield* carryOnPlaced(current, call.attemptId, info, answer, input.envelope, input.sender).pipe(
          Effect.tapCause(() =>
            reopenStuck(current, call.attemptId, input.attentionId, info).pipe(
              Effect.catchCause((cause) => Effect.logWarning('Could not reopen a stuck call whose answer failed', cause)),
            ),
          ),
        )
      })

    /**
     * A stuck call whose answer failed to carry on, open again with its step waiting on it, and the window told: a
     * review the hand-over had ended is waiting again. Left alone where the step is under way, or its run stopped.
     */
    const reopenStuck = (run: RunRow, attemptId: string | null, attentionId: string, info: StuckInfo) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const reopened = yield* sql.withTransaction(
          Effect.gen(function* () {
            if (!(yield* going(run))) return false
            const [call] = yield* sql<{ state: string }>`SELECT state FROM attention_requests WHERE id = ${attentionId}`
            if (call?.state !== 'answered') return false
            if (attemptId !== null) {
              const [attempt] = yield* sql<{ nodeId: string; state: string }>`
                  SELECT node_id, state FROM node_attempts WHERE id = ${attemptId}`
              if (attempt === undefined) return false
              if (attempt.state === 'failed') {
                // Ended by the hand-over; no other attempt of its step took its place.
                const [other] = yield* sql<{ id: string }>`
                    SELECT id FROM node_attempts WHERE node_id = ${attempt.nodeId} AND id != ${attemptId}
                      AND state NOT IN ('failed', 'cancelled', 'succeeded') LIMIT 1`
                if (other !== undefined) return false
                const revision = yield* change('node_attempts', attemptId, {
                  state: 'waiting_attention',
                  holdReason: null,
                  endedAt: null,
                })
                yield* change('nodes', attempt.nodeId, { state: 'running' })
                yield* fact({
                  projectId: run.projectId,
                  aggregateType: 'node_attempt',
                  aggregateId: attemptId,
                  revision,
                  type: 'node_attempt.waiting_attention',
                  payload: info,
                  actorId: instance.systemId,
                })
              } else if (attempt.state !== 'waiting_attention') return false
            }
            const revision = yield* change('attention_requests', attentionId, { state: 'open', answeredAt: null })
            yield* fact({
              projectId: run.projectId,
              aggregateType: 'attention_request',
              aggregateId: attentionId,
              revision,
              type: 'attention_request.opened',
              payload: info,
              actorId: instance.systemId,
            })
            return true
          }),
        )
        if (reopened) yield* touchCard(run.taskId)
      })

    /**
     * Carries on a lead's step that needed the person, as they answered,
     * once its lead has a place among the agents at work on this machine
     * (Busy.ts): without one, the step is held with the answer, and carries
     * on as answered once one frees, after a restart too. A review asks for
     * its place as it starts again; abandoning, and publishing, which is
     * Althar's own, take none.
     */
    const carryOnPlaced = (
      current: RunRow,
      attemptId: string | null,
      info: StuckInfo,
      answer: Exclude<StuckAnswer, { readonly kind: 'wait' }>,
      envelope: CommandEnvelope,
      sender?: MessageSender,
    ) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        if (attemptId === null || answer.kind === 'abandon' || (info.step !== 'implement' && info.step !== 'settle'))
          return yield* carryOn(current, attemptId, info, answer, envelope, undefined, undefined, undefined, 'person', sender)
        yield* busy.enter(
          current.taskId,
          (room) =>
            room
              ? Effect.succeed(true)
              : sql.withTransaction(
                  Effect.gen(function* () {
                    // Stopped since the answer, the step is the person's to resume, not to carry on.
                    const [still] = yield* sql<{ state: string }>`SELECT state FROM node_attempts WHERE id = ${attemptId}`
                    if (still?.state !== 'waiting_attention' || !(yield* going(current))) return false
                    yield* waitForPlace(current, attemptId, { how: 'answered', info, answer, sender })
                    return false
                  }),
                ),
          // As the person answered: at once.
          {
            order: 'person',
            next: (room) =>
              room
                ? provide(carryOn(current, attemptId, info, answer, envelope, undefined, undefined, undefined, 'person', sender))
                : Effect.void,
          },
        )
        yield* touchCard(current.taskId)
      })

    /**
     * A step a usage limit stopped, held until the reset as the person said:
     * at it, the same agent carries it on, as for a project that waits. A
     * reset already past by the answer carries it on now.
     */
    const waitForReset = (current: RunRow, attemptId: string | null, info: StuckInfo, envelope: CommandEnvelope) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const until = info.limit?.resetsAt
        if (attemptId === null || info.agentId === null || until == null) return
        if (Date.parse(until) <= Date.parse(yield* timestamp))
          return yield* carryOnPlaced(current, attemptId, info, { kind: 'retry', agentId: info.agentId }, envelope)
        const agentId = info.agentId
        const model = yield* modelOnStep(current.taskId, info.step, agentId)
        const held = yield* sql.withTransaction(
          Effect.gen(function* () {
            // Stopped since the answer, the step waits for the person to resume it, not for the reset.
            const [still] = yield* sql<{ state: string }>`SELECT state FROM node_attempts WHERE id = ${attemptId}`
            if (still?.state !== 'waiting_attention' || !(yield* going(current))) return false
            const revision = yield* change('node_attempts', attemptId, {
              state: 'held',
              holdReason: 'usage_limit',
              output: JSON.stringify({
                heldFor: agentId,
                until,
                account: info.limit?.accountId ?? null,
                model,
                why: 'asked',
                // Who could take it over still, so the person can change their mind before the reset.
                ...(info.limit === undefined ? {} : { choices: info.limit.choices }),
              } satisfies typeof Hold.Encoded),
            })
            yield* fact({
              projectId: current.projectId,
              aggregateType: 'node_attempt',
              aggregateId: attemptId,
              revision,
              type: 'node_attempt.held',
              payload: { reason: 'usage_limit', agentId, until },
              actorId: envelope.actorId,
            })
            return true
          }),
        )
        if (!held) return
        // The person's doing, so not one the home lists as the loop's.
        yield* addItem({ projectId: current.projectId, threadId: current.threadId }, 'notice', {
          source: 'runtime',
          severity: 'info',
          title: `${capitalized(info.step === 'publish' ? 'the step waits' : `${outStep[info.step].work} ${outStep[info.step].waits}`)} until ${whenWords(until, yield* Clock.currentTimeMillis)}.`,
        })
        yield* touchCard(current.taskId)
        yield* Queue.offer(holdsChanged, undefined)
      })

    /**
     * The person hands a step held for a usage limit to another agent, on
     * the account and model they picked, without waiting for the reset: as
     * answering its call would, had the project asked. Its hold ends where
     * it is read, so the reset doesn't bring it back too. A lead's step
     * takes a place among the agents at work on this machine as the work
     * of a task under way: without one it waits its turn in Up next, after
     * a restart too, and carries on as handed once one frees. A review
     * starts its new round on the agent picked, asking for its place so.
     * A lead's step that can't start then needs the person.
     */
    const handOverHeld = (input: {
      readonly envelope: CommandEnvelope
      readonly taskId: string
      readonly answer: Extract<StuckAnswer, { readonly kind: 'retry' }>
    }) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const { answer } = input
        const current = yield* currentRun(input.taskId)
        const heldOn = () =>
          current === undefined
            ? Effect.succeed(undefined)
            : Effect.map(
                sql<{ attemptId: string; nodeKey: string; iteration: number; output: string | null }>`
                    SELECT a.id AS attempt_id, n.node_key, n.iteration, a.output FROM node_attempts a JOIN nodes n ON n.id = a.node_id
                    WHERE n.execution_id = ${current.executionId} AND a.state = 'held' AND a.hold_reason = 'usage_limit'
                    ORDER BY a.admitted_at DESC LIMIT 1`,
                ([row]) => row,
              )
        const held = yield* heldOn()
        if (current === undefined || held === undefined) return yield* new NotHeld({ taskId: input.taskId })
        // An account picked is one of the agent's own, still there.
        if (answer.accountId !== undefined) {
          const [owner] = yield* sql<{ agentId: string }>`
              SELECT agent_id FROM agent_accounts WHERE id = ${answer.accountId} AND removed_at IS NULL`
          if (owner?.agentId !== answer.agentId) return yield* new NotFound({ kind: 'account', id: answer.accountId })
        }
        const hold = yield* decodeHold(held.output ?? '').pipe(Effect.orElseSucceed(() => undefined))
        const info: StuckInfo = {
          step: stepOf(held.nodeKey),
          why: 'usage_limit',
          detail: null,
          agentId: hold?.heldFor ?? null,
          round: held.iteration,
          open: 0,
        }
        /** Its hold ends, read where it is written: false where the reset, or the person's stop, came first. */
        const release = <R>(then: Effect.Effect<void, unknown, R>) =>
          sql.withTransaction(
            Effect.gen(function* () {
              const [still] = yield* sql<{ state: string; holdReason: string | null }>`
                  SELECT state, hold_reason FROM node_attempts WHERE id = ${held.attemptId}`
              if (still?.state !== 'held' || still.holdReason !== 'usage_limit' || !(yield* going(current))) return false
              const revision = yield* change('node_attempts', held.attemptId, { state: 'admitted', holdReason: null, output: null })
              yield* fact({
                projectId: current.projectId,
                aggregateType: 'node_attempt',
                aggregateId: held.attemptId,
                revision,
                type: 'node_attempt.admitted',
                payload: { node: held.nodeKey, iteration: held.iteration, handedTo: answer },
                actorId: input.envelope.actorId,
                commandId: input.envelope.commandId,
              })
              yield* then
              return true
            }),
          )
        /** Carried on as handed; a lead that can't start leaves the step needing the person, as when a plan starts. */
        const carry = Effect.gen(function* () {
          const carried = yield* Effect.exit(
            carryOn(current, held.attemptId, info, answer, input.envelope, undefined, undefined, undefined, 'underway'),
          )
          if (carried._tag === 'Failure')
            yield* stuck(current, { id: held.attemptId }, { ...info, why: 'failed_to_start', detail: summarize(carried.cause) || null })
        })
        if (info.step === 'review') {
          // A review asks for its own place as its new round starts.
          if (!(yield* release(Effect.void))) return yield* new NotHeld({ taskId: input.taskId })
          yield* carry
          return yield* touchCard(current.taskId)
        }
        const released = yield* busy.enter(
          current.taskId,
          (room) =>
            release(
              room
                ? Effect.void
                : // Admitted only to be held again at once, for a place this time, in the same transaction.
                  waitForPlace(current, held.attemptId, { how: 'handed', info, answer }),
            ).pipe(Effect.map((done) => (done ? (room ? ('now' as const) : ('waits' as const)) : ('gone' as const)))),
          { order: 'underway', next: (how) => (how === 'now' ? provide(carry) : Effect.void) },
        )
        if (released === 'gone') return yield* new NotHeld({ taskId: input.taskId })
        yield* touchCard(current.taskId)
      })

    /**
     * Carries a step on that stopped: told what to do, handed to another
     * agent (on a model, where one is chosen), or abandoned; as the person
     * answered its call, or as Althar does when an agent is out of usage.
     */
    const carryOn = (
      current: RunRow,
      attemptId: string | null,
      info: StuckInfo,
      answer: Exclude<StuckAnswer, { readonly kind: 'wait' }>,
      envelope: CommandEnvelope,
      model?: string | null,
      /** Why it carries on so, where Althar says: in place of the thread's own line for a switch. */
      said?: string,
      /** How hard the agent it is handed to thinks, where the person picked. */
      effort?: string | null,
      /** Whose doing it is: the person's (their answer, their resume), or Althar's own, as for a usage limit or a restart (ADR-037). */
      by: Order = 'underway',
      sender?: MessageSender,
      /** What the thread's line for `said` says Althar dealt with: a usage limit, or a step without its report. */
      about: 'limit' | 'stall' = 'limit',
    ) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [attempt] =
          attemptId === null
            ? []
            : yield* sql<{
                id: string
                nodeId: string
                state: string
              }>`SELECT id, node_id, state FROM node_attempts WHERE id = ${attemptId}`
        // The account and model the person picked, where they did; a model Althar chose comes first.
        const accountId = answer.kind === 'retry' ? answer.accountId : undefined
        const on = model ?? (answer.kind === 'retry' ? answer.model : undefined)
        /** The waiting attempt runs again, reminded afresh; whether it does, its run not stopped meanwhile. */
        const resume = (sessionId: string) =>
          attempt === undefined ? Effect.succeed(true) : begin(current, attempt.id, sessionId, current.threadId, true)
        const endAttempt = (state: 'failed' | 'cancelled', output: unknown) =>
          attempt === undefined
            ? Effect.void
            : sql.withTransaction(
                Effect.gen(function* () {
                  const at = yield* timestamp
                  // One held for a limit and handed on ends with its hold.
                  const revision = yield* change('node_attempts', attempt.id, {
                    state,
                    holdReason: null,
                    output: JSON.stringify(output),
                    endedAt: at,
                  })
                  yield* change('nodes', attempt.nodeId, { state })
                  yield* fact({
                    projectId: current.projectId,
                    aggregateType: 'node_attempt',
                    aggregateId: attempt.id,
                    revision,
                    type: `node_attempt.${state}`,
                    payload: output,
                    actorId: envelope.actorId,
                  })
                }),
              )
        if (info.step === 'publish') {
          // Gone on without its ending, the task is ready on its branch; otherwise Althar tries again. Not while its lead is still
          // at work: that would finish a task whose work hasn't stopped.
          if (answer.kind === 'abandon') {
            if (yield* atWork(current.taskId))
              return yield* new ToolRefused({
                message: 'Its lead is still at work, so the task isn’t finished: the pull request opens when the lead’s work is done.',
              })
            yield* endAttempt('cancelled', { skipped: true })
            yield* addItem({ projectId: current.projectId, threadId: current.threadId }, 'notice', {
              source: 'runtime',
              severity: 'info',
              title: 'Gone on without opening the pull request: the task is ready on its branch.',
            })
            return yield* finish(current, 'succeeded')
          }
          yield* endAttempt('failed', { again: true })
          return yield* conclude(current)
        }
        if (info.step === 'review') {
          if (answer.kind === 'abandon') {
            // Gone on without the review, the task is ready, with what was found left open.
            yield* endAttempt('cancelled', { skipped: true })
            yield* addItem({ projectId: current.projectId, threadId: current.threadId }, 'notice', {
              source: 'runtime',
              severity: 'info',
              title: 'The review stopped: gone on without it, with what it found left open.',
            })
            return yield* conclude(current)
          }
          yield* endAttempt('failed', { handedTo: answer.kind === 'retry' ? answer.agentId : info.agentId })
          // A review starts on its own thread, so why it moved is said in the task's.
          if (said !== undefined)
            yield* sayOut(
              current.threadId,
              current.projectId,
              said,
              about,
              // Another agent takes the review over; the same on another of its accounts goes on quietly.
              answer.kind !== 'retry' || answer.agentId !== info.agentId,
            )
          const [last] = yield* sql<{ summary: string }>`
              SELECT json_extract(content, '$.summary') AS summary FROM thread_items
              WHERE thread_id = ${current.threadId} AND kind = 'step_result' AND json_extract(content, '$.step') = 'settle'
              ORDER BY sequence DESC LIMIT 1`
          const round = yield* review(
            current,
            info.round,
            // A round after the first reads what the lead settled before it.
            info.round > 0 ? last?.summary : undefined,
            answer.kind === 'retry' ? answer.agentId : undefined,
            on,
            accountId,
            // As the person said, or as Althar carries it on: a place of its own, not the lead's.
            yield* lastLead(current),
            by,
            effort ?? (answer.kind === 'retry' ? answer.effort : undefined),
          )
          if (answer.kind === 'tell') {
            const [thread] = yield* sql<{
              id: string
            }>`SELECT id FROM threads WHERE task_id = ${current.taskId} AND kind = 'step' AND node_key = 'review'`
            if (thread !== undefined && round !== undefined)
              yield* sessions.send({
                envelope: envelope,
                threadId: thread.id,
                body: answer.note,
                sender: sender ?? { kind: 'internal' },
                ...(answer.quiet === true ? { quiet: true } : {}),
              })
          }
          return
        }
        if (answer.kind === 'abandon') {
          // Given up, a round of work after the plan leaves the task where it was before it (ADR-034); what it committed stays.
          const round = info.step === 'implement' ? yield* roundStartOf(current) : undefined
          if (round !== undefined) {
            yield* endAttempt('cancelled', { abandoned: true })
            const now = yield* startOf(current.taskId)
            const committed = Object.entries(now.heads).some(([path, head]) => round.start.heads[path] !== head)
            yield* sql.withTransaction(backWhereItWas(current, round.round, 'abandoned', committed))
            yield* rest(current.taskId)
            yield* Effect.ignore(changes.settleIfMerged(current.taskId))
            return yield* touchCard(current.taskId)
          }
          yield* endAttempt('cancelled', { abandoned: true })
          return yield* finish(current, 'cancelled')
        }
        // The lead's step: its agent (or the one picked) on the task's thread, told again what the step is.
        const sessionId = yield* leadOn(
          current,
          answer.kind === 'retry' ? answer.agentId : undefined,
          on,
          said,
          effort ?? (answer.kind === 'retry' ? answer.effort : undefined),
          accountId,
          about,
          attemptId,
        )
        if (!(yield* resume(sessionId))) return
        if (answer.kind === 'tell')
          yield* sessions.send({
            envelope: envelope,
            threadId: current.threadId,
            body: answer.note,
            sender: sender ?? { kind: 'internal' },
            ...(answer.quiet === true ? { quiet: true } : {}),
          })
        else
          yield* sessions.send({
            envelope: envelope,
            threadId: current.threadId,
            body:
              info.step === 'settle'
                ? settling(yield* openToSettle(current))
                : current.planId === null && info.step === 'implement'
                  ? "Carry on with the task from where it stands: what the person asked you last. When it's done, call Althar's finish_step tool with your summary."
                  : "Carry on with the task from where it stands. When it's done, call Althar's finish_step tool with your summary.",
            quiet: true,
          })
        yield* sessions.wake(current.threadId)
        yield* touchCard(current.taskId)
      })

    /** Who leads the task's thread: the last agent on it, on its model and effort, else the plan's lead. */
    const lastLead = (run: RunRow) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [last] = yield* sql<{ agentId: string; model: string | null; effort: string | null }>`
            SELECT agent_id, model, effort FROM provider_sessions WHERE thread_id = ${run.threadId} ORDER BY started_at DESC, rowid DESC LIMIT 1`
        if (last !== undefined) return last satisfies Lead
        const { implement } = yield* stepsOf(run)
        return { agentId: implement?.agentId ?? 'claude-code', model: implement?.model ?? null, effort: implement?.effort ?? null }
      })

    /**
     * Carries on a run its task's stop suspended (docs/architecture/05,
     * "Task and run lifecycle"): it runs again, on an attempt of its own,
     * from the step stopping cut short. The lead's step runs again on the
     * lead given, or its last, told to carry on (or to settle what is still
     * open); a review starts its round again on its reviewer; publishing is
     * tried again. Stopped between two steps, the lead carries its own on.
     * What the person said meanwhile waits in the lead's thread: beside a
     * review or publishing the lead starts too, so it is read now.
     */
    /**
     * Tells an answer to a question whose agent has gone since it asked
     * (DEV-13): queued for the thread, quietly, and read by the agent on it,
     * or by one started for it. A run's lead step that waited on the answer
     * carries on, its lead started as a stuck step's is when told what to do;
     * otherwise the agent last on the thread starts again.
     */
    const answered = (input: { readonly envelope: CommandEnvelope; readonly threadId: string; readonly body: string }) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        // Queued first, so the agent that starts reads it in its first turn.
        yield* sessions.send({ envelope: input.envelope, threadId: input.threadId, body: input.body, quiet: true })
        if (Option.isSome(yield* sessions.running(input.threadId))) return
        const [step] = yield* sql<{ taskId: string; attemptId: string }>`
            SELECT r.task_id, a.id AS attempt_id FROM threads t
            JOIN runs r ON r.task_id = t.task_id AND r.state = 'running'
            JOIN workflow_executions e ON e.run_id = r.id
            JOIN nodes n ON n.execution_id = e.id AND n.node_key IN ('implement', 'settle')
            JOIN node_attempts a ON a.node_id = n.id AND a.state IN ('running', 'waiting_attention')
            WHERE t.id = ${input.threadId} AND t.kind = 'task'
            ORDER BY a.admitted_at DESC LIMIT 1`
        const current = step === undefined ? undefined : yield* currentRun(step.taskId)
        if (step !== undefined && current !== undefined) {
          const sessionId = yield* leadOn(current)
          yield* begin(current, step.attemptId, sessionId, current.threadId, true)
          return
        }
        yield* sessions.startLast(input.threadId)
      })

    /** The lead's step a resume carries on, on the lead given, told to carry on; a lead that can't start leaves it needing the person, as when a plan starts. */
    const resumeLead = (
      current: RunRow,
      attemptId: string,
      key: 'implement' | 'settle',
      iteration: number,
      lead: Lead,
      said: CommandEnvelope,
    ) =>
      Effect.gen(function* () {
        const info: StuckInfo = { step: key, why: 'restarted', detail: null, agentId: lead.agentId, round: iteration, open: 0 }
        const carried = yield* Effect.exit(
          carryOn(current, attemptId, info, { kind: 'retry', agentId: lead.agentId }, said, lead.model, undefined, lead.effort, 'person'),
        )
        if (carried._tag === 'Failure')
          yield* stuck(current, { id: attemptId }, { ...info, why: 'failed_to_start', detail: summarize(carried.cause) || null })
      })

    const resume = (input: { readonly envelope: CommandEnvelope; readonly taskId: string; readonly lead?: Lead }) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const resumed = yield* sql.withTransaction(
          Effect.gen(function* () {
            const [last] = yield* sql<{ id: string; projectId: ProjectId; state: RunState }>`
                SELECT id, project_id, state FROM runs WHERE task_id = ${input.taskId} ORDER BY created_at DESC LIMIT 1`
            if (last === undefined || last.state !== 'suspended') return false
            // Read where it is written: a task abandoned meanwhile stays as it is.
            const [task] = yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${input.taskId}`
            if (task?.state !== 'open' && task?.state !== 'draft') return false
            const state = yield* transition(runLifecycle, last.state, 'running')
            const at = yield* timestamp
            const [attempts] = yield* sql<{ n: number }>`SELECT max(attempt_number) AS n FROM run_attempts WHERE run_id = ${last.id}`
            // A new attempt at the run: the one stopping interrupted stays as it ended.
            yield* sql`INSERT INTO run_attempts ${sql.insert({
              id: yield* newId(Ids.runAttempt),
              projectId: last.projectId,
              runId: last.id,
              attemptNumber: (attempts?.n ?? 0) + 1,
              deviceId: instance.deviceId,
              controllerGeneration: 1,
              controllerInstanceId: instance.id,
              state: 'active',
              startedAt: at,
            })}`
            const revision = yield* change('runs', last.id, { state })
            yield* fact({
              projectId: last.projectId,
              aggregateType: 'run',
              aggregateId: last.id,
              revision,
              type: 'run.resumed',
              actorId: input.envelope.actorId,
              commandId: input.envelope.commandId,
            })
            return true
          }),
        )
        if (!resumed) return
        const current = yield* currentRun(input.taskId)
        if (current === undefined) return
        // An answer kept for a place when the task stopped is the lead's to read as it carries on, as anything said meanwhile.
        for (const kept of yield* keptAnswers(input.taskId)) {
          const told = yield* questions.tell(kept.id)
          if (!told.told)
            yield* sessions.send({
              envelope: yield* envelope('thread.send', { threadId: told.threadId, answered: kept.id }),
              threadId: told.threadId,
              body: told.body,
              quiet: true,
            })
        }
        const lead = input.lead ?? (yield* lastLead(current))
        // The run's latest attempt: the one stopping cut short, unless it stopped between two steps; with the agent it ran on,
        // where it started one, since a step handed to another agent keeps its node's first.
        const [latest] = yield* sql<{
          nodeKey: string
          iteration: number
          config: string
          input: string
          state: string
          stopped: number | null
          ranOn: string | null
          ranModel: string | null
        }>`
            SELECT n.node_key, n.iteration, n.config, a.input, a.state, json_extract(a.output, '$.stopped') AS stopped,
              s.agent_id AS ran_on, s.model AS ran_model
            FROM node_attempts a JOIN nodes n ON n.id = a.node_id LEFT JOIN provider_sessions s ON s.id = a.provider_session_id
            WHERE n.execution_id = ${current.executionId} ORDER BY a.admitted_at DESC, a.rowid DESC LIMIT 1`
        const cut = latest !== undefined && latest.state === 'cancelled' && latest.stopped === 1 ? latest : undefined
        const step = cut === undefined ? undefined : stepOf(cut.nodeKey)
        const config = JSON.parse(cut?.config ?? '{}') as { agentId?: string; model?: string | null }
        // A review a stop cut short on a branch with nothing built isn't carried on: its lead does the work instead, and the
        // thread says why the review didn't start.
        const empty =
          cut !== undefined && step === 'review' && (yield* changes.nothingBuilt(current.taskId).pipe(Effect.orElseSucceed(() => false)))
        if (empty)
          yield* addItem({ projectId: current.projectId, threadId: current.threadId }, 'notice', {
            source: 'runtime',
            severity: 'info',
            title: 'The review waits: the branch has nothing built yet. Its lead carries on with the work.',
          })
        if (cut !== undefined && step === 'review' && !empty) {
          // Its round again, on its reviewer, with what the lead settled before it, after the first: once it has a place.
          const settled = cut.iteration > 0 ? yield* settledBefore(current) : undefined
          const reviewer =
            cut.ranOn === null ? { agentId: config.agentId, model: config.model ?? null } : { agentId: cut.ranOn, model: cut.ranModel }
          yield* review(current, cut.iteration, settled, reviewer.agentId, reviewer.model, undefined, lead)
        } else if (cut !== undefined && step === 'publish') yield* conclude(current)
        else {
          // The lead's step: the one cut short, else the lead's latest, else Implement.
          const leadCut = empty ? undefined : cut
          const [own] =
            leadCut === undefined
              ? yield* sql<{ nodeKey: string; iteration: number; config: string; input: string }>`
                    SELECT n.node_key, n.iteration, n.config, a.input FROM node_attempts a JOIN nodes n ON n.id = a.node_id
                    WHERE n.execution_id = ${current.executionId} AND n.node_key IN ('implement', 'settle')
                    ORDER BY a.admitted_at DESC, a.rowid DESC LIMIT 1`
              : [leadCut]
          const { implement } = yield* stepsOf(current)
          const key = own?.nodeKey === 'settle' ? 'settle' : 'implement'
          const iteration = own?.iteration ?? 0
          // It takes a place among the agents at work on this machine, or waits for one.
          // As the person resumed it: at once.
          const admitted = yield* busy.enter(
            current.taskId,
            (room) =>
              sql.withTransaction(
                Effect.gen(function* () {
                  const admission = yield* admit(
                    current,
                    key,
                    iteration,
                    JSON.parse(own?.config ?? JSON.stringify(implement ?? {})),
                    JSON.parse(own?.input ?? '{}'),
                  )
                  if (!room) yield* waitForPlace(current, admission.attemptId, { how: 'resume', lead })
                  return { ...admission, room }
                }),
              ),
            { order: 'person' },
          )
          if (admitted.room) yield* resumeLead(current, admitted.attemptId, key, iteration, lead, input.envelope)
          return yield* touchCard(current.taskId)
        }
        // Beside a review or publishing, what the person said is read now: the lead starts for it.
        const [waiting] = yield* sql<{ id: string }>`
            SELECT i.id FROM user_inputs i JOIN actors a ON a.id = i.author_actor_id
            WHERE i.thread_id = ${current.threadId} AND i.state = 'queued' AND a.kind = 'person' LIMIT 1`
        if (waiting !== undefined && Option.isNone(yield* sessions.running(current.threadId)))
          yield* Effect.ignore(leadOn(current, lead.agentId, lead.model, undefined, lead.effort))
        yield* touchCard(current.taskId)
      })

    /** The last line in the task's thread that said Althar carried the step on by itself, keyed so; and whether a crash came before it. */
    const lastCarried = (current: RunRow, key: '$.restarted' | '$.startedAgain', value: string) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [carried] = yield* sql<{ createdAt: string; crashed: number | null }>`
            SELECT created_at, json_extract(content, '$.crashed') AS crashed FROM thread_items
            WHERE thread_id = ${current.threadId} AND kind = 'notice' AND json_extract(content, ${key}) = ${value}
            ORDER BY sequence DESC LIMIT 1`
        return carried === undefined ? undefined : { createdAt: carried.createdAt, crashed: carried.crashed === 1 }
      })

    /**
     * Whether Althar crashed on the step twice in a row: this launch follows
     * a crash, and so did the one that last carried the step on, and the
     * last sign of life in the task's thread or its review's, the line that
     * said it carried on at least, came within RESTART_GRACE of that line.
     * Quitting or restarting Althar in between never counts.
     */
    const restartedAgain = (current: RunRow, step: { readonly nodeId: string }) =>
      instance.afterCrash ? soonAgain(current, '$.restarted', step.nodeId, true) : Effect.succeed(false)

    /**
     * Whether a step Althar carried on by itself, as its notice keyed so in
     * the task's thread says, stopped again soon after: nothing of the task's
     * thread or its review's came RESTART_GRACE after that notice. `crashed`,
     * only where that notice followed a crash.
     */
    const soonAgain = (current: RunRow, key: '$.restarted' | '$.startedAgain', value: string, crashed = false) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const carried = yield* lastCarried(current, key, value)
        if (carried === undefined || (crashed && !carried.crashed)) return false
        const grace = new Date(Date.parse(carried.createdAt) + Duration.toMillis(RESTART_GRACE)).toISOString()
        const [alive] = yield* sql<{ later: number }>`
            SELECT count(*) AS later FROM thread_items i JOIN threads t ON t.id = i.thread_id
            WHERE t.task_id = ${current.taskId} AND (t.kind = 'task' OR (t.kind = 'step' AND t.node_key = 'review'))
              AND i.created_at >= ${grace}`
        return alive?.later === 0
      })

    /**
     * A step running when Althar stopped carries on by itself, as the
     * person's resume would carry it on, and the thread says so in a line.
     * A lead that asked the person a question still waits on them. A step
     * Althar crashed on twice, the second time before its agent had been at
     * it for RESTART_GRACE, needs the person instead, so it doesn't start
     * over forever; quitting or restarting Althar never counts. After a
     * clean quit, a step an earlier version paused for restarts, which
     * couldn't tell them from crashes, carries on too, its call withdrawn;
     * one paused for crashes waits on the person. A step on
     * an agent takes a place among the agents at work on this machine like
     * any other (Busy.ts): each waits for one, in the order they were first
     * admitted, so those that were working go before what waited behind
     * them, and as many carry on at once as there are places. Publishing,
     * which is Althar's own, takes none and carries on at once.
     */
    const interrupted = yield* provide(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const left = yield* sql<{
          taskId: string
          nodeKey: string
          nodeId: string
          attemptId: string
          iteration: number
          ranOn: string | null
          ranModel: string | null
          admittedAt: string
          input: string
          state: string
        }>`
            SELECT r.task_id, n.node_key, n.id AS node_id, a.id AS attempt_id, n.iteration, a.admitted_at, a.input, a.state,
              -- The agent it ran on, on its model; one not started yet, the plan's for the step (Althar's own, none).
              coalesce(s.agent_id, json_extract(n.config, '$.agentId')) AS ran_on,
              CASE WHEN s.id IS NULL THEN json_extract(n.config, '$.model') ELSE s.model END AS ran_model
            FROM runs r JOIN workflow_executions e ON e.run_id = r.id JOIN nodes n ON n.execution_id = e.id
            JOIN node_attempts a ON a.node_id = n.id LEFT JOIN provider_sessions s ON s.id = a.provider_session_id
            WHERE r.state = 'running' AND (a.state IN ('admitted', 'running') OR (${instance.afterCrash ? 0 : 1} = 1
              AND a.state = 'waiting_attention' AND EXISTS (SELECT 1 FROM attention_requests q WHERE q.node_attempt_id = a.id
                AND q.kind = 'stuck' AND q.state = 'open' AND json_extract(q.payload, '$.why') = 'restarted')))`
        const carrying: Array<Interrupted> = []
        for (const step of left) {
          const current = yield* currentRun(step.taskId)
          if (current === undefined) continue
          // Paused for restarts: by crashes, it still waits on the person; by restarts an earlier version counted, it carries on.
          if (step.state === 'waiting_attention') {
            if ((yield* lastCarried(current, '$.restarted', step.nodeId))?.crashed === true) continue
            yield* sql.withTransaction(unstuck(current))
          }
          // A lead that asked the person a question still waits on them: their answer carries the step on.
          if (step.nodeKey !== 'review' && (yield* asking(current.threadId))) {
            const revision = yield* change('node_attempts', step.attemptId, { state: 'waiting_attention' })
            yield* fact({
              projectId: current.projectId,
              aggregateType: 'node_attempt',
              aggregateId: step.attemptId,
              revision,
              type: 'node_attempt.waiting_attention',
              payload: { question: true },
              actorId: instance.systemId,
            })
            continue
          }
          // A round of work whose lead's last turn had completed as Althar stopped waited on the person: as that turn's end would
          // have, it ends where it made nothing new (ADR-034). One cut short by the stop is carried on, as any step.
          if (current.planId === null && step.nodeKey === 'implement') {
            const [turn] = yield* sql<{ state: string }>`
                SELECT state FROM turn_deliveries WHERE thread_id = ${current.threadId} ORDER BY requested_at DESC, rowid DESC LIMIT 1`
            if (
              turn?.state === 'completed' &&
              (yield* quietly(current, { id: step.attemptId, nodeId: step.nodeId, nodeKey: step.nodeKey, input: step.input }))
            )
              continue
          }
          if (yield* restartedAgain(current, step)) {
            yield* stuck(
              current,
              { id: step.attemptId },
              { step: stepOf(step.nodeKey), why: 'restarted', detail: null, agentId: step.ranOn, round: step.iteration, open: 0 },
            )
            continue
          }
          if (step.nodeKey === 'publish') carrying.push({ ...step, current })
          else yield* sql.withTransaction(waitForPlace(current, step.attemptId, { how: 'restart' }, step.admittedAt))
        }
        return carrying
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.as(Effect.logWarning('Could not mark the steps a restart stopped', cause), [] as ReadonlyArray<Interrupted>),
        ),
      ),
    )

    /**
     * Carries on a step a restart stopped, as the person's resume does: the
     * lead's step on the lead, its model and effort, told to carry on; a
     * review's round again on its reviewer; publishing tried again. An
     * agent out of usage goes the way a limit takes it, held or handed on;
     * a lead that can't start needs the person.
     */
    const carryOnAfterRestart = (step: Interrupted) =>
      Effect.gen(function* () {
        const { current } = step
        const kind = stepOf(step.nodeKey)
        // The lead's steps on the lead, as it last was; a review on its reviewer.
        const { agentId, model, effort } =
          kind === 'implement' || kind === 'settle' ? yield* lastLead(current) : { agentId: step.ranOn, model: step.ranModel, effort: null }
        const info: StuckInfo = { step: kind, why: 'restarted', detail: null, agentId, round: step.iteration, open: 0 }
        // Out of usage on what the project runs it on, it goes the way a limit takes it, with the account that is out.
        const out = agentId === null ? Option.none() : yield* limits.out(agentId, current.projectId)
        const carried = yield* Effect.exit(
          Option.isSome(out)
            ? outOfUsage(
                { ...step, taskId: current.taskId, output: null, input: '{}', run: current, step: kind },
                out.value.agentId,
                out.value.accountId,
              )
            : Effect.gen(function* () {
                // Said first, so a crash while it starts counts as one soon after; after a crash, it says so for the next.
                yield* addItem({ projectId: current.projectId, threadId: current.threadId }, 'notice', {
                  source: 'runtime',
                  severity: 'info',
                  title: 'Carried on after Althar restarted.',
                  restarted: step.nodeId,
                  ...(instance.afterCrash ? { crashed: true } : {}),
                })
                const carrying = yield* envelope('thread.send', { threadId: current.threadId, restarted: step.attemptId })
                yield* carryOn(
                  current,
                  step.attemptId,
                  info,
                  // Publishing, which is Althar's own, is tried again whoever is named.
                  { kind: 'retry', agentId: agentId ?? 'althar' },
                  carrying,
                  model,
                  undefined,
                  effort,
                )
              }),
        )
        // A lead that can't start, or one handed on for a limit that can't, leaves its step needing the person, as when a plan starts.
        if (carried._tag === 'Failure')
          yield* stuck(current, { id: step.attemptId }, { ...info, why: 'failed_to_start', detail: summarize(carried.cause) || null })
      })

    /**
     * Starts a step again whose agent went on its own (DEV-173), as a restart
     * carries one on: the lead's steps on the lead, its model and effort, told
     * to carry on; a review's round again on its reviewer. Said in the task's
     * thread keyed by the step, so going again soon after needs the person
     * (`soonAgain`); one that can't start needs them too.
     */
    const startAgain = (on: LimitedStep, key: string, info: (why: StuckWhy, detail: string | null) => StuckInfo) =>
      Effect.gen(function* () {
        const asked = info('session_ended', null)
        const lead = on.step === 'implement' || on.step === 'settle'
        const { agentId, model, effort } = lead
          ? yield* lastLead(on.run)
          : {
              agentId: asked.agentId,
              model: asked.agentId === null ? null : yield* modelOnStep(on.run.taskId, on.step, asked.agentId),
              effort: null,
            }
        if (agentId === null) return yield* stuck(on.run, { id: on.attemptId }, asked)
        yield* addItem({ projectId: on.run.projectId, threadId: on.run.threadId }, 'notice', {
          source: 'runtime',
          severity: 'info',
          title: 'Started again after its agent stopped on its own.',
          startedAgain: key,
        })
        const starting = yield* envelope('thread.send', { threadId: on.run.threadId, startedAgain: on.attemptId })
        const carried = yield* Effect.exit(
          carryOn(on.run, on.attemptId, asked, { kind: 'retry', agentId }, starting, model, undefined, effort),
        )
        if (carried._tag === 'Failure')
          yield* stuck(on.run, { id: on.attemptId }, { ...asked, why: 'failed_to_start', detail: summarize(carried.cause) || null })
      })

    /**
     * A step held for a usage limit runs again at the reset, on the agent,
     * account and model it was held for, once it has a place among the
     * agents at work on this machine; until then it waits for one.
     * `placed`, it waited for a place after its reset, and has one now.
     * One held for the connection (`connection`, ADR-060) goes the same
     * way, its turn sent again in the session it was in, told quietly to
     * carry on; started again as after a reset where that session went.
     */
    const resumeHeld = (
      held: {
        readonly taskId: string
        readonly attemptId: string
        readonly nodeKey: string
        readonly iteration: number
        readonly agentId: string
        readonly accountId: string | null
        readonly model: string | null
      },
      placed = false,
      /** Held for the connection, rather than a reset: how often its service had failed in a row. */
      connection?: { readonly tries: number },
    ) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const current = yield* currentRun(held.taskId)
        if (current === undefined) return
        const reason = connection === undefined ? 'usage_limit' : 'agent_unavailable'
        const resumed = yield* busy.enter(
          held.taskId,
          (room) =>
            sql.withTransaction(
              Effect.gen(function* () {
                // Stopped meanwhile, it waits for the person to resume it, not for the reset.
                // Handed to another agent by the person meanwhile, it isn't held for the reset any more, though it may wait for a place.
                const [still] = yield* sql<{ state: string; holdReason: string | null }>`
                    SELECT state, hold_reason FROM node_attempts WHERE id = ${held.attemptId}`
                if (placed ? still?.state !== 'admitted' : still?.state !== 'held' || still.holdReason !== reason) return false
                if (!room) {
                  yield* waitForPlace(current, held.attemptId, {
                    how: 'reset',
                    agentId: held.agentId,
                    accountId: held.accountId,
                    model: held.model,
                    ...(connection === undefined ? {} : { connection }),
                  })
                  return false
                }
                // Back from the connection, it keeps how often its service failed, so one that keeps failing comes to the person.
                const revision = yield* change('node_attempts', held.attemptId, {
                  state: 'running',
                  holdReason: null,
                  output: connection === undefined || connection.tries === 0 ? null : JSON.stringify({ tries: connection.tries }),
                })
                yield* fact({
                  projectId: current.projectId,
                  aggregateType: 'node_attempt',
                  aggregateId: held.attemptId,
                  revision,
                  type: 'node_attempt.resumed',
                  actorId: instance.systemId,
                })
                return true
              }),
            ),
          // Back from a usage limit, or the connection: the work of a task under way.
          { review: held.nodeKey === 'review', order: 'underway' },
        )
        if (!resumed) return yield* touchCard(held.taskId)
        const resuming = yield* envelope('thread.send', { threadId: current.threadId, resumed: held.attemptId })
        if (connection !== undefined) {
          // Its turn again, in the session it was in, where that is still there on the agent it was on.
          const [review] =
            held.nodeKey === 'review'
              ? yield* sql<{
                  id: string
                }>`SELECT id FROM threads WHERE task_id = ${held.taskId} AND kind = 'step' AND node_key = 'review'`
              : []
          const threadId = review?.id ?? current.threadId
          const live = Option.filter(yield* sessions.running(threadId), (session) => !session.stopping)
          if (Option.isSome(live) && live.value.agentId === held.agentId) {
            yield* addItem({ projectId: current.projectId, threadId: current.threadId }, 'notice', {
              source: 'runtime',
              severity: 'info',
              title: 'The connection is back.',
            })
            yield* sessions.send({ envelope: resuming, threadId, body: RECONNECTED, quiet: true })
            yield* sessions.wake(threadId)
            return yield* touchCard(held.taskId)
          }
        }
        const info: StuckInfo = {
          step: stepOf(held.nodeKey),
          why: connection === undefined ? 'usage_limit' : 'transient',
          detail: null,
          agentId: held.agentId,
          round: held.iteration,
          open: 0,
        }
        yield* carryOn(
          current,
          held.attemptId,
          info,
          {
            kind: 'retry',
            agentId: held.agentId,
            ...(held.accountId === null ? {} : { accountId: held.accountId }),
            ...(held.model === null ? {} : { model: held.model }),
          },
          resuming,
        )
      })

    /**
     * A step held for the connection, due (ADR-060): where its service
     * answers, it carries on; where it doesn't yet, though the computer says
     * it is online, it waits for the connection, and asks again a while
     * later.
     */
    const backOnline = (
      step: { readonly taskId: string; readonly attemptId: string; readonly nodeKey: string; readonly iteration: number },
      hold: typeof Hold.Type,
    ) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const service = yield* serviceOf(hold.heldFor)
        const tries = hold.tries ?? 0
        if (yield* connectivity.answers(service?.url))
          return yield* resumeHeld({ ...step, agentId: hold.heldFor, accountId: hold.account ?? null, model: hold.model ?? null }, false, {
            tries,
          })
        const until = new Date(Date.parse(yield* timestamp) + Duration.toMillis(connectivity.every)).toISOString()
        const waited = yield* sql.withTransaction(
          Effect.gen(function* () {
            const [still] = yield* sql<{ state: string; holdReason: string | null }>`
                SELECT state, hold_reason FROM node_attempts WHERE id = ${step.attemptId}`
            if (still?.state !== 'held' || still.holdReason !== 'agent_unavailable') return false
            yield* change('node_attempts', step.attemptId, {
              output: JSON.stringify({ ...hold, until, offline: true } satisfies typeof Hold.Encoded),
            })
            return true
          }),
        )
        // It waits for the connection now, rather than for a try again: its card says so.
        if (waited && hold.offline !== true) yield* touchCard(step.taskId)
      })

    /** A message that waited for an agent's reset goes to it then: to its session, or, after a restart, to one started for it. */
    const deliverWaiting = (waiting: { readonly threadId: string; readonly agentId: string }) =>
      Effect.gen(function* () {
        const live = yield* sessions.running(waiting.threadId)
        if (Option.isNone(live)) return void (yield* sessions.start({ threadId: waiting.threadId, agentId: waiting.agentId }))
        // Another agent the person picked since has the message already.
        if (live.value.agentId === waiting.agentId) yield* sessions.wake(waiting.threadId)
      })

    /*
     * Stand-ins whose lead couldn't be queued back just now (it was being handed over, or stopping): each waits a while
     * before the next try, so the loop never spins on it.
     */
    const notYetBack = new Map<string, number>()

    /**
     * The lead a stand-in stands in for is back (its usage, or the step it failed over): it leads the thread again from its
     * next turn, queued in one move with the checks that nothing newer was chosen (Sessions' `giveBack`), and the thread says
     * so as it takes over. Until it has, the stand-in stays one, so a stop, a restart or a lead that couldn't start tries again.
     */
    const giveBack = (one: { readonly sessionId: string; readonly threadId: string }) =>
      Effect.gen(function* () {
        if (yield* sessions.giveBack(one)) return void notYetBack.delete(one.sessionId)
        notYetBack.set(one.sessionId, (yield* Clock.currentTimeMillis) + Duration.toMillis(Duration.seconds(30)))
      })

    /* The turns whose waiting message was given back this launch, so one that fails again waits for its own reset. */
    const given = new Set<string>()

    /* What waited for a usage limit and couldn't go on at its reset, each waiting a while before it is tried again. */
    const tries = backoff()

    /** Polls only while the hold is still the one read. Host I/O is always outside the transaction. */
    const pollExternal = (
      step: { taskId: string; attemptId: string; nodeKey: string; iteration: number; output: string },
      wait: ExternalWait,
    ) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const current = yield* currentRun(step.taskId)
        if (current === undefined) return
        const live = yield* sessions.running(current.threadId)
        const now = yield* Clock.currentTimeMillis
        const stillHeld = Effect.gen(function* () {
          if (wait.instructionCount !== undefined && (yield* externalInstructions(current.threadId)).total !== wait.instructionCount)
            return false
          const [still] = yield* sql<{
            state: string
            output: string | null
          }>`SELECT state, output FROM node_attempts WHERE id = ${step.attemptId}`
          return still?.state === 'held' && still.output === step.output && (yield* going(current))
        })
        const keep = (after: ExternalWait) =>
          sql.withTransaction(
            Effect.gen(function* () {
              if (!(yield* stillHeld)) return
              yield* change('node_attempts', step.attemptId, { output: JSON.stringify({ externalWait: after }) })
              yield* touchCard(current.taskId)
            }),
          )
        // The tool records the wait in its turn. Never start another turn before that one has yielded.
        if (Option.isSome(live) && live.value.turnRunning) return yield* keep({ ...wait, nextCheck: waitTime(now + 1000) })
        const info: StuckInfo = {
          step: stepOf(step.nodeKey),
          why: 'waiting_on_person',
          detail: null,
          agentId: Option.isSome(live) ? live.value.agentId : (yield* lastLead(current)).agentId,
          round: step.iteration,
          open: 0,
        }
        const needsPerson = (detail: string) =>
          sql.withTransaction(
            Effect.gen(function* () {
              if (yield* stillHeld) yield* stuck(current, { id: step.attemptId }, { ...info, detail })
            }),
          )
        if (now >= Date.parse(wait.deadline))
          return yield* needsPerson(
            `Wait expired: ${wait.reason}. Check what is blocking it, then tell the lead whether to keep waiting or change the task.${wait.error === null ? '' : ` Last check: ${wait.error}`}`,
          )
        // An any-mode timer is independent of a code host's retry time. Once due, it needs no host read at all.
        const timeReached =
          wait.mode === 'any' && wait.conditions.some((one) => one.target.kind === 'time' && Date.parse(one.target.at) <= now)
        const observations = yield* Effect.forEach(wait.conditions, (one) =>
          (timeReached && one.target.kind !== 'time' ? Effect.succeed<Observation>({ met: false }) : observeExternal(one)).pipe(
            Effect.map((observed): Observation => observed),
            Effect.catch((error) => {
              const message =
                error instanceof ConnectorFailed || error instanceof ToolRefused
                  ? error.message
                  : error instanceof NotFound || error instanceof NotConnected
                    ? 'The saved connection is no longer available.'
                    : 'The code host could not be read.'
              const blocked =
                error instanceof ToolRefused ||
                error instanceof NotFound ||
                error instanceof NotConnected ||
                (error instanceof ConnectorFailed && ['unauthorized', 'forbidden', 'not_found'].includes(error.reason))
              return Effect.succeed<Observation>({
                met: false,
                error: message,
                ...(blocked
                  ? { blocked: `The wait cannot read its target: ${message}. Restore access or tell the lead what to do instead.` }
                  : {}),
                ...(error instanceof ConnectorFailed && error.retryAt !== undefined ? { retryAt: error.retryAt } : {}),
              })
            }),
          ),
        )
        const outcome = waitOutcome(wait.mode, observations)
        if (outcome === 'blocked')
          return yield* needsPerson(
            observations.find((one) => one.blocked !== undefined)?.blocked ?? `The wait cannot continue: ${wait.reason}.`,
          )
        if (outcome === 'waiting') {
          const errors = observations.flatMap((one) => (one.error === undefined ? [] : [one.error]))
          const failures = errors.length === 0 ? 0 : wait.failures + 1
          const delay = errors.length === 0 ? externalEvery : Math.min(15 * 60_000, externalEvery * 2 ** Math.min(failures, 8))
          const remote = wait.conditions.some((one) => one.target.kind !== 'time')
          const times = wait.conditions.flatMap((one) =>
            one.target.kind === 'time' && Date.parse(one.target.at) > now ? [Date.parse(one.target.at)] : [],
          )
          const retryAt = Math.max(
            0,
            ...observations.map((one) => (one.retryAt === undefined ? 0 : Date.parse(one.retryAt))).filter(Number.isFinite),
          )
          const remoteReady = wait.conditions.every((one, index) => one.target.kind === 'time' || observations[index]?.met === true)
          const due = Math.min(
            Date.parse(wait.deadline),
            ...(remote ? [Math.max(now + delay, retryAt)] : []),
            ...(wait.mode === 'any' || remoteReady ? times : []),
          )
          yield* keep({
            ...wait,
            conditions: wait.conditions.map((one, index) => ({
              ...one,
              seen: observations[index]?.seen ?? one.seen,
              met: observations[index]?.met ?? false,
            })),
            lastCheck: waitTime(now),
            nextCheck: waitTime(due),
            failures,
            error: errors.length === 0 ? null : errors.join('; ').slice(0, 1000),
          })
          return
        }
        const note = `Carry on with the task from where it stands. The external wait resolved: ${wait.reason}\n${observations.flatMap((one) => (one.summary === undefined ? [] : [one.summary])).join('\n')}\nCarry on toward the task’s goal. Read current host state before writing; this wake-up does not approve any push or merge, and an uncertain earlier write must be checked before retrying.`
        // Althar's words for the lead, not the person's: it reads them quietly, and the thread says the wait is over in a line.
        const answer = { kind: 'tell' as const, note, quiet: true }
        const take = (room: boolean) =>
          sql.withTransaction(
            Effect.gen(function* () {
              if (!(yield* stillHeld)) return false
              // The notice is durable even if Althar stops between admitting the step and delivering its next turn.
              yield* addItem({ projectId: current.projectId, threadId: current.threadId }, 'notice', {
                source: 'runtime',
                severity: 'info',
                title: `Done waiting: ${wait.reason}`,
              })
              if (!room) {
                yield* waitForPlace(current, step.attemptId, { how: 'answered', info, answer })
                return false
              }
              const revision = yield* change('node_attempts', step.attemptId, {
                state: 'admitted',
                holdReason: null,
                output: JSON.stringify({ externalResume: note }),
              })
              yield* fact({
                projectId: current.projectId,
                aggregateType: 'node_attempt',
                aggregateId: step.attemptId,
                revision,
                type: 'node_attempt.external_ready',
                actorId: instance.systemId,
              })
              return true
            }),
          )
        const resuming = yield* envelope('thread.send', { threadId: current.threadId, externalWait: step.attemptId })
        yield* busy.enter(step.taskId, take, {
          order: 'underway',
          next: (taken) =>
            !taken
              ? Effect.void
              : provide(
                  carryOn(current, step.attemptId, info, answer, resuming, undefined, undefined, undefined, 'underway').pipe(
                    Effect.catchCause((cause) =>
                      Cause.hasInterruptsOnly(cause)
                        ? Effect.interrupt
                        : stuck(current, { id: step.attemptId }, { ...info, why: 'failed_to_start', detail: summarize(cause) || null }),
                    ),
                  ),
                ),
        })
        yield* touchCard(current.taskId)
      })

    /*
     * What waits for a usage limit to reset runs again then, the soonest
     * first, or sooner if something new waits; after a restart too. A step
     * held for it, and what the person said to the coordinator or a lead
     * outside a step. Each is its own: one whose hold can't be read is left
     * out, and one that can't go on waits a while, as the rest go on.
     */
    const holds = Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      for (;;) {
        const held = yield* sql<{
          taskId: string
          projectId: string
          attemptId: string
          nodeKey: string
          iteration: number
          output: string
          holdReason: string
        }>`
            SELECT r.task_id, r.project_id, a.id AS attempt_id, n.node_key, n.iteration, a.output, a.hold_reason
            FROM runs r JOIN workflow_executions e ON e.run_id = r.id JOIN nodes n ON n.execution_id = e.id
            JOIN node_attempts a ON a.node_id = n.id
            JOIN tasks k ON k.id = r.task_id JOIN projects p ON p.id = r.project_id
            WHERE r.state = 'running' AND a.state = 'held' AND a.hold_reason IN ('usage_limit', 'agent_unavailable', 'external')
              AND k.state IN ('draft', 'open') AND p.archived_at IS NULL`
        // Offline, nothing waiting for the connection is due: the computer coming back says so.
        const online = yield* connectivity.online
        // Any retained input waits where the thread's last turn reached the limit, outside a step, including quiet news.
        const messages = yield* sql<{ threadId: string; turnId: string; agentId: string; accountId: string | null }>`
            SELECT t.id AS thread_id, d.id AS turn_id, s.agent_id, s.account_id FROM threads t
            JOIN turn_deliveries d ON d.id = (SELECT id FROM turn_deliveries WHERE thread_id = t.id ORDER BY requested_at DESC LIMIT 1)
            JOIN provider_sessions s ON s.id = d.provider_session_id
            WHERE t.kind IN ('coordinator', 'task') AND d.error_class = 'usage_limit'
              AND NOT EXISTS (SELECT 1 FROM record_events f
                WHERE f.aggregate_type = 'provider_session'
                  AND f.aggregate_id = (SELECT latest.id FROM provider_sessions latest WHERE latest.thread_id = t.id
                  ORDER BY (SELECT max(owner.sequence) FROM record_events owner WHERE owner.aggregate_type = 'provider_session' AND owner.aggregate_id = latest.id) DESC,
                    latest.started_at DESC, latest.rowid DESC LIMIT 1)
                  AND f.type = 'provider_session.stop_requested' AND json_extract(f.payload, '$.state') = 'completed'
                  AND json_extract(f.payload, '$.reason') IN ('stopped', 'settled'))
              AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.task_id = t.task_id AND r.state IN ('running', 'suspended'))
              AND NOT EXISTS (SELECT 1 FROM tasks k WHERE k.id = t.task_id AND k.state IN ('done', 'abandoned'))
              AND EXISTS (SELECT 1 FROM user_inputs i
                WHERE i.thread_id = t.id AND i.state IN ('queued', 'noted'))`
        const due: Array<{ readonly key: string; readonly at: number; readonly run: Effect.Effect<void, unknown, Store> }> = []
        for (const step of held) {
          if (step.holdReason === 'external') {
            const wait = externalWaitOf(step.output)
            if (wait === undefined) {
              const current = yield* currentRun(step.taskId)
              if (current !== undefined)
                yield* stuck(
                  current,
                  { id: step.attemptId },
                  {
                    step: stepOf(step.nodeKey),
                    why: 'waiting_on_person',
                    detail: 'The saved wait could not be read. Tell the lead what it should wait for again.',
                    agentId: (yield* lastLead(current)).agentId,
                    round: step.iteration,
                    open: 0,
                  },
                )
              continue
            }
            due.push({
              key: step.attemptId,
              at: Math.min(Date.parse(wait.nextCheck), Date.parse(wait.deadline)),
              run: pollExternal(step, wait),
            })
            continue
          }
          const hold = yield* decodeHold(step.output).pipe(contained('Runs.held', () => undefined))
          if (hold === undefined) continue
          const connection = step.holdReason === 'agent_unavailable'
          if (connection && !online) continue
          // Waiting for a reset, it goes on at once if its agent's account is not out of usage any more: the person reset it,
          // or a fresh reading shows room (Limits). A new step held for being nearly out, or handed over, waits for its time.
          const back =
            !connection &&
            hold.why !== undefined &&
            hold.left === undefined &&
            Option.isNone(
              yield* (hold.account != null ? limits.outAccount(hold.account) : limits.out(hold.heldFor, step.projectId)).pipe(
                contained('Runs.held', () => Option.some<Out>({ agentId: hold.heldFor, accountId: '', resetsAt: null, until: hold.until })),
              ),
            )
          due.push({
            key: step.attemptId,
            at: back ? 0 : Date.parse(hold.until),
            run: connection
              ? backOnline(step, hold)
              : resumeHeld({ ...step, agentId: hold.heldFor, accountId: hold.account ?? null, model: hold.model ?? null }),
          })
        }
        for (const message of messages) {
          if (given.has(message.turnId)) continue
          // One whose agent's limit can't be read waits, left out until it can be.
          const out = yield* (message.accountId === null ? limits.out(message.agentId) : limits.outAccount(message.accountId)).pipe(
            contained('Runs.held', () => undefined),
          )
          if (out === undefined) continue
          due.push({
            key: message.turnId,
            at: Option.isSome(out) ? Date.parse(out.value.until) : 0,
            run: Effect.andThen(
              Effect.sync(() => given.add(message.turnId)),
              deliverWaiting(message),
            ),
          })
        }
        // A lead standing in for the one a usage limit stopped gives the thread back once that one has usage again (standIn.ts).
        const standing = yield* sql<{ sessionId: string; threadId: string; projectId: ProjectId }>`
            SELECT s.id AS session_id, s.thread_id, s.project_id FROM provider_sessions s
            JOIN threads t ON t.id = s.thread_id
            WHERE s.state IN ('active', 'waiting_approval') AND t.kind IN ('coordinator', 'task')
              AND EXISTS (SELECT 1 FROM record_events f WHERE f.aggregate_type = 'provider_session' AND f.aggregate_id = s.id
                AND f.type = 'provider_session.starting' AND json_extract(f.payload, '$.standsIn') IS NOT NULL)`
        for (const one of standing) {
          // Queued back already, it waits for its next turn; one that couldn't start comes back here with its choice cleared.
          const live = yield* sessions.running(one.threadId)
          if (Option.isNone(live) || live.value.sessionId !== one.sessionId || live.value.stopping || live.value.nextLead !== undefined)
            continue
          const standsIn = yield* standInOf(one.sessionId).pipe(contained('Runs.held', () => Option.none()))
          if (Option.isNone(standsIn)) continue
          const at = yield* whenBack(standsIn.value, (given) =>
            given.accountId === null ? limits.out(given.agentId, one.projectId) : limits.outAccount(given.accountId),
          ).pipe(contained('Runs.held', () => Option.none<number>()))
          if (Option.isNone(at)) continue
          due.push({ key: one.sessionId, at: Math.max(at.value, notYetBack.get(one.sessionId) ?? 0), run: giveBack(one) })
        }
        for (const sessionId of notYetBack.keys()) if (!standing.some((one) => one.sessionId === sessionId)) notYetBack.delete(sessionId)
        // A turn given back that no longer waits, its thread's latest turn now another, never waits again.
        const waitingTurns = new Set(messages.map((message) => message.turnId))
        for (const turnId of given) if (!waitingTurns.has(turnId)) given.delete(turnId)
        const next = due.map((one) => ({ ...one, at: Math.max(one.at, tries.until(one.key)) })).toSorted((a, b) => a.at - b.at)[0]
        if (next === undefined) {
          yield* Queue.take(holdsChanged)
          continue
        }
        const wait = next.at - (yield* Clock.currentTimeMillis)
        if (wait > 0) {
          yield* Effect.raceFirst(Queue.take(holdsChanged), Effect.sleep(Duration.millis(wait)))
          continue
        }
        yield* tries.attempt(next.key, 'Runs.resume', next.run)
      }
    })

    return {
      answerStuck,
      answered,
      carryOn,
      carryOnAfterRestart,
      handOverHeld,
      holds,
      interrupted,
      resume,
      resumeHeld,
      resumeLead,
      soonAgain,
      startAgain,
    }
  })
