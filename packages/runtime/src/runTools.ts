import { join } from 'node:path'
import { pictureViewKey, viewOfKey } from '@althar/contracts'
import { Ids, type InvalidTransition, type NodeAttemptId, type ProjectId, newId } from '@althar/domain'
import type { Ledger, RevisionConflict, RowNotFound } from '@althar/persistence-sqlite'
import { type Crypto, Effect, Queue, type Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'
import type { Artifacts } from './Artifacts'
import type { Order } from './Busy'
import { touchCard } from './cards'
import type { Changes } from './Changes'
import { RuntimeConfig } from './Config'
import { conventionsAt } from './conventions'
import { coordinatorFolderAt } from './coordinatorFolder'
import { thisDevice } from './device'
import type { GitFailed } from './errors'
import {
  EVIDENCE_KINDS,
  SHOWN_MOST,
  builtAsk,
  builtIn,
  evidenceFiles,
  evidenceOf,
  evidencePaths,
  keepEvidence,
  keepShown,
  keptViewsIn,
  readEvidence,
  readShown,
  saysNothing,
  unverifiedOf,
} from './evidence'
import { evidenceGallery, galleryEditProblem } from './evidenceGallery'
import { observeExternal, prepareExternalWait } from './externalWaits'
import { branchOnFirstWrite, unbranched } from './firstWrite'
import { commitsAhead, uncommittedFiles } from './git'
import type { Instance, InstanceInfo } from './Instance'
import type { MergeReviews } from './MergeReviews'
import { roundsOutNow } from './plansAndReviews'
import { unreviewedLine } from './pullRequestReview'
import { DESCRIPTION_SHAPE, type Undescribed, descriptionAsk, filesLine } from './pullRequestWords'
import { change, fact, timestamp } from './records'
import {
  Finding,
  Finished,
  type Lead,
  type PlanParameters,
  type PlanStep,
  Reviewed,
  type RoundBack,
  type RoundStart,
  type RunRow,
  Shown,
  type Store,
  type StuckInfo,
  type TaskEnd,
  WaitingForPerson,
  read,
  roundOf,
  titleOf,
} from './runRecords'
import { addItem } from './threads'
import { POOL, type Tool, type ToolAccess, ToolRefused, type ToolServer } from './ToolServer'

interface RunToolsDependencies {
  readonly acceptShipWork: (run: RunRow) => Effect.Effect<void, GitFailed | SqlError.SqlError | Schema.SchemaError, SqlClient.SqlClient>
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
  readonly changes: Changes['Service']
  readonly conclude: (run: RunRow) => Effect.Effect<void, unknown, SqlClient.SqlClient | Instance | Crypto.Crypto | Ledger>
  readonly currentRun: (taskId: string) => Effect.Effect<RunRow | undefined, SqlError.SqlError, SqlClient.SqlClient>
  readonly digestAll: (taskId: string) => Effect.Effect<string, SqlError.SqlError, SqlClient.SqlClient>
  readonly dropped: ToolRefused
  readonly ended: (
    run: RunRow,
    attempt: { readonly id: string; readonly nodeId: string },
    state: 'succeeded' | 'failed',
    output: unknown,
  ) => Effect.Effect<void, SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict, SqlClient.SqlClient | Ledger>
  readonly externalInstructions: (
    threadId: string,
  ) => Effect.Effect<{ total: number; queued: number }, SqlError.SqlError, SqlClient.SqlClient>
  readonly going: (run: RunRow) => Effect.Effect<boolean, SqlError.SqlError, SqlClient.SqlClient>
  readonly holdsChanged: Queue.Queue<void, never>
  readonly instance: InstanceInfo
  readonly keeps: (
    run: RunRow,
    attemptId: string,
    report: unknown,
  ) => Effect.Effect<boolean, SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict, SqlClient.SqlClient | Ledger>
  readonly madeSince: (taskId: string, start: RoundStart) => Effect.Effect<boolean, SqlError.SqlError, SqlClient.SqlClient>
  readonly mergeReviews: MergeReviews['Service']
  readonly modelOf: (sessionId: string) => Effect.Effect<string | null, SqlError.SqlError, SqlClient.SqlClient>
  readonly openFindings: (
    run: RunRow,
  ) => Effect.Effect<
    readonly { id: string; severity: Finding['severity']; location: string; claim: string; title: string | null }[],
    SqlError.SqlError,
    SqlClient.SqlClient
  >
  readonly provide: <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.Effect<A, E>
  readonly rest: (taskId: string) => Effect.Effect<void, never, SqlClient.SqlClient>
  readonly restedOf: (
    taskId: string,
  ) => Effect.Effect<
    { heads: Record<string, string>; uncommitted: Record<string, readonly string[]>; digest: string },
    SqlError.SqlError,
    SqlClient.SqlClient
  >
  readonly result: (
    run: Pick<RunRow, 'projectId' | 'threadId'>,
    content: Readonly<Record<string, unknown>>,
    id?: string,
  ) => Effect.Effect<string, SqlError.SqlError | Schema.SchemaError, SqlClient.SqlClient | Crypto.Crypto | Ledger>
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
  readonly running: (
    run: RunRow,
    keys: ReadonlyArray<string>,
  ) => Effect.Effect<
    { id: string; nodeId: string; nodeKey: string; iteration: number; input: string } | undefined,
    SqlError.SqlError,
    SqlClient.SqlClient
  >
  readonly settle: (
    run: RunRow,
    round: number,
    findings: ReadonlyArray<Finding & { readonly id: string }>,
  ) => Effect.Effect<void, unknown, SqlClient.SqlClient | Instance | Crypto.Crypto | Ledger>
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
  readonly tinyFixOf: (run: RunRow) => Effect.Effect<{ files: string[]; lines: number } | null, never, SqlClient.SqlClient>
  readonly toolServer: ToolServer['Service']
  readonly unexplained: (
    run: RunRow,
    attemptId: string,
  ) => Effect.Effect<
    readonly { id: string; severity: Finding['severity']; location: string; claim: string; title: string | null }[],
    SqlError.SqlError,
    SqlClient.SqlClient
  >
  readonly unstuck: (
    run: RunRow,
  ) => Effect.Effect<void, SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict, SqlClient.SqlClient | Ledger>
  readonly worktreesOf: (
    taskId: string,
  ) => Effect.Effect<
    readonly { id: string; path: string; branch: string; name: string; slug: string; base: string | null; change: string | null }[],
    SqlError.SqlError,
    SqlClient.SqlClient
  >
}

export const makeRunTools = (dependencies: RunToolsDependencies) =>
  Effect.gen(function* () {
    const {
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
    } = dependencies

    /**
     * Descriptions the lead gave for a step Althar sent back, by thread:
     * kept, so a task of several can give them one by one. Kept for the
     * launch, for the last few threads sent back; after a restart, or for
     * one long left, the lead is asked again.
     */
    const givenBefore = new Map<string, Readonly<Record<string, string>>>()

    const GIVEN_KEPT = 64

    /** The descriptions the lead gave, by the slug of the repository each is for; refused where it names none of the task's. */
    const descriptionsOf = (
      worktrees: ReadonlyArray<{ readonly name: string; readonly slug: string }>,
      given: ReadonlyArray<{ readonly repository?: string | undefined; readonly text: string }>,
    ) =>
      Effect.gen(function* () {
        const named: Record<string, string> = {}
        for (const description of given) {
          const wanted = description.repository?.trim().toLowerCase()
          const worktree =
            wanted === undefined || wanted === ''
              ? worktrees.length === 1
                ? worktrees[0]
                : undefined
              : worktrees.find((candidate) => candidate.slug === wanted || candidate.name.toLowerCase() === wanted)
          if (worktree === undefined)
            return yield* new ToolRefused({
              message: `Say which repository each description is for: ${worktrees.map((candidate) => candidate.name).join(', ')}.`,
            })
          if (description.text.trim() !== '') named[worktree.slug] = description.text
        }
        return Object.keys(named).length === 0 ? {} : { descriptions: named }
      })

    /**
     * The task's repositories with a pull request to open that the lead
     * hasn't described, now or before: in its template, where it has one.
     * One with nothing to publish opens none, and one whose pull request is
     * open has its description already, so neither needs one.
     */
    const undescribedOf = (
      threadId: string,
      worktrees: ReadonlyArray<{
        readonly id: string
        readonly path: string
        readonly name: string
        readonly slug: string
        readonly base: string | null
      }>,
      given: Readonly<Record<string, string>>,
      /**
       * When each repository's last pull request opened, by its worktree, for a next one: only descriptions given since count, as
       * that one's describe it. Each its own, as the pull request is described (Changes.bodyFor).
       */
      since: Readonly<Record<string, string>> = {},
    ) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const undescribed: Array<Undescribed> = []
        for (const worktree of worktrees) {
          if (given[worktree.slug] !== undefined) continue
          const ahead = worktree.base === null ? 1 : yield* commitsAhead(worktree.path, worktree.base).pipe(Effect.orElseSucceed(() => 1))
          if (ahead === 0) continue
          const [open] = yield* sql<{ n: number }>`
              SELECT count(*) AS n FROM repository_changes c JOIN external_links l ON l.kind = 'change' AND l.url = c.pull_request_url
              WHERE c.workspace_id = ${worktree.id} AND json_extract(l.snapshot, '$.state') = 'open'`
          if ((open?.n ?? 0) > 0) continue
          const [before] = yield* sql<{ n: number }>`
              SELECT count(*) AS n FROM thread_items WHERE thread_id = ${threadId} AND kind = 'step_result'
                AND json_extract(content, '$.descriptions.' || json_quote(${worktree.slug})) IS NOT NULL
                AND (${since[worktree.id] ?? null} IS NULL OR created_at > ${since[worktree.id] ?? null})`
          if ((before?.n ?? 0) > 0) continue
          const { template } = yield* conventionsAt(worktree.path, 'HEAD')
          undescribed.push({ name: worktree.name, template })
        }
        return undescribed
      })

    /**
     * The lead ends its turn waiting on the person's answer, its step still
     * open: the call says what it asks, the task waits in Needs you, and the
     * person's answer starts the lead again where it stopped. Never a step
     * done, so no review runs and the task isn't ready.
     */
    const waitForPerson = (access: ToolAccess, input: unknown) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const { question } = yield* read(WaitingForPerson, input)
        const asked = question.replace(/\s+/g, ' ').trim()
        if (asked === '')
          return yield* new ToolRefused({
            message: 'Ask the person a question in a line, so they know what you need before you end your turn.',
          })
        if (access.taskId === null)
          return yield* new ToolRefused({
            message: 'Only a task’s lead waits on the person: the coordinator talks with them in its thread.',
          })
        const current = yield* currentRun(access.taskId)
        // After its plan, a turn is a conversation (a task is a conversation plus parts): its question is its answer, and the
        // person's reply is the next turn.
        if (current === undefined)
          return 'No step is open, so there is nothing to hold: ask your question in your answer and end your turn. The person’s reply comes to you as your next turn.'
        const attempt = yield* running(current, ['implement', 'settle'])
        if (attempt === undefined)
          return yield* new ToolRefused({ message: 'No step is waiting on you, so there is nothing to wait on the person for.' })
        const step = attempt.nodeKey === 'settle' ? 'settle' : 'implement'
        const [agent] = yield* sql<{ agentId: string }>`
            SELECT agent_id FROM provider_sessions WHERE thread_id = ${access.threadId}
            ORDER BY started_at DESC, rowid DESC LIMIT 1`
        yield* stuck(
          current,
          { id: attempt.id },
          {
            step,
            why: 'waiting_on_person',
            detail: asked,
            agentId: agent?.agentId ?? null,
            round: attempt.iteration,
            open: 0,
          },
        )
        return `Althar has your question. Your step waits in the person’s Needs you; their answer starts you again. End your turn now.`
      })

    /** A durable hold is recorded before the agent yields; only the runtime polls it. */
    const waitForExternal = (access: ToolAccess, input: unknown) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        if (access.taskId === null) return yield* new ToolRefused({ message: 'Only a task’s lead can wait for an external condition.' })
        const current = yield* currentRun(access.taskId)
        if (current === undefined) return yield* new ToolRefused({ message: 'No step is open to wait on an external condition.' })
        const [held] = yield* sql<{ output: string | null }>`
            SELECT a.output FROM node_attempts a JOIN nodes n ON n.id = a.node_id
            WHERE n.execution_id = ${current.executionId} AND a.state = 'held' AND a.hold_reason = 'external'`
        if (held !== undefined) return 'The wait is already recorded. End your turn; Althar will start you again when it changes.'
        const attempt = yield* running(current, ['implement', 'settle'])
        if (attempt === undefined) return yield* new ToolRefused({ message: 'No lead step is waiting for you.' })
        const instructions = yield* externalInstructions(current.threadId)
        if (instructions.queued > 0)
          return yield* new ToolRefused({ message: 'A new instruction is waiting. Read it before deciding what to wait for.' })
        const wait = yield* prepareExternalWait(access.projectId, input)
        // Establish the baseline for change watches. Terminal conditions are checked again after the hold commits.
        const conditions = yield* Effect.forEach(wait.conditions, (one) =>
          one.target.kind === 'pull_request' && one.target.until === 'changed'
            ? Effect.map(observeExternal(one), (seen) => ({ ...one, seen: seen.seen ?? null }))
            : Effect.succeed(one),
        )
        yield* sql.withTransaction(
          Effect.gen(function* () {
            const [still] = yield* sql<{ state: string }>`SELECT state FROM node_attempts WHERE id = ${attempt.id}`
            if (still?.state !== 'running' || !(yield* going(current)))
              return yield* new ToolRefused({ message: 'The step changed while the wait was prepared. Read the task again.' })
            if ((yield* externalInstructions(current.threadId)).total !== instructions.total)
              return yield* new ToolRefused({ message: 'The instruction changed while the wait was prepared. Read it before waiting.' })
            const revision = yield* change('node_attempts', attempt.id, {
              state: 'held',
              holdReason: 'external',
              output: JSON.stringify({ externalWait: { ...wait, conditions, instructionCount: instructions.total } }),
            })
            yield* fact({
              projectId: current.projectId,
              aggregateType: 'node_attempt',
              aggregateId: attempt.id,
              revision,
              type: 'node_attempt.held',
              payload: { reason: 'external', wait: wait.reason, deadline: wait.deadline },
              actorId: instance.systemId,
            })
            yield* addItem({ projectId: current.projectId, threadId: current.threadId }, 'notice', {
              source: 'runtime',
              severity: 'info',
              title: `Waiting: ${wait.reason}`,
            })
          }),
        )
        yield* touchCard(current.taskId)
        yield* Queue.offer(holdsChanged, undefined)
        return 'Althar is watching. End your turn without finish_step; the wait releases your agent place, and Althar starts your next turn with what changed.'
      })

    /**
     * The lead says its step is done: Implement, or a round of settling. A
     * description it gives reaches the task's pull requests open already,
     * which opened with an earlier one; what became of each is said after.
     */
    const finishStep = (access: ToolAccess, input: unknown) => {
      let described: ReadonlyArray<string> = []
      /** Sets the descriptions given on the task's open pull requests, once the step is taken; what came of it is said at the end. */
      const describe = (given: Readonly<Record<string, string>> | undefined, built: string | null) =>
        access.taskId === null || given === undefined
          ? Effect.void
          : Effect.map(changes.redescribe(access.taskId, given, built), (lines) => {
              described = lines
            })
      return Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [watching] = yield* sql<{ id: string }>`
            SELECT a.id FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
            JOIN runs r ON r.id = e.run_id WHERE r.task_id = ${access.taskId ?? ''} AND r.state = 'running'
              AND a.state = 'held' AND a.hold_reason = 'external' LIMIT 1`
        if (watching !== undefined)
          return yield* new ToolRefused({
            message: 'Your step is waiting on an external condition. End your turn; do not finish it before the wait resolves.',
          })
        // The model this step's turn ran on, kept with its report so its round keeps its name after a switch (DEV-154).
        const model = yield* modelOf(access.sessionId)
        // A review's lead has no step to finish: it ends with its draft, and is refused every tool but a review's (Reviews.ts).
        const {
          summary,
          findings: settled = [],
          descriptions: given = [],
          title: titled,
          evidence: handed = [],
          unverified,
          kept_views: keptViews,
          gallery: givenGallery,
          expected_gallery_revision: expectedGalleryRevision,
          built: said,
          answered: answering = false,
        } = yield* read(Finished, input)
        const gallery = givenGallery ?? { mode: 'patch' as const }
        const validateCollection = () =>
          Effect.gen(function* () {
            const current = yield* evidenceGallery(access.threadId)
            const problem = galleryEditProblem(current, gallery, expectedGalleryRevision)
            if (problem !== null) return yield* new ToolRefused({ message: problem })
          })
        const built = builtIn(said)
        const words = titled === undefined || titled.trim() === '' ? null : titled.trim()
        const builds = { ...(built === null ? {} : { built }), ...(words === null ? {} : { title: words }) }
        const worktrees = access.taskId === null ? [] : yield* worktreesOf(access.taskId)
        // What it shows of its work: its pictures read now, and kept once the step is taken.
        const evidence = yield* readEvidence(
          handed,
          worktrees.map((worktree) => worktree.path),
        )
        // A quick task whose lead changed the repository has its work on a branch of its own from here, before anything below reads
        // it; what it hands as evidence now isn't work. One that changed nothing has no branch still, and has built nothing to say.
        const branched =
          access.taskId === null ? [] : yield* changes.exclusive(access.taskId, branchOnFirstWrite(access.taskId, evidenceFiles(evidence)))
        const plain = access.taskId !== null && (yield* unbranched(access.taskId))
        const reply = (said: string) =>
          branched.length === 0
            ? said
            : `${said} You changed the repository, so Althar put the task's work on a branch of its own, ${branched.join(', ')}, which stays on ${thisDevice()}: commit there.`
        const itemId = yield* newId(Ids.threadItem)
        const shows = Effect.gen(function* () {
          // A note that only says there was nothing to show shows nothing: it isn't kept, and a step with nothing else draws no
          // "What it checked". Every other piece is kept, a note of what an answer found included.
          const shown = evidence.filter((piece) => !saysNothing(piece.given))
          const kept = yield* keepEvidence({ projectId: access.projectId as ProjectId, itemId, folders: [] }, shown)
          const views = new Set<string>()
          for (const piece of evidenceOf(kept)) {
            if (piece.picture === null) continue
            const view = pictureViewKey(piece)
            if (view === null) continue
            if (views.has(view))
              return yield* new ToolRefused({
                message: `Two images name the same view “${view}”. Give each state a distinct view ID, or submit one image for it.`,
              })
            views.add(view)
            if ([...(gallery.remove ?? []), ...(gallery.invalidate ?? [])].includes(viewOfKey(view)))
              return yield* new ToolRefused({
                message: `View “${view}” cannot be updated and removed or invalidated in the same handoff.`,
              })
          }
          // A list given is kept even empty: what an earlier step couldn't show, this one may have.
          return {
            ...(kept.length === 0 ? {} : { evidence: kept }),
            ...(unverified === undefined ? {} : { unverified: unverifiedOf(unverified) }),
            ...keptViewsIn(keptViews),
            gallery,
          }
        })
        // What it gave before Althar sent the step back, and what it gives now.
        const now = yield* descriptionsOf(worktrees, given)
        const kept = { ...givenBefore.get(access.threadId), ...now.descriptions }
        const descriptions = Object.keys(kept).length === 0 ? {} : { descriptions: kept }
        const underWay = access.taskId === null ? undefined : yield* currentRun(access.taskId)
        const [planned] =
          access.taskId === null ? [] : yield* sql<{ id: string }>`SELECT id FROM runs WHERE task_id = ${access.taskId} LIMIT 1`
        if (underWay === undefined) {
          // After its plan, only the task's lead gives it a summary in a turn: a session of another thread's, or one handed over,
          // keeps none, as none did before a turn could.
          const [own] =
            planned === undefined
              ? [{ id: access.sessionId }]
              : yield* sql<{ id: string }>`
                    SELECT id FROM provider_sessions WHERE id = ${access.sessionId} AND thread_id = ${access.threadId} AND state != 'superseded'`
          if (own === undefined) return yield* new ToolRefused({ message: 'No step is waiting on you, so Althar keeps no summary now.' })
          // After its plan, a lead's turn is a turn, not a round (a task is a conversation plus parts): a summary it gives is kept, its
          // evidence and descriptions with it, and opens nothing. What it committed waits for the person's Ship, which reviews it.
          // A task started without a plan has no steps: the summary is still what the person reads, and what it built, its end.
          // Where it changed the work since the last run left it, what the task built is said again, so the pull request and Outputs
          // are never older than its work.
          const made = planned !== undefined && access.taskId !== null && (yield* madeSince(access.taskId, yield* restedOf(access.taskId)))
          if ((planned === undefined || made) && built === null && !plain) return yield* new ToolRefused({ message: builtAsk(false) })
          yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* validateCollection()
              yield* addItem(
                { projectId: access.projectId as ProjectId, threadId: access.threadId },
                'step_result',
                {
                  step: 'implement',
                  summary,
                  ...builds,
                  ...descriptions,
                  ...(model === null ? {} : { model }),
                  ...(yield* shows),
                },
                { id: itemId },
              )
            }),
          )
          yield* describe(Object.keys(kept).length === 0 ? undefined : kept, built)
          if (planned === undefined) return reply('Althar has your summary.')
          const waiting = access.taskId === null ? [] : yield* changes.holds(access.taskId)
          return reply(
            waiting.length === 0
              ? 'Althar has your summary.'
              : 'Althar has your summary. What you committed waits on the branch for the person’s Ship, which reviews it and then pushes it.',
          )
        }
        const current = underWay
        const attempt = yield* running(current, ['implement', 'settle'])
        if (attempt === undefined) return yield* new ToolRefused({ message: 'No step is waiting on you, so Althar keeps no summary now.' })
        const step = attempt.nodeKey === 'settle' ? 'settle' : 'implement'
        // A step waiting on the person's answer isn't done: their answer starts it again.
        const [waitingOnPerson] = yield* sql<{ id: string }>`
            SELECT id FROM attention_requests WHERE task_id = ${current.taskId} AND kind = 'stuck' AND state = 'open'
              AND json_extract(payload, '$.why') = 'waiting_on_person' LIMIT 1`
        if (waitingOnPerson !== undefined)
          return yield* new ToolRefused({
            message:
              'You are waiting on the person’s answer: end your turn. Their answer starts you again; don’t call finish_step until the work is done.',
          })
        // A round of work that made nothing new ends with its summary, and the task is back where it was.
        const round = current.planId === null && step === 'implement' ? roundOf(attempt.input) : undefined
        const quiet = round !== undefined && !(yield* madeSince(current.taskId, round.start))
        // Only a round answers: what it committed opens no pull request, so it needs no description (ADR-034).
        const answered = round !== undefined && answering
        // Whether settling changed the work: then what the task built is said again, so its end is never older than its work. A round
        // that made nothing new needn't say it.
        const workBefore = step === 'settle' ? ((JSON.parse(attempt.input) as { before?: string }).before ?? '') : ''
        const workAfter = step === 'settle' ? yield* digestAll(current.taskId) : ''
        if (built === null && !quiet && !plain && (step === 'implement' || workAfter !== workBefore))
          return yield* new ToolRefused({ message: builtAsk(step === 'settle') })
        // A task that ends on its host pushes commits only: what isn't committed is the lead's to commit or clear away first.
        const ending = yield* stepsOf(current)
        const end = ending.end ?? (ending.here ? null : yield* changes.endFor(current.projectId, current.taskId))
        if (end !== null) {
          // In a task of several repositories, each file by the repository it's in. A picture handed as evidence, now or at an
          // earlier step, needn't be committed.
          const pictures = evidenceFiles(evidence)
          const before = yield* evidencePaths(current.taskId)
          const left = (yield* Effect.forEach(worktrees, (worktree) =>
            Effect.map(uncommittedFiles(worktree.path), (files) =>
              files
                .filter(
                  (file) =>
                    !before(worktree.path, file) &&
                    !pictures.some((picture) => picture.worktree === worktree.path && picture.file === file),
                )
                .map((file) => (worktrees.length > 1 ? `${worktree.name}/${file}` : file)),
            ),
          )).flat()
          if (left.length > 0)
            return yield* new ToolRefused({
              message: `These aren't committed: ${filesLine(left)}. Althar pushes commits only, so commit what belongs to the task, delete the rest (scratch files, logs), and call finish_step again.`,
            })
        }
        // A pull request the task opens is described by the lead, for its reviewer: in the repository's template, where it has one.
        if ((end === 'draft' || end === 'ready') && !quiet && !answered) {
          // A round's work after its task's pull request merged or closed goes in a new one, described from what came since.
          const after = round === undefined ? [] : yield* changes.unshipped(current.taskId).pipe(Effect.orElseSucceed(() => []))
          const since = Object.fromEntries(
            after.flatMap((one) => (one.openedAt === null ? [] : [[one.workspaceId, one.openedAt] as const])),
          )
          const undescribed = yield* undescribedOf(access.threadId, worktrees, kept, since)
          if (undescribed.length > 0) {
            givenBefore.delete(access.threadId)
            givenBefore.set(access.threadId, kept)
            for (const oldest of givenBefore.keys()) if (givenBefore.size > GIVEN_KEPT) givenBefore.delete(oldest)
            return yield* new ToolRefused({ message: descriptionAsk(undescribed, worktrees.length > 1) })
          }
        }
        givenBefore.delete(access.threadId)
        const showing = yield* shows
        const taken = yield* sql.withTransaction(
          Effect.gen(function* () {
            // Read before the looks at git above: stopped and resumed meanwhile, the report is dropped.
            if (!(yield* keeps(current, attempt.id, { step, summary }))) return false
            yield* validateCollection()
            yield* ended(current, attempt, 'succeeded', { summary, ...(answered ? { answered } : {}) })
            yield* result(
              current,
              {
                step,
                round: attempt.iteration,
                summary,
                ...builds,
                ...descriptions,
                ...(model === null ? {} : { model }),
                ...showing,
              },
              itemId,
            )
            // What became of each finding, as the lead says: the input to the next round, and to what reviews learn.
            if (step === 'settle') yield* settleFindings(current, attempt.id, settled)
            // A step that needed the person and reported after all no longer does.
            yield* unstuck(current)
            if (quiet && round !== undefined) yield* backWhereItWas(current, round.round)
            return true
          }),
        )
        if (!taken) return yield* dropped
        yield* describe(Object.keys(kept).length === 0 ? undefined : kept, built)
        if (quiet) {
          yield* rest(current.taskId)
          // A pull request that merged while it ran settles the task now.
          yield* Effect.ignore(changes.settleIfMerged(current.taskId))
          yield* touchCard(current.taskId)
          return `Althar has your summary. Nothing ${plain ? 'in the repository' : 'on the branch'} changed this round, so the task is back where it was.`
        }
        if (step === 'implement') {
          // Nothing on its branch to read: no review runs, and the task goes on to its ending as it is.
          if (yield* changes.nothingBuilt(current.taskId).pipe(Effect.orElseSucceed(() => false))) {
            yield* conclude(current)
            return reply('Althar has your summary. Nothing was built, so there is nothing to review; the task is ready for the person.')
          }
          const next = yield* review(current, 0)
          return reply(
            next === undefined
              ? 'Althar has your summary. The task is ready for the person.'
              : 'Althar has your summary. A review starts now; wait for its findings.',
          )
        }
        // A fix is checked only where it needs it, never by another whole review (a task is a conversation plus parts): a tiny one
        // isn't read again, and the pull request names it; a bigger one gets one short check by the same reviewer, of the fixes
        // alone. A finding that check reopened is the lead's once more, and that second fix isn't read again.
        if (workAfter !== workBefore && attempt.iteration === 0) {
          // Not read again only once every finding is settled: one left open, or set aside with no word why, gets the check as a
          // bigger fix does, and what's still unsettled after it goes back to the lead, then to the person.
          const unsettled = (yield* openFindings(current)).length + (yield* unexplained(current, attempt.id)).length
          const tiny = unsettled === 0 ? yield* tinyFixOf(current) : null
          if (tiny !== null) {
            yield* change('node_attempts', attempt.id, { output: JSON.stringify({ summary, tiny }) })
            yield* acceptShipWork(current)
            yield* conclude(current)
            return 'Althar has your summary. Your fixes are small enough to need no check, so the task goes on to its end.'
          }
          yield* review(current, attempt.iteration + 1, summary)
          return 'Althar has your summary. The reviewer checks your fixes, and only them.'
        }
        // After the check, a second fix no one reads: it goes on to its ending where the person's setting says it may, once every
        // finding is settled; else it's their call (05: Stuck, findings open).
        if (workAfter !== workBefore) {
          // Unsettled: still open, or set aside by this settle with no word why (a decline is deliberate only when explained).
          const left = [...(yield* openFindings(current)), ...(yield* unexplained(current, attempt.id))]
          const carry = yield* roundsOutNow
          if (carry === 'settled' && left.length === 0) {
            yield* carriedOn(current, attempt.id, attempt.iteration + 1, summary)
            yield* acceptShipWork(current)
            yield* conclude(current)
            return 'Althar has your summary. The check is done; the task goes on to its end with this fix not read again, and the person decides on any merge.'
          }
          const { review: reviewer } = yield* stepsOf(current)
          yield* stuck(current, null, {
            step: 'review',
            why: 'round_limit',
            detail: summary,
            agentId: reviewer?.agentId ?? null,
            round: attempt.iteration + 1,
            open: left.length,
          })
          return 'Althar has your summary. The check is done and a finding is still open, so the person decides what comes next.'
        }
        yield* conclude(current)
        return 'Althar has your summary. The task is ready for the person.'
      }).pipe(Effect.map((said) => (described.length === 0 ? said : `${said} ${described.join(' ')}`)))
    }

    /**
     * The lead shows the person pictures in its thread, at any time, with a
     * step open or none: kept in the artifact store as a step's screenshots
     * are, so they stay once the worktree goes; in the lead's turn, where it
     * showed them.
     */
    const showPictures = (access: ToolAccess, input: unknown) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const { pictures: given } = yield* read(Shown, input)
        // A lead's from its worktrees; the coordinator's from its copies (ADR-097: one tool set).
        const folders =
          access.role === 'coordinator'
            ? yield* Effect.gen(function* () {
                const [project] = yield* sql<{ slug: string }>`SELECT slug FROM projects WHERE id = ${access.projectId}`
                if (project === undefined) return []
                const folder = coordinatorFolderAt((yield* RuntimeConfig).worktreeRoot, project.slug)
                // Each copy first, as the coordinator works in one and names a picture from there, then the folder itself.
                const copies = yield* sql<{ slug: string }>`
                    SELECT slug FROM repository_bindings WHERE project_id = ${access.projectId} AND detached_at IS NULL
                    ORDER BY created_at, rowid`
                return [...copies.map((copy) => join(folder, copy.slug)), folder]
              })
            : access.taskId === null
              ? yield* new ToolRefused({ message: 'This tool is for a task’s lead or the coordinator.' })
              : (yield* worktreesOf(access.taskId)).map((worktree) => worktree.path)
        const shown = yield* readShown(given, folders, access.role === 'coordinator' ? 'your copies of the project' : undefined)
        const itemId = yield* newId(Ids.threadItem)
        const pictures = yield* keepShown({ projectId: access.projectId as ProjectId, itemId, folders: [] }, shown)
        const [session] = yield* sql<{ id: string }>`SELECT id FROM provider_sessions WHERE id = ${access.sessionId}`
        yield* addItem(
          {
            projectId: access.projectId as ProjectId,
            threadId: access.threadId,
            ...(session === undefined ? {} : { sessionId: session.id }),
          },
          'pictures',
          { pictures },
          { id: itemId },
        )
        return `Althar shows ${pictures.length === 1 ? 'it' : `the ${pictures.length}`} in the thread now, each with its caption, and keeps ${pictures.length === 1 ? 'it' : 'them'}: don't list ${pictures.length === 1 ? 'it' : 'them'} again in what you say.`
      })

    /**
     * The task goes on after its rounds of review ran out, the lead's last fixes never read by a reviewer: the settle that made
     * them says so (the pull request tells it, pullRequestReview.ts), and the thread does.
     */
    const carriedOn = (run: RunRow, attemptId: string, reviews: number, summary: string) =>
      Effect.gen(function* () {
        yield* change('node_attempts', attemptId, { output: JSON.stringify({ summary, unreviewed: 1 }) })
        yield* addItem({ projectId: run.projectId, threadId: run.threadId }, 'notice', {
          source: 'runtime',
          severity: 'info',
          title: unreviewedLine(reviews),
        })
      })

    /** Records what the lead did about each of the run's open findings it names: fixed, or set aside with its reason. */
    const settleFindings = (
      run: RunRow,
      attemptId: string,
      settled: ReadonlyArray<{
        readonly id: string
        readonly outcome: 'fixed' | 'set_aside'
        readonly reason?: string | undefined
        readonly commit?: string | undefined
      }>,
    ) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const at = yield* timestamp
        for (const outcome of settled) {
          const [finding] = yield* sql<{ id: string }>`
              SELECT f.id FROM findings f JOIN node_attempts a ON a.id = f.review_attempt_id JOIN nodes n ON n.id = a.node_id
              WHERE f.id = ${outcome.id} AND f.state = 'open' AND n.execution_id = ${run.executionId}`
          if (finding === undefined) continue
          const revision = yield* change('findings', finding.id, {
            state: outcome.outcome,
            settledInAttemptId: attemptId,
            response: outcome.reason ?? null,
            settledAt: at,
          })
          yield* fact({
            projectId: run.projectId,
            aggregateType: 'finding',
            aggregateId: finding.id,
            revision,
            type: `finding.${outcome.outcome}`,
            payload: { reason: outcome.reason ?? null, ...(outcome.outcome === 'fixed' ? { commit: outcome.commit ?? null } : {}) },
            actorId: instance.systemId,
          })
        }
      })

    /** The reviewer's findings: the run ends if there are none, and the lead settles them if there are. */
    const reportReview = (access: ToolAccess, input: unknown) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        // The model this review ran on, kept with its verdict so its round keeps its name after a switch (DEV-154).
        const model = yield* modelOf(access.sessionId)
        const reviewed = yield* read(Reviewed, input)
        const findings = (reviewed.findings ?? []).map(({ title, ...finding }): Finding => {
          const line = titleOf(title)
          return line === null ? finding : { ...finding, title: line }
        })
        // A review after a merge reports in its own thread, to the person rather than the lead (MergeReviews.ts).
        if (yield* mergeReviews.owns(access.threadId))
          return yield* mergeReviews.reported(access, {
            verdict: reviewed.verdict,
            summary: reviewed.summary,
            findings: findings.map((finding) => ({ ...finding, file: finding.file ?? null, line: finding.line ?? null })),
            model,
          })
        const current = access.taskId === null ? undefined : yield* currentRun(access.taskId)
        const attempt = current === undefined ? undefined : yield* running(current, ['review'])
        if (current === undefined || attempt === undefined) return yield* new ToolRefused({ message: 'No review is waiting on you.' })
        const recorded = yield* sql.withTransaction(
          Effect.gen(function* () {
            if (!(yield* keeps(current, attempt.id, { step: 'review', verdict: reviewed.verdict, summary: reviewed.summary })))
              return undefined
            yield* unstuck(current)
            const ids: Array<Finding & { readonly id: string }> = []
            for (const finding of findings) {
              const id = yield* newId(Ids.finding)
              ids.push({ ...finding, id })
              yield* sql`INSERT INTO findings ${sql.insert({
                id,
                projectId: current.projectId,
                reviewAttemptId: attempt.id,
                severity: finding.severity,
                location: JSON.stringify({ file: finding.file ?? null, line: finding.line ?? null }),
                claim: finding.claim,
                title: finding.title ?? null,
                state: 'open',
                createdAt: yield* timestamp,
              })}`
            }
            yield* ended(current, attempt, 'succeeded', {
              verdict: reviewed.verdict,
              summary: reviewed.summary,
              findings: findings.length,
            })
            const [reviewer] = yield* sql<{ agentId: string }>`SELECT agent_id FROM provider_sessions WHERE id = ${access.sessionId}`
            yield* result(current, {
              step: 'review',
              // Which review this is, so its report opens its own findings, whatever ran after.
              attemptId: attempt.id,
              round: attempt.iteration,
              verdict: reviewed.verdict,
              summary: reviewed.summary,
              findings,
              agentId: reviewer?.agentId ?? null,
              ...(model === null ? {} : { model }),
            })
            return ids
          }),
        )
        if (recorded === undefined) return yield* dropped
        if (reviewed.verdict === 'pass' || findings.length === 0) {
          yield* conclude(current)
          return 'Althar has your review. The change passes.'
        }
        yield* settle(current, attempt.iteration, recorded)
        return 'Althar has your review. The lead settles your findings; you may be asked to look again.'
      })

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
              : Effect.andThen(
                  Effect.logWarning('A step tool did not succeed', error),
                  Effect.fail(new ToolRefused({ message: 'Althar could not record that. Try again.' })),
                ),
          ),
        ),
    })

    yield* toolServer.serve('lead', [
      tool(
        'read_gallery',
        'Reads this task’s complete visual collection, including its revision, stable view IDs, captions and report times. Use its revision for explicit removal, invalidation or replacement in finish_step. A new image with the same view updates it; unrelated views stay.',
        { type: 'object', properties: {} },
        (access) => Effect.map(evidenceGallery(access.threadId), (collection) => JSON.stringify(collection)),
      ),
      tool(
        'finish_step',
        "Tells Althar you have done your step: the task, or settling a review's findings. Don't call it while the work isn't done because it waits on the person: call wait_for_person with your question instead. The summary is what the person reads instead of your whole turn: a few lines on what you changed, how you checked it, and anything left open. In `built`, what the task has built as it stands now, which the person reads at its end. Where the task ends in a pull request, its description in `descriptions`, for whoever reviews it on the code host. With it, the evidence you gathered that the change does what it should, and in `unverified` what you couldn't show.",
        {
          type: 'object',
          properties: {
            summary: {
              type: 'string',
              description:
                'What the person reads of your step, in a few lines: what you changed, how you checked it, and anything left open. What you said along the way folds out of sight. Where you write nothing after this report, it and `built` are what stays open, so they carry everything the person needs in full: the proposal, every question, the decisions you need from them, and what was built or not. Where you write after it, your last message stays open instead, and carries all of that. Never point at something said earlier in your turn ("see above").',
            },
            built: {
              type: 'string',
              description:
                'What the task has built, as it stands now, for the person: what it does for them now, the main changes and where they are, anything left open or decided along the way and why, and what they should do next (try something, check it on a real device). A few lines or a short list, about the end state, not this step: a fixed review finding belongs only if it changed what was built. Needed when you finish the task, and again after settling a review that changed the work.',
            },
            evidence: {
              type: 'array',
              description:
                "What shows the change does what it should, in the form that fits the task, each with a caption saying what it shows. A screenshot or recording is a PNG, JPEG, GIF or WebP file in the worktree, by its path (it needn't be committed); a command or test run is what you ran, its exit code and the end of its output, all three; a response, log or note is text. Where nothing fits (a typo, a version bump, a question answered), none.",
              items: {
                type: 'object',
                properties: {
                  kind: { type: 'string', enum: [...EVIDENCE_KINDS] },
                  caption: {
                    type: 'string',
                    description: 'What it shows, in a line: "The Evidence section with two screenshots and a test run".',
                  },
                  path: { type: 'string', description: 'For a screenshot or recording: the picture, from the worktree.' },
                  command: { type: 'string', description: 'For a command or test run: what you ran.' },
                  exit_code: { type: 'integer' },
                  output: {
                    type: 'string',
                    description: 'What it printed: the part that shows the result, such as the summary of a test run.',
                  },
                  text: { type: 'string', description: 'For a response, log or note: the text.' },
                  view: {
                    type: 'string',
                    description:
                      'For a screenshot or recording of the work as built: the view it shows, by a short name you keep the same each time you take it again ("Running page", "Running page, a refused file"). A later picture of the same view replaces it in Outputs and on the pull request.',
                  },
                  option: {
                    type: 'boolean',
                    description:
                      "For a screenshot or recording: true where it isn't the work as built but one of the options or directions the person chooses between, or an exploration. It stays in the thread, and out of the change's Outputs and its pull request.",
                  },
                  before: {
                    type: 'boolean',
                    description:
                      "For a screenshot of the work before your change, such as main: true, with `view` the same name as the picture of it after (or a caption starting with its name, A1). The pull request's comment shows the two side by side as Before and After. A view you took again isn't a before unless you say so.",
                  },
                },
                required: ['kind', 'caption'],
              },
            },
            gallery: {
              type: 'object',
              description:
                'An explicit edit to the persistent visual collection. Default: patch, keeping every unrelated view. replace starts a new collection deliberately; remove retires view IDs; invalidate keeps them visible as needing a new capture. Call read_gallery first and supply expected_gallery_revision for these edits.',
              properties: {
                mode: { type: 'string', enum: ['patch', 'replace'] },
                remove: { type: 'array', items: { type: 'string' } },
                invalidate: { type: 'array', items: { type: 'string' } },
              },
              required: ['mode'],
            },
            expected_gallery_revision: {
              type: 'integer',
              description: 'The revision returned by read_gallery; required when removing, invalidating or replacing views.',
            },
            kept_views: {
              type: 'array',
              description:
                'The views you pictured in an earlier step that still show the work as it is, by their names, where this step pictures something new. Earlier views now stay automatically. This legacy field is accepted for compatibility; use gallery.remove to retire a view explicitly.',
              items: { type: 'string' },
            },
            answered: {
              type: 'boolean',
              description:
                'In a round of work after the plan, true where the person only asked something and what you committed came with answering it: Althar opens no pull request for it, and leaves it for the person to open from the task.',
            },
            unverified: {
              type: 'array',
              description:
                'What you changed but couldn\'t show working, each in a line, and why: "Not tried with a real microphone: none in the sandbox". A claim with no evidence belongs here. Settling a review, an empty list says what you couldn\'t show before, you have now.',
              items: { type: 'string' },
            },
            title: {
              type: 'string',
              description:
                'Only where your work goes in a pull request that follows one merged or closed already, as a fix after a merge does: what that pull request does, in a few words and the way a title reads ("Stop summing task timing into every snapshot"). Althar puts "After #12:" in front. Not the task\'s own title, which says what the first one did.',
            },
            descriptions: {
              type: 'array',
              description: `The description of the task's pull request, for whoever reviews it on the code host rather than the person in Althar: needed when you finish a task that ends in one, and again after settling a review that changes what it says. ${DESCRIPTION_SHAPE} Where the repository has a pull request template, write it in that: keep every heading and checklist, fill each section in that spirit, and leave every box unticked.`,
              items: {
                type: 'object',
                properties: {
                  repository: { type: 'string', description: 'Which repository it is for, where the task has several.' },
                  text: { type: 'string' },
                },
                required: ['text'],
              },
            },
            findings: {
              type: 'array',
              description: 'When settling a review: what became of each finding, by the id Althar gave it.',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  outcome: { type: 'string', enum: ['fixed', 'set_aside'] },
                  reason: {
                    type: 'string',
                    description:
                      'For one fixed, what changed, in a line of plain words ("A session’s windows stay over an endpoint answer asked before them."); for one set aside, why it stays, in a line. The pull request lists them.',
                  },
                  commit: {
                    type: 'string',
                    description:
                      'For one fixed, the sha of the commit you made that fixed it, where one did. The pull request names it beside what changed.',
                  },
                },
                required: ['id', 'outcome'],
              },
            },
          },
          required: ['summary'],
        },
        finishStep,
      ),
      tool(
        'wait_for_person',
        "Ends your turn waiting on the person's answer, without finishing your step: ask your question in a line, and the task waits in their Needs you until they answer, when their answer starts you again. Use this instead of finish_step when the work isn't done because it waits on the person. Don't call finish_step while you wait.",
        {
          type: 'object',
          properties: {
            question: {
              type: 'string',
              description:
                'The question, in one line, the decision in a few words, with the options where there are any. Put the background in what you write just before it, which stays in the thread.',
            },
          },
          required: ['question'],
        },
        waitForPerson,
      ),
      tool(
        'wait_for',
        'Wait for an external condition without finishing your step or occupying an agent place. Give a short reason and up to 16 conditions. A pull_request is in a connected repository of this project, by its name or full host path and number; until is merged, checks_complete, checks_passed, or changed (new checks, review/comment, head or queue state). checks watches a branch or commit ref, such as main. time uses a UTC timestamp. mode any wakes on the first met condition; all waits for every one. A PR closed without merging needs the person. Checks with no results are unknown. Default timeout is 24 hours, at most 7 days. Once recorded, end your turn without finish_step. Althar resumes you with what changed; re-read before taking action. This grants no additional push or merge permission.',
        {
          type: 'object',
          properties: {
            reason: { type: 'string', minLength: 1, maxLength: 240 },
            mode: { enum: ['any', 'all'] },
            timeout_seconds: { type: 'integer', minimum: 1, maximum: 604800 },
            conditions: {
              type: 'array',
              minItems: 1,
              maxItems: 16,
              items: {
                oneOf: [
                  {
                    type: 'object',
                    properties: { kind: { const: 'time' }, at: { type: 'string', format: 'date-time' } },
                    required: ['kind', 'at'],
                  },
                  {
                    type: 'object',
                    properties: {
                      kind: { const: 'pull_request' },
                      repository: { type: 'string' },
                      number: { type: 'integer', minimum: 1 },
                      until: { enum: ['merged', 'checks_complete', 'checks_passed', 'changed'] },
                    },
                    required: ['kind', 'repository', 'number', 'until'],
                  },
                  {
                    type: 'object',
                    properties: {
                      kind: { const: 'checks' },
                      repository: { type: 'string' },
                      ref: { type: 'string' },
                      until: { enum: ['checks_complete', 'checks_passed'] },
                    },
                    required: ['kind', 'repository', 'ref', 'until'],
                  },
                ],
              },
            },
          },
          required: ['reason', 'conditions'],
        },
        waitForExternal,
      ),
    ])

    // Showing pictures is in the shared set (ADR-097): a lead's from its worktree, the coordinator's from its copies.
    yield* toolServer.serve(POOL, [
      tool(
        'show_pictures',
        `Shows the person pictures in your thread, at any time, with a step open or none: when they ask to see something, show it this way rather than naming the files. Each is a PNG, JPEG, GIF or WebP file in your folder (a lead's worktree and its scratch folder; the coordinator's copies), by its path, with a caption saying what it shows; up to ${SHOWN_MOST} at once, in the order given, each up to 20 MB. Althar keeps a copy, so they stay once the worktree is gone; the files needn't be committed. What shows your step's work still goes in finish_step's evidence when you finish it.`,
        {
          type: 'object',
          properties: {
            pictures: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  path: { type: 'string', description: 'The picture, from your folder.' },
                  caption: { type: 'string', description: 'What it shows, in a line: "The settings page in the dark theme".' },
                },
                required: ['path', 'caption'],
              },
            },
          },
          required: ['pictures'],
        },
        showPictures,
      ),
    ])

    yield* toolServer.serve('reviewer', [
      tool(
        'report_review',
        'Reports your review of the change: a verdict, a summary of a few lines, and your findings. With no findings worth fixing, the verdict is pass.',
        {
          type: 'object',
          properties: {
            verdict: { type: 'string', enum: ['pass', 'changes_requested'] },
            summary: {
              type: 'string',
              description:
                'Your review in a few lines. With your findings, it is what the person and the lead read: what you said along the way folds out of sight, so never point at it ("see above"); say it here.',
            },
            findings: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  severity: { type: 'string', enum: ['blocking', 'major', 'minor', 'nit'] },
                  title: {
                    type: 'string',
                    description:
                      'What is wrong, in one short line of plain words, under 80 characters: "The usage column has no header in the model browser". The person scans these before reading any claim.',
                  },
                  file: { type: 'string', description: "The file it is in, from the repository's root, where it is in one." },
                  line: { type: 'integer', description: 'The line it points at in that file, as you read it.' },
                  claim: { type: 'string', description: 'What is wrong, in full: why, and what would fix it.' },
                },
                required: ['severity', 'title', 'claim'],
              },
            },
          },
          required: ['verdict', 'summary'],
        },
        reportReview,
      ),
    ])

    return {}
  })
