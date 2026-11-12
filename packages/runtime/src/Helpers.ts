import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { Ids, newId, type ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { removeFully } from '@althar/provider-adapters'
import { Clock, Context, type Crypto, Duration, Effect, Layer, Option, Schedule, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { Accounts } from './Accounts'
import { touchTask } from './cards'
import { Agents } from './Config'
import { Connectivity } from './Connectivity'
import { Installs } from './Installs'
import { Limits } from './Limits'
import { ModelFacts } from './ModelFacts'
import { Models as ModelsService } from './Models'
import { PlanUsage } from './PlanUsage'
import { SignIns } from './SignIns'
import { usableModels } from './usableModels'
import { envelope } from './envelope'
import { commitTree, git, treeOf } from './git'
import { scratchOf } from './firstWrite'
import { Instance } from './Instance'
import { Live, type LiveEvent } from './Live'
import { timestamp } from './records'
import { Sessions } from './Sessions'
import { addItem } from './threads'
import { ToolServer } from './ToolServer'

/*
 * Helpers (ADR-087, as "a task is a conversation plus parts" amends it). A
 * task's lead hands one of its changes to a helper, on any agent and model,
 * to work on in the background while the person keeps talking to the lead.
 * The helper works in that change's worktree, the only one writing there
 * until it reports, so its commits are on the change's branch when it's done
 * and nothing needs bringing back. It pushes nothing: the change ships with
 * Ship, after its review.
 *
 * A helper has a session of its own, in a step thread of the task's
 * (`helper:` and its id), briefed with what the lead asked, whole. Its last
 * message, once its turn ends and it is done, is its result: kept on its
 * thread and as a file in the lead's scratch folder, then queued to the lead
 * as quiet news, never the person's word, starting a lead that stopped. A
 * lead waiting on its helpers isn't missing its report (Runs' watch), and
 * finish_step waits for them. Four of a task's at once, fifty in its life,
 * one level deep: a helper starts none, and asks the person nothing.
 */

type Models = Agents | ModelsService | ModelFacts | SignIns | Installs | Limits | Accounts | PlanUsage
type Store = SqlClient.SqlClient | Instance | Sessions | Ledger | Crypto.Crypto | Live | ToolServer | Connectivity | Models

/** How many of a task's helpers may be at work or waiting for a place (four at work at once: Busy.ts), and in its life. */
export const HELPERS_AT_WORK_OR_WAITING = 10
export const HELPERS_IN_A_LIFE = 50
/** How long a helper may work, from its start; then it is stopped and its lead told (ADR-087). */
export const HELPER_HOUR = Duration.hours(1)
/** How often its hour is looked at. */
const HOUR_EVERY = Duration.seconds(30)
/** How much of a helper's result its lead's turn carries; the rest is in the file. */
const RESULT_WORDS = 8000

/** What a helper may call: reading and setting its folder up. Nothing that ships, asks or starts work. */
const HELPERS_TOOLS = new Set([
  'read_issue',
  'read_pull_request',
  'read_checks',
  'read_check_log',
  'screenshot',
  'install_dependencies',
  'find_issues',
  'list_models',
])

export interface HelperRow {
  readonly id: string
  readonly name: string
  readonly threadId: string
  readonly agentId: string
  readonly model: string | null
  readonly state: string
}

export class Helpers extends Context.Service<
  Helpers,
  {
    /** Starts a helper on one of the task's changes, the first unless named: what the lead is told, or why not. */
    start(input: {
      readonly taskId: string
      readonly name: string
      readonly brief: string
      readonly agentId: string
      readonly model: string | null
      readonly modelName: string
      readonly effort?: string
      readonly change?: string | null
      /** In a copy of its own of the change's worktree, not in it (ADR-087, task 6). */
      readonly inCopy?: boolean
      /** In a copy, what it changes is kept as a commit for its lead to bring in. */
      readonly writes?: boolean
    }): Effect.Effect<string, unknown>
    /** Stops one of the task's helpers, by its name or id: by its lead, which knows why; by the person, said in the thread. */
    stop(input: { readonly taskId: string; readonly helper: string; readonly by: 'lead' | 'person' }): Effect.Effect<string, unknown>
    /** The task's helpers at work. */
    working(taskId: string): Effect.Effect<ReadonlyArray<HelperRow>, unknown>
    /** Looks at each helper's hour now, as Althar does every 30 seconds: one past it is stopped, and its lead told. */
    readonly lookAtHours: Effect.Effect<void, unknown>
  }
>()('@althar/runtime/Helpers') {
  static readonly layer: Layer.Layer<Helpers, never, Store> = Layer.effect(
    Helpers,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)
      const instance = yield* Instance
      const sessions = yield* Sessions
      const live = yield* Live
      const toolServer = yield* ToolServer
      // A failing service is tried again after each of a step's pauses (ADR-060): 15 s, 1 min, 4 min.
      const pauses = (yield* Connectivity).pauses

      const working = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          return yield* sql<HelperRow>`
            SELECT id, name, thread_id, agent_id, model, state FROM helpers WHERE task_id = ${taskId} AND state = 'working'
            ORDER BY started_at`
        })

      const start: Helpers['Service']['start'] = (input) =>
        provide(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const name = input.name.trim().slice(0, 60) || 'Helper'
            const brief = input.brief.trim()
            if (brief === '') return 'Give the helper its brief: what to do, whole. It reads nothing of your conversation.'
            const atWork = yield* working(input.taskId)
            if (atWork.length >= HELPERS_AT_WORK_OR_WAITING)
              return `${HELPERS_AT_WORK_OR_WAITING} helpers are at work or waiting for a place already (${atWork.map((one) => `"${one.name}"`).join(', ')}): wait for a result, or stop one with stop_helper.`
            const [life] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM helpers WHERE task_id = ${input.taskId}`
            if ((life?.n ?? 0) >= HELPERS_IN_A_LIFE)
              return `This task has had ${HELPERS_IN_A_LIFE} helpers, its most: do the rest yourself, or tell the person.`
            // The change it is handed: the one named, else the task's first.
            const [workspace] = yield* sql<{ id: string; projectId: ProjectId; name: string | null; path: string }>`
              SELECT id, project_id, name, path FROM workspaces
              WHERE task_id = ${input.taskId} AND device_id = ${instance.deviceId} AND access = 'write' AND state = 'ready'
                AND reviewing IS NULL AND (${input.change ?? null} IS NULL AND name IS NULL OR lower(name) = lower(${input.change ?? ''}))
              ORDER BY created_at LIMIT 1`
            if (workspace === undefined)
              return input.change == null
                ? 'This task has no worktree to hand a helper: take one with add_part first.'
                : `This task has no change "${input.change}" here: start_change starts one.`
            const changeWords = workspace.name === null ? 'the task’s change' : `“${workspace.name}”`
            const copied = input.inCopy === true || input.writes === true
            // The only one writing there until it reports; one in a copy of its own writes beside it.
            const [busy] = copied
              ? []
              : yield* sql<{ name: string }>`
                  SELECT name FROM helpers WHERE workspace_id = ${workspace.id} AND state = 'working' AND copy_path IS NULL LIMIT 1`
            if (busy !== undefined)
              return `Helper "${busy.name}" works on ${changeWords} already: hand this one another change, or wait for it.`
            const [run] = yield* sql<{ executionId: string }>`
              SELECT e.id AS execution_id FROM runs r JOIN workflow_executions e ON e.run_id = r.id
              WHERE r.task_id = ${input.taskId} ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1`
            if (run === undefined) return 'This task has never run, so it has nothing to hand a helper yet.'
            const id = `hlp_${(yield* newId(Ids.thread)).slice(4)}`
            const threadId = yield* newId(Ids.thread)
            // Its copy: the change's worktree as it stands, untracked files too, checked out apart.
            const made = copied ? yield* Effect.exit(copyFor(workspace.path, id)) : undefined
            if (made !== undefined && made._tag === 'Failure')
              return `Althar couldn't make a copy of ${changeWords} for the helper. Try again, or hand it the change itself.`
            const copy = made?._tag === 'Success' ? made.value : undefined
            const at = yield* timestamp
            yield* sql.withTransaction(
              Effect.gen(function* () {
                yield* sql`INSERT INTO threads ${sql.insert({
                  id: threadId,
                  projectId: workspace.projectId,
                  kind: 'step',
                  taskId: input.taskId,
                  executionId: run.executionId,
                  nodeKey: `helper:${id.slice(-12)}`,
                  createdAt: at,
                })}`
                yield* sql`INSERT INTO helpers ${sql.insert({
                  id,
                  taskId: input.taskId,
                  projectId: workspace.projectId,
                  threadId,
                  workspaceId: workspace.id,
                  name,
                  brief,
                  agentId: input.agentId,
                  model: input.model,
                  state: 'working',
                  startedAt: at,
                  ...(copy === undefined ? {} : { copyPath: copy.path, snapshot: copy.commit, writes: input.writes === true ? 1 : 0 }),
                })}`
              }),
            )
            const lead = yield* leadThreadOf(input.taskId)
            if (lead !== undefined)
              yield* addItem({ projectId: workspace.projectId, threadId: lead }, 'notice', {
                source: 'runtime',
                severity: 'info',
                title: `Helper · ${name}, ${copy === undefined ? 'on' : 'in a copy of'} ${changeWords} (${input.modelName}).`,
                description: null,
                // A row of the work's own, opening in place to what the helper does.
                step: {
                  kind: 'helper',
                  name,
                  branch: `${copy === undefined ? 'on' : 'in a copy of'} ${changeWords}, ${input.modelName}`,
                  toward: null,
                  thread: threadId,
                },
              })
            const started = yield* Effect.exit(
              Effect.gen(function* () {
                yield* sessions.start({
                  threadId,
                  agentId: input.agentId,
                  ...(input.model === null ? {} : { model: input.model }),
                  ...(input.effort === undefined ? {} : { effort: input.effort }),
                })
                yield* sessions.send({
                  envelope: yield* envelope('thread.send', { threadId }),
                  threadId,
                  body: 'Begin with what you were asked.',
                  origin: 'system',
                  quiet: true,
                })
              }),
            )
            yield* touchTask(input.taskId)
            if (started._tag === 'Failure') {
              yield* ended(id, 'failed', 'Its agent couldn’t start.')
              return `Helper "${name}" couldn't start on ${input.modelName}: its agent didn't start. Start it again on another model, as you judge.`
            }
            if (copy !== undefined)
              return `Started "${name}" on ${input.modelName}, in a copy of its own of ${changeWords} as it stands now: ${input.writes === true ? 'what it changes there is kept as a commit, which its result names for you to bring in' : 'what it changes there is thrown away'}. Its result comes to you as a new turn when it ends. Don't wait or poll for it, and don't say what it will find: carry on, or end your turn.`
            return `Started "${name}" on ${input.modelName}, in the worktree of ${changeWords}. Its result comes to you as a new turn when it ends. Don't wait or poll for it, don't write in that worktree meanwhile, and don't say what it will find: carry on with work it doesn't touch, or end your turn.`
          }),
        )

      const leadThreadOf = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [lead] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${taskId} AND kind = 'task'`
          return lead?.id
        })

      /** A helper's end, kept: done with its result, stopped, or failed, and why. Its copy, where it had one, goes. */
      const ended = (id: string, state: 'done' | 'stopped' | 'failed', result: string | null) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          // Its copy goes first: what reads it as ended finds nothing of it left.
          yield* dropCopy(id)
          yield* sql`UPDATE helpers SET state = ${state}, result = ${result}, ended_at = ${yield* timestamp}
            WHERE id = ${id} AND state = 'working'`
        })

      /**
       * A helper's copy (ADR-087, task 6): its change's worktree as it stands, untracked files included, committed as a
       * snapshot and checked out apart, under `<project>/.helpers/<task>/<helper>/<repository>`.
       */
      const copyFor = (worktree: string, id: string) =>
        Effect.gen(function* () {
          const tree = yield* treeOf(worktree)
          const head = yield* git(worktree, 'rev-parse', 'HEAD')
          const commit = yield* commitTree(worktree, tree, head, 'What a helper starts from')
          const task = dirname(worktree)
          const path = join(dirname(task), '.helpers', basename(task), id, basename(worktree))
          yield* git(worktree, 'worktree', 'add', '--detach', path, commit)
          return { path, commit }
        })

      /** Removes a helper's copy, where it had one: what it changed there that wasn't kept goes with it. */
      const dropCopy = (id: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<{ copyPath: string | null; worktree: string | null }>`
            SELECT h.copy_path, w.path AS worktree FROM helpers h LEFT JOIN workspaces w ON w.id = h.workspace_id WHERE h.id = ${id}`
          if (row?.copyPath == null) return
          const path = row.copyPath
          yield* git(row.worktree ?? path, 'worktree', 'remove', '--force', path).pipe(Effect.ignore)
          yield* removeFully(dirname(path)).pipe(Effect.ignore)
        })

      /**
       * A writing helper's work, kept (ADR-087, task 6): what it changed in its copy committed on its snapshot, and kept on
       * `refs/althar/helpers/<task>/<helper>`, never pushed, for its lead to bring in. Undefined where it changed nothing.
       */
      const keepWork = (helper: { readonly id: string; readonly name: string; readonly taskId: string }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<{ copyPath: string | null; snapshot: string | null; writes: number }>`
            SELECT copy_path, snapshot, writes FROM helpers WHERE id = ${helper.id}`
          if (row?.copyPath == null || row.snapshot === null || row.writes !== 1) return undefined
          const copy = row.copyPath
          yield* git(copy, 'add', '-A')
          const staged = yield* git(copy, 'status', '--porcelain')
          if (staged.trim() !== '')
            yield* git(copy, '-c', 'user.name=Althar', '-c', 'user.email=althar@localhost', 'commit', '-q', '-m', `Helper “${helper.name}”`)
          const head = yield* git(copy, 'rev-parse', 'HEAD')
          if (head === row.snapshot) return undefined
          const ref = `refs/althar/helpers/${helper.taskId}/${helper.id}`
          yield* git(copy, 'update-ref', ref, head)
          yield* sql`UPDATE helpers SET kept_ref = ${ref} WHERE id = ${helper.id}`
          return { ref, head, from: row.snapshot }
        }).pipe(Effect.orElseSucceed(() => undefined))

      /**
       * A helper's turn ended, and it is done: its last message is its result, kept on its thread and as a file in the lead's
       * scratch folder, then queued to the lead as quiet news, which starts a lead that stopped. Its session ends.
       */
      const deliver = (helper: HelperRow & { readonly taskId: string; readonly projectId: ProjectId }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [said] = yield* sql<{ content: string }>`
            SELECT content FROM thread_items WHERE thread_id = ${helper.threadId} AND kind = 'agent_message'
            ORDER BY sequence DESC LIMIT 1`
          const spoken = said === undefined ? undefined : (JSON.parse(said.content) as { text?: unknown }).text
          const text = typeof spoken === 'string' ? spoken : ''
          const said_ = text.trim() === '' ? '(It said nothing.)' : text.trim()
          // A writing helper's work, kept for its lead: named, with how to bring it in.
          const kept = yield* keepWork(helper)
          const result =
            kept === undefined
              ? said_
              : `${said_}\n\nIts work is kept as commit ${kept.head.slice(0, 12)} (${kept.ref}), never pushed. Bring it into your worktree with \`git cherry-pick --no-commit ${kept.from.slice(0, 12)}..${kept.head.slice(0, 12)}\`, settling any conflict as you do with main, then commit it as yours.`
          const [lead] = yield* sql<{ id: string; path: string | null }>`
            SELECT t.id, (SELECT w.path FROM workspaces w WHERE w.task_id = t.task_id AND w.access = 'write' AND w.state = 'ready'
              ORDER BY w.created_at LIMIT 1) AS path
            FROM threads t WHERE t.task_id = ${helper.taskId} AND t.kind = 'task'`
          // Kept whole before it is sent: a restart, a compaction or a handover can read it again.
          let file: string | null = null
          if (lead?.path != null) {
            const folder = join(scratchOf(lead.path), 'helpers')
            file = join(folder, `${helper.id}.md`)
            const path = file
            yield* Effect.sync(() => {
              mkdirSync(folder, { recursive: true })
              writeFileSync(path, `# ${helper.name}\n\n${result}\n`)
            }).pipe(Effect.ignore)
          }
          yield* ended(helper.id, 'done', result)
          yield* sessions.stop(helper.threadId).pipe(Effect.ignore)
          if (lead === undefined) return
          const words = result.split(/\s+/)
          const carried = words.length > RESULT_WORDS ? `${words.slice(0, RESULT_WORDS).join(' ')} …` : result
          yield* sessions.send({
            envelope: yield* envelope('thread.send', { threadId: lead.id }),
            threadId: lead.id,
            body: `Helper "${helper.name}" (${helper.model ?? helper.agentId}) ended. What it said, which is its own and not the person's:\n\n${carried}${file === null ? '' : `\n\n(Kept whole in ${file}.)`}`,
            origin: 'news',
            quiet: true,
          })
          if (Option.isNone(yield* sessions.running(lead.id))) yield* sessions.startLast(lead.id).pipe(Effect.ignore)
          yield* touchTask(helper.taskId)
        })

      /** Tries a helper's failing service again, by turn: how many times it has, kept for this run of Althar. */
      const tries = new Map<string, number>()

      /** A helper that can't go on, told to its lead at once, with the models it may use now to start another. */
      const failedForGood = (helper: HelperRow & { readonly taskId: string }, why: string) =>
        Effect.gen(function* () {
          yield* ended(helper.id, 'failed', why)
          yield* sessions.stop(helper.threadId).pipe(Effect.ignore)
          const lead = yield* leadThreadOf(helper.taskId)
          if (lead === undefined) return yield* touchTask(helper.taskId)
          const [project] = yield* (yield* SqlClient.SqlClient)<{ projectId: string }>`
            SELECT project_id FROM tasks WHERE id = ${helper.taskId}`
          const usable = yield* usableModels(project?.projectId).pipe(Effect.orElseSucceed(() => []))
          const others = usable.map((model) => model.name).slice(0, 12)
          yield* sessions.send({
            envelope: yield* envelope('thread.send', { threadId: lead }),
            threadId: lead,
            body: `Helper "${helper.name}" (${helper.model ?? helper.agentId}) couldn't go on: ${why} ${others.length === 0 ? 'No model can be used now.' : `The models you can use now: ${others.join(', ')}. Start it again on one of them with start_helper, as you judge, or do it yourself.`}`,
            origin: 'news',
            quiet: true,
          })
          if (Option.isNone(yield* sessions.running(lead))) yield* sessions.startLast(lead).pipe(Effect.ignore)
          yield* touchTask(helper.taskId)
        })

      /** A helper's turn failed: its service tried again after each pause, then its lead hears with the models it may use. */
      const turnFailed = (
        helper: HelperRow & { readonly taskId: string; readonly projectId: ProjectId },
        errorClass: string | undefined,
        failure: string | undefined,
      ) =>
        Effect.gen(function* () {
          const tried = tries.get(helper.id) ?? 0
          const again = errorClass === 'transient' || errorClass === 'session_lost' || errorClass === undefined
          const pause = pauses[tried]
          if (!again || pause === undefined) {
            tries.delete(helper.id)
            const why =
              errorClass === 'usage_limit'
                ? `${helper.model ?? helper.agentId} is out of usage.`
                : `${helper.model ?? helper.agentId} kept failing${failure === undefined ? '' : ` (${failure})`}, tried ${tried === 0 ? 'once' : `${tried + 1} times`}.`
            return yield* failedForGood(helper, why)
          }
          tries.set(helper.id, tried + 1)
          yield* addItem({ projectId: helper.projectId, threadId: helper.threadId }, 'notice', {
            source: 'runtime',
            severity: 'warning',
            title: `Its service didn’t answer: trying again in ${Duration.format(pause)}.`,
          })
          yield* Effect.forkDetach(
            Effect.andThen(
              Effect.sleep(pause),
              provide(
                Effect.gen(function* () {
                  const sql = yield* SqlClient.SqlClient
                  const [still] = yield* sql<{ state: string }>`SELECT state FROM helpers WHERE id = ${helper.id}`
                  if (still?.state !== 'working') return
                  if (Option.isNone(yield* sessions.running(helper.threadId)))
                    yield* sessions.startLast(helper.threadId).pipe(Effect.ignore)
                  yield* sessions.send({
                    envelope: yield* envelope('thread.send', { threadId: helper.threadId }),
                    threadId: helper.threadId,
                    body: 'Your last turn failed on the service. Carry on with what you were asked, from where it stands.',
                    origin: 'system',
                    quiet: true,
                  })
                }),
              ),
            ).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not try a helper again', cause))),
          )
        })

      const heard = (event: LiveEvent) =>
        Effect.gen(function* () {
          if (event._tag !== 'TurnEnded' && event._tag !== 'SessionEnded') return
          const sql = yield* SqlClient.SqlClient
          const [helper] = yield* sql<HelperRow & { taskId: string; projectId: ProjectId }>`
            SELECT id, name, thread_id, agent_id, model, state, task_id, project_id FROM helpers
            WHERE thread_id = ${event.threadId} AND state = 'working'`
          if (helper === undefined) return
          if (event._tag === 'SessionEnded') {
            // Gone before it was done: the lead hears, and starts it again as it judges.
            yield* Effect.sleep(Duration.millis(200))
            const [still] = yield* sql<{ state: string }>`SELECT state FROM helpers WHERE id = ${helper.id}`
            if (still?.state !== 'working') return
            // Its task settled, which stops everything of it: it stops with it, and its lead isn't woken (ADR-068).
            if (yield* settled(helper.taskId)) return yield* ended(helper.id, 'stopped', 'Its task settled.')
            yield* ended(helper.id, 'failed', 'Its agent stopped before it was done.')
            const lead = yield* leadThreadOf(helper.taskId)
            if (lead !== undefined)
              yield* sessions.send({
                envelope: yield* envelope('thread.send', { threadId: lead }),
                threadId: lead,
                body: `Helper "${helper.name}" (${helper.model ?? helper.agentId}) stopped before it was done: its agent went. Start it again, on this or another model, as you judge.`,
                origin: 'news',
                quiet: true,
              })
            return yield* touchTask(helper.taskId)
          }
          // A turn that failed on its service is tried again, then its lead hears; one stopped is the stopper's to say.
          if (event.state === 'failed') return yield* turnFailed(helper, event.errorClass, event.failure)
          if (event.state === 'interrupted') return
          tries.delete(helper.id)
          // Done once nothing of its own is still at work.
          yield* Effect.forkDetach(
            Effect.andThen(sessions.untilIdle(helper.threadId, Duration.minutes(2)), provide(deliver(helper))).pipe(
              Effect.catchCause((cause) => Effect.logWarning('Could not bring a helper’s result to its lead', cause)),
            ),
          )
        })

      /** Whether a task is settled: what stops everything of it, its helpers too. */
      const settled = (taskId: string) =>
        Effect.map(
          SqlClient.SqlClient.pipe(
            Effect.flatMap((sql) => sql<{ settledAt: string | null }>`SELECT settled_at FROM tasks WHERE id = ${taskId}`),
          ),
          ([task]) => task?.settledAt != null,
        )

      /** A helper past its hour is stopped, and its lead told: what it said is on its thread, and nothing more comes. */
      const overTime = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        // A writing helper's kept commit goes once its task settles: nothing is left to bring it into (ADR-087, task 6).
        const kept = yield* sql<{ id: string; keptRef: string; path: string | null }>`
          SELECT h.id, h.kept_ref, coalesce(
              (SELECT l.path FROM workspaces w JOIN repository_locations l ON l.binding_id = w.binding_id WHERE w.id = h.workspace_id LIMIT 1),
              (SELECT w.path FROM workspaces w WHERE w.id = h.workspace_id)) AS path
          FROM helpers h JOIN tasks k ON k.id = h.task_id WHERE h.kept_ref IS NOT NULL AND k.settled_at IS NOT NULL`
        for (const one of kept) {
          if (one.path !== null) yield* git(one.path, 'update-ref', '-d', one.keptRef).pipe(Effect.ignore)
          yield* sql`UPDATE helpers SET kept_ref = NULL WHERE id = ${one.id}`
        }
        const before = new Date((yield* Clock.currentTimeMillis) - Duration.toMillis(HELPER_HOUR)).toISOString()
        const late = yield* sql<HelperRow & { taskId: string }>`
          SELECT id, name, thread_id, agent_id, model, state, task_id FROM helpers WHERE state = 'working' AND started_at <= ${before}`
        for (const helper of late)
          yield* failedForGood(helper, 'it worked for its hour, its most, and was stopped. What it said is on its thread.')
      })
      yield* Effect.forkScoped(
        provide(overTime).pipe(
          Effect.catchCause((cause) => Effect.logWarning('Could not look at helpers’ hours', cause)),
          Effect.repeat(Schedule.spaced(HOUR_EVERY)),
        ),
      )

      // The helpers at work as Althar started: those a restart left behind. Read now, before the delay below, so a helper
      // started since — its row in, its session still starting — isn't taken for one a restart left, and failed for it.
      const leftBehind = yield* SqlClient.SqlClient.pipe(
        Effect.flatMap(
          (sql) => sql<HelperRow & { taskId: string }>`
            SELECT id, name, thread_id, agent_id, model, state, task_id FROM helpers WHERE state = 'working'`,
        ),
        Effect.orDie,
      )

      /**
       * After a restart, a helper that was at work carries on: its agent started again on its thread, told to go on from where
       * it stands. One that can't start is its lead's to hear of, as a failure.
       */
      const carryOn = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        for (const helper of leftBehind) {
          // Stopped or ended since Althar started: nothing left to carry on.
          const [still] = yield* sql<{ state: string }>`SELECT state FROM helpers WHERE id = ${helper.id}`
          if (still?.state !== 'working') continue
          if (Option.isSome(yield* sessions.running(helper.threadId))) continue
          const started = yield* sessions.startLast(helper.threadId).pipe(Effect.orElseSucceed(() => false))
          if (!started) {
            yield* failedForGood(helper, 'Althar restarted, and its agent couldn’t start again.')
            continue
          }
          yield* sessions.send({
            envelope: yield* envelope('thread.send', { threadId: helper.threadId }),
            threadId: helper.threadId,
            body: 'Althar restarted while you worked. Carry on with what you were asked, from where it stands.',
            origin: 'system',
            quiet: true,
          })
        }
      })
      yield* Effect.forkScoped(
        provide(Effect.delay(carryOn, Duration.seconds(2))).pipe(
          Effect.catchCause((cause) => Effect.logWarning('Could not carry helpers on after a restart', cause)),
        ),
      )

      yield* Effect.forkScoped(
        Stream.runForEach(yield* live.subscribe, (event) =>
          provide(heard(event)).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not hear a helper', cause))),
        ),
      )

      // A helper reads and works in its folder; it ships nothing, asks nothing and starts no helpers. Its lead's report waits
      // for its helpers: finish_step is refused while one works, naming each.
      yield* toolServer.guard('lead', (tool, access) =>
        provide(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const [helper] = yield* sql<{ name: string }>`SELECT name FROM helpers WHERE thread_id = ${access.threadId}`
            if (helper !== undefined)
              return HELPERS_TOOLS.has(tool.name)
                ? null
                : `You are a helper: ${tool.name} isn't yours. Do what you were asked in your folder, and end your turn with your result.`
            if (tool.name !== 'finish_step' || access.taskId === null) return null
            const atWork = yield* working(access.taskId)
            return atWork.length === 0
              ? null
              : `Your helpers are still at work: ${atWork.map((one) => `"${one.name}"`).join(', ')}. Their results come as new turns; wait for them, or stop them with stop_helper, then call finish_step.`
          }),
        ).pipe(Effect.orElseSucceed(() => null)),
      )

      const stop: Helpers['Service']['stop'] = (input) =>
        provide(
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient
            const [helper] = yield* sql<HelperRow & { projectId: ProjectId }>`
              SELECT id, name, thread_id, agent_id, model, state, project_id FROM helpers
              WHERE task_id = ${input.taskId} AND state = 'working' AND (id = ${input.helper} OR lower(name) = lower(${input.helper}))
              LIMIT 1`
            if (helper === undefined) return `No helper "${input.helper}" is at work on this task.`
            yield* ended(helper.id, 'stopped', null)
            yield* sessions.stop(helper.threadId).pipe(Effect.ignore)
            const lead = yield* leadThreadOf(input.taskId)
            if (lead !== undefined && input.by === 'person')
              yield* addItem({ projectId: helper.projectId, threadId: lead }, 'notice', {
                source: 'runtime',
                severity: 'info',
                title: `You stopped helper “${helper.name}”: what it had said stays on its thread.`,
              })
            yield* touchTask(input.taskId)
            return `Stopped "${helper.name}". Nothing of it comes back.`
          }),
        )

      return Helpers.of({ start, stop, working: (taskId) => provide(working(taskId)), lookAtHours: provide(overTime) })
    }),
  )
}
