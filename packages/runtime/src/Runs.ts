import { createHash } from 'node:crypto'
import { type CheckoutAnswer, type MessageSender, PLANS_AND_REVIEWS, ShipRoute } from '@althar/contracts'
import { type ActorId, type CommandEnvelope, Ids, type ProjectId, newId, taskLifecycle, transition } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import type { FieldAnswer } from '@althar/provider-adapters'
import { Cause, Clock, Context, type Crypto, Duration, Effect, Layer, Option, Queue, Schema, Stream } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'
import { Busy, type Order } from './Busy'
import { touchCard } from './cards'
import { Changes, type Published } from './Changes'
import { Agents, RuntimeConfig } from './Config'
import { NotConnected } from './Connections'
import { Connectivity } from './Connectivity'
import { envelope } from './envelope'
import { NoChangeToOpen, NotFound } from './errors'
import { evidenceForReview } from './evidence'
import { externalWaitOf } from './externalWaits'
import { keptGoing } from './Failures'
import { branchOnFirstWrite, unbranched } from './firstWrite'
import { commitOf, git } from './git'
import { Instance } from './Instance'
import { Issues } from './Issues'
import { RESTATE_START, type RoundItem, restateWords, toRestate } from './lastMessage'
import { LeftBehind } from './LeftBehind'
import { Limits, noReportWords } from './Limits'
import { Live, type LiveEvent } from './Live'
import { type MoveConsent, type Moved, dropMove } from './local'
import { type AfterMergeChoice, MergeReviews } from './MergeReviews'
import { NO_REPORT } from './missedReports'
import { AutoModels } from './modelMoves'
import { roundsNow } from './plansAndReviews'
import { Policies, usageLimitOf } from './Policies'
import { filesLine } from './pullRequestWords'
import { type Answered, Questions } from './Questions'
import { change, fact, timestamp } from './records'
import { evidenceFolderOf, reviewCopyOf, snapshotForReview } from './reviewCopy'
import { type LimitedStep, type RunCapacityDependencies, makeRunCapacity } from './runCapacity'
import { makeRunCheckouts } from './runCheckouts'
import { makeRunPlanChanges } from './runPlanChanges'
import {
  AFTER_TURN_WAIT,
  BLANKS,
  BLANK_PAUSE,
  CONTINUES,
  CONTINUING,
  Finding,
  type Lead,
  type Place,
  PlanParameters,
  PlanStep,
  type ReviewerChange,
  type RoundStart,
  type RunRow,
  RunStopped,
  type Store,
  type StuckAnswer,
  type StuckInfo,
  type StuckWhy,
  TaskEnd,
  type TaskEnding,
  type TeamChanged,
  type Waiting,
  beforeFirstStep,
  blankAgain,
  findingsText,
  mayPass,
  orderOf,
  planWaits,
  reviewerChange,
  roundOf,
  unlessStopped,
  waitingOf,
} from './runRecords'
import { type Placed, makeRunRecovery } from './runRecovery'
import { makeRunShipping } from './runShipping'
import { makeRunTools } from './runTools'
import { Sessions } from './Sessions'
import { type GiveUp, watchStalls } from './Stalls'
import type { StandIn } from './standIn'
import { addItem } from './threads'
import { ToolRefused, ToolServer } from './ToolServer'
import { stuckWhyOf, summarize } from './words'

export {
  type Lead,
  type Place,
  PlanParameters,
  PlanStep,
  RESTART_GRACE,
  type ReviewerChange,
  type StuckAnswer,
  type StuckInfo,
  type StuckWhy,
  TaskEnd,
  type TaskEnding,
  type TeamChanged,
  beforeFirstStep,
  checkoutWaitOf,
  endingOf,
  mayPass,
  planWaits,
  reviewerChange,
  titleOf,
} from './runRecords'

export class Runs extends Context.Service<
  Runs,
  {
    /**
     * Runs an accepted plan: its task opens, and its steps run in order. Its
     * first step starts now (`running`), or waits for a place among the
     * agents at work on this machine (`waiting`); null where it runs nothing.
     */
    run(planId: string): Effect.Effect<'running' | 'waiting' | null, unknown>
    /** The workflow version every task's plan runs, for now. */
    readonly workflowVersion: Effect.Effect<string, unknown>
    /**
     * Opens the pull request of a task whose work ended on its branch, a
     * draft, as the person said: pushes the branch and opens it, as the
     * task's own ending would have. A Change ending in a pull request with a reviewer follows Ship first, so this older
     * opener cannot bypass its review; the answer then means the Ship was admitted.
     */
    publish(taskId: string): Effect.Effect<void, unknown>
    /**
     * Hands a step held for a usage limit to another agent, as the person
     * picked, rather than waiting for the reset. NotHeld where it isn't held
     * for one any more.
     */
    handOverHeld(input: {
      readonly envelope: CommandEnvelope
      readonly taskId: string
      readonly answer: Extract<StuckAnswer, { readonly kind: 'retry' }>
    }): Effect.Effect<void, unknown>
    /** The person's answer to a step that needs them. */
    answerStuck(input: {
      readonly envelope: CommandEnvelope
      readonly attentionId: string
      readonly answer: StuckAnswer
      readonly sender?: MessageSender | undefined
    }): Effect.Effect<void, unknown>
    /**
     * Carries on the run a task's stop suspended, from the step it was on:
     * with its last lead, or the one given. Nothing happens to a run that
     * isn't suspended.
     */
    resume(input: { readonly envelope: CommandEnvelope; readonly taskId: string; readonly lead?: Lead }): Effect.Effect<void, unknown>
    /** Tells the person's answer to a question whose agent has gone since it asked: to the agent on its thread next, started for it. */
    answered(input: { readonly envelope: CommandEnvelope; readonly threadId: string; readonly body: string }): Effect.Effect<void, unknown>
    /**
     * The person's answer to a question a task's lead or reviewer asked:
     * told to it once it has a place among the agents at work on this
     * machine, and kept until then (Busy.ts); to an agent gone since it
     * asked, as `answered`.
     */
    answer(input: {
      readonly envelope: CommandEnvelope
      readonly attentionId: string
      readonly answers: Readonly<Record<string, FieldAnswer>>
    }): Effect.Effect<void, unknown>
    /**
     * Skips the review of the task's run under way, as the person said
     * (ADR-034): the run no longer has one, a review under way or waiting
     * stops, and a run whose lead is done with its step concludes. The next
     * round of work has its review again, as the plan says.
     */
    skipReview(input: { readonly envelope: CommandEnvelope; readonly taskId: string }): Effect.Effect<void, unknown>
    /**
     * Turns down the review a change was offered as its work turned real: it isn't offered again. Nothing where it was turned
     * down already. NotFound for a task that isn't one.
     */
    declineReview(taskId: string, actorId: ActorId): Effect.Effect<void, unknown>
    /**
     * Ships what waits on the task's branch, on the person's word (a task is
     * a conversation plus parts, "A tweak waits for Ship"): its review first,
     * where the plan has one before the work ships, over everything since the
     * last; then the commits go up, past the hold. ShipRefused while the task
     * is at work, or where nothing waits.
     */
    ship(input: {
      readonly envelope: CommandEnvelope
      readonly taskId: string
      /** Its own lead asked in its turn: it ships once that turn ends, refused then only where nothing waits. */
      readonly afterTurn?: boolean
      /** One of its changes, by name: it ships alone, after what waits beneath it in its stack. Every change waiting without. */
      readonly change?: string
      /** Its route, as the person chose it for this Ship; without it, the task's own (`TaskView.shipRoute`). */
      readonly route?: ShipRoute
    }): Effect.Effect<void, unknown>
    /**
     * Changes the route of the task's Ship under way, as the person said: how far it goes, where it hasn't gone past that
     * point (a Ship waiting to merge that goes back to ready stops waiting, and ends there), and its review, which stops as
     * Skip review stops it where the route turns it off. Answered once the route is kept, with the route as kept; what it
     * stops goes on behind. What the route leaves out stays as it was (ship_task's, which may say only one). ShipRefused
     * (`not_shipping`) where no Ship is under way.
     */
    routeShip(input: {
      readonly envelope: CommandEnvelope
      readonly taskId: string
      readonly route: { readonly review?: boolean | undefined; readonly far?: ShipRoute['far'] | undefined }
    }): Effect.Effect<ShipRoute, unknown>
    /**
     * Merge, with commits not shipped (a task is a conversation plus parts):
     * `review`, Review and merge, ships them with one review of what waited
     * and merges once they are up, unless the lead set a finding aside; `now`,
     * Merge now, sends them up and merges at once, and they are reviewed after
     * the merge where the task has a reviewer. With nothing waiting, it merges
     * as it stands.
     */
    mergeWaiting(input: {
      readonly envelope: CommandEnvelope
      readonly taskId: string
      readonly how: 'review' | 'now'
      readonly url?: string
    }): Effect.Effect<void, unknown>
    /** Whether the task's plan waits for a place before its first step, nothing of it started yet: the person can still change it. */
    planWaits(taskId: string): Effect.Effect<boolean, SqlError.SqlError, SqlClient.SqlClient>
    /**
     * Changes the plan of a run whose first step waits for a place, as the
     * person changed it: who leads and reviews, and how it ends. False, and
     * nothing changed, where it no longer waits. Inside the caller's
     * transaction.
     */
    changeWaiting(
      taskId: string,
      parameters: string,
      actorId: ActorId,
    ): Effect.Effect<boolean, unknown, SqlClient.SqlClient | Ledger | Crypto.Crypto>
    /**
     * Takes back a run that has begun nothing (`beforeFirstStep`), as the person held its plan: its waiting step is cancelled, so
     * it leaves the line for a place, and its run ends, which a start makes anew. False, and nothing changed, where it has begun.
     * Inside the caller's transaction.
     */
    unstart(taskId: string, actorId: ActorId): Effect.Effect<boolean, unknown, SqlClient.SqlClient | Ledger | Crypto.Crypto>
    /**
     * Makes a quick task a change, as the person asked its lead to
     * (make_it_a_change), inside the caller's transaction: its plan, its
     * plan's run, and the run under way, if one is, review as `review` says
     * (none, with null) and end as `end` does, and no longer stay on this
     * Mac. A round under way then publishes as its plan's run would, its work
     * counted from where the task started, so all of it is reviewed and goes
     * in the pull request. Whether a run is under way: where none is,
     * `madeRound` opens one once this is in.
     */
    makeChange(
      taskId: string,
      review: PlanStep | null,
      end: TaskEnd | null,
      actorId: ActorId,
    ): Effect.Effect<boolean, unknown, SqlClient.SqlClient | Ledger | Crypto.Crypto>
    /**
     * Where the reviewer of a task stands to change: `now`, before its review round starts or between rounds; `next_round`, in a
     * round under way, which the change waits for; `next_ship`, once its review is done: the reviewer named reads what ships next.
     */
    reviewerChange(taskId: string): Effect.Effect<ReviewerChange, unknown, SqlClient.SqlClient>
    /**
     * Changes who leads and who reviews a task, at any time (a task is a conversation plus parts: every part changes either way,
     * on the person's word). The lead changes from its next turn, never in the one it is in; the reviewer until its review round
     * starts, from the next round during one, and once a review of it ran or it merged, from what ships next. A review added
     * before the work ships where its plan read it only after the merge (the fast lane) reads it before now. A review added
     * where its work is up in an open pull request reads that pull request's head at once, unless `atShip`: a task stepped back
     * into a change, whose lead builds it now, has it read at its next Ship. Says what it changed, for its caller to say in the
     * task's thread. Refused only for an abandoned task.
     */
    changeTeam(input: {
      readonly taskId: string
      readonly steps: ReadonlyArray<PlanStep>
      readonly actorId: ActorId
      readonly atShip?: boolean | undefined
    }): Effect.Effect<TeamChanged, unknown>
    /**
     * Opens the round a quick task made a change after its last run ended
     * works in (ADR-034), on its lead's session, which is in its turn: with
     * the plan's new review and ending, publishing as they say, its work
     * counted from where the task started. Whether one opened.
     */
    madeRound(taskId: string, sessionId: string): Effect.Effect<boolean, unknown>
    /**
     * Changes how a task ends, and when its review reads it, at any time and either way (a task is a conversation plus parts):
     * `end`, `here` (nothing of it leaving this computer until the person ships it), `none` (its branch pushed), a pull
     * request, a draft or ready for review, or null (ready on its branch, nothing going to a host: a project on none Althar
     * knows); `afterMerge`, a reviewer that reads it only once it merged (the fast lane's), or
     * null for its review before it ships again. Its plan, the run of it and its latest run take them, so its next ending and
     * its next Ship go by them; a Ship under way as it comes to end here sends nothing. `chosen`, with `end`: whether that
     * ending is the person's own rather than the project's, so a preset saved from it keeps it, or follows the project;
     * left out, it stays as it was. How it ended before, for its caller to say. Refused only for an abandoned task, or one
     * with no plan.
     */
    reshape(input: {
      readonly taskId: string
      readonly end?: TaskEnding | null
      readonly chosen?: boolean
      readonly afterMerge?: PlanStep | null
      readonly smallChange?: boolean
      readonly actorId: ActorId
    }): Effect.Effect<{ readonly was: TaskEnding | null }, unknown>
    /** Explicitly keeps or drops a review after merge; asking for it sets that timing on the task's configured reviewer. */
    setReviewAfterMerge(input: {
      readonly taskId: string
      readonly review: 'review' | 'none' | null
      readonly actorId: ActorId
    }): Effect.Effect<AfterMergeChoice, unknown>
    /** The person's answer to what Althar asked before a Local task takes a checkout (ADR-091); its task is placed again at once. */
    answerCheckout(input: {
      readonly envelope: CommandEnvelope
      readonly attentionId: string
      readonly answer: CheckoutAnswer
    }): Effect.Effect<void, unknown>
    /** Looks again at what waits for a checkout, as a plan changed where it works, or a task settled. */
    readonly checkoutsMoved: Effect.Effect<void>
    /**
     * Moves a running task's change between a worktree and Local, between its lead's turns (a task is a conversation plus
     * parts, "Moving between a worktree and Local"): at once where nothing holds it, else once it can, tried again every few
     * seconds; or the person is asked first, about a checkout on a branch of their own.
     */
    move(input: {
      readonly envelope: CommandEnvelope
      readonly taskId: string
      readonly to: 'worktree' | 'checkout'
      readonly change?: string | null
      readonly consent?: MoveConsent
    }): Effect.Effect<Moved, unknown>
    /** Calls off a move that waits: the task stays where it works. */
    dropMove(input: { readonly envelope: CommandEnvelope; readonly taskId: string }): Effect.Effect<void, unknown>
    /**
     * Points a running task at another branch to work toward (a task is a conversation plus parts, "Changing the branch a
     * task works toward"), or its default with null: between its lead's turns, the person's word waiting for one under way;
     * its lead's own, from its tool, at once. A conflict goes to its lead; a change pushed already opens its new pull
     * request into the new branch, unless it waits for Ship. What it did, in words.
     */
    workToward(input: {
      readonly taskId: string
      readonly toward: string | null
      readonly change?: string | null
      /** Its lead asked, in its turn: no turn to wait for. */
      readonly byLead?: boolean
    }): Effect.Effect<ReadonlyArray<string>, unknown>
  }
>()('@althar/runtime/Runs') {
  static readonly layer: Layer.Layer<Runs, never, Store> = Layer.effect(
    Runs,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const sessions = yield* Sessions
      const leftBehind = yield* LeftBehind
      const mergeReviews = yield* MergeReviews
      /**
       * Tasks with something still at work here: an agent, in a turn or idle,
       * or a settling not done stopping what they ran. A settled Local task's
       * checkout stays its own until it has none (ADR-091).
       */
      const notYetStopped = Effect.gen(function* () {
        const live = (yield* sessions.onTasks).map((session) => session.taskId)
        return new Set([...live, ...(yield* leftBehind.stopping)])
      })
      const questions = yield* Questions
      const toolServer = yield* ToolServer
      const live = yield* Live
      const changes = yield* Changes
      const issues = yield* Issues
      const limits = yield* Limits
      const autoModels = yield* AutoModels
      const policies = yield* Policies
      const busy = yield* Busy
      const connectivity = yield* Connectivity
      const agentsHere = yield* Agents
      const scope = yield* Effect.scope
      const blankPause = (yield* RuntimeConfig).idle?.blank ?? BLANK_PAUSE
      const publishAgain = (yield* RuntimeConfig).publishAgain ?? Duration.seconds(30)
      const externalEvery = Duration.toMillis((yield* RuntimeConfig).externalWaitEvery ?? Duration.seconds(30))
      // Asked when a step is held for a reset, so the wait for it starts again.
      const holdsChanged = yield* Queue.sliding<void>(1)
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)
      // Starts a thread's budget again, as a step that starts does: the stall watch's, once it is running below.
      let freshen: (threadId: string) => Effect.Effect<void> = () => Effect.void
      // Ships waiting to merge on their required checks, by run: each wakes as its route changes, rather than at its next look.
      const mergeWakes = new Map<string, Queue.Queue<void>>()

      /** The workflow every task runs, for now: made once per profile. */
      const workflowVersion = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [known] = yield* sql<{ id: string }>`
          SELECT v.id FROM workflow_versions v JOIN workflow_definitions d ON d.id = v.definition_id WHERE d.name = 'task' AND v.version = 1`
        if (known !== undefined) return known.id
        const definition = JSON.stringify({
          steps: ['implement', 'review'],
          review: { rounds: PLANS_AND_REVIEWS.rounds, settledBy: 'lead' },
        })
        const definitionId = yield* newId(Ids.workflowDefinition)
        const versionId = yield* newId(Ids.workflowVersion)
        const at = yield* timestamp
        yield* sql`INSERT INTO workflow_definitions ${sql.insert({ id: definitionId, name: 'task', createdAt: at })}`
        yield* sql`INSERT INTO workflow_versions ${sql.insert({
          id: versionId,
          definitionId,
          version: 1,
          contentHash: createHash('sha256').update(definition).digest('hex'),
          definition,
          createdAt: at,
        })}`
        return versionId
      })

      /** The project's rules, as the run records them: the revision it starts under. */
      const policyOf = (projectId: ProjectId) => Effect.map(policies.current(projectId), (policy) => policy.id)

      /** What a usage limit does to a run's steps: as the rules it ran under say. */
      const usageLimitOfRun = (run: RunRow) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [cited] = yield* sql<{ policyId: string }>`SELECT policy_id FROM runs WHERE id = ${run.runId}`
          return usageLimitOf(
            cited === undefined ? (yield* policies.current(run.projectId)).rules : yield* policies.rulesOf(cited.policyId),
          )
        })

      /** The run a task is on now. */
      const currentRun = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<RunRow>`
            SELECT r.id AS run_id, a.id AS run_attempt_id, e.id AS execution_id, r.project_id, r.task_id, t.id AS thread_id, r.parameters,
              r.plan_id
            FROM runs r
            JOIN run_attempts a ON a.run_id = r.id AND a.state = 'active'
            JOIN workflow_executions e ON e.run_id = r.id
            JOIN threads t ON t.task_id = r.task_id AND t.kind = 'task'
            WHERE r.task_id = ${taskId} AND r.state = 'running'
            ORDER BY r.created_at DESC LIMIT 1`
          return row
        })

      const stepsOf = (run: RunRow) =>
        Effect.map(Schema.decodeUnknownEffect(Schema.fromJsonString(PlanParameters))(run.parameters), (parameters) => ({
          implement: parameters.steps.find((step) => step.key === 'implement'),
          review: parameters.steps.find((step) => step.key === 'review' && !step.skipped),
          end: parameters.end ?? null,
          here: parameters.here === true,
          publishes: parameters.publishes === true,
          ships: parameters.ships,
        }))

      /**
       * Whether the run is still the one this was read from: running, on the
       * same run attempt. A stop suspends it and interrupts that attempt, and
       * resuming makes another, so whatever read it before either can't write
       * to it any more. Inside the caller's transaction.
       */
      const going = (run: RunRow) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<{ n: number }>`
            SELECT count(*) AS n FROM runs r JOIN run_attempts a ON a.run_id = r.id
            WHERE r.id = ${run.runId} AND r.state = 'running' AND a.id = ${run.runAttemptId} AND a.state = 'active'`
          return (row?.n ?? 0) > 0
        })

      /**
       * Whether a step's report can still be kept: its run is going, on the
       * attempt it was read from, and the step's attempt still waits for it.
       * One that can't is kept out of the run and said in the record, as
       * from an agent that worked on while the task was stopped and resumed.
       * Inside the caller's transaction.
       */
      const keeps = (run: RunRow, attemptId: string, report: unknown) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [attempt] = yield* sql<{
            state: string
            output: string | null
          }>`SELECT state, output FROM node_attempts WHERE id = ${attemptId}`
          if ((yield* going(run)) && ['admitted', 'running', 'waiting_attention'].includes(attempt?.state ?? '')) return true
          const revision = yield* change('node_attempts', attemptId, { output: attempt?.output ?? null })
          yield* fact({
            projectId: run.projectId,
            aggregateType: 'node_attempt',
            aggregateId: attemptId,
            revision,
            type: 'node_attempt.report_dropped',
            payload: report,
            actorId: instance.systemId,
          })
          return false
        })

      /** What a step whose report was dropped is told. */
      const dropped = new ToolRefused({ message: 'That step was stopped, so Althar keeps nothing of this report.' })

      /** Adds a node for a step, for a round of the review loop, and admits an attempt at it. */
      const admit = (
        run: RunRow,
        key: 'implement' | 'review' | 'settle' | 'publish',
        iteration: number,
        config: unknown,
        input: unknown = {},
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          // Nothing new starts on a run its task's stop suspended, or for whatever read it before it was resumed.
          if (!(yield* going(run))) return yield* new RunStopped({ runId: run.runId })
          const at = yield* timestamp
          const [existing] = yield* sql<{ id: string }>`
            SELECT id FROM nodes WHERE execution_id = ${run.executionId} AND node_key = ${key} AND iteration = ${iteration}`
          const nodeId = existing?.id ?? (yield* newId(Ids.node))
          if (existing === undefined)
            yield* sql`INSERT INTO nodes ${sql.insert({
              id: nodeId,
              projectId: run.projectId,
              executionId: run.executionId,
              nodeKey: key,
              iteration,
              // What Althar does itself, outside, is an integration node; the rest is an agent's.
              type: key === 'publish' ? 'integration' : 'agent',
              addedInRevision: 1,
              config: JSON.stringify(config),
              state: 'running',
              createdAt: at,
            })}`
          else yield* change('nodes', nodeId, { state: 'running' })
          const [previous] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM node_attempts WHERE node_id = ${nodeId}`
          const attemptId = yield* newId(Ids.nodeAttempt)
          yield* sql`INSERT INTO node_attempts ${sql.insert({
            id: attemptId,
            projectId: run.projectId,
            nodeId,
            attemptNumber: (previous?.n ?? 0) + 1,
            runAttemptId: run.runAttemptId,
            controllerGeneration: 1,
            state: 'admitted',
            input: JSON.stringify(input),
            admittedAt: at,
          })}`
          yield* fact({
            projectId: run.projectId,
            aggregateType: 'node_attempt',
            aggregateId: attemptId,
            revision: 1,
            type: 'node_attempt.admitted',
            payload: { node: key, iteration },
            actorId: instance.systemId,
          })
          return { nodeId, attemptId }
        })

      /**
       * An attempt waits for a place among the agents at work on this machine,
       * held until one frees (Busy.ts), with how it starts then and since when
       * it waits: now, or, for one a restart stopped, since it was admitted, so
       * it goes before what waited behind it. Inside the caller's transaction.
       */
      const waitForPlace = (run: Pick<RunRow, 'projectId'>, attemptId: string, place: Place, since?: string) =>
        Effect.gen(function* () {
          const revision = yield* change('node_attempts', attemptId, {
            state: 'held',
            holdReason: 'machine_busy',
            output: JSON.stringify({ place, since: since ?? (yield* timestamp) } satisfies Waiting),
          })
          yield* fact({
            projectId: run.projectId,
            aggregateType: 'node_attempt',
            aggregateId: attemptId,
            revision,
            type: 'node_attempt.held',
            payload: { reason: 'machine_busy', how: place.how },
            actorId: instance.systemId,
          })
        })

      /**
       * An attempt now runs in a session, unless it can't any more: its run
       * was stopped or abandoned while its agent started (`stopped`: the
       * caller stops that agent), or it ended meanwhile, as one whose agent
       * reported in its first turn (`past`: it stays as it ended). `fresh`
       * clears what it had said, for one reminded afresh.
       */
      const started = (run: RunRow, attemptId: string, sessionId: string, fresh = false) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [now] = yield* sql<{ attempt: string }>`SELECT state AS attempt FROM node_attempts WHERE id = ${attemptId}`
          if (now === undefined || now.attempt === 'cancelled' || !(yield* going(run))) return 'stopped' as const
          if (!['admitted', 'running', 'waiting_attention', 'held'].includes(now.attempt)) return 'past' as const
          const revision = yield* change('node_attempts', attemptId, {
            state: 'running',
            holdReason: null,
            providerSessionId: sessionId,
            startedAt: yield* timestamp,
            // One that waited, for a place or a reset, starts with nothing said yet.
            ...(fresh || now.attempt === 'held' ? { output: null } : {}),
          })
          yield* fact({
            projectId: run.projectId,
            aggregateType: 'node_attempt',
            aggregateId: attemptId,
            revision,
            type: 'node_attempt.running',
            actorId: instance.systemId,
          })
          const [session] = yield* sql<{ threadId: string }>`SELECT thread_id FROM provider_sessions WHERE id = ${sessionId}`
          if (session !== undefined) yield* freshen(session.threadId)
          return 'running' as const
        })

      /** Marks an attempt running in a session, and stops that agent where the run was stopped meanwhile. Whether it runs. */
      const begin = (run: RunRow, attemptId: string, sessionId: string, threadId: string, fresh = false) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const now = yield* sql.withTransaction(started(run, attemptId, sessionId, fresh))
          if (now === 'stopped') yield* Effect.ignore(sessions.stop(threadId))
          return now !== 'stopped'
        })

      /** Ends an attempt and its node, with what it reported. */
      const ended = (
        run: RunRow,
        attempt: { readonly id: string; readonly nodeId: string },
        state: 'succeeded' | 'failed',
        output: unknown,
      ) =>
        Effect.gen(function* () {
          const at = yield* timestamp
          const revision = yield* change('node_attempts', attempt.id, { state, output: JSON.stringify(output), endedAt: at })
          yield* change('nodes', attempt.nodeId, { state })
          yield* fact({
            projectId: run.projectId,
            aggregateType: 'node_attempt',
            aggregateId: attempt.id,
            revision,
            type: `node_attempt.${state}`,
            payload: output,
            actorId: instance.systemId,
          })
        })

      /** The attempt running now, at one of these steps. */
      const running = (run: RunRow, keys: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [attempt] = yield* sql<{ id: string; nodeId: string; nodeKey: string; iteration: number; input: string }>`
            SELECT a.id, a.node_id, n.node_key, n.iteration, a.input FROM node_attempts a JOIN nodes n ON n.id = a.node_id
            WHERE n.execution_id = ${run.executionId} AND a.state IN ('admitted', 'running', 'waiting_attention')
              AND n.node_key IN ${sql.in(keys)}
            ORDER BY a.admitted_at DESC LIMIT 1`
          return attempt
        })

      /** A step's result, in the task's thread: what the person reads instead of the work. */
      const result = (run: Pick<RunRow, 'projectId' | 'threadId'>, content: Readonly<Record<string, unknown>>, id?: string) =>
        addItem({ projectId: run.projectId, threadId: run.threadId }, 'step_result', content, id === undefined ? {} : { id })

      /** The run is over: the task is ready for the person, or stopped. */
      const finish = (run: RunRow, state: 'succeeded' | 'failed' | 'cancelled') =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql.withTransaction(ends(run, state))
          yield* rest(run.taskId)
          yield* touchCard(run.taskId)
        })

      /** Where Althar keeps, by worktree, the commit it was on when the task's last run ended: what a round its lead's report opens starts from. */
      const RESTED = 'refs/althar/rested/'

      /**
       * Keeps where each of the task's worktrees is as a run of it ends
       * (ADR-034), in a ref of Althar's beside those of what it pushed: so a
       * round the lead's report opens later knows what came after. Nothing,
       * where git can't say.
       */
      const rest = (taskId: string) =>
        Effect.gen(function* () {
          for (const worktree of yield* worktreesOf(taskId))
            yield* Effect.ignore(git(worktree.path, 'update-ref', `${RESTED}${worktree.id}`, 'HEAD'))
        }).pipe(Effect.ignore)

      /** The run ends, inside the caller's transaction: unless its task's stop suspended it meanwhile, when it waits to be resumed. */
      const ends = (run: RunRow, state: 'succeeded' | 'failed' | 'cancelled') =>
        Effect.gen(function* () {
          if (!(yield* going(run))) return
          const at = yield* timestamp
          yield* change('run_attempts', run.runAttemptId, { state, endedAt: at })
          yield* change('workflow_executions', run.executionId, { state, endedAt: at })
          const revision = yield* change('runs', run.runId, { state, endedAt: at })
          yield* fact({
            projectId: run.projectId,
            aggregateType: 'run',
            aggregateId: run.runId,
            revision,
            type: `run.${state}`,
            actorId: instance.systemId,
          })
        })

      /** What a step that Althar does itself reported, in a line. */
      /** What publishing did, in words: in each repository, by name where there are several. */
      const publishedSummary = (published: Published, end: TaskEnd) =>
        published
          .map((one) => {
            const did = ((): string => {
              switch (one.kind) {
                case 'opened': {
                  const noun = one.change.words.noun
                  const name = `${noun} ${one.change.words.prefix}${one.change.number}`
                  if (one.attached === true) return `Pushed to ${name}, which the task follows.`
                  return end === 'ready' || !one.change.draft ? `Opened ${name} for review.` : `Opened draft ${name}.`
                }
                case 'pushed':
                  return `Pushed ${one.branch}.`
                case 'nothing':
                  return 'The branch has no commits to propose, so nothing was pushed.'
                case 'branch':
                  return "It isn't on a code host Althar knows, so it ends on its branch."
                case 'kept':
                  return `It ends on its branch here: ${one.pullRequest} stays as it is, and nothing more goes to it until it ends in a pull request again.`
              }
            })()
            const said = one.left.length === 0 ? did : `${did} Left out what the lead didn't commit: ${filesLine(one.left)}.`
            return published.length > 1 ? `${one.repository}: ${said}` : said
          })
          .join('\n')

      /** The pull request publishing opened, for the thread to show: the first, where it opened several. */
      const openedOf = (published: Published) => {
        const opened = published.find((one) => one.kind === 'opened')
        return opened?.kind === 'opened' ? { change: opened.change } : {}
      }

      /** A task that ends on its branch says why, and how its pull request can still open. */
      const onBranch = (run: RunRow) =>
        Effect.gen(function* () {
          const host = yield* changes.hostFor(run.projectId)
          yield* addItem({ projectId: run.projectId, threadId: run.threadId }, 'notice', {
            source: 'runtime',
            severity: 'info',
            ...(host === null
              ? {
                  title: 'The task ends on its branch.',
                }
              : {
                  title: `The task ends on its branch: ${host.name} isn't connected.`,
                  description: `Connect ${host.name} from the project, then open the pull request.`,
                }),
          })
        })

      /**
       * One action on the task's pull request: two quick clicks open one, and
       * the second hears it has one. In each repository whose last pull
       * request merged or closed with commits after it, the task opens its
       * next (ADR-034), whatever another repository's pull request is doing;
       * a merged task with such commits is open again for it.
       */
      /**
       * Whether an agent is at work on a task, or on its way to it, as the
       * task's card counts it under way: a turn of its lead or reviewer
       * running, a session starting, a step admitted, or what carries on by
       * itself: a step held for a place, a reset or the connection, its lead
       * about to be asked about a conflict, an answer kept for a place, or a
       * thread waiting for one.
       */
      const atWork = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<{ coming: number }>`
            SELECT (SELECT count(*) FROM provider_sessions s JOIN threads h ON h.id = s.thread_id WHERE h.task_id = ${taskId} AND s.state = 'starting')
              + (SELECT count(*) FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
                JOIN runs r ON r.id = e.run_id WHERE r.task_id = ${taskId} AND r.state = 'running' AND a.state IN ('admitted', 'held'))
              + (SELECT count(*) FROM conflict_resolutions c WHERE c.task_id = ${taskId} AND c.state = 'resolving' AND c.waiting IS NOT NULL)
              + (SELECT count(*) FROM attention_requests x WHERE x.task_id = ${taskId} AND x.kind = 'question' AND x.state = 'answered'
                AND json_extract(x.payload, '$.waitsForPlace') IS NOT NULL)
              + (SELECT count(*) FROM threads h WHERE h.task_id = ${taskId} AND h.waits_for_place IS NOT NULL) AS coming`
          if ((row?.coming ?? 0) > 0) return true
          const threads = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${taskId}`
          const live = yield* Effect.forEach(threads, (thread) => sessions.running(thread.id))
          return live.some((session) => Option.exists(session, (one) => one.turnRunning))
        })

      const publish = (taskId: string) =>
        changes.exclusive(
          taskId,
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const [task] = yield* sql<{ state: string; projectId: ProjectId }>`SELECT state, project_id FROM tasks WHERE id = ${taskId}`
            if (task === undefined) return yield* new NotFound({ kind: 'task', id: taskId })
            // An abandoned task's branch stays as it is; so does a merged one's, but for commits after its pull requests.
            if (task.state === 'abandoned') return yield* new NoChangeToOpen({ taskId, why: 'settled' })
            // A plain task that hasn't changed the repository has no branch: there is nothing to open one for.
            if (yield* unbranched(taskId)) return yield* new NoChangeToOpen({ taskId, why: 'nothing' })
            const opened = yield* changes.ofTask(taskId)
            // By repository: one whose pull request is open takes pushes, one whose last merged or closed with commits after it a new one.
            const after = opened.length > 0 ? yield* changes.unshipped(taskId) : []
            if (task.state === 'done' && after.length === 0) return yield* new NoChangeToOpen({ taskId, why: 'settled' })
            const [last] = yield* sql<{ runId: string; projectId: ProjectId; threadId: string; state: string }>`
            SELECT r.id AS run_id, r.project_id, t.id AS thread_id, r.state FROM runs r
            JOIN threads t ON t.task_id = r.task_id AND t.kind = 'task'
            WHERE r.task_id = ${taskId} ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1`
            // Work under way opens its pull request as it ends; work that stopped short, stopped or failed, opens it now, as a draft:
            // so does a run whose lead's turn was cut short, as the person interrupting it leaves it, with no agent at work on it.
            if (
              last === undefined ||
              !['succeeded', 'suspended', 'failed', 'cancelled', 'running'].includes(last.state) ||
              (last.state === 'running' && (yield* atWork(taskId)))
            )
              return yield* new NoChangeToOpen({ taskId, why: 'working' })
            if (opened.length > 0 && after.length === 0)
              return yield* new NoChangeToOpen({ taskId, why: opened.some((change) => change.state === 'open') ? 'opened' : 'nothing' })
            // Its new work going out, a merged task is open again, until that merges too: before it goes, so a try that opens
            // some of its pull requests and not others leaves it open, for the next.
            if (task.state === 'done')
              yield* sql.withTransaction(
                Effect.gen(function* () {
                  const [now] = yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${taskId}`
                  if (now?.state !== 'done') return
                  const revision = yield* change('tasks', taskId, {
                    state: yield* transition(taskLifecycle, 'done', 'open'),
                    settledAt: null,
                  })
                  yield* fact({
                    projectId: task.projectId,
                    aggregateType: 'task',
                    aggregateId: taskId,
                    revision,
                    type: 'task.reopened',
                    payload: { published: true },
                    actorId: instance.personId,
                  })
                }),
              )
            const published = yield* changes.publish({
              projectId: last.projectId,
              taskId,
              runId: last.runId,
              end: 'draft',
              ...(opened.length > 0 ? { again: true } : {}),
            })
            yield* result(
              { projectId: last.projectId, threadId: last.threadId },
              {
                step: 'publish',
                round: 0,
                summary: publishedSummary(published, 'draft'),
                ...openedOf(published),
              },
            )
            yield* touchCard(taskId)
          }),
        )

      /** Keep publication's branch switch and recorded workspace together, and fence Stop after waiting for that lock. */
      const publishForStep = (run: RunRow, attemptId: string, input: Parameters<typeof changes.publish>[0]) =>
        changes.exclusive(
          run.taskId,
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            yield* sql.withTransaction(
              Effect.gen(function* () {
                if (!(yield* going(run))) return yield* new RunStopped({ runId: run.runId })
                const [attempt] = yield* sql<{ state: string }>`SELECT state FROM node_attempts WHERE id = ${attemptId}`
                if (attempt?.state !== 'running') return yield* new RunStopped({ runId: run.runId })
              }),
            )
            return yield* changes.publish(input)
          }),
        )

      /**
       * The work is done: the task's ending, if its plan has one, then the
       * run is over and the task ready. Pushing and opening its pull request
       * is Althar's own step; if it can't, the person decides.
       */
      const conclude = (run: RunRow) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          // A quick task whose lead changed nothing in the repository has no branch, and nothing to send anywhere: it is done.
          if (yield* unbranched(run.taskId)) return yield* finish(run, 'succeeded')
          const ending = yield* stepsOf(run)
          // A Ship ends by sending up what waited, past the hold, as the plan ends, or as the project's, where it says none.
          if (ending.ships !== undefined)
            return yield* shipEnding(
              run,
              ending.end ??
                (ending.here ? 'draft' : yield* changes.endFor(run.projectId, run.taskId, true).pipe(Effect.orElseSucceed(() => null))),
            )
          // A round of work's commits go to the task's open pull request as its lead's turn ends (ADR-072); after its last merged
          // or closed, they open the next by themselves, a draft, as a plan's ending opens the first, where the project's rules
          // would have (ADR-034). But for the round a quick task was made a change in, which ends as the person asked.
          if (run.planId === null && !ending.publishes) {
            // A quick task's work isn't for a pull request, unless the person has it made a change: nothing to open.
            const after = ending.here ? [] : yield* changes.unshipped(run.taskId).pipe(Effect.orElseSucceed(() => []))
            if (after.length === 0) {
              yield* finish(run, 'succeeded')
              yield* Effect.ignore(changes.settleIfMerged(run.taskId))
              return
            }
            const unsaid = addItem({ projectId: run.projectId, threadId: run.threadId }, 'notice', {
              source: 'runtime',
              severity: 'info',
              title: "What the follow-up committed isn't in a pull request yet.",
            })
            // Only a task that had a pull request, in any of its repositories: one whose project leaves its work on its branch, or
            // on no host, stays so, and so does one whose plan ends with its branch now (it dropped its pull request).
            const had = (yield* changes.ofTask(run.taskId).pipe(Effect.orElseSucceed(() => []))).length > 0
            const end =
              had && ending.end !== 'none'
                ? yield* changes.endFor(run.projectId, run.taskId, true).pipe(Effect.orElseSucceed(() => null))
                : null
            // Nor a round its lead said only answered the person: what it committed in passing waits for them (ADR-034).
            const [last] = yield* sql<{ answered: number | null }>`
              SELECT json_extract(a.output, '$.answered') AS answered FROM node_attempts a JOIN nodes n ON n.id = a.node_id
              WHERE n.execution_id = ${run.executionId} AND n.node_key = 'implement' AND a.state = 'succeeded'
              ORDER BY a.ended_at DESC, a.rowid DESC LIMIT 1`
            // Said before the round ends, so whatever reads it ended finds it said.
            if ((end !== 'draft' && end !== 'ready') || last?.answered === 1) {
              yield* unsaid
              yield* finish(run, 'succeeded')
              yield* Effect.ignore(changes.settleIfMerged(run.taskId))
              return
            }
            // Under way from before the round ends until it opens or can't, so its card never reads Ready in between (DEV-173).
            yield* changes.opensNext(run.taskId, true)
            yield* finish(run, 'succeeded').pipe(Effect.onError(() => changes.opensNext(run.taskId, false)))
            yield* Effect.ignore(changes.settleIfMerged(run.taskId))
            // Apart: publishing takes the task's lock, which what ends the round may hold. Where it can't, the card offers it.
            return yield* Effect.forkIn(
              provide(
                publish(run.taskId).pipe(
                  Effect.catchCause((cause) =>
                    Cause.hasInterruptsOnly(cause)
                      ? Effect.interrupt
                      : Effect.andThen(Effect.logWarning('Could not open the next pull request', cause), unsaid),
                  ),
                  Effect.ensuring(Effect.andThen(changes.opensNext(run.taskId, false), Effect.ignore(touchCard(run.taskId)))),
                ),
              ),
              scope,
            ).pipe(Effect.asVoid)
          }
          // The plan's ending, else the project's, as when a plan is made: one made while the host wasn't connected opens its pull request if it is by now.
          // A quick task's stays on this Mac, and says nothing of a host.
          // Its repositories' remotes as git has them now: one added since the repository was is where it ends.
          const end = ending.end ?? (ending.here ? null : yield* changes.endFor(run.projectId, run.taskId, true))
          if (end === null) {
            if (!ending.here) yield* onBranch(run)
            return yield* finish(run, 'succeeded')
          }
          // Admitted and under way in one transaction, which a stop can't come between: once it is running, publishing has begun.
          const admitted = yield* unlessStopped(
            sql.withTransaction(
              Effect.gen(function* () {
                const admission = yield* admit(run, 'publish', 0, { end })
                const revision = yield* change('node_attempts', admission.attemptId, { state: 'running', startedAt: yield* timestamp })
                yield* fact({
                  projectId: run.projectId,
                  aggregateType: 'node_attempt',
                  aggregateId: admission.attemptId,
                  revision,
                  type: 'node_attempt.running',
                  actorId: instance.systemId,
                })
                return admission
              }),
            ),
          )
          if (admitted === undefined) return
          const { nodeId, attemptId } = admitted
          yield* touchCard(run.taskId)
          const publishing = Effect.exit(
            publishForStep(run, attemptId, { projectId: run.projectId, taskId: run.taskId, runId: run.runId, end }),
          )
          const first = yield* publishing
          // A failure that may pass is tried again once by itself, after a pause, unless it was stopped meanwhile: only a second
          // asks the person (DEV-173). Publishing again adopts what the first did on the host.
          const again =
            first._tag === 'Failure' && mayPass(first.cause)
              ? yield* Effect.andThen(
                  Effect.sleep(publishAgain),
                  Effect.gen(function* () {
                    const [still] = yield* sql<{ state: string }>`SELECT state FROM node_attempts WHERE id = ${attemptId}`
                    return still?.state === 'running' && (yield* going(run))
                  }),
                )
              : false
          const published = again ? yield* publishing : first
          if (published._tag === 'Failure') {
            const error = Cause.findErrorOption(published.cause)
            const notConnected = Option.isSome(error) && error.value instanceof NotConnected
            return yield* stuck(
              run,
              { id: attemptId },
              {
                step: 'publish',
                why: notConnected ? 'not_connected' : 'failed_to_start',
                detail: summarize(published.cause) || null,
                agentId: null,
                round: 0,
                open: 0,
              },
            )
          }
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const said = { step: 'publish', round: 0, summary: publishedSummary(published.value, end), ...openedOf(published.value) }
              // Stopped or abandoned while it published, what it did on the host is said, and the run waits: publishing again, as resuming
              // does, adopts what is there.
              const [still] = yield* sql<{ state: string }>`SELECT state FROM node_attempts WHERE id = ${attemptId}`
              if (still?.state !== 'running' || !(yield* going(run))) return yield* result(run, said)
              yield* ended(run, { id: attemptId, nodeId }, 'succeeded', published.value)
              yield* unstuck(run)
              yield* result(run, said)
              yield* ends(run, 'succeeded')
            }),
          )
          yield* rest(run.taskId)
          yield* touchCard(run.taskId)
        })

      /**
       * A step needs the person (docs/architecture/05): its attempt waits on
       * them, and a call in the task says why. A run has one such call open at
       * a time.
       */
      const stuck = (run: RunRow, attempt: { readonly id: string } | null, asked: StuckInfo) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          // An agent that couldn't start because it is signed out, its sign-in ended or it isn't installed stops for that:
          // signing it in again, or installing it, is the way on, which the call offers.
          const startWhy = asked.why === 'failed_to_start' ? stuckWhyOf(asked.detail) : undefined
          const told: StuckInfo = startWhy === undefined ? asked : { ...asked, why: startWhy }
          // The model it was on, so handing the step on can leave out the one that failed.
          const on =
            told.agentId === null || told.step === 'publish' || told.model !== undefined
              ? undefined
              : yield* sessionOnStep(run.taskId, told.step, told.agentId)
          const info: StuckInfo = {
            ...told,
            ...(on?.model == null ? {} : { model: on.model }),
            ...(on?.effort == null ? {} : { effort: on.effort }),
          }
          const opened = yield* sql.withTransaction(
            Effect.gen(function* () {
              const [open] = yield* sql<{ id: string }>`
                SELECT id FROM attention_requests WHERE task_id = ${run.taskId} AND kind = 'stuck' AND state = 'open'`
              if (open !== undefined) return false
              // A run its task's stop suspended, or a step it cut short, asks nothing of the person: they stopped it.
              const [now] = yield* sql<{ attempt: string | null }>`
                SELECT (SELECT state FROM node_attempts WHERE id = ${attempt?.id ?? ''}) AS attempt`
              if (!(yield* going(run)) || now?.attempt === 'cancelled') return false
              if (attempt !== null) {
                // One held for a limit, whose handover didn't go through, waits on the person instead.
                const revision = yield* change('node_attempts', attempt.id, { state: 'waiting_attention', holdReason: null })
                yield* fact({
                  projectId: run.projectId,
                  aggregateType: 'node_attempt',
                  aggregateId: attempt.id,
                  revision,
                  type: 'node_attempt.waiting_attention',
                  payload: info,
                  actorId: instance.systemId,
                })
              }
              const id = yield* newId(Ids.attentionRequest)
              yield* sql`INSERT INTO attention_requests ${sql.insert({
                id,
                projectId: run.projectId,
                taskId: run.taskId,
                nodeAttemptId: attempt?.id ?? null,
                kind: 'stuck',
                addresseeActorId: instance.personId,
                payload: JSON.stringify(info),
                state: 'open',
                createdAt: yield* timestamp,
              })}`
              yield* fact({
                projectId: run.projectId,
                aggregateType: 'attention_request',
                aggregateId: id,
                revision: 1,
                type: 'attention_request.opened',
                payload: info,
                actorId: instance.systemId,
              })
              return true
            }),
          )
          if (opened) yield* touchCard(run.taskId)
        })

      /** The model and effort a step's agent last ran on, on the step's own thread. */
      const sessionOnStep = (taskId: string, step: StuckInfo['step'], agentId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [last] = yield* sql<{ model: string | null; effort: string | null }>`
            SELECT s.model, s.effort FROM provider_sessions s JOIN threads t ON t.id = s.thread_id
            WHERE t.task_id = ${taskId} AND t.kind = ${step === 'review' ? 'step' : 'task'} AND s.agent_id = ${agentId}
            ORDER BY s.started_at DESC, s.rowid DESC LIMIT 1`
          return last
        })

      /** The model a step's agent last ran on, on the step's own thread: the one it carries on with at a reset. */
      const modelOnStep = (taskId: string, step: StuckInfo['step'], agentId: string) =>
        Effect.map(sessionOnStep(taskId, step, agentId), (last) => last?.model ?? null)

      /** A step that reported after all no longer needs the person: its call is withdrawn. */
      const unstuck = (run: RunRow) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const open = yield* sql<{ id: string }>`
            SELECT id FROM attention_requests WHERE task_id = ${run.taskId} AND kind = 'stuck' AND state = 'open'`
          for (const call of open) {
            const revision = yield* change('attention_requests', call.id, { state: 'withdrawn' })
            yield* fact({
              projectId: run.projectId,
              aggregateType: 'attention_request',
              aggregateId: call.id,
              revision,
              type: 'attention_request.withdrawn',
              actorId: instance.systemId,
            })
          }
        })

      /** Whether an agent on the thread asked the person a question they haven't answered, or whose answer waits for a place to be told. */
      const asking = (threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [thread] = yield* sql<{ taskId: string }>`
            SELECT task_id AS taskId FROM threads WHERE id = ${threadId} AND kind = 'task'`
          const [open] = yield* sql<{ id: string }>`
            SELECT id FROM attention_requests
            WHERE ((kind = 'question' AND json_extract(payload, '$.threadId') = ${threadId}
                AND (state = 'open' OR (state = 'answered' AND json_extract(payload, '$.waitsForPlace') IS NOT NULL)))
              OR (${thread?.taskId ?? ''} <> '' AND kind = 'stuck' AND state = 'open' AND task_id = ${thread?.taskId ?? ''}
                AND json_extract(payload, '$.why') = 'waiting_on_person')) LIMIT 1`
          return open !== undefined
        })

      /**
       * The person wrote in the task's thread: a lead waiting on them has its call answered. It is answered as they send,
       * whichever way the message is delivered (`PersonSaid`), so the card closes then and not only when a turn starts.
       * The step runs again on the turn their words start (`resume`), not before: the lead's own turn may still be
       * ending, and a step running with no turn of its own to report in is read as one that went quiet. The call doesn't
       * stay open, so `finish_step` no longer refuses once the work is done.
       */
      const answerWaiting = (threadId: string, resume: boolean, turnId?: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [thread] = yield* sql<{ taskId: string }>`
            SELECT task_id AS taskId FROM threads WHERE id = ${threadId} AND kind = 'task'`
          if (thread === undefined) return
          // A turn answers the calls that were open when the person's words it carries were sent, not one the lead asked after
          // them, while it ran on: that question is still the person's to answer. What the coordinator or Althar sent beside
          // their words doesn't move that point.
          const [sent] =
            turnId === undefined
              ? []
              : yield* sql<{ at: string | null }>`
                SELECT max(u.accepted_at) AS at FROM turn_delivery_inputs d JOIN user_inputs u ON u.id = d.user_input_id
                WHERE d.delivery_id = ${turnId} AND u.sender_kind IN ('window', 'paired_device')`
          const until = sent?.at ?? '9999'
          const open = yield* sql<{ id: string; projectId: ProjectId; attemptId: string | null }>`
            SELECT id, project_id AS projectId, node_attempt_id AS attemptId FROM attention_requests
            WHERE task_id = ${thread.taskId} AND kind = 'stuck' AND state = 'open' AND created_at <= ${until}
              AND json_extract(payload, '$.why') = 'waiting_on_person'`
          for (const call of open) {
            const at = yield* timestamp
            const revision = yield* change('attention_requests', call.id, { state: 'answered', answeredAt: at })
            yield* fact({
              projectId: call.projectId,
              aggregateType: 'attention_request',
              aggregateId: call.id,
              revision,
              type: 'attention_request.answered',
              payload: { kind: 'tell' },
              actorId: instance.personId,
            })
          }
          // The step of each call the person answered goes on with the turn their words start, which may come after the call closed.
          const waiting = resume
            ? yield* sql<{ attemptId: string }>`
                SELECT DISTINCT q.node_attempt_id AS attemptId FROM attention_requests q
                JOIN node_attempts a ON a.id = q.node_attempt_id AND a.state = 'waiting_attention'
                WHERE q.task_id = ${thread.taskId} AND q.kind = 'stuck' AND q.state = 'answered'
                  AND json_extract(q.payload, '$.why') = 'waiting_on_person'
                  AND NOT EXISTS (SELECT 1 FROM attention_requests o WHERE o.node_attempt_id = a.id AND o.state = 'open')`
            : []
          for (const { attemptId } of waiting) yield* change('node_attempts', attemptId, { state: 'running' })
          if (open.length > 0 || waiting.length > 0) yield* touchCard(thread.taskId)
        }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not answer a lead waiting on the person', cause)))

      /** The answers kept on the task's threads while there was no place to tell them, oldest first. */
      const keptAnswers = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql<{ id: string }>`
            SELECT id FROM attention_requests WHERE task_id = ${taskId} AND kind = 'question' AND state = 'answered'
              AND json_extract(payload, '$.waitsForPlace') IS NOT NULL ORDER BY answered_at`
        })

      /** Review findings of the run the lead hasn't settled. */
      const openFindings = (run: RunRow) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql<{ id: string; severity: Finding['severity']; location: string; claim: string; title: string | null }>`
            SELECT f.id, f.severity, f.location, f.claim, f.title FROM findings f JOIN node_attempts a ON a.id = f.review_attempt_id
            JOIN nodes n ON n.id = a.node_id WHERE n.execution_id = ${run.executionId} AND f.state = 'open' ORDER BY f.created_at`
        })

      /** The run's findings that one settle set aside without giving a reason. */
      const unexplained = (run: RunRow, attemptId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql<{ id: string; severity: Finding['severity']; location: string; claim: string; title: string | null }>`
            SELECT f.id, f.severity, f.location, f.claim, f.title FROM findings f JOIN node_attempts a ON a.id = f.review_attempt_id
            JOIN nodes n ON n.id = a.node_id WHERE n.execution_id = ${run.executionId} AND f.state = 'set_aside'
            AND f.settled_in_attempt_id = ${attemptId} AND (f.response IS NULL OR trim(f.response) = '') ORDER BY f.created_at`
        })

      /** The run's open findings, as the lead is told to settle them. */
      const openToSettle = (run: RunRow) =>
        Effect.map(openFindings(run), (open) =>
          open.map((finding) => {
            const location = JSON.parse(finding.location) as { file?: string | null; line?: number | null }
            return {
              id: finding.id,
              severity: finding.severity,
              ...(finding.title === null ? {} : { title: finding.title }),
              claim: finding.claim,
              ...(location.file == null ? {} : { file: location.file }),
              ...(location.line == null ? {} : { line: location.line }),
            }
          }),
        )

      /** The step waiting on a thread's agent: the lead's (Implement, settling) on the task's thread, or the review on its own. */
      const stepOn = (threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<{
            taskId: string
            nodeKey: string
            nodeId: string
            attemptId: string
            output: string | null
            input: string
            iteration: number
          }>`
            SELECT r.task_id, n.node_key, n.id AS node_id, a.id AS attempt_id, a.output, a.input, n.iteration
            FROM threads t
            JOIN runs r ON r.task_id = t.task_id AND r.state = 'running'
            JOIN workflow_executions e ON e.run_id = r.id
            JOIN nodes n ON n.execution_id = e.id
            JOIN node_attempts a ON a.node_id = n.id AND a.state = 'running'
            WHERE t.id = ${threadId}
              AND ((t.kind = 'task' AND n.node_key IN ('implement', 'settle')) OR (t.kind = 'step' AND t.node_key = 'review' AND n.node_key = 'review'))
            ORDER BY a.admitted_at DESC LIMIT 1`
          if (row === undefined) return undefined
          const run = yield* currentRun(row.taskId)
          return run === undefined ? undefined : { ...row, run, step: stepOf(row.nodeKey) }
        })

      const stepOf = (key: string): StuckInfo['step'] =>
        key === 'review' ? 'review' : key === 'settle' ? 'settle' : key === 'publish' ? 'publish' : 'implement'

      /**
       * Whether a step's attempt, as its agent's turn `turnId` ended, is past
       * what that turn's end decides: it reported meanwhile, or ended
       * otherwise, or the thread has had a turn since, which may yet report and
       * whose own end decides. Read again where it decides, as the git a
       * round's end reads can take a while: under load the lead's next turn
       * starts before then, and both looked at the same step (#430).
       */
      const pastTurn = (threadId: string, turnId: string, attemptId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [attempt] = yield* sql<{ state: string }>`SELECT state FROM node_attempts WHERE id = ${attemptId}`
          if (!['admitted', 'running', 'waiting_attention'].includes(attempt?.state ?? '')) return true
          const [latest] = yield* sql<{ id: string }>`
            SELECT id FROM turn_deliveries WHERE thread_id = ${threadId} ORDER BY requested_at DESC, rowid DESC LIMIT 1`
          return latest !== undefined && latest.id !== turnId
        })

      /**
       * How many of the thread's latest turns, up to `turnId`, ended having
       * done nothing at all, in a row: each completed having used no tokens, as
       * its agent said, and said or did nothing. None where `turnId` isn't its
       * latest, or didn't end so.
       */
      const blanks = (threadId: string, turnId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const turns = yield* sql<{ id: string; blank: number }>`
            SELECT d.id, d.state = 'completed' AND d.error_class IS NULL AND json_extract(d.usage, '$.totalTokens') = 0
              AND NOT EXISTS (SELECT 1 FROM thread_items i WHERE i.delivery_id = d.id AND i.kind <> 'user_message') AS blank
            FROM turn_deliveries d WHERE d.thread_id = ${threadId} ORDER BY d.requested_at DESC, d.rowid DESC LIMIT ${BLANKS + 1}`
          if (turns[0]?.id !== turnId) return 0
          const worked = turns.findIndex((turn) => turn.blank !== 1)
          return worked === -1 ? turns.length : worked
        })

      /** A settled task's lead stops once its turn ends (LeftBehind.ts), unless a run of the task is under way. */
      const settledAgain = (threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [task] = yield* sql<{ taskId: string; state: string }>`
            SELECT k.id AS task_id, k.state FROM threads t JOIN tasks k ON k.id = t.task_id WHERE t.id = ${threadId} AND t.kind = 'task'`
          if (task === undefined || task.state !== 'done' || (yield* currentRun(task.taskId)) !== undefined) return
          yield* leftBehind.settled(task.taskId)
        })

      /**
       * A task's lead whose turn after its plan ended having done nothing at
       * all never reached its model: a moment later, unless something was
       * said to it since, it is told to carry on with what it was last asked,
       * as a step's agent is; BLANKS times in a row to no effect, the thread
       * says so once, for the person to write again. There is no step to
       * stop: the conversation is theirs.
       */
      const blankTalk = (threadId: string, turnId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [thread] = yield* sql<{ projectId: ProjectId; taskId: string }>`
            SELECT project_id, task_id FROM threads WHERE id = ${threadId} AND kind = 'task'`
          if (thread === undefined) return false
          const inARow = yield* blanks(threadId, turnId)
          if (inARow === 0) return false
          // At most BLANKS + 1 are counted: past BLANKS, it has been told to carry on as often as it is, and the thread says so.
          if (inARow > BLANKS) {
            yield* addItem({ projectId: thread.projectId, threadId }, 'notice', {
              source: 'runtime',
              severity: 'warning',
              title: 'Its turns ended without doing anything. Write to it again to carry on.',
              about: 'stall',
            })
            return false
          }
          yield* addItem({ projectId: thread.projectId, threadId }, 'notice', {
            source: 'runtime',
            severity: 'warning',
            title: 'Its turn ended without doing anything.',
            about: 'stall',
            role: 'aside',
          })
          const again = Effect.gen(function* () {
            yield* Effect.sleep(blankPause)
            // Moved on meanwhile: a step began, or it was told something, which started another turn or waits for one.
            if ((yield* currentRun(thread.taskId)) !== undefined) return
            const [latest] = yield* sql<{ id: string }>`
              SELECT id FROM turn_deliveries WHERE thread_id = ${threadId} ORDER BY requested_at DESC, rowid DESC LIMIT 1`
            if (latest?.id !== turnId) return
            const [queued] = yield* sql<{
              id: string
            }>`SELECT id FROM user_inputs WHERE thread_id = ${threadId} AND state = 'queued' LIMIT 1`
            if (queued !== undefined) return
            yield* sessions.send({
              envelope: yield* envelope('thread.send', { threadId, blank: turnId }),
              threadId,
              body: blankAgain('implement', true),
              quiet: true,
            })
          }).pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.logWarning('Could not tell a lead to carry on', cause),
            ),
          )
          yield* Effect.forkIn(provide(again), scope)
          return true
        })

      /**
       * A step's agent whose turn ended having done nothing at all never
       * reached its model: it hasn't stopped without reporting. A minute
       * later, unless the person or Althar has said something to it since,
       * it is told to carry on; told so BLANKS times in a row to no effect, it
       * counts as stalled, and the step needs the person.
       */
      const blankTurn = (
        threadId: string,
        turnId: string,
        on: NonNullable<Effect.Success<ReturnType<typeof stepOn>>>,
        inARow: number,
        info: (why: StuckWhy, detail: string | null) => StuckInfo,
      ) =>
        Effect.gen(function* () {
          if (inARow > BLANKS) return yield* stuck(on.run, { id: on.attemptId }, { ...info('stalled', null), tried: ['carried_on'] })
          yield* addItem({ projectId: on.run.projectId, threadId }, 'notice', {
            source: 'runtime',
            severity: 'warning',
            title: 'Its turn ended without doing anything.',
            about: 'stall',
            role: 'aside',
          })
          const again = Effect.gen(function* () {
            yield* Effect.sleep(blankPause)
            const sql = yield* SqlClient.SqlClient
            const [still] = yield* sql<{ id: string }>`SELECT id FROM node_attempts WHERE id = ${on.attemptId} AND state = 'running'`
            // Moved on meanwhile: stopped or reported, or told something, which started another turn or waits for one.
            if (still === undefined) return
            const [latest] = yield* sql<{ id: string }>`
              SELECT id FROM turn_deliveries WHERE thread_id = ${threadId} ORDER BY requested_at DESC, rowid DESC LIMIT 1`
            if (latest?.id !== turnId) return
            const [queued] = yield* sql<{ id: string }>`
              SELECT id FROM user_inputs WHERE thread_id = ${threadId} AND state = 'queued' LIMIT 1`
            if (queued !== undefined) return
            yield* sessions.send({
              envelope: yield* envelope('thread.send', { threadId, blank: on.attemptId }),
              threadId,
              body: blankAgain(on.step, on.run.planId === null),
              quiet: true,
            })
          }).pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.interrupt
                : stuck(on.run, { id: on.attemptId }, info('no_report', summarize(cause) || null)),
            ),
          )
          yield* Effect.forkIn(provide(again), scope)
        })

      /**
       * Where a task's lead's turn ends, or its session goes, a quick task
       * whose lead changed the repository gets its branch (`firstWrite.ts`),
       * one thing at a time with publishing the task. Nothing for any other
       * thread, or a task with its branch already.
       */
      const firstWriteOn = (threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [thread] = yield* sql<{ taskId: string }>`
            SELECT t.task_id FROM threads t WHERE t.id = ${threadId} AND t.kind = 'task'
              AND EXISTS (SELECT 1 FROM workspaces w WHERE w.task_id = t.task_id AND w.access = 'write' AND w.branched_at IS NULL)`
          if (thread !== undefined) yield* changes.exclusive(thread.taskId, branchOnFirstWrite(thread.taskId))
        }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not look for a plain task’s first change', cause)))

      /** Told once when its turn ends without the report its step needs: report, or say what blocks it; ended again without, the step is handed on. */
      const reminders = {
        lead: "Your step isn't done until you call Althar's finish_step tool. If you have done it, call finish_step now with your summary. If you can't go on without the person, call wait_for_person with your question and end your turn; don't call finish_step for work that waits on them. If finish_step isn't among your tools, say so in a line, with the tools you have, and end your turn.",
        round:
          "Your step isn't done until you call Althar's finish_step tool: you changed the task's work since the person last wrote to you. If you have done what they asked, call finish_step now with your summary and your evidence. If you can't go on without the person, call wait_for_person with your question and end your turn; don't call finish_step for work that waits on them. If finish_step isn't among your tools, say so in a line, with the tools you have, and end your turn.",
        reviewer:
          "Your review isn't done until you call Althar's report_review tool. Call it now with your verdict, a summary and your findings. If report_review isn't among your tools, say so in a line, with the tools you have, and end your turn.",
      }

      /**
       * A lead's turn that ends with what stands open of its round, its last
       * message or its report where nothing follows it, only pointing back at
       * what folded ("the proposal is above") is told once to say it again in
       * full (lastMessage.ts, ADR-099); a turn that answered that isn't told
       * again. Nothing for another thread, a turn more input waits behind, or
       * a round with nothing said before what stands open.
       */
      const restate = (event: Extract<LiveEvent, { readonly _tag: 'TurnEnded' }>) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [thread] = yield* sql<{ kind: string }>`SELECT kind FROM threads WHERE id = ${event.threadId}`
          if (thread?.kind !== 'task') return false
          const [queued] = yield* sql<{ id: string }>`
            SELECT id FROM user_inputs WHERE thread_id = ${event.threadId} AND state = 'queued' LIMIT 1`
          if (queued !== undefined) return false
          const [answering] = yield* sql<{ id: string }>`
            SELECT u.id FROM turn_delivery_inputs d JOIN user_inputs u ON u.id = d.user_input_id
            WHERE d.delivery_id = ${event.turnId} AND substr(u.body, 1, ${RESTATE_START.length}) = ${RESTATE_START} LIMIT 1`
          if (answering !== undefined) return false
          const [turn] = yield* sql<{ first: number | null }>`
            SELECT min(sequence) AS first FROM thread_items WHERE delivery_id = ${event.turnId}`
          if (turn?.first == null) return false
          // The round, since what was last said to the lead: what it said, and its reports on its work.
          const [ask] = yield* sql<{ at: number | null }>`
            SELECT max(sequence) AS at FROM thread_items WHERE thread_id = ${event.threadId} AND kind = 'user_message'`
          const said = yield* sql<{ kind: string; sequence: number; content: string }>`
            SELECT kind, sequence, content FROM thread_items
            WHERE thread_id = ${event.threadId} AND sequence > ${ask?.at ?? 0}
              AND (kind = 'agent_message' OR (kind = 'step_result' AND json_extract(content, '$.step') IN ('implement', 'settle')))
            ORDER BY sequence`
          const first = turn.first
          const round = said.map((item): RoundItem => {
            const content = JSON.parse(item.content) as { text?: string; built?: string | null; summary?: string }
            return item.kind === 'agent_message'
              ? { kind: 'message', text: content.text ?? '', thisTurn: item.sequence >= first }
              : { kind: 'report', text: content.built ?? content.summary ?? '', thisTurn: item.sequence >= first }
          })
          const pointing = toRestate(round)
          if (pointing === undefined) return false
          yield* sessions.send({
            envelope: yield* envelope('thread.send', { threadId: event.threadId, restate: event.turnId }),
            threadId: event.threadId,
            body: restateWords(pointing),
            quiet: true,
          })
          return true
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.as(Effect.logWarning('Could not read whether a turn’s last message stands alone', cause), false),
          ),
        )

      /**
       * The best model to hand a step on to whose agent ended twice without its
       * report, by the rules a usage limit hands one on by (`limits.free`):
       * another agent, as the trouble is most often its agent's session rather
       * than its model (OpenCode's, that lost Althar's tools), with room and on
       * a plan, a review away from the lead's maker where it can be, the
       * person's models before others. None where no other agent is free.
       */
      const takerFor = (on: LimitedStep, failed: { readonly agentId: string; readonly model: string | null }) =>
        Effect.gen(function* () {
          const { implement, review: plannedReview } = yield* stepsOf(on.run)
          const planned = on.step === 'review' ? plannedReview : implement
          const other = yield* otherStepOf(on.run, on.step === 'review' ? 'review' : 'implement')
          return yield* limits.free({
            besides: [failed.agentId],
            projectId: on.run.projectId,
            from: failed,
            ...(planned === undefined ? {} : { planned }),
            ...(other === undefined ? {} : { other }),
          })
        })

      /**
       * A step's agent ended its turn without its report after it was reminded.
       * The record notes which model it was (`missedReports`), and the step
       * goes to the best model free (`takerFor`) on its own: the thread says who
       * failed and who takes it over, and the new agent starts briefed with the
       * thread so far, as for any handover. Handed on for this once already in
       * the step's round, so it can't go round, or with no other model free, it
       * needs the person, as before; and so does one whose task was settled
       * meanwhile. An automation's run goes the same way: nothing here waits
       * on the person while another model can take it.
       */
      const noReport = (
        on: LimitedStep,
        turnId: string,
        output: Readonly<Record<string, unknown>>,
        info: (why: StuckWhy, detail: string | null) => StuckInfo,
        detail: string | null,
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const asked = info('no_report', detail)
          const [turn] = yield* sql<{ agentId: string; model: string | null }>`
            SELECT s.agent_id, coalesce(t.model, s.model) AS model FROM turn_deliveries t
            JOIN provider_sessions s ON s.id = t.provider_session_id WHERE t.id = ${turnId}`
          const agentId = turn?.agentId ?? asked.agentId
          const model = turn?.model ?? null
          const [before] = yield* sql<{ one: number }>`
            SELECT 1 AS one FROM record_events WHERE aggregate_type = 'node_attempt'
              AND aggregate_id IN (SELECT id FROM node_attempts WHERE node_id = ${on.nodeId})
              AND type = ${NO_REPORT} AND json_extract(payload, '$.handedTo') IS NOT NULL LIMIT 1`
          // A task settled meanwhile, its change merged as its lead worked on, has nothing left to hand on: its lead stops as it does.
          const [settled] = yield* sql<{ one: number }>`SELECT 1 AS one FROM tasks WHERE id = ${on.run.taskId} AND settled_at IS NOT NULL`
          const next =
            before !== undefined || agentId === null || settled !== undefined
              ? undefined
              : yield* takerFor(on, { agentId, model }).pipe(Effect.orElseSucceed(() => undefined))
          if (agentId !== null) {
            const revision = yield* change('node_attempts', on.attemptId, {
              output: JSON.stringify({ ...output, reminded: true, missed: true }),
            })
            yield* fact({
              projectId: on.run.projectId,
              aggregateType: 'node_attempt',
              aggregateId: on.attemptId,
              revision,
              type: NO_REPORT,
              payload: { agentId, model, step: on.step, handedTo: next?.agentId ?? null, handedModel: next?.model ?? null },
              actorId: instance.systemId,
            })
          }
          if (next === undefined)
            return yield* stuck(on.run, { id: on.attemptId }, before === undefined ? asked : { ...asked, tried: ['handed_on'] })
          const step = on.step === 'publish' ? undefined : on.step
          const said = noReportWords({
            from: yield* limits.named(agentId ?? next.agentId, model),
            to: yield* limits.named(next.agentId, next.model),
            ...(step === undefined ? {} : { step }),
          })
          const handing = yield* envelope('thread.send', { threadId: on.run.threadId, noReport: on.attemptId })
          const carried = yield* Effect.exit(
            carryOn(
              on.run,
              on.attemptId,
              asked,
              { kind: 'retry', agentId: next.agentId, accountId: next.accountId },
              handing,
              next.model,
              said,
              undefined,
              'underway',
              undefined,
              'stall',
            ),
          )
          if (carried._tag === 'Failure')
            yield* stuck(
              on.run,
              { id: on.attemptId },
              { ...asked, why: 'failed_to_start', agentId: next.agentId, detail: summarize(carried.cause) || null },
            )
        })

      /** A monotonic count fences a host read against a newer instruction, even before its event is handled. */
      const externalInstructions = (threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [inputs] = yield* sql<{ total: number; queued: number }>`
            SELECT count(*) AS total, coalesce(sum(CASE WHEN u.state = 'queued' THEN 1 ELSE 0 END), 0) AS queued
            FROM user_inputs u JOIN actors a ON a.id = u.author_actor_id
            WHERE u.thread_id = ${threadId} AND a.kind = 'person'`
          return inputs ?? { total: 0, queued: 0 }
        })

      /** The person's instruction or explicit stop takes back an external wait, atomically with its fact. */
      const releaseExternalOn = (threadId: string, why: 'person' | 'lead_stopped') =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const waiting = yield* sql<{ id: string; taskId: string; projectId: ProjectId; output: string | null }>`
            SELECT a.id, r.task_id, r.project_id, a.output FROM threads t JOIN runs r ON r.task_id = t.task_id AND r.state = 'running'
            JOIN workflow_executions e ON e.run_id = r.id JOIN nodes n ON n.execution_id = e.id
            JOIN node_attempts a ON a.node_id = n.id AND a.state = 'held' AND a.hold_reason = 'external'
            WHERE t.id = ${threadId}`
              for (const one of waiting) {
                // A delayed turn-start event must not cancel a wait the lead set after reading that instruction.
                const count = externalWaitOf(one.output)?.instructionCount
                if (why === 'person' && count !== undefined && count >= (yield* externalInstructions(threadId)).total) continue
                const revision = yield* change('node_attempts', one.id, { state: 'running', holdReason: null, output: null })
                yield* fact({
                  projectId: one.projectId,
                  aggregateType: 'node_attempt',
                  aggregateId: one.id,
                  revision,
                  type: 'node_attempt.external_cancelled',
                  payload: { why },
                  actorId: instance.personId,
                })
                yield* touchCard(one.taskId)
              }
            }),
          )
        })

      /**
       * When a step's agent ends a turn without reporting, it is reminded once,
       * and then the step is handed on (`noReport`). When it goes (and no other agent
       * took the thread over), the step needs the person at once. A turn the
       * person interrupted is theirs to carry on.
       */
      const watch = (event: LiveEvent) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          // Back online, or offline: what waits for the connection looks again.
          if (event._tag === 'Connection') return yield* Queue.offer(holdsChanged, undefined)
          // A fresh reading of a plan, or a turn that went through, may have ended an account's out-of-usage state (Limits): what
          // waits for its reset looks again, and goes on if it is not out any more.
          if (event._tag === 'PlanUsage') return yield* Queue.offer(holdsChanged, undefined)
          if (event._tag === 'TurnEnded' && event.errorClass === undefined && event.state === 'completed')
            yield* Queue.offer(holdsChanged, undefined)
          // An agent that says it is trying its service again may be waiting on a dead connection, its turn never ending (Codex).
          if (
            event._tag === 'Agent' &&
            event.event._tag === 'AgentFailure' &&
            event.event.severity === 'warning' &&
            event.event.classified.failure === 'transient'
          )
            return yield* reconnecting(event.threadId, event.event.classified.message)
          if (event._tag !== 'TurnEnded' && event._tag !== 'SessionEnded') {
            // The person wrote in the thread: a lead waiting on their answer has its card closed as they send, and goes on with the turn that carries it.
            if (event._tag === 'PersonSaid') yield* answerWaiting(event.threadId, false)
            if (event._tag === 'TurnStarted' && event.byPerson === true) yield* answerWaiting(event.threadId, true, event.turnId)
            // The person's new instruction supersedes a lead's wait, before its next turn uses the step's tools.
            if (event._tag === 'PersonSaid' || (event._tag === 'TurnStarted' && event.byPerson === true))
              yield* releaseExternalOn(event.threadId, 'person')
            return
          }
          // A quick task's writes still acquire their own branch when its turn ends, even when it yielded to a wait.
          yield* firstWriteOn(event.threadId)
          // A turn can end after its task settled while it was working. It owes no further report: a reminder would race
          // settling, keep its agent alive, and prevent a waiting Local task from taking the checkout.
          // A new conversation after Done still carries on normally; only the turn already under way as it settled ends here.
          if (event._tag === 'TurnEnded') {
            const [settledTask] = yield* sql<{ id: string }>`SELECT k.id FROM threads t JOIN tasks k ON k.id = t.task_id
              JOIN turn_deliveries d ON d.id = ${event.turnId}
              WHERE t.id = ${event.threadId} AND t.kind = 'task' AND k.state IN ('done', 'abandoned')
                AND d.requested_at <= k.settled_at`
            if (settledTask !== undefined) {
              yield* leftBehind.settled(settledTask.id)
              return
            }
          }
          // A declared external wait is a valid end of turn, not a missing report or a blank answer.
          const [watching] = yield* sql<{ id: string }>`
            SELECT a.id FROM threads t JOIN runs r ON r.task_id = t.task_id AND r.state = 'running'
            JOIN workflow_executions e ON e.run_id = r.id JOIN nodes n ON n.execution_id = e.id
            JOIN node_attempts a ON a.node_id = n.id AND a.state = 'held' AND a.hold_reason = 'external'
            WHERE t.id = ${event.threadId} LIMIT 1`
          if (watching !== undefined) {
            if (
              (event._tag === 'SessionEnded' && event.state === 'completed') ||
              (event._tag === 'TurnEnded' && event.state === 'interrupted')
            )
              yield* releaseExternalOn(event.threadId, 'lead_stopped')
            else return
          }
          // A lead whose last message only points back at what folded says it again first: its next turn is what's read.
          if (
            event._tag === 'TurnEnded' &&
            event.state === 'completed' &&
            event.errorClass === undefined &&
            (event.stopReason === undefined || event.stopReason === 'end_turn') &&
            (yield* restate(event))
          )
            return
          const on = yield* stepOn(event.threadId)
          // A turn the person interrupted is theirs to carry on; a round of work it left with nothing new goes back where it was.
          if (event._tag === 'TurnEnded' && event.state === 'interrupted') {
            // Another agent is taking the thread over: its own session ending says so, and the step carries on there.
            const [ended] = yield* sql<{ sessionId: string | null }>`
              SELECT provider_session_id AS sessionId FROM turn_deliveries WHERE id = ${event.turnId}`
            const [newer] = yield* sql<{ id: string }>`
              SELECT id FROM provider_sessions WHERE thread_id = ${event.threadId} ORDER BY started_at DESC, rowid DESC LIMIT 1`
            if (ended?.sessionId != null && newer !== undefined && newer.id !== ended.sessionId) return
            // A person's message waiting in the queue interrupts the turn only to carry on: the review reads it next.
            const [waiting] = yield* sql<{ id: string }>`
              SELECT id FROM user_inputs WHERE thread_id = ${event.threadId} AND state = 'queued' LIMIT 1`
            if (on !== undefined && on.step === 'review') {
              if (waiting !== undefined) return
              yield* addItem({ projectId: on.run.projectId, threadId: on.run.threadId }, 'notice', {
                source: 'runtime',
                severity: 'info',
                title: 'The review stopped: you interrupted it. It waits for you to start it again.',
              })
              yield* stuck(
                on.run,
                { id: on.attemptId },
                {
                  step: 'review',
                  why: 'session_ended',
                  detail: 'You interrupted it.',
                  agentId: null,
                  round: on.iteration,
                  open: 0,
                },
              )
              return
            }
            if (on !== undefined) yield* quietly(on.run, { id: on.attemptId, nodeId: on.nodeId, nodeKey: on.nodeKey, input: on.input })
            return
          }
          if (event._tag === 'TurnEnded' && event.errorClass === 'usage_limit') {
            // Only the live session's turn speaks for the thread; one another agent took over from is history.
            const [turn] = yield* sql<{ sessionId: string | null; agentId: string; accountId: string | null }>`
              SELECT t.provider_session_id AS session_id, s.agent_id, s.account_id FROM turn_deliveries t
              JOIN provider_sessions s ON s.id = t.provider_session_id WHERE t.id = ${event.turnId}`
            const live = yield* sessions.running(event.threadId)
            if (turn === undefined || Option.isNone(live) || live.value.sessionId !== turn.sessionId) return
            return yield* on === undefined
              ? outOfUsageElsewhere(event.threadId, turn.agentId, turn.accountId)
              : outOfUsage(on, turn.agentId, turn.accountId)
          }
          if (on === undefined) {
            // After its plan, a turn that did nothing at all is told to carry on too, as a step's is (a task is a conversation plus parts).
            const toldAgain =
              event._tag === 'TurnEnded' && event.state === 'completed' && event.errorClass === undefined
                ? yield* blankTalk(event.threadId, event.turnId)
                : false
            // A settled task's lead, written to, stops once its turn ends, as it did when it settled: what it said stays, and the
            // person's next words start it again. Not one about to be told to carry on: the turn that follows stops it, or, moved on
            // meanwhile, whatever turn or run came instead.
            if (event._tag === 'TurnEnded' && !toldAgain) yield* settledAgain(event.threadId)
            return
          }
          // Its connection or its service failed (ADR-060): not a missing report, so it isn't reminded. It waits, and is tried again.
          if (event._tag === 'TurnEnded' && event.errorClass === 'transient') {
            const [turn] = yield* sql<{ sessionId: string | null; agentId: string; accountId: string | null }>`
              SELECT t.provider_session_id AS session_id, s.agent_id, s.account_id FROM turn_deliveries t
              JOIN provider_sessions s ON s.id = t.provider_session_id WHERE t.id = ${event.turnId}`
            const live = yield* sessions.running(event.threadId)
            if (turn === undefined || Option.isNone(live) || live.value.sessionId !== turn.sessionId) return
            return yield* unavailable(on, turn.agentId, turn.accountId, event.failure ?? null)
          }
          const [agent] = yield* sql<{ agentId: string }>`
            SELECT agent_id FROM provider_sessions WHERE thread_id = ${event.threadId} ORDER BY started_at DESC LIMIT 1`
          const info = (why: StuckWhy, detail: string | null): StuckInfo => ({
            step: on.step,
            why,
            detail,
            agentId: agent?.agentId ?? null,
            round: on.iteration,
            open: 0,
          })
          if (event._tag === 'SessionEnded') {
            // Another agent took the thread over: the step carries on there, and the thread says the review didn't vanish.
            if (event.state === 'superseded') {
              if (on.step === 'review')
                yield* addItem({ projectId: on.run.projectId, threadId: on.run.threadId }, 'notice', {
                  source: 'runtime',
                  severity: 'info',
                  title: 'The review stopped: another agent took it over. It starts again there.',
                })
              return
            }
            if (Option.isSome(yield* sessions.running(event.threadId))) return
            // It went while it asked the person something: their answer starts it again, so the question is the call.
            if (yield* asking(event.threadId)) return
            // A round that made nothing new ends with its lead (ADR-034).
            if (yield* quietly(on.run, { id: on.attemptId, nodeId: on.nodeId, nodeKey: on.nodeKey, input: on.input })) return
            // Gone on its own, it is started again once, as after a restart (DEV-173); gone again soon after, it needs the person.
            const key = `${on.run.runId}:${on.nodeKey}:${on.iteration}`
            if (event.state === 'lost' && !(yield* soonAgain(on.run, '$.startedAgain', key))) return yield* startAgain(on, key, info)
            return yield* stuck(on.run, { id: on.attemptId }, info('session_ended', null))
          }
          // A turn of a session another agent has taken over from is that session's last, not the step's.
          const [turn] = yield* sql<{ sessionId: string | null }>`
            SELECT provider_session_id AS session_id FROM turn_deliveries WHERE id = ${event.turnId}`
          const live = yield* sessions.running(event.threadId)
          if (Option.isSome(live) && turn?.sessionId != null && live.value.sessionId !== turn.sessionId) return
          // More input waits on the thread, so another turn comes, which may yet report; or one came already, or the step reported.
          // A helper of its lead's at work is another turn to come too (ADR-087): its result starts one.
          const [queued] = yield* sql<{ id: string }>`
            SELECT id FROM user_inputs WHERE thread_id = ${event.threadId} AND state = 'queued'
            UNION ALL
            SELECT h.id FROM helpers h JOIN threads t ON t.task_id = h.task_id AND t.id = ${event.threadId} AND t.kind = 'task'
            WHERE h.state = 'working'
            LIMIT 1`
          if (queued !== undefined || (yield* pastTurn(event.threadId, event.turnId, on.attemptId))) return
          const inARow = event.state === 'completed' && event.errorClass === undefined ? yield* blanks(event.threadId, event.turnId) : 0
          if (inARow > 0) return yield* blankTurn(event.threadId, event.turnId, on, inARow, info)
          // A round whose lead made nothing new, as for a question answered, ends there: the task is back where it was (ADR-034).
          if (yield* quietly(on.run, { id: on.attemptId, nodeId: on.nodeId, nodeKey: on.nodeKey, input: on.input }, event.turnId)) return
          // Seeing what the round made took a while: the step may have reported meanwhile, or the lead's next turn begun.
          if (yield* pastTurn(event.threadId, event.turnId, on.attemptId)) return
          // A turn that went through after its service failed starts the count of its failures again (ADR-060).
          const { tries: _tries, ...output } = JSON.parse(on.output ?? '{}') as { reminded?: boolean; continued?: number; tries?: number }
          // Signed out, or refused, it won't go on however it's reminded.
          if (event.errorClass === 'auth_required') {
            // On an agent that reaches several providers, it is one provider's sign-in that was refused: the turn's model says which.
            const [signedOutTurn] = yield* sql<{ model: string | null }>`SELECT model FROM turn_deliveries WHERE id = ${event.turnId}`
            const model = signedOutTurn?.model ?? null
            const providers = agentsHere.list.find((entry) => entry.definition.id === agent?.agentId)?.definition.signIn.providers
            const provider = model === null ? undefined : providers?.of(model)
            return yield* stuck(
              on.run,
              { id: on.attemptId },
              {
                ...info('signed_out', event.failure ?? null),
                ...(model === null || provider === undefined ? {} : { model, provider }),
              },
            )
          }
          if (event.stopReason === 'refusal') return yield* stuck(on.run, { id: on.attemptId }, info('refused', null))
          // Cut off by the agent's own limit on a turn, it carries on where it was, a few times, before it is reminded.
          const continued = output.continued ?? 0
          if (
            (event.stopReason === 'max_tokens' || event.stopReason === 'max_turn_requests') &&
            event.errorClass === undefined &&
            continued < CONTINUES
          ) {
            yield* change('node_attempts', on.attemptId, { output: JSON.stringify({ ...output, continued: continued + 1 }) })
            return yield* sessions
              .send({
                envelope: yield* envelope('thread.send', { threadId: event.threadId, continued: on.attemptId }),
                threadId: event.threadId,
                body: CONTINUING,
                quiet: true,
              })
              .pipe(
                Effect.asVoid,
                Effect.catchCause((cause) => stuck(on.run, { id: on.attemptId }, info('no_report', summarize(cause) || null))),
              )
          }
          // An aside answered in its turn: no report is asked of it, nor any reminder to give one.
          if (event.state === 'completed' && event.errorClass === undefined && (yield* asideAnswered(on, event.turnId))) return
          // Reminded already, it ended again without its report: the step goes to another model, or needs the person.
          if (output.reminded === true) return yield* noReport(on, event.turnId, output, info, event.errorClass ?? null)
          yield* change('node_attempts', on.attemptId, { output: JSON.stringify({ ...output, reminded: true }) })
          yield* sessions
            .send({
              envelope: yield* envelope('thread.send', { threadId: event.threadId, reminder: on.attemptId }),
              threadId: event.threadId,
              body:
                on.step === 'review'
                  ? reminders.reviewer
                  : on.run.planId === null && on.step === 'implement'
                    ? reminders.round
                    : reminders.lead,
              quiet: true,
            })
            .pipe(Effect.catchCause((cause) => stuck(on.run, { id: on.attemptId }, info('no_report', summarize(cause) || null))))
        })

      /**
       * Starts, or carries on, a round of review, on the plan's reviewer or
       * another the person picked. The reviewer's thread spans the rounds. A
       * reviewer that can't start leaves the step needing the person. The
       * round asks for a place among the agents at work on this machine first,
       * and without one waits for it: after the lead's step, the lead's place is
       * the reviewer's, unless what the lead left running still runs; resumed by
       * the person (`resumed`, their lead), it asks as any other.
       */
      const review = (
        run: RunRow,
        round: number,
        settled?: string,
        reviewer?: string,
        model?: string | null,
        accountId?: string,
        resumed?: Lead,
        /** Where a review carried on stands: the person's, unless Althar carries it on, as for a usage limit (ADR-037). */
        order: Order = 'person',
        /** How hard the reviewer picked thinks; without it, the model's own, unless the plan's reviewer stays on its own model. */
        effort?: string | null,
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const { review: planned } = yield* stepsOf(run)
          if (planned === undefined) return yield* conclude(run)
          // The plan's reviewer, unless it is out of usage and the project moves on.
          const instead = reviewer === undefined ? yield* insteadOf(run, planned) : undefined
          const step =
            instead !== undefined
              ? { ...planned, agentId: instead.agentId, model: instead.model }
              : reviewer === undefined || reviewer === planned.agentId
                ? model == null
                  ? effort == null
                    ? planned
                    : { ...planned, effort }
                  : // The plan's effort is for the plan's model: another model starts on the effort picked, or its own.
                    { ...planned, model, effort: effort ?? (model === planned.model ? planned.effort : null) }
                : // The plan's effort is for the plan's reviewer: another agent starts on the effort picked, or its own.
                  { ...planned, agentId: reviewer, model: model ?? null, effort: effort ?? null }
          const admitted = yield* unlessStopped(
            busy.enter(
              run.taskId,
              (room) =>
                sql.withTransaction(
                  Effect.gen(function* () {
                    const admission = yield* admit(run, 'review', round, step)
                    if (!room)
                      yield* waitForPlace(
                        run,
                        admission.attemptId,
                        resumed === undefined ? { how: 'next', reviewer: step } : { how: 'resume', lead: resumed, reviewer: step },
                      )
                    return { ...admission, room }
                  }),
                ),
              // After the lead's step, in its place; as the person resumed or answered, at once.
              { review: true, ...(resumed === undefined ? { after: 'lead' as const } : { order }) },
            ),
          )
          if (admitted === undefined) return undefined
          const { nodeId, attemptId } = admitted
          if (!admitted.room) yield* touchCard(run.taskId)
          else {
            // The plan's reviewer nearly out, where the project waits or asks: held or asked before it starts.
            const held = reviewer === undefined && instead === undefined && (yield* heldLow(run, 'review', attemptId, round, planned))
            if (!held) yield* reviewOn(run, round, settled, step, attemptId, accountId ?? instead?.accountId)
          }
          return { nodeId, attemptId }
        })

      /** A round of review admitted, under way on its reviewer; one that can't start needs the person. */
      const reviewOn = (run: RunRow, round: number, settled: string | undefined, step: PlanStep, attemptId: string, accountId?: string) =>
        Effect.gen(function* () {
          // Nothing of the task's own on its branch: no review runs, and its thread says so rather than the line vanishing.
          if (yield* changes.nothingBuilt(run.taskId).pipe(Effect.orElseSucceed(() => false))) {
            const sql = yield* SqlClient.SqlClient
            const [attempt] = yield* sql<{ nodeId: string }>`SELECT node_id AS nodeId FROM node_attempts WHERE id = ${attemptId}`
            const at = yield* timestamp
            yield* change('node_attempts', attemptId, {
              state: 'cancelled',
              output: JSON.stringify({ nothingBuilt: true }),
              endedAt: at,
            })
            if (attempt !== undefined) yield* change('nodes', attempt.nodeId, { state: 'cancelled' })
            yield* addItem({ projectId: run.projectId, threadId: run.threadId }, 'notice', {
              source: 'runtime',
              severity: 'info',
              title: 'The review didn’t run: the branch has nothing built yet.',
            })
            return yield* finish(run, 'succeeded')
          }
          const begun = yield* Effect.exit(reviewRound(run, round, settled, step, attemptId, accountId))
          if (begun._tag === 'Failure')
            yield* stuck(
              run,
              { id: attemptId },
              {
                step: 'review',
                why: 'failed_to_start',
                detail: summarize(begun.cause) || null,
                agentId: step.agentId,
                round,
                open: 0,
              },
            )
        })

      /** What the lead settled last, for a round of review after the first to read. */
      const settledBefore = (run: RunRow) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [last] = yield* sql<{ summary: string }>`
            SELECT json_extract(content, '$.summary') AS summary FROM thread_items
            WHERE thread_id = ${run.threadId} AND kind = 'step_result' AND json_extract(content, '$.step') = 'settle'
            ORDER BY sequence DESC LIMIT 1`
          return last?.summary
        })

      /** What a reviewer is told of a round of work after the plan: what the lead did, and how to see what changed since it started. */
      const moreToReview = (run: RunRow, start: RoundStart) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [lead] = yield* sql<{ summary: string | null }>`
            SELECT json_extract(content, '$.summary') AS summary FROM thread_items WHERE thread_id = ${run.threadId} AND kind = 'step_result'
              AND json_extract(content, '$.step') = 'implement' ORDER BY sequence DESC LIMIT 1`
          const worktrees = yield* worktreesOf(run.taskId)
          const from = worktrees.flatMap((worktree) => {
            const head = start.heads[worktree.path]
            return head === undefined || head === '' ? [] : [{ name: worktree.name, head: head.slice(0, 12) }]
          })
          const how =
            from.length === 1
              ? `with \`git diff ${from[0]?.head ?? ''}\` in your copy`
              : from.map((one) => `\n- ${one.name}: \`git diff ${one.head}\``).join('')
          return `More to review. The task's earlier work was reviewed before; since then the person asked the lead for more, and it did it:\n\n${lead?.summary ?? ''}\n\nReview what changed since, ${how}. Look at the earlier work only where the new work touches it.`
        })
      const {
        acceptShipWork,
        asideAnswered,
        backWhereItWas,
        digestAll,
        fromItsStart,
        madeSince,
        mergeWaiting,
        openRound,
        parametersNow,
        quietly,
        restedOf,
        ship,
        shipEnding,
        shipHeads,
        shipToReview,
        startOf,
        tinyFixOf,
        worktreesOf,
      } = makeRunShipping({
        admit,
        asking,
        atWork,
        begin,
        changes,
        conclude,
        currentRun,
        ended,
        ends,
        externalEvery,
        going,
        instance,
        keeps,
        leftBehind,
        mergeReviews,
        mergeWakes,
        openedOf,
        pastTurn,
        policyOf,
        provide,
        publishedSummary,
        publishForStep,
        rest,
        RESTED,
        result,
        review,
        scope,
        sessions,
        stepsOf,
        stuck,
        unstuck,
      })

      /** Where a round started, as its Implement step keeps it; undefined for a run of a plan. */
      const roundStartOf = (run: RunRow) =>
        Effect.gen(function* () {
          if (run.planId !== null) return undefined
          const sql = yield* SqlClient.SqlClient
          const [first] = yield* sql<{ input: string }>`
            SELECT a.input FROM node_attempts a JOIN nodes n ON n.id = a.node_id
            WHERE n.execution_id = ${run.executionId} AND n.node_key = 'implement' ORDER BY a.admitted_at, a.rowid LIMIT 1`
          return roundOf(first?.input)
        })

      /** A round of review's copy, thread and session: its reviewer reads the work as it stands, on the account picked, where one was. */
      const reviewRound = (
        run: RunRow,
        round: number,
        settled: string | undefined,
        step: PlanStep,
        attemptId: string,
        accountId?: string,
      ) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          // A change's own Ship reads only its admitted workspaces; ones added later wait for the next Ship.
          const ships = (yield* parametersNow(run)).ships
          const only = ships?.heads === undefined ? ships?.only : Object.keys(ships.heads)
          const read = (yield* worktreesOf(run.taskId)).filter((one) => only === undefined || only.includes(one.id))
          // A check after the first round reads only the fixes: from what the round before read, in the first repository.
          const [first] = read
          const [before] =
            round === 0 || first === undefined
              ? []
              : yield* sql<{ commitSha: string | null }>`
                  SELECT s.commit_sha FROM workspace_snapshots s JOIN node_attempts a ON a.id = s.node_attempt_id
                  JOIN nodes n ON n.id = a.node_id
                  WHERE n.execution_id = ${run.executionId} AND n.node_key = 'review' AND s.workspace_id = ${first.id}
                  ORDER BY s.taken_at DESC, s.rowid DESC LIMIT 1`
          const reread = before?.commitSha ?? null
          // The round reads a copy of the work as it stands now, in each repository, and the record keeps which code that was (ADR-008).
          const snapshots: Record<string, string> = {}
          for (const workspace of read) {
            const snapshot = yield* snapshotForReview(workspace.path, round)
            snapshots[workspace.id] = snapshot.commit
            yield* sql`INSERT INTO workspace_snapshots ${sql.insert({
              id: yield* newId(Ids.workspaceSnapshot),
              projectId: run.projectId,
              workspaceId: workspace.id,
              nodeAttemptId: attemptId,
              commitSha: snapshot.commit,
              treeSha: snapshot.tree,
              reason: 'node_started',
              takenAt: yield* timestamp,
            })}`
          }
          if (ships !== undefined)
            yield* sql`UPDATE runs SET parameters = json_set(parameters, '$.ships.snapshots', json(${JSON.stringify(snapshots)})), revision = revision + 1 WHERE id = ${run.runId}`
          const [thread] = yield* sql<{ id: string }>`
            SELECT id FROM threads WHERE task_id = ${run.taskId} AND kind = 'step' AND node_key = 'review'`
          const threadId = thread?.id ?? (yield* newId(Ids.thread))
          if (thread === undefined)
            yield* sql`INSERT INTO threads ${sql.insert({
              id: threadId,
              projectId: run.projectId,
              kind: 'step',
              taskId: run.taskId,
              executionId: run.executionId,
              nodeKey: 'review',
              createdAt: yield* timestamp,
            })}`
          // Handed to another agent, the round starts that one afresh; one being stopped isn't carried on with.
          const running = Option.filter(yield* sessions.running(threadId), (session) => !session.stopping)
          // Handed to another agent or account, or its account out of usage, the round starts afresh, on another account where it is.
          const spent = Option.isSome(running) && Option.isSome(yield* limits.outAccount(running.value.accountId))
          const elsewhere = (session: { readonly agentId: string; readonly accountId: string }) =>
            session.agentId !== step.agentId || (accountId !== undefined && session.accountId !== accountId)
          if (Option.isSome(running) && (spent || elsewhere(running.value))) yield* Effect.ignore(sessions.stop(threadId))
          const onIt = Option.filter(running, (session) => !spent && !elsewhere(session))
          // A new round, as any new step: its account nearly out for the model, it starts afresh on another of the agent's with room.
          const roomier = Option.isSome(onIt)
            ? yield* roomierAccount(run, 'review', onIt.value, step.model ?? (yield* modelOf(onIt.value.sessionId)), threadId)
            : Option.none<{ accountId: string; said: string }>()
          if (Option.isSome(roomier)) {
            yield* Effect.ignore(sessions.stop(threadId))
            yield* sayOut(run.threadId, run.projectId, roomier.value.said)
          }
          // Kept for another round, the reviewer is on the model its step names; one that won't move starts afresh.
          const kept = Option.isSome(onIt) && Option.isNone(roomier) && (yield* onModel(threadId, onIt.value.sessionId, step.model))
          if (Option.isSome(onIt) && Option.isNone(roomier) && !kept) yield* Effect.ignore(sessions.stop(threadId))
          const live = kept ? onIt : Option.none()
          const on = accountId ?? Option.getOrUndefined(Option.map(roomier, (moved) => moved.accountId))
          const sessionId = Option.isSome(live)
            ? live.value.sessionId
            : yield* sessions.start({
                threadId,
                agentId: step.agentId,
                ...(step.model === null ? {} : { model: step.model }),
                ...(step.effort == null ? {} : { effort: step.effort }),
                ...(on === undefined ? {} : { accountId: on }),
              })
          // A reviewer carrying on has the brief it started with: the lead's evidence as it stands now, written out again, goes with the round.
          const shown =
            Option.isSome(live) && first !== undefined
              ? yield* evidenceForReview(run.threadId, evidenceFolderOf(reviewCopyOf(first.path))).pipe(Effect.orElseSucceed(() => ''))
              : ''
          // A round of work after the plan is reviewed for what it changed since it started (ADR-034); the round a quick task was
          // made a change in, for all of it, as nothing of it was reviewed before.
          const ending = yield* stepsOf(run)
          const since = round === 0 && !ending.publishes && ending.ships === undefined ? yield* roundStartOf(run) : undefined
          // A Ship's review reads what came after the last review: one pass over every tweak since.
          if (round === 0 && ending.ships !== undefined)
            yield* sessions.send({
              envelope: yield* envelope('thread.send', { threadId, round, ships: run.runId }),
              threadId,
              body: yield* shipToReview(run, ending.ships.from),
              quiet: true,
            })
          else if (since !== undefined)
            yield* sessions.send({
              envelope: yield* envelope('thread.send', { threadId, round, since: run.runId }),
              threadId,
              body: yield* moreToReview(run, since.start),
              quiet: true,
            })
          else if (Option.isSome(live) || round > 0)
            yield* sessions.send({
              envelope: yield* envelope('thread.send', { threadId, round }),
              threadId,
              body: `A check of the fixes, not another review. The lead settled your findings:\n\n${settled ?? ''}\n\nYour copy now holds the settled work${reread === null ? '' : `; what the fixes changed is \`git diff ${reread.slice(0, 12)}\` in it`}. Read only the fixes, against your findings, and say whether each is settled: pass where they all are. Reopen only a finding a fix didn't settle, saying which and why, and don't raise again what the lead set aside unless you have new evidence. Don't review the rest of the change again.${shown === '' ? '' : `\n\nAs it stands now, in place of what you were told before:\n\n${shown}`}`,
              quiet: true,
            })
          yield* begin(run, attemptId, sessionId, threadId)
          yield* sessions.wake(threadId)
          yield* touchCard(run.taskId)
        })

      /**
       * The lead settles what the review found, in its own session, once it
       * has a place among the agents at work on this machine: the reviewer's,
       * unless what the reviewer left running still runs. Without one, it waits
       * for one, and is then told what is still open.
       */
      const settle = (run: RunRow, round: number, findings: ReadonlyArray<Finding & { readonly id: string }>) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const before = yield* digestAll(run.taskId)
          const { implement } = yield* stepsOf(run)
          const admitted = yield* unlessStopped(
            busy.enter(
              run.taskId,
              (room) =>
                sql.withTransaction(
                  Effect.gen(function* () {
                    const admission = yield* admit(run, 'settle', round, implement ?? {}, { before })
                    if (!room) yield* waitForPlace(run, admission.attemptId, { how: 'next' })
                    return { ...admission, room }
                  }),
                ),
              { after: 'review' },
            ),
          )
          if (admitted === undefined) return
          if (!admitted.room) return yield* touchCard(run.taskId)
          yield* settleOn(run, round, admitted.attemptId, findings)
        })

      /** The lead told what to settle, on the settle step admitted for it; one that can't start needs the person. */
      const settleOn = (run: RunRow, round: number, attemptId: string, findings: ReadonlyArray<Finding & { readonly id: string }>) =>
        Effect.gen(function* () {
          const { implement } = yield* stepsOf(run)
          const begun = yield* Effect.exit(
            Effect.gen(function* () {
              // Nearly out, the lead goes on elsewhere, or the fixes wait or ask, as the project says.
              const steered = yield* steerSettle(run, round, attemptId)
              if (steered === 'held') return
              const sessionId = yield* steered === undefined
                ? leadOn(run)
                : leadOn(run, steered.agentId, steered.model, steered.said, steered.effort, steered.accountId)
              yield* sessions.send({
                envelope: yield* envelope('thread.send', { threadId: run.threadId, round, settle: true }),
                threadId: run.threadId,
                body: settling(findings),
                quiet: true,
              })
              yield* begin(run, attemptId, sessionId, run.threadId)
            }),
          )
          if (begun._tag === 'Failure')
            yield* stuck(
              run,
              { id: attemptId },
              {
                step: 'settle',
                why: 'failed_to_start',
                detail: summarize(begun.cause) || null,
                agentId: implement?.agentId ?? null,
                round,
                open: findings.length,
              },
            )
          yield* touchCard(run.taskId)
        })

      /** What the lead is told to settle a review's findings. */
      const settling = (findings: ReadonlyArray<Finding & { readonly id: string }>) =>
        `The review found:\n\n${findingsText(findings)}\n\nSettle each: fix what holds, and set aside what doesn't, with a reason. Then call finish_step with a summary, and in \`findings\` what became of each, by its id: fixed, with what changed in a line of plain words and the commit that fixed it, or set_aside, with why in a line. The pull request lists both. If settling changes the work, say again in \`built\` what the task has built, as it now stands, and, where it changes what the pull request's description says, give that again in \`descriptions\`.`

      /** The model a session is on, where it says. */
      const modelOf = (sessionId: string) =>
        Effect.map(
          Effect.flatMap(
            SqlClient.SqlClient,
            (sql) => sql<{ model: string | null }>`SELECT model FROM provider_sessions WHERE id = ${sessionId}`,
          ),
          ([on]) => on?.model ?? null,
        )

      /**
       * Whether a session kept for a step is on the model the step asks for,
       * put there where it was on another of its agent's. One the agent won't
       * move isn't kept: the step starts afresh on its model instead.
       */
      const onModel = (threadId: string, sessionId: string, model: string | null | undefined) =>
        Effect.gen(function* () {
          if (model == null) return true
          const sql = yield* SqlClient.SqlClient
          const [on] = yield* sql<{ model: string | null }>`SELECT model FROM provider_sessions WHERE id = ${sessionId}`
          if (on?.model === model) return true
          const moved = yield* sessions.setModel({ threadId, model }).pipe(
            Effect.as(true),
            Effect.catchCause((cause) =>
              Effect.as(Effect.logWarning('A kept session wouldn’t move to its step’s model; starting afresh', cause), false),
            ),
          )
          if (!moved) return false
          // Moved, it is on what the agent says it took, which may not be what was asked for.
          const [now] = yield* sql<{ model: string | null }>`SELECT model FROM provider_sessions WHERE id = ${sessionId}`
          return now?.model === model
        })

      /** The lead's session: the one running, or the plan's lead (or another the person picked, on the account they picked) started. */
      const leadOn = (
        run: RunRow,
        agentId?: string,
        model?: string | null,
        said?: string,
        effort?: string | null,
        accountId?: string,
        /** What the thread's line says Althar dealt with: a usage limit, or a step gone quiet or without its report. */
        about: 'limit' | 'stall' = 'limit',
        /** The step attempt handed on, where one is: a stand-in for a step without its report leads until it is over. */
        attemptId?: string | null,
      ) =>
        Effect.gen(function* () {
          const { implement } = yield* stepsOf(run)
          const wanted = agentId ?? implement?.agentId ?? 'claude-code'
          // One being stopped isn't carried on with: a new one starts once it has gone.
          const live = Option.filter(yield* sessions.running(run.threadId), (session) => !session.stopping)
          // One on an account that is out of usage hands over, to the same agent's next account where it has one (ADR-012).
          const spent = Option.isSome(live) && Option.isSome(yield* limits.outAccount(live.value.accountId))
          // Auto weighs a lead kept on its step's model too, not only one starting afresh: the plan's usage may cross over while it runs.
          const planModel = agentId === undefined && implement !== undefined ? (implement.model ?? null) : null
          const moved =
            planModel !== null && Option.isSome(live) && !spent && (yield* modelOf(live.value.sessionId)) === planModel
              ? yield* lighterModel(run, live.value.agentId, planModel)
              : undefined
          const nextAccountId = accountId ?? moved?.accountId
          const nextModel = moved?.model ?? model
          if (
            Option.isSome(live) &&
            !spent &&
            (agentId === undefined || live.value.agentId === agentId) &&
            (nextAccountId === undefined || live.value.accountId === nextAccountId)
          ) {
            // Kept, it moves to a model asked for now, or the lighter one Auto picked; the plan's, or one the person set on it since, stays.
            // One that won't move starts afresh.
            const wantedModel = moved?.model ?? model
            if (yield* onModel(run.threadId, live.value.sessionId, wantedModel)) return live.value.sessionId
            yield* Effect.ignore(sessions.stop(run.threadId))
            return yield* sessions.start({
              threadId: run.threadId,
              agentId: live.value.agentId,
              ...(wantedModel == null ? {} : { model: wantedModel }),
            })
          }
          if (Option.isSome(live)) {
            // Moving the same model to another account also keeps the person's effort choice.
            const sql = yield* SqlClient.SqlClient
            const [current] =
              moved?.accountId !== undefined && effort == null
                ? yield* sql<{ effort: string | null }>`SELECT effort FROM provider_sessions WHERE id = ${live.value.sessionId}`
                : []
            const nextEffort = effort ?? current?.effort
            return yield* sessions.switchAgent({
              threadId: run.threadId,
              agentId: wanted,
              ...(nextModel == null ? {} : { model: nextModel }),
              ...(nextEffort == null ? {} : { effort: nextEffort }),
              ...(said === undefined ? {} : { said, about }),
              ...(said === undefined || attemptId == null ? {} : { attemptId }),
              ...(nextAccountId === undefined ? {} : { accountId: nextAccountId }),
            })
          }
          // The plan's lead, unless it is out of usage and the project moves on: the next free agent instead.
          const instead = agentId === undefined && implement !== undefined ? yield* insteadOf(run, implement) : undefined
          // The plan's model and effort are for the plan's lead; another starts on the model chosen for it, or its own.
          const planned = agentId === undefined && instead === undefined
          const chosen = instead?.model ?? (planned ? (implement?.model ?? null) : (model ?? null))
          const thinks = planned ? (implement?.effort ?? null) : (effort ?? null)
          const chosenAccount = accountId ?? instead?.accountId
          // Nearly out, the lead's next step moves to a lighter model of its agent, and the thread says why (README 7).
          const auto = planned ? yield* lighterModel(run, wanted, chosen) : undefined
          const startingAccountId = chosenAccount ?? auto?.accountId
          if (said !== undefined) {
            // A handover to another agent or model than the thread's last is always said; the same on another account, quietly.
            const [last] = yield* (yield* SqlClient.SqlClient)<{ agentId: string; model: string | null }>`
              SELECT agent_id, model FROM provider_sessions WHERE thread_id = ${run.threadId} ORDER BY started_at DESC, rowid DESC LIMIT 1`
            const starting = { agentId: instead?.agentId ?? auto?.agentId ?? wanted, model: auto?.model ?? chosen }
            const handover =
              last === undefined || last.agentId !== starting.agentId || (starting.model !== null && starting.model !== last.model)
            yield* sayOut(run.threadId, run.projectId, said, about, handover)
          }
          // Another agent for the plan's lead, out or nearly out as it starts, only stands in for it: the plan's lead takes the
          // task back once it has usage again (standIn.ts), as one handed on while it runs does.
          const standsIn = instead === undefined || implement === undefined ? undefined : yield* standInForPlan(run, implement)
          return yield* sessions.start({
            threadId: run.threadId,
            agentId: instead?.agentId ?? auto?.agentId ?? wanted,
            ...((auto?.model ?? chosen) === null ? {} : { model: (auto?.model ?? chosen) as string }),
            ...(thinks === null ? {} : { effort: thinks }),
            ...(startingAccountId === undefined ? {} : { accountId: startingAccountId }),
            ...(standsIn === undefined ? {} : { standsIn }),
          })
        })

      /**
       * Who another agent stands in for where the plan's lead is out, or nearly out, as its step starts: the plan's lead, on its
       * model and effort, until its account's reset.
       */
      const standInForPlan = (run: RunRow, planned: PlanStep) =>
        Effect.gen(function* () {
          const out = yield* limits.out(planned.agentId, run.projectId)
          if (Option.isSome(out))
            return {
              agentId: planned.agentId,
              model: planned.model ?? null,
              effort: planned.effort ?? null,
              accountId: out.value.accountId,
              until: out.value.until,
            } satisfies StandIn
          const low = yield* limits.nearlyOut(planned.agentId, run.projectId, planned.model ?? undefined)
          if (Option.isNone(low)) return undefined
          const until =
            low.value.resetsAt ?? new Date((yield* Clock.currentTimeMillis) + Duration.toMillis(Duration.hours(1))).toISOString()
          return {
            agentId: planned.agentId,
            model: planned.model ?? null,
            effort: planned.effort ?? null,
            accountId: low.value.accountId,
            until,
            why: 'low',
          } satisfies StandIn
        })
      const {
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
      } = makeRunCapacity({
        agentsHere,
        autoModels,
        get carryOn(): RunCapacityDependencies['carryOn'] {
          return carryOn
        },
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
      })
      const { answerCheckout, checkoutWakes, checkoutsEvery, lookAtCheckouts, moving, placeFirst, workToward, worksInOf } =
        yield* makeRunCheckouts({ busy, changes, currentRun, instance, notYetStopped, sessions, stepsOf, stuck, waitForPlace })

      yield* Effect.forkScoped(
        provide(
          keptGoing(
            'Runs.checkouts',
            // With no task Local here, nothing to look at until one is.
            Effect.forever(
              Effect.flatMap(lookAtCheckouts, (waits) =>
                waits ? Effect.raceFirst(Queue.take(checkoutWakes), Effect.sleep(checkoutsEvery)) : Queue.take(checkoutWakes),
              ),
            ),
          ),
        ),
      )

      const run = (planId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [plan] = yield* sql<{ projectId: ProjectId; taskId: string; state: string; parameters: string; workflowVersionId: string }>`
            SELECT project_id, task_id, state, parameters, workflow_version_id FROM task_plans WHERE id = ${planId}`
          if (plan === undefined) return null
          const [already] = yield* sql<{ id: string }>`SELECT id FROM runs WHERE plan_id = ${planId}`
          if (already !== undefined) return null
          const parameters = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PlanParameters))(plan.parameters)
          const implement = parameters.steps.find((step) => step.key === 'implement')
          if (implement === undefined) return null
          const runId = yield* newId(Ids.run)
          const runAttemptId = yield* newId(Ids.runAttempt)
          const executionId = yield* newId(Ids.workflowExecution)
          yield* sql.withTransaction(
            Effect.gen(function* () {
              // Checked where the run is written: a project removed meanwhile gets no run.
              const [live] = yield* sql<{ id: string }>`SELECT id FROM projects WHERE id = ${plan.projectId} AND archived_at IS NULL`
              if (live === undefined) return yield* new NotFound({ kind: 'project', id: plan.projectId })
              const at = yield* timestamp
              const [task] = yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${plan.taskId}`
              // Abandoned as its plan was accepted, it gets no run; nor does a plan declined meanwhile.
              if (task?.state === 'abandoned' || task?.state === 'done') return
              const [still] = yield* sql<{ state: string }>`SELECT state FROM task_plans WHERE id = ${planId}`
              if (still?.state !== 'accepted') return
              if (task?.state === 'draft') {
                const revision = yield* change('tasks', plan.taskId, { state: 'open' })
                yield* fact({
                  projectId: plan.projectId,
                  aggregateType: 'task',
                  aggregateId: plan.taskId,
                  revision,
                  type: 'task.opened',
                  actorId: instance.systemId,
                })
              }
              yield* sql`INSERT INTO runs ${sql.insert({
                id: runId,
                projectId: plan.projectId,
                taskId: plan.taskId,
                planId,
                workflowVersionId: plan.workflowVersionId,
                policyId: yield* policyOf(plan.projectId),
                parameters: plan.parameters,
                state: 'running',
                createdAt: at,
              })}`
              yield* sql`INSERT INTO run_attempts ${sql.insert({
                id: runAttemptId,
                projectId: plan.projectId,
                runId,
                attemptNumber: 1,
                deviceId: instance.deviceId,
                controllerGeneration: 1,
                controllerInstanceId: instance.id,
                state: 'active',
                startedAt: at,
              })}`
              yield* sql`INSERT INTO workflow_executions ${sql.insert({
                id: executionId,
                projectId: plan.projectId,
                runId,
                workflowVersionId: plan.workflowVersionId,
                graphRevision: 1,
                state: 'running',
                createdAt: at,
              })}`
              yield* sql`INSERT INTO execution_graph_revisions ${sql.insert({
                projectId: plan.projectId,
                executionId,
                revision: 1,
                graph: JSON.stringify({ steps: parameters.steps.filter((step) => !step.skipped), review: { rounds: yield* roundsNow } }),
                cause: 'materialized',
                createdAt: at,
              })}`
              yield* fact({
                projectId: plan.projectId,
                aggregateType: 'run',
                aggregateId: runId,
                revision: 1,
                type: 'run.admitted',
                payload: { planId },
                actorId: instance.systemId,
              })
            }),
          )
          const current = yield* currentRun(plan.taskId)
          if (current === undefined) return null
          // Its first step takes a place among the agents at work on this machine, or waits for one.
          const admitted = yield* unlessStopped(
            busy.enter(plan.taskId, (room) =>
              sql.withTransaction(
                Effect.gen(function* () {
                  const admission = yield* admit(current, 'implement', 0, implement)
                  if (!room) yield* waitForPlace(current, admission.attemptId, { how: 'start' })
                  return { ...admission, room }
                }),
              ),
            ),
          )
          if (admitted === undefined) return null
          if (!admitted.room) {
            yield* touchCard(plan.taskId)
            return 'waiting' as const
          }
          // Local, held for its checkout, it waits as one with no place does (ADR-091).
          return (yield* startFirst(current, admitted.attemptId)) ? ('running' as const) : ('waiting' as const)
        })

      /**
       * A plan's first step under way: its lead, as the plan says, on it. A lead that can't start leaves Implement needing the
       * person, who can hand it to another agent. False where it is held for its checkout instead (ADR-091).
       */
      const startFirst = (current: RunRow, attemptId: string) =>
        Effect.gen(function* () {
          // Where it works first: Local, its checkouts taken, or held for them, which are looked at from now on.
          const placed = yield* placeFirst(current, attemptId)
          if (worksInOf(current) === 'checkout') yield* Queue.offer(checkoutWakes, undefined)
          if (!placed) return false
          // The plan's lead nearly out, where the project waits or asks: held or asked before it starts.
          const { implement: lead } = yield* stepsOf(current)
          if (lead !== undefined && (yield* heldLow(current, 'implement', attemptId, 0, lead))) return true
          const begun = yield* Effect.exit(leadOn(current))
          if (begun._tag === 'Failure') {
            const { implement } = yield* stepsOf(current)
            yield* stuck(
              current,
              { id: attemptId },
              {
                step: 'implement',
                why: 'failed_to_start',
                detail: summarize(begun.cause) || null,
                agentId: implement?.agentId ?? null,
                round: 0,
                open: 0,
              },
            )
            return true
          }
          yield* begin(current, attemptId, begun.value, current.threadId)
          // Its first step has started: the issue it came from moves to In Progress, as the person would move it.
          yield* issues.started(current.taskId)
          yield* touchCard(current.taskId)
          return true
        })
      yield* makeRunTools({
        acceptShipWork,
        backWhereItWas,
        changes,
        conclude,
        currentRun,
        digestAll,
        dropped,
        ended,
        externalInstructions,
        going,
        holdsChanged,
        instance,
        keeps,
        madeSince,
        mergeReviews,
        modelOf,
        openFindings,
        provide,
        rest,
        restedOf,
        result,
        review,
        running,
        settle,
        stepsOf,
        stuck,
        tinyFixOf,
        toolServer,
        unexplained,
        unstuck,
        worktreesOf,
      })
      const {
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
      } = yield* makeRunRecovery({
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
      })
      yield* Effect.forkScoped(provide(keptGoing('Runs.holds', holds)))

      // What the person says to a task's lead after its plan is a turn, not a round (a task is a conversation plus parts, "A message
      // is a turn, not a round"): no step, no report and no review. Where each worktree stood as it began is kept with it, so its end
      // can hold what it committed for Ship (Changes.ts), after a restart too. A step under way takes the message into itself, as ever.
      yield* sessions.onPersonsTurn((lead) =>
        provide(
          Effect.gen(function* () {
            const current = yield* currentRun(lead.taskId)
            if (current !== undefined) {
              yield* releaseExternalOn(lead.threadId, 'person')
              // Ship's review reads a copy: a separate person turn still owns anything it commits, even after Ship ends.
              if ((yield* stepsOf(current)).ships === undefined) return
            }
            const heads: Record<string, string> = {}
            for (const worktree of yield* worktreesOf(lead.taskId)) {
              const head = yield* commitOf(worktree.path, 'HEAD').pipe(Effect.orElseSucceed(() => null))
              if (head !== null) heads[worktree.id] = head
            }
            yield* change('turn_deliveries', lead.deliveryId, { heads: JSON.stringify(heads) })
          }),
        ).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not keep where the person’s turn began', cause))),
      )

      // Each turn a step's agent ends, and each session that goes, is checked for the report its step needs.
      const events = yield* live.subscribe
      yield* Effect.forkScoped(
        Stream.runForEach(events, (event) =>
          provide(watch(event)).pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.logWarning('Could not check a step after its turn', cause),
            ),
          ),
        ),
      )

      /** A step's agent stalled, went round in circles or ran past its budget, beyond what Althar could do: the step needs the person. */
      const stalledStep = (giveUp: GiveUp) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const on = yield* stepOn(giveUp.threadId)
          if (on === undefined) return false
          const [agent] = yield* sql<{ agentId: string }>`
            SELECT agent_id FROM provider_sessions WHERE thread_id = ${giveUp.threadId} ORDER BY started_at DESC LIMIT 1`
          yield* stuck(
            on.run,
            { id: on.attemptId },
            {
              step: on.step,
              why: giveUp.why,
              detail: giveUp.detail,
              agentId: agent?.agentId ?? null,
              round: on.iteration,
              open: 0,
              ...(giveUp.tried.length === 0 ? {} : { tried: giveUp.tried }),
            },
          )
          return true
        }).pipe(Effect.catchCause((cause) => Effect.as(Effect.logWarning('Could not ask the person about a stalled step', cause), false)))
      const stalls = yield* watchStalls((giveUp) => provide(stalledStep(giveUp)))
      freshen = (threadId) => stalls.fresh(threadId)

      /**
       * Starts a step that waited for a place, now it has one, as it would
       * have started: a plan's first on its lead; one a restart stopped as
       * after a restart; one the person resumed on the lead they gave, or its
       * reviewer; one back from a usage limit on the agent it was held for.
       */
      const startPlaced = (row: Placed, waited: Waiting) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const current = yield* currentRun(row.taskId)
          if (current === undefined) return
          // Its place taken in the store, read where it is written: stopped since it was listed, it is the person's to resume.
          // Admitted from here on, a restart carries it on as any step a restart stopped, and needs the person where it
          // stopped Althar again soon after.
          const taken = yield* sql.withTransaction(
            Effect.gen(function* () {
              const [still] = yield* sql<{ state: string; holdReason: string | null }>`
                SELECT state, hold_reason FROM node_attempts WHERE id = ${row.attemptId}`
              if (still?.state !== 'held' || still.holdReason !== 'machine_busy') return false
              const revision = yield* change('node_attempts', row.attemptId, { state: 'admitted', holdReason: null, output: null })
              // How long it waited, in milliseconds: what the first turn of the session it starts counts as waiting for a place.
              const placedAfter = Math.max(0, (yield* Clock.currentTimeMillis) - Date.parse(waited.since))
              yield* fact({
                projectId: current.projectId,
                aggregateType: 'node_attempt',
                aggregateId: row.attemptId,
                revision,
                type: 'node_attempt.admitted',
                payload: { node: row.nodeKey, iteration: row.iteration, placed: waited.place.how, waited: placedAfter },
                actorId: instance.systemId,
              })
              return true
            }),
          )
          if (!taken) return
          yield* Effect.ignore(touchCard(current.taskId))
          const { place } = waited
          switch (place.how) {
            case 'start':
              return yield* startFirst(current, row.attemptId)
            case 'restart':
              return yield* carryOnAfterRestart({ ...row, current })
            case 'resume': {
              if (row.nodeKey === 'review') {
                const step = place.reviewer ?? (JSON.parse(row.config) as PlanStep)
                yield* reviewOn(current, row.iteration, row.iteration > 0 ? yield* settledBefore(current) : undefined, step, row.attemptId)
              } else {
                const said = yield* envelope('thread.send', { threadId: current.threadId, placed: row.attemptId })
                const key = row.nodeKey === 'settle' ? 'settle' : 'implement'
                yield* resumeLead(current, row.attemptId, key, row.iteration, place.lead, said)
              }
              return yield* touchCard(current.taskId)
            }
            case 'reset':
              return yield* resumeHeld(
                { ...row, agentId: place.agentId, accountId: place.accountId, model: place.model },
                true,
                place.connection,
              )
            case 'answered':
              return yield* carryOn(
                current,
                row.attemptId,
                place.info,
                place.answer,
                yield* envelope('thread.send', { placed: row.attemptId }),
                undefined,
                undefined,
                undefined,
                'person',
                place.sender,
              )
            case 'handed': {
              // As one handed on at once: an agent that can't start leaves the step needing the person, not admitted with nothing at work.
              const carried = yield* Effect.exit(
                carryOn(
                  current,
                  row.attemptId,
                  place.info,
                  place.answer,
                  yield* envelope('thread.send', { placed: row.attemptId }),
                  undefined,
                  undefined,
                  undefined,
                  'underway',
                ),
              )
              if (carried._tag === 'Failure')
                yield* stuck(
                  current,
                  { id: row.attemptId },
                  { ...place.info, why: 'failed_to_start', detail: summarize(carried.cause) || null },
                )
              return
            }
            case 'next': {
              if (row.nodeKey === 'review') {
                const step = place.reviewer ?? (JSON.parse(row.config) as PlanStep)
                // The plan's reviewer, nearly out since it waited, goes as at once: elsewhere, held or asked.
                const { review: planned } = yield* stepsOf(current)
                const steers = planned !== undefined && step.agentId === planned.agentId
                const instead = steers ? yield* insteadOf(current, planned) : undefined
                if (steers && instead === undefined && (yield* heldLow(current, 'review', row.attemptId, row.iteration, planned)))
                  return yield* touchCard(current.taskId)
                yield* reviewOn(
                  current,
                  row.iteration,
                  row.iteration > 0 ? yield* settledBefore(current) : undefined,
                  instead === undefined ? step : { ...step, agentId: instead.agentId, model: instead.model },
                  row.attemptId,
                  instead?.accountId,
                )
              } else yield* settleOn(current, row.iteration, row.attemptId, yield* openToSettle(current))
              return yield* touchCard(current.taskId)
            }
          }
        })

      /** Every step that waits for a place, with since when and how it starts once it has one. */
      const placed = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const at = yield* timestamp
        const rows = yield* sql<Placed & { output: string | null }>`
          SELECT r.task_id, n.node_key, n.id AS node_id, n.config, a.id AS attempt_id, n.iteration, a.output,
            coalesce(s.agent_id, json_extract(n.config, '$.agentId')) AS ran_on,
            CASE WHEN s.id IS NULL THEN json_extract(n.config, '$.model') ELSE s.model END AS ran_model
          FROM runs r JOIN workflow_executions e ON e.run_id = r.id JOIN nodes n ON n.execution_id = e.id
          JOIN node_attempts a ON a.node_id = n.id LEFT JOIN provider_sessions s ON s.id = a.provider_session_id
          JOIN tasks k ON k.id = r.task_id JOIN projects p ON p.id = r.project_id
          WHERE r.state = 'running' AND a.state = 'held' AND a.hold_reason = 'machine_busy'
            AND k.state IN ('draft', 'open') AND p.archived_at IS NULL`
        return rows.map((row) => {
          const waited = waitingOf(row.output, at)
          return {
            taskId: row.taskId,
            review: row.nodeKey === 'review',
            order: orderOf(waited.place),
            since: waited.since,
            start: provide(startPlaced(row, waited)),
          }
        })
      })
      yield* busy.queue(provide(placed))

      /**
       * Every answer kept while there was no place for its agent to carry on,
       * with since when: told once there is one, to the agent waiting on it,
       * or, gone, as an answer to a question whose agent went is (`answered`).
       * Not while its task is stopped: resuming it tells them.
       */
      const answersWaiting = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ id: string; taskId: string; kind: string; since: string }>`
          SELECT q.id, q.task_id, t.kind, json_extract(q.payload, '$.waitsForPlace') AS since
          FROM attention_requests q JOIN threads t ON t.id = json_extract(q.payload, '$.threadId')
          JOIN tasks k ON k.id = q.task_id JOIN projects p ON p.id = q.project_id
          WHERE q.kind = 'question' AND q.state = 'answered' AND json_extract(q.payload, '$.waitsForPlace') IS NOT NULL
            AND k.state IN ('draft', 'open') AND p.archived_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.task_id = q.task_id AND r.state = 'suspended'
              AND r.created_at = (SELECT max(created_at) FROM runs WHERE task_id = q.task_id))`
        return rows.map((row) => ({
          taskId: row.taskId,
          review: row.kind === 'step',
          // The person's answer: kept before what they did started at once (ADR-037), it starts now.
          order: 'person' as const,
          since: row.since,
          start: provide(
            Effect.gen(function* () {
              const told = yield* questions.tell(row.id)
              if (told.told) return
              yield* answered({
                envelope: yield* envelope('thread.send', { threadId: told.threadId, answered: row.id }),
                threadId: told.threadId,
                body: told.body,
              })
            }),
          ),
        }))
      })
      yield* busy.queue(provide(answersWaiting))

      // The steps a restart stopped carry on now the launch is up, a few at a time so their agents don't all start at once.
      yield* Effect.forkScoped(
        provide(
          Effect.forEach(
            interrupted,
            (step) =>
              carryOnAfterRestart(step).pipe(
                Effect.catchCause((cause) =>
                  Cause.hasInterruptsOnly(cause)
                    ? Effect.interrupt
                    : Effect.logWarning('Could not carry on a step a restart stopped', cause),
                ),
              ),
            { concurrency: 3, discard: true },
          ),
        ),
      )
      const {
        changeTeam,
        declineReview,
        makeChange,
        publishAsked,
        reshape,
        routeShip,
        setReviewAfterMerge,
        shipCouldNotStart,
        shipPressed,
        skipReview,
      } = makeRunPlanChanges({
        agentsHere,
        changes,
        conclude,
        currentRun,
        fromItsStart,
        going,
        instance,
        mergeReviews,
        mergeWakes,
        provide,
        publish,
        scope,
        sessions,
        ship,
        shipHeads,
        unstuck,
      })

      return Runs.of({
        run: (planId) => provide(run(planId)),
        skipReview: (input) => provide(skipReview(input)),
        declineReview: (taskId, actorId) => provide(declineReview(taskId, actorId)),
        mergeWaiting: (input) => provide(mergeWaiting(input)),
        ship: (input) =>
          provide(
            input.afterTurn === true
              ? Effect.asVoid(
                  Effect.forkIn(
                    Effect.gen(function* () {
                      const sql = yield* SqlClient.SqlClient
                      const [thread] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${input.taskId} AND kind = 'task'`
                      if (thread !== undefined) yield* sessions.untilIdle(thread.id, AFTER_TURN_WAIT)
                      yield* ship(input.taskId, input.envelope.actorId, {
                        onlyChange: input.change,
                        ...(input.route === undefined ? {} : { route: input.route }),
                      })
                    }).pipe(
                      Effect.catchCause((cause) =>
                        Cause.hasInterruptsOnly(cause) ? Effect.interrupt : shipCouldNotStart(input.taskId, cause),
                      ),
                      provide,
                    ),
                    scope,
                  ),
                )
              : shipPressed(input.taskId, input.envelope.actorId, {
                  onlyChange: input.change,
                  ...(input.route === undefined ? {} : { route: input.route }),
                }),
          ),
        routeShip: (input) => provide(routeShip(input)),
        workflowVersion: provide(workflowVersion),
        publish: (taskId) => provide(publishAsked(taskId)),
        answerStuck: (input) => provide(answerStuck(input)),
        handOverHeld: (input) => provide(handOverHeld(input)),
        resume: (input) => provide(resume(input)),
        answered: (input) => provide(answered(input)),
        planWaits,
        reviewerChange,
        changeTeam: (input) => provide(changeTeam(input)),
        reshape: (input) =>
          input.afterMerge === undefined ? provide(reshape(input)) : mergeReviews.beforeChange(input.taskId, provide(reshape(input))),
        setReviewAfterMerge: (input) => provide(setReviewAfterMerge(input)),
        makeChange,
        madeRound: (taskId, sessionId) => provide(Effect.map(openRound(taskId, sessionId), (opened) => opened !== undefined)),
        answerCheckout: (input) => provide(answerCheckout(input)),
        move: (input) =>
          provide(
            Effect.andThen(
              Effect.gen(function* () {
                const sql = yield* SqlClient.SqlClient
                const [task] = yield* sql<{ state: string }>`SELECT state FROM tasks WHERE id = ${input.taskId}`
                if (task === undefined) return yield* new NotFound({ kind: 'task', id: input.taskId })
              }),
              moving(input.taskId, input.to, input.change ?? null, input.envelope.actorId, input.consent),
            ).pipe(Effect.tap(() => Queue.offer(checkoutWakes, undefined))),
          ),
        workToward: (input) => provide(workToward(input)),
        dropMove: (input) =>
          provide(
            Effect.gen(function* () {
              yield* dropMove(input.taskId)
              yield* touchCard(input.taskId)
            }),
          ),
        checkoutsMoved: Queue.offer(checkoutWakes, undefined).pipe(Effect.asVoid),
        changeWaiting: (taskId, parameters, actorId) =>
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            if (!(yield* planWaits(taskId))) return false
            const current = yield* currentRun(taskId)
            if (current === undefined) return false
            const revision = yield* change('runs', current.runId, { parameters })
            yield* fact({
              projectId: current.projectId,
              aggregateType: 'run',
              aggregateId: current.runId,
              revision,
              type: 'run.plan_changed',
              actorId,
            })
            // Its first step starts on the lead the plan now names, as admitted.
            const steps = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PlanParameters))(parameters)
            // Moved to a worktree, what was asked about its checkout no longer stands (ADR-091).
            if ((steps.worksIn ?? 'worktree') === 'worktree') {
              const open = yield* sql<{ id: string }>`
                SELECT id FROM attention_requests WHERE task_id = ${taskId} AND kind = 'checkout' AND state = 'open'`
              for (const call of open) {
                const withdrawn = yield* change('attention_requests', call.id, { state: 'withdrawn' })
                yield* fact({
                  projectId: current.projectId,
                  aggregateType: 'attention_request',
                  aggregateId: call.id,
                  revision: withdrawn,
                  type: 'attention_request.withdrawn',
                  actorId,
                })
              }
            }
            const implement = steps.steps.find((step) => step.key === 'implement')
            if (implement !== undefined)
              yield* sql`UPDATE nodes SET config = ${JSON.stringify(implement)} WHERE execution_id = ${current.executionId} AND node_key = 'implement'`
            return true
          }),
        unstart: (taskId, actorId) =>
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            if (!(yield* beforeFirstStep(taskId))) return false
            const current = yield* currentRun(taskId)
            if (current === undefined) return false
            const at = yield* timestamp
            const attempts = yield* sql<{ id: string; nodeId: string; output: string | null }>`
              SELECT a.id, a.node_id, a.output FROM node_attempts a JOIN nodes n ON n.id = a.node_id
              WHERE n.execution_id = ${current.executionId} AND a.state IN ('ready', 'admitted', 'running', 'waiting_attention', 'verifying', 'held', 'reconciling')`
            for (const attempt of attempts) {
              const revision = yield* change('node_attempts', attempt.id, {
                state: 'cancelled',
                holdReason: null,
                output: JSON.stringify({ ...(JSON.parse(attempt.output ?? '{}') as Readonly<Record<string, unknown>>), stopped: true }),
                endedAt: at,
              })
              yield* change('nodes', attempt.nodeId, { state: 'cancelled' })
              yield* fact({
                projectId: current.projectId,
                aggregateType: 'node_attempt',
                aggregateId: attempt.id,
                revision,
                type: 'node_attempt.cancelled',
                payload: { stopped: true, why: 'held' },
                actorId,
              })
            }
            // What it asked of the person, about its checkout or its step, no longer waits on them.
            const calls = yield* sql<{ id: string }>`
              SELECT id FROM attention_requests WHERE task_id = ${taskId} AND kind IN ('checkout', 'stuck') AND state = 'open'`
            for (const call of calls) {
              const withdrawn = yield* change('attention_requests', call.id, { state: 'withdrawn' })
              yield* fact({
                projectId: current.projectId,
                aggregateType: 'attention_request',
                aggregateId: call.id,
                revision: withdrawn,
                type: 'attention_request.withdrawn',
                actorId,
              })
            }
            yield* change('run_attempts', current.runAttemptId, { state: 'interrupted', endedAt: at })
            yield* change('workflow_executions', current.executionId, { state: 'cancelled', endedAt: at })
            // Detached from its plan, which waits to be started: a start makes its run anew.
            const revision = yield* change('runs', current.runId, { state: 'cancelled', endedAt: at, planId: null })
            yield* fact({
              projectId: current.projectId,
              aggregateType: 'run',
              aggregateId: current.runId,
              revision,
              type: 'run.cancelled',
              payload: { why: 'held' },
              actorId,
            })
            return true
          }),
        answer: (input) =>
          provide(
            Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient
              const [on] = yield* sql<{ taskId: string | null; kind: string | null }>`
                SELECT q.task_id, t.kind FROM attention_requests q LEFT JOIN threads t ON t.id = json_extract(q.payload, '$.threadId')
                WHERE q.id = ${input.attentionId}`
              const onward = (told: Answered) =>
                told.told
                  ? Effect.void
                  : provide(
                      Effect.gen(function* () {
                        yield* answered({
                          envelope: yield* envelope('thread.send', { threadId: told.threadId, answered: input.attentionId }),
                          threadId: told.threadId,
                          body: told.body,
                        })
                      }),
                    )
              const answering = (keep: boolean) => questions.answer({ ...input, keep })
              if (on?.taskId == null) return yield* Effect.flatMap(answering(false), onward)
              yield* busy.enter(on.taskId, (room) => answering(!room), { review: on.kind === 'step', order: 'person', next: onward })
            }),
          ),
      })
    }),
  )
}
