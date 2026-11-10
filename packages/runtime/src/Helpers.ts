import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Ids, newId, type ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { Context, type Crypto, Duration, Effect, Layer, Option, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { touchTask } from './cards'
import { envelope } from './envelope'
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

type Store = SqlClient.SqlClient | Instance | Sessions | Ledger | Crypto.Crypto | Live | ToolServer

/** How many of a task's helpers work at once, and in its life. */
export const HELPERS_AT_ONCE = 4
export const HELPERS_IN_A_LIFE = 50
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
    }): Effect.Effect<string, unknown>
    /** Stops one of the task's helpers, by its name or id: by its lead, which knows why; by the person, said in the thread. */
    stop(input: { readonly taskId: string; readonly helper: string; readonly by: 'lead' | 'person' }): Effect.Effect<string, unknown>
    /** The task's helpers at work. */
    working(taskId: string): Effect.Effect<ReadonlyArray<HelperRow>, unknown>
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
            if (atWork.length >= HELPERS_AT_ONCE)
              return `${HELPERS_AT_ONCE} helpers are at work already (${atWork.map((one) => `"${one.name}"`).join(', ')}): wait for a result, or stop one with stop_helper.`
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
            // The only one writing there until it reports.
            const [busy] = yield* sql<{ name: string }>`
              SELECT name FROM helpers WHERE workspace_id = ${workspace.id} AND state = 'working' LIMIT 1`
            if (busy !== undefined)
              return `Helper "${busy.name}" works on ${changeWords} already: hand this one another change, or wait for it.`
            const [run] = yield* sql<{ executionId: string }>`
              SELECT e.id AS execution_id FROM runs r JOIN workflow_executions e ON e.run_id = r.id
              WHERE r.task_id = ${input.taskId} ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1`
            if (run === undefined) return 'This task has never run, so it has nothing to hand a helper yet.'
            const id = `hlp_${(yield* newId(Ids.thread)).slice(4)}`
            const threadId = yield* newId(Ids.thread)
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
                })}`
              }),
            )
            const lead = yield* leadThreadOf(input.taskId)
            if (lead !== undefined)
              yield* addItem({ projectId: workspace.projectId, threadId: lead }, 'notice', {
                source: 'runtime',
                severity: 'info',
                title: `Helper · ${name}, on ${changeWords} (${input.modelName}).`,
                description: null,
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
            return `Started "${name}" on ${input.modelName}, in the worktree of ${changeWords}. Its result comes to you as a new turn when it ends. Don't wait or poll for it, don't write in that worktree meanwhile, and don't say what it will find: carry on with work it doesn't touch, or end your turn.`
          }),
        )

      const leadThreadOf = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [lead] = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${taskId} AND kind = 'task'`
          return lead?.id
        })

      /** A helper's end, kept: done with its result, stopped, or failed, and why. */
      const ended = (id: string, state: 'done' | 'stopped' | 'failed', result: string | null) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql`UPDATE helpers SET state = ${state}, result = ${result}, ended_at = ${yield* timestamp}
            WHERE id = ${id} AND state = 'working'`
        })

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
          const result = text.trim() === '' ? '(It said nothing.)' : text.trim()
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
          // Done once nothing of its own is still at work.
          yield* Effect.forkDetach(
            Effect.andThen(sessions.untilIdle(helper.threadId, Duration.minutes(2)), provide(deliver(helper))).pipe(
              Effect.catchCause((cause) => Effect.logWarning('Could not bring a helper’s result to its lead', cause)),
            ),
          )
        })

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

      return Helpers.of({ start, stop, working: (taskId) => provide(working(taskId)) })
    }),
  )
}
