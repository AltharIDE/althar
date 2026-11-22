import type { LimitCall, MessageSender } from '@althar/contracts'
import type { CommandEnvelope, ProjectId } from '@althar/domain'
import type { Ledger, RevisionConflict, RowNotFound } from '@althar/persistence-sqlite'
import { Cause, Clock, type Crypto, Duration, Effect, Option, Queue, type Schema, type Scope } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'
import type { Artifacts } from './Artifacts'
import type { Order } from './Busy'
import { touchCard } from './cards'
import type { Agents } from './Config'
import type { Connectivity } from './Connectivity'
import { envelope } from './envelope'
import type { NotFound } from './errors'
import type { Instance, InstanceInfo } from './Instance'
import { type Limits, NEARLY_OUT, type Out, type Room, lowWords, outStep, outWords, whoWords } from './Limits'
import type { AutoModels } from './modelMoves'
import { type Policies, type UsageLimit, usageLimitOf } from './Policies'
import { change, fact, timestamp } from './records'
import {
  Hold,
  type HoldWhy,
  type PlanParameters,
  PlanStep,
  type RunRow,
  type Store,
  type StuckAnswer,
  type StuckInfo,
  type TaskEnd,
  pauseWords,
} from './runRecords'
import type { Sessions } from './Sessions'
import { addItem } from './threads'

export interface LimitedStep {
  readonly run: RunRow
  readonly step: StuckInfo['step']
  readonly taskId: string
  readonly nodeKey: string
  readonly nodeId: string
  readonly attemptId: string
  readonly output: string | null
  readonly input: string
  readonly iteration: number
}

export interface RunCapacityDependencies {
  readonly agentsHere: Agents['Service']
  readonly autoModels: AutoModels['Service']
  readonly carryOn: (
    current: RunRow,
    attemptId: string | null,
    info: StuckInfo,
    answer: Exclude<StuckAnswer, { readonly kind: 'wait' }>,
    envelope: CommandEnvelope,
    model?: string | null,
    said?: string,
    effort?: string | null,
    by?: Order,
    sender?: MessageSender,
    about?: 'limit' | 'stall',
  ) => Effect.Effect<void, unknown, SqlClient.SqlClient | Instance | Crypto.Crypto | Ledger | Artifacts>
  readonly connectivity: Connectivity['Service']
  readonly going: (run: RunRow) => Effect.Effect<boolean, SqlError.SqlError, SqlClient.SqlClient>
  readonly holdsChanged: Queue.Queue<void, never>
  readonly instance: InstanceInfo
  readonly limits: Limits['Service']
  readonly modelOnStep: (
    taskId: string,
    step: StuckInfo['step'],
    agentId: string,
  ) => Effect.Effect<string | null, SqlError.SqlError, SqlClient.SqlClient>
  readonly policies: Policies['Service']
  readonly provide: <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.Effect<A, E>
  readonly scope: Scope.Scope
  readonly sessions: Sessions['Service']
  readonly stepOn: (threadId: string) => Effect.Effect<LimitedStep | undefined, SqlError.SqlError, SqlClient.SqlClient>
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
  readonly usageLimitOfRun: (
    run: RunRow,
  ) => Effect.Effect<UsageLimit, NotFound | SqlError.SqlError | Schema.SchemaError, SqlClient.SqlClient>
}

export const makeRunCapacity = (dependencies: RunCapacityDependencies) => {
  const {
    agentsHere,
    autoModels,
    connectivity,
    going,
    holdsChanged,
    instance,
    limits,
    modelOnStep,
    policies,
    provide,
    scope,
    sessions,
    stepOn,
    stepsOf,
    stuck,
    usageLimitOfRun,
  } = dependencies

  /**
   * Whether work goes on with the agent's next account here: only where
   * the project turned that on (ADR-012), and another of its accounts the
   * project allows can run.
   */
  const nextAccount = (agentId: string, projectId: ProjectId) =>
    Effect.gen(function* () {
      if (!(yield* limits.rotates(projectId))) return false
      return Option.isNone(yield* limits.out(agentId, projectId))
    })

  /**
   * Says in the task's thread what a usage limit or a stall did. `handover`: it says the work went to another model, which the window always
   * shows (never a silent switch); a limit's other lines (the work waits) are the task's state's to show, not the chat's.
   */
  const sayOut = (threadId: string, projectId: ProjectId, title: string, about: 'limit' | 'stall' = 'limit', handover = false) =>
    addItem({ projectId, threadId }, 'notice', {
      source: 'runtime',
      severity: 'warning',
      title,
      about,
      ...(handover ? { handover: true } : {}),
    })

  /**
   * Auto's lighter model (README section 7): where the plan is nearly out,
   * the lead's next step moves to a lighter model of the same agent, and
   * the thread says why. The person's keep for this task holds.
   */
  const lighterModel = (run: RunRow, agentId: string, model: string | null) =>
    model === null
      ? Effect.succeed(undefined)
      : autoModels
          .lighter({ taskId: run.taskId, projectId: run.projectId, threadId: run.threadId, agentId, model })
          .pipe(Effect.catchCause(() => Effect.succeed(undefined)))

  /**
   * A planned agent that is out of usage, or nearly out (Limits), where the
   * project moves on: the next free agent, the model it takes over on, and
   * what the thread says of it, which it says unless `quiet`. Nearly out,
   * it moves only to one with room; with none, the step starts on what is
   * left. Undefined where the planned one is fine, or nothing is free.
   */
  const insteadOf = (run: RunRow, planned: PlanStep, step: keyof typeof outStep = planned.key, quiet = false) =>
    Effect.gen(function* () {
      if ((yield* usageLimitOfRun(run)) !== 'move') return undefined
      // Its model turned off or gone on the planned agent and offered by another: it starts there as the lead, not as a
      // stand-in for a way it can't take (Sessions' `routed`).
      const way = yield* limits.route({ agentId: planned.agentId, model: planned.model ?? null, projectId: run.projectId })
      if (way.kind === 'elsewhere') return undefined
      const out = yield* limits.out(planned.agentId, run.projectId)
      const low = Option.isSome(out)
        ? Option.none<Room>()
        : yield* limits.nearlyOut(planned.agentId, run.projectId, planned.model ?? undefined)
      if (Option.isNone(out) && Option.isNone(low)) return undefined
      const other = yield* otherStepOf(run, planned.key)
      const next = yield* limits.free({
        besides: [planned.agentId],
        projectId: run.projectId,
        withRoom: Option.isSome(low),
        planned,
        ...(other === undefined ? {} : { other, ...(planned.key === 'review' ? { reviewing: true } : {}) }),
      })
      if (next === undefined) return undefined
      const { model } = next
      const [from, to] = [yield* limits.named(planned.agentId, planned.model ?? null), yield* limits.named(next.agentId, model)]
      // That it is another model is said where the line names the one before.
      const instead = { ...to, ownWork: next.ownWork, ...(next.otherModel === true && from.model !== null ? { otherModel: true } : {}) }
      const now = yield* Clock.currentTimeMillis
      const said = Option.isSome(low)
        ? lowWords({ from: whoWords(from), room: low.value, now, step, to: instead })
        : outWords({ from: whoWords(from), resetsAt: Option.getOrThrow(out).resetsAt, now, step, to: instead })
      if (!quiet) yield* sayOut(run.threadId, run.projectId, said, 'limit', true)
      return { agentId: next.agentId, model, said, accountId: next.accountId }
    })

  /**
   * A new step held or asked about before it starts, its planned agent
   * nearly out where the project waits or asks (`lowAtStart`): whether it
   * was.
   */
  const heldLow = (run: RunRow, step: 'implement' | 'review' | 'settle', attemptId: string, round: number, planned: PlanStep) =>
    Effect.gen(function* () {
      const low = yield* lowAtStart(run, planned)
      if (Option.isNone(low)) return false
      const [attempt] = yield* (yield* SqlClient.SqlClient)<{ nodeId: string; input: string }>`
            SELECT node_id, input FROM node_attempts WHERE id = ${attemptId}`
      yield* lowHold(
        {
          taskId: run.taskId,
          nodeKey: step,
          nodeId: attempt?.nodeId ?? '',
          attemptId,
          output: null,
          input: attempt?.input ?? '{}',
          iteration: round,
          run,
          step,
        },
        planned.agentId,
        low.value,
      )
      return true
    })

  /**
   * A session kept for a new step whose account is nearly out for the
   * model, where the project rotates: another of the agent's accounts with
   * room for it, and what the thread says of the move. None where the
   * others are nearly out too, so the project's rule goes as for the agent
   * nearly out (`insteadOf`, `heldLow`), and none where the account is out:
   * its handover goes as any (ADR-012).
   */
  const roomierAccount = (
    run: RunRow,
    step: 'review' | 'settle',
    session: { readonly agentId: string; readonly accountId: string },
    model: string | null,
    threadId: string,
  ) =>
    Effect.gen(function* () {
      const { agentId, accountId } = session
      const room = yield* limits.room(accountId, model ?? undefined)
      if (Option.isNone(room) || room.value.leftPercent >= NEARLY_OUT) return Option.none<{ accountId: string; said: string }>()
      if (Option.isSome(yield* limits.outAccount(accountId)) || !(yield* limits.rotates(run.projectId)))
        return Option.none<{ accountId: string; said: string }>()
      const next = yield* limits.pick({ agentId, projectId: run.projectId, threadId, ...(model === null ? {} : { model }) })
      const theirs = yield* limits.room(next.id, model ?? undefined)
      if (next.id === accountId || (Option.isSome(theirs) && theirs.value.leftPercent < NEARLY_OUT))
        return Option.none<{ accountId: string; said: string }>()
      const [from, to] = [yield* limits.named(agentId, null, accountId), yield* limits.named(agentId, null, next.id)]
      return Option.some({
        accountId: next.id,
        said: lowWords({
          from: from.agent,
          room: room.value,
          now: yield* Clock.currentTimeMillis,
          step,
          to: { agent: to.agent, model: null },
        }),
      })
    })

  /**
   * How the lead settling a review goes on where it is nearly out, as any
   * new step (docs/architecture/05): a usage takeover ends at the step's
   * boundary when the planned lead has room again. Otherwise the lead at
   * work on the thread, on its
   * model, else the plan's. Its account nearly out, where the project
   * rotates and another of the agent's has room, it goes on there; the
   * agent nearly out on every account, the project's rule goes: moved to an
   * agent with room (`insteadOf`), or held or asked about before it starts
   * (`held`). Undefined where it settles where it is. What runs on is never
   * stopped: the lead between its steps is.
   */
  const steerSettle = (run: RunRow, round: number, attemptId: string) =>
    Effect.gen(function* () {
      const { implement } = yield* stepsOf(run)
      const live = Option.filter(yield* sessions.running(run.threadId), (session) => !session.stopping)
      let lead = implement
      if (Option.isSome(live)) {
        const [moved] = yield* (yield* SqlClient.SqlClient)<{ one: number }>`
              SELECT 1 AS one FROM thread_items WHERE thread_id = ${run.threadId} AND kind = 'notice'
                AND json_extract(content, '$.about') = 'limit'
                AND (provider_session_id = ${live.value.sessionId} OR (provider_session_id IS NULL AND NOT EXISTS (
                  SELECT 1 FROM thread_items chosen WHERE chosen.provider_session_id = ${live.value.sessionId}
                    AND chosen.kind = 'notice' AND coalesce(json_extract(chosen.content, '$.about'), '') <> 'limit'
                ))) LIMIT 1`
        if (
          moved !== undefined &&
          implement !== undefined &&
          live.value.agentId !== implement.agentId &&
          Option.isNone(yield* limits.out(implement.agentId, run.projectId)) &&
          Option.isNone(yield* limits.nearlyOut(implement.agentId, run.projectId, implement.model ?? undefined))
        ) {
          return {
            agentId: implement.agentId,
            model: implement.model,
            effort: implement.effort ?? null,
            accountId: undefined,
            said: undefined,
          }
        }
        const [on] = yield* (yield* SqlClient.SqlClient)<{ model: string | null; effort: string | null }>`
              SELECT model, effort FROM provider_sessions WHERE id = ${live.value.sessionId}`
        const model = on?.model ?? null
        lead = { key: 'implement', agentId: live.value.agentId, model, effort: on?.effort ?? null, skipped: false }
        const roomier = yield* roomierAccount(run, 'settle', live.value, model, run.threadId)
        if (Option.isSome(roomier)) return { agentId: live.value.agentId, model, effort: on?.effort ?? null, ...roomier.value }
      }
      if (lead === undefined) return undefined
      const instead = yield* insteadOf(run, lead, 'settle', true)
      if (instead !== undefined) return { ...instead, effort: null }
      return (yield* heldLow(run, 'settle', attemptId, round, lead)) ? ('held' as const) : undefined
    })

  /**
   * A new step whose planned agent is nearly out, where the project waits
   * for resets or asks the person: how little it has left, to hold the
   * step or ask, as when it runs out (`outOfUsage`). None where the project
   * moves on (`insteadOf` has moved it, or it starts on what is left), and
   * none where the agent is out already: its session finds that out at once.
   */
  const lowAtStart = (run: RunRow, planned: PlanStep) =>
    Effect.gen(function* () {
      if ((yield* usageLimitOfRun(run)) === 'move') return Option.none<Room>()
      if (Option.isSome(yield* limits.out(planned.agentId, run.projectId))) return Option.none<Room>()
      return yield* limits.nearlyOut(planned.agentId, run.projectId, planned.model ?? undefined)
    })

  /**
   * The agent on the run's other step: the lead's, for a review (as it
   * leads now); the planned reviewer's, for the lead's steps. Work moved on
   * goes to it only when nothing else is free, so an agent rarely reviews
   * what it wrote.
   */
  const otherStepOf = (run: RunRow, key: 'implement' | 'review') =>
    Effect.gen(function* () {
      const { implement, review: planned } = yield* stepsOf(run)
      if (key !== 'review') return planned
      const [lead] = yield* (yield* SqlClient.SqlClient)<{ agentId: string; model: string | null }>`
            SELECT agent_id, model FROM provider_sessions WHERE thread_id = ${run.threadId} ORDER BY started_at DESC, rowid DESC LIMIT 1`
      return lead ?? implement
    })

  /**
   * Holds a step until the reset of the account that stopped it: what
   * waits for it, and what brings it back if handing it over doesn't go
   * through. `low`, it was held before it started, its agent nearly out.
   * `notice`, what the thread says of it, written in the hold's
   * transaction, so nothing reads the step held without it.
   */
  const holdForLimit = (
    on: LimitedStep,
    agentId: string,
    accountId: string | null,
    out: Out | null,
    why?: HoldWhy,
    choices?: LimitCall['choices'],
    low?: Room,
    notice?: { readonly said: string },
  ) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.withTransaction(
        Effect.gen(function* () {
          // Its reset; one already past still waits an hour, so nothing brings the step back mid-handover.
          const until = out?.until ?? new Date(Date.parse(yield* timestamp) + Duration.toMillis(Duration.hours(1))).toISOString()
          // The account and model it was on, so it carries on there at the reset, after a restart too.
          const model = yield* modelOnStep(on.run.taskId, on.step, agentId)
          const revision = yield* change('node_attempts', on.attemptId, {
            state: 'held',
            holdReason: 'usage_limit',
            output: JSON.stringify({
              heldFor: agentId,
              until,
              account: accountId,
              model,
              ...(why === undefined ? {} : { why }),
              ...(choices === undefined ? {} : { choices }),
              ...(low === undefined ? {} : { left: low.leftPercent }),
            } satisfies typeof Hold.Encoded),
          })
          yield* fact({
            projectId: on.run.projectId,
            aggregateType: 'node_attempt',
            aggregateId: on.attemptId,
            revision,
            type: 'node_attempt.held',
            payload: { reason: 'usage_limit', agentId, until },
            actorId: instance.systemId,
          })
          if (notice !== undefined) yield* sayOut(on.run.threadId, on.run.projectId, notice.said)
        }),
      )
    })

  /**
   * A step's agent is out of usage (docs/architecture/05). Where the
   * project moves on and an agent is free, the step goes to it, as when the
   * person hands it over; otherwise it waits, or asks (`waitOrAsk`).
   */
  const outOfUsage = (on: LimitedStep, agentId: string, accountId: string | null) =>
    Effect.gen(function* () {
      const currentModel = yield* modelOnStep(on.run.taskId, on.step, agentId)
      const out = Option.getOrNull(yield* accountId === null ? limits.out(agentId, on.run.projectId) : limits.outAccount(accountId))
      if ((yield* usageLimitOfRun(on.run)) === 'move') {
        const { implement, review: plannedReview } = yield* stepsOf(on.run)
        const planned = on.step === 'review' ? plannedReview : implement
        const other = yield* otherStepOf(on.run, on.step === 'review' ? 'review' : 'implement')
        // The same agent's next account first, on the same model, where the project turned that on; then the next free agent.
        const next = (yield* nextAccount(agentId, on.run.projectId))
          ? { agentId, model: currentModel, ownWork: false }
          : yield* limits.free({
              besides: [agentId],
              projectId: on.run.projectId,
              ...(planned === undefined ? {} : { planned }),
              from: { agentId, model: currentModel },
              ...(other === undefined ? {} : { other, ...(on.step === 'review' ? { reviewing: true } : {}) }),
            })
        if (next !== undefined) {
          const { model } = next
          const to =
            next.agentId === agentId
              ? (yield* limits.pick({
                  agentId: next.agentId,
                  projectId: on.run.projectId,
                  threadId: on.run.threadId,
                  ...(model === null ? {} : { model }),
                })).id
              : null
          const step = on.step === 'publish' ? undefined : on.step
          const fromNamed = yield* limits.named(agentId, currentModel, accountId)
          const said = outWords({
            from: whoWords(fromNamed),
            resetsAt: out?.resetsAt ?? null,
            now: yield* Clock.currentTimeMillis,
            ...(step === undefined ? {} : { step }),
            // Another lead stands in until this one's reset (standIn.ts); the same on another account just carries on.
            to: {
              ...(yield* limits.named(next.agentId, model, to)),
              ownWork: next.ownWork,
              standsIn: next.agentId !== agentId || model !== currentModel,
              ...('otherModel' in next && next.otherModel === true && fromNamed.model !== null ? { otherModel: true } : {}),
            },
          })
          // Held while the next agent takes over, so nothing it says before it is told the step counts for the step.
          yield* holdForLimit(on, agentId, accountId, out)
          const handing = yield* envelope('thread.send', { threadId: on.run.threadId, usageLimit: on.attemptId })
          const info: StuckInfo = { step: on.step, why: 'usage_limit', detail: null, agentId, round: on.iteration, open: 0 }
          return yield* dependencies.carryOn(
            on.run,
            on.attemptId,
            info,
            { kind: 'retry', agentId: next.agentId, ...('accountId' in next ? { accountId: next.accountId } : {}) },
            handing,
            model,
            said,
          )
        }
      }
      yield* waitOrAsk(on, agentId, accountId, out)
    })

  /**
   * A step a usage limit stopped, that isn't moved on: held until the
   * reset, with who could take it over, so the person can hand it on
   * meanwhile (`handOverHeld`); where the project asks, or with no reset
   * known, it needs the person, with who could take it over and when the
   * agent is back. `low`: a new step not started, its agent nearly out
   * where the project waits or asks (`lowAtStart`); what it has left is
   * one of the ways on.
   */
  const waitOrAsk = (on: LimitedStep, agentId: string, accountId: string | null, out: Out | null, low?: Room) =>
    Effect.gen(function* () {
      const resetsAt = out?.resetsAt ?? null
      const from = whoWords(yield* limits.named(agentId, yield* modelOnStep(on.run.taskId, on.step, agentId), accountId))
      const { implement, review: plannedReview } = yield* stepsOf(on.run)
      const planned = on.step === 'review' ? plannedReview : implement
      const info: StuckInfo = { step: on.step, why: 'usage_limit', detail: null, agentId, round: on.iteration, open: 0 }
      const step = on.step === 'publish' ? undefined : on.step
      const policy = yield* usageLimitOfRun(on.run)
      const other = yield* otherStepOf(on.run, on.step === 'review' ? 'review' : 'implement')
      const choices = yield* limits.choices({
        accountId: low === undefined ? accountId : null,
        projectId: on.run.projectId,
        rather: other === undefined ? [] : [other.agentId],
        ...(planned === undefined ? {} : { planned }),
      })
      // Where the project asks but no one could take it over, there is nothing to choose: it waits for the reset, as where
      // nothing was free to move it to (DEV-173). Not started yet, nearly out, starting on what is left is a choice still.
      const noOne = policy === 'ask' && out !== null && resetsAt !== null && low === undefined && !(yield* limits.canTakeOver(choices))
      if ((policy === 'ask' && !noOne) || out === null || resetsAt === null)
        return yield* stuck(
          on.run,
          { id: on.attemptId },
          { ...info, limit: { accountId, resetsAt, choices, ...(low === undefined ? {} : { left: low.leftPercent }) } },
        )
      // Waiting, it says why: the project waits for resets, or nothing else was free to move it to or to ask about.
      const nothingFree = policy === 'move' || noOne
      const now = yield* Clock.currentTimeMillis
      // Said with the hold, in its transaction: whoever sees the step held reads why in its thread too.
      yield* holdForLimit(on, agentId, accountId, out, nothingFree ? 'nothing_free' : 'waits', choices, low, {
        said:
          low === undefined
            ? outWords({ from, resetsAt, now, ...(step === undefined ? {} : { step }), waits: 'step', nothingFree })
            : lowWords({ from, room: low, now, ...(step === undefined ? {} : { step }) }),
      })
      yield* touchCard(on.run.taskId)
      yield* Queue.offer(holdsChanged, undefined)
    })

  /** A new step held or asked before it starts, its agent nearly out (`lowAtStart`): out until the reset of its tightest window. */
  const lowHold = (on: LimitedStep, agentId: string, low: Room) =>
    waitOrAsk(
      on,
      agentId,
      low.accountId,
      low.resetsAt === null ? null : { agentId, accountId: low.accountId, resetsAt: low.resetsAt, until: low.resetsAt },
      low,
    )

  /**
   * Outside a step, the coordinator or a lead the person is talking to is
   * out of usage. Where the project moves on, the next free agent takes the
   * thread over, with what the person said waiting for it; otherwise what
   * they said waits for the reset.
   */
  const outOfUsageElsewhere = (threadId: string, agentId: string, accountId: string | null) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const [thread] = yield* sql<{ projectId: ProjectId; kind: string }>`SELECT project_id, kind FROM threads WHERE id = ${threadId}`
      if (thread === undefined || (thread.kind !== 'coordinator' && thread.kind !== 'task')) return
      // The model the lead is on, as it ran out: not its agent's default, which the thread may never have been given.
      const live = yield* sessions.running(threadId)
      const [session] = Option.isNone(live)
        ? []
        : yield* sql<{ model: string | null }>`SELECT model FROM provider_sessions WHERE id = ${live.value.sessionId}`
      const currentModel = session?.model ?? (yield* limits.modelFor({ agentId, projectId: thread.projectId }))
      const out = Option.getOrNull(yield* accountId === null ? limits.out(agentId, thread.projectId) : limits.outAccount(accountId))
      const resetsAt = out?.resetsAt ?? null
      const fromNamed = yield* limits.named(agentId, currentModel, accountId)
      const from = whoWords(fromNamed)
      if (usageLimitOf((yield* policies.current(thread.projectId)).rules) === 'move') {
        // The same agent's next account first, where the project turned that on; then the next free agent.
        const next = (yield* nextAccount(agentId, thread.projectId))
          ? { agentId, model: currentModel }
          : yield* limits.free({
              besides: [agentId],
              projectId: thread.projectId,
              from: { agentId, model: currentModel },
            })
        if (next !== undefined) {
          const { model } = next
          const to =
            next.agentId === agentId
              ? (yield* limits.pick({
                  agentId: next.agentId,
                  projectId: thread.projectId,
                  threadId,
                  ...(model === null ? {} : { model }),
                })).id
              : null
          yield* sessions.switchAgent({
            threadId,
            agentId: next.agentId,
            ...(model === null ? {} : { model }),
            ...('accountId' in next ? { accountId: next.accountId } : {}),
            said: outWords({
              from,
              resetsAt,
              now: yield* Clock.currentTimeMillis,
              // Another lead stands in until this one's reset, and gives the thread back then (standIn.ts, `holds`).
              to: {
                ...(yield* limits.named(next.agentId, model, to)),
                standsIn: next.agentId !== agentId || model !== currentModel,
                ...('otherModel' in next && next.otherModel === true && fromNamed.model !== null ? { otherModel: true } : {}),
              },
            }),
            about: 'limit',
          })
          yield* Queue.offer(holdsChanged, undefined)
          return
        }
      }
      const [person] = yield* sql<{ id: string }>`
            SELECT i.id FROM user_inputs i JOIN actors a ON a.id = i.author_actor_id
            WHERE i.thread_id = ${threadId} AND i.state = 'queued' AND a.kind = 'person' LIMIT 1`
      const words = outWords({
        from,
        resetsAt,
        now: yield* Clock.currentTimeMillis,
        ...(person === undefined ? {} : { waits: 'message' as const }),
      })
      yield* sayOut(threadId, thread.projectId, person === undefined ? `${words} The waiting work resumes when usage is available.` : words)
      // Back at its reset, it takes what waits: the same loop as a held step's, so after a restart too.
      yield* Queue.offer(holdsChanged, undefined)
    })

  /** The service an agent's model runs on, as the registry names it; none where it depends on the provider the person picks. */
  const serviceOf = (agentId: string) =>
    agentsHere.get(agentId).pipe(
      Effect.map((entry) => entry.definition.service),
      Effect.orElseSucceed(() => undefined),
    )

  /** A service's name, as a thread says it: the agent's own, where the registry names none. */
  const serviceNamed = (agentId: string) =>
    Effect.gen(function* () {
      const service = yield* serviceOf(agentId)
      return service?.name ?? `${(yield* limits.named(agentId, null)).agent}'s service`
    })

  /**
   * Holds a step for the connection (ADR-060), as a usage limit holds one
   * for its reset (`Hold`): it gives up its place among the agents at
   * work here, as a step held for a reset does, and asks for one again as
   * the work of a task under way when it carries on. False where the step
   * isn't running any more.
   */
  const holdForConnection = (
    on: NonNullable<Effect.Success<ReturnType<typeof stepOn>>>,
    agentId: string,
    accountId: string | null,
    held: { readonly until: string; readonly offline: boolean; readonly tries: number; readonly failure: string | null },
  ) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const service = yield* serviceNamed(agentId)
      const model = yield* modelOnStep(on.run.taskId, on.step, agentId)
      const done = yield* sql.withTransaction(
        Effect.gen(function* () {
          const [still] = yield* sql<{ state: string }>`SELECT state FROM node_attempts WHERE id = ${on.attemptId}`
          if (still?.state !== 'running' || !(yield* going(on.run))) return false
          const revision = yield* change('node_attempts', on.attemptId, {
            state: 'held',
            holdReason: 'agent_unavailable',
            output: JSON.stringify({
              heldFor: agentId,
              until: held.until,
              account: accountId,
              model,
              offline: held.offline,
              tries: held.tries,
              service,
              failure: held.failure,
            } satisfies typeof Hold.Encoded),
          })
          yield* fact({
            projectId: on.run.projectId,
            aggregateType: 'node_attempt',
            aggregateId: on.attemptId,
            revision,
            type: 'node_attempt.held',
            payload: { reason: 'agent_unavailable', agentId, until: held.until, offline: held.offline },
            actorId: instance.systemId,
          })
          return true
        }),
      )
      if (!done) return false
      yield* addItem({ projectId: on.run.projectId, threadId: on.run.threadId }, 'notice', {
        source: 'runtime',
        severity: 'info',
        title: held.offline
          ? `Lost the connection to ${service}.`
          : `${service} failed. Trying again in ${pauseWords(connectivity.pauses[held.tries - 1] ?? connectivity.every)}.`,
        ...(held.failure === null ? {} : { description: held.failure }),
      })
      yield* touchCard(on.run.taskId)
      yield* Queue.offer(holdsChanged, undefined)
      return true
    })

  /**
   * A step's turn failed on its connection or its service (ADR-060).
   * Where the service doesn't answer, the computer offline or the service
   * out of reach, the step waits for the connection, however long that
   * takes, and none of it counts. Where it answers, the step is tried
   * again after a pause that grows (15 seconds, a minute, four); once
   * those are spent, it needs the person, with what the service said.
   */
  const unavailable = (
    on: NonNullable<Effect.Success<ReturnType<typeof stepOn>>>,
    agentId: string,
    accountId: string | null,
    failure: string | null,
  ) =>
    Effect.gen(function* () {
      const service = yield* serviceOf(agentId)
      const answers = yield* connectivity.answers(service?.url)
      const tries = (JSON.parse(on.output ?? '{}') as { tries?: number }).tries ?? 0
      const at = Date.parse(yield* timestamp)
      if (answers && tries >= connectivity.pauses.length)
        return yield* stuck(
          on.run,
          { id: on.attemptId },
          {
            step: on.step,
            why: 'transient',
            detail: failure,
            agentId,
            round: on.iteration,
            open: 0,
            ...(service === undefined ? {} : { service: service.name }),
          },
        )
      const pause = answers ? (connectivity.pauses[tries] ?? Duration.zero) : Duration.zero
      yield* holdForConnection(on, agentId, accountId, {
        until: new Date(at + Duration.toMillis(pause)).toISOString(),
        offline: !answers,
        tries: answers ? tries + 1 : tries,
        failure,
      })
    })

  /* The threads whose agent's warning is being looked into, so each is looked into once at a time. */
  const looking = new Set<string>()

  /**
   * A step's agent says it is trying its service again, mid-turn. Where
   * the service answers, its own retry may get through, and it is left
   * to it. Where it doesn't, the step waits for the connection now, and
   * the turn that would only wait on it, or fail, is stopped: Codex,
   * offline, waits for the network without ending its turn, and Claude
   * Code tries for three minutes before it gives up.
   */
  const reconnecting = (threadId: string, said: string) =>
    Effect.gen(function* () {
      if (looking.has(threadId)) return
      const on = yield* stepOn(threadId)
      const live = yield* sessions.running(threadId)
      if (on === undefined || Option.isNone(live)) return
      looking.add(threadId)
      const look = Effect.gen(function* () {
        const service = yield* serviceOf(live.value.agentId)
        if (yield* connectivity.answers(service?.url)) return
        const tries = (JSON.parse(on.output ?? '{}') as { tries?: number }).tries ?? 0
        const held = yield* holdForConnection(on, live.value.agentId, live.value.accountId, {
          until: yield* timestamp,
          offline: true,
          tries,
          failure: said,
        })
        if (held) yield* Effect.ignore(sessions.interrupt(threadId))
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.logWarning('Could not look into a step’s connection', cause),
        ),
        Effect.ensuring(Effect.sync(() => looking.delete(threadId))),
      )
      yield* Effect.forkIn(provide(look), scope)
    })

  return {
    heldLow,
    insteadOf,
    lighterModel,
    otherStepOf,
    outOfUsage,
    outOfUsageElsewhere,
    reconnecting,
    roomierAccount,
    sayOut,
    serviceOf,
    steerSettle,
    unavailable,
  }
}
