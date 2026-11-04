import type { ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { Context, type Crypto, Effect, Layer, Semaphore, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { envelope } from './envelope'
import { Instance } from './Instance'
import { Live, type LiveEvent } from './Live'
import { changeOf, sharedPaths, type TaskChange } from './otherTasks'
import { fact } from './records'
import { Sessions } from './Sessions'

/*
 * A heads-up for leads whose work meets (docs/architecture/04, "What a lead
 * sees of other tasks"). When a lead changes files another running task of
 * the project is changing too, by the paths in their changes, uncommitted
 * work included (otherTasks.ts), Althar tells it once which task and which
 * files, so it can read that task's work before it builds a conflict; and
 * tells the other lead the same of it. Once for each pair of tasks, for as
 * long as the tasks last: kept in the record (`task.overlap_noticed`), so
 * neither more edits nor a relaunch say it again.
 *
 * It looks after a lead's edit ends, and as its turn ends, for what it
 * changed with a command. Looks wait their turn, one at a time, and a task
 * that asks again while it waits is looked at once: a lead making many
 * edits in a row costs one look, not one for each. A running task is an
 * open one with its lead's session here. A lead is told only while it is in
 * a turn, at work on the task, and reads it as that turn ends; one between
 * turns isn't woken for it, and hears of it the next time it changes a file
 * the other task changes.
 */

type Store = SqlClient.SqlClient | Instance | Sessions | Ledger | Crypto.Crypto

/** The calls that change files, by what their agent said they are. */
const EDITS: ReadonlySet<string> = new Set(['edit', 'delete', 'move'])

/** The heads-up a lead gets of another task changing the files it changes. */
export const overlapWords = (other: { readonly slug: string; readonly title: string }, files: ReadonlyArray<string>) => {
  const named = files.slice(0, 8)
  const more = files.length - named.length
  return `Heads-up: another running task, ${other.title} (${other.slug}), is changing ${files.length === 1 ? 'a file' : 'files'} you are changing too: ${named.join(', ')}${more > 0 ? ` and ${more} more` : ''}. Before you go further there, read its work with read_task_diff and read_task (read_thread for what it was asked), so yours doesn't conflict with it. You can't message its lead; where you need it to change course, say so in your report. Althar says this once for this task.`
}

export class Overlaps extends Context.Service<
  Overlaps,
  {
    /** Looks at whether a task's change meets another running task's, and tells both leads of a pair once. */
    look(taskId: string): Effect.Effect<void>
  }
>()('@althar/runtime/Overlaps') {
  static readonly layer: Layer.Layer<Overlaps, never, Store | Live> = Layer.effect(
    Overlaps,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const sessions = yield* Sessions
      const live = yield* Live
      const scope = yield* Effect.scope
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)
      const one = Semaphore.makeUnsafe(1)
      /** The tasks waiting for a look: one asking again meanwhile is looked at once. */
      const waiting = new Set<string>()
      /** The edits under way, by thread and call: one is looked at as it ends. */
      const editing = new Set<string>()
      const tasks = new Map<string, string | null>()

      /** Whether a task's lead was told of another already. */
      const told = (taskId: string, otherId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<{ one: number }>`
            SELECT 1 AS one FROM record_events WHERE aggregate_type = 'task' AND aggregate_id = ${taskId}
              AND type = 'task.overlap_noticed' AND json_extract(payload, '$.other') = ${otherId} LIMIT 1`
          return row !== undefined
        })

      /** Tells a task's lead, once, of another task changing the files it changes, and keeps that it was told. */
      const tell = (
        to: { readonly id: string; readonly projectId: string; readonly threadId: string },
        about: { readonly id: string; readonly slug: string; readonly title: string },
        files: ReadonlyArray<string>,
      ) =>
        Effect.gen(function* () {
          if (files.length === 0 || (yield* told(to.id, about.id))) return
          const sql = yield* SqlClient.SqlClient
          const [task] = yield* sql<{ revision: number }>`SELECT revision FROM tasks WHERE id = ${to.id}`
          yield* fact({
            projectId: to.projectId as ProjectId,
            aggregateType: 'task',
            aggregateId: to.id,
            revision: task?.revision ?? 1,
            type: 'task.overlap_noticed',
            payload: { other: about.id, files },
            actorId: instance.systemId,
          })
          const body = overlapWords(about, files)
          yield* sessions.send({
            envelope: yield* envelope('thread.send', { threadId: to.threadId, body }, undefined, instance.systemId),
            threadId: to.threadId,
            body,
            disposition: 'after_current',
            quiet: true,
          })
        })

      const look = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const leads = (yield* sessions.onTasks).filter((session) => !session.reviewer)
          const running = new Set(leads.map((session) => session.taskId))
          // Told only while in a turn, at work on its task: one between turns would be woken for nothing it is doing.
          const atWork = new Set(leads.flatMap((session) => (session.turnRunning ? [session.taskId] : [])))
          if (!running.has(taskId)) return
          const open = yield* sql<{ id: string; slug: string; title: string; projectId: string; threadId: string }>`
            SELECT k.id, k.slug, k.title, k.project_id, t.id AS thread_id FROM tasks k
            JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
            WHERE k.state = 'open' AND k.project_id = (SELECT project_id FROM tasks WHERE id = ${taskId})
            ORDER BY k.created_at, k.rowid`
          const task = open.find((one) => one.id === taskId)
          if (task === undefined) return
          // Only pairs with a lead at work not told yet: nothing is read for the rest.
          const others: Array<{ readonly task: (typeof open)[number]; readonly toMe: boolean; readonly toThem: boolean }> = []
          for (const other of open) {
            if (other.id === taskId || !running.has(other.id)) continue
            const toMe = atWork.has(taskId) && !(yield* told(taskId, other.id))
            const toThem = atWork.has(other.id) && !(yield* told(other.id, taskId))
            if (toMe || toThem) others.push({ task: other, toMe, toThem })
          }
          if (others.length === 0) return
          const mine = yield* changeOf(taskId)
          if (mine.repositories.every((repository) => repository.files.length === 0)) return
          for (const other of others) {
            const theirs: TaskChange | null = yield* changeOf(other.task.id).pipe(Effect.orElseSucceed(() => null))
            if (theirs === null) continue
            const shared = sharedPaths(mine, theirs)
            if (shared.length === 0) continue
            if (other.toMe) yield* tell(task, other.task, shared)
            if (other.toThem) yield* tell(other.task, task, sharedPaths(theirs, mine))
          }
        })

      const looked = (taskId: string) =>
        provide(look(taskId)).pipe(
          Effect.catchCause((cause) => Effect.logWarning('Could not look at whether a lead’s change meets another task’s', cause)),
        )

      /** Looks at a task once its turn comes; asked again while it waits, still once. */
      const ask = (taskId: string) =>
        Effect.gen(function* () {
          if (waiting.has(taskId)) return
          waiting.add(taskId)
          yield* Effect.forkIn(
            one.withPermits(1)(
              Effect.suspend(() => {
                waiting.delete(taskId)
                return looked(taskId)
              }),
            ),
            scope,
          )
        })

      const taskOf = (threadId: string) =>
        Effect.gen(function* () {
          if (tasks.has(threadId)) return tasks.get(threadId) ?? null
          const sql = yield* SqlClient.SqlClient
          const [thread] = yield* sql<{ taskId: string }>`SELECT task_id FROM threads WHERE id = ${threadId} AND kind = 'task'`
          tasks.set(threadId, thread?.taskId ?? null)
          return thread?.taskId ?? null
        })

      /** Whether an event ends a lead's change of files: an edit's call, or its turn, which may have changed them with a command. */
      const ends = (event: LiveEvent) => {
        if (event._tag === 'TurnEnded') return true
        if (event._tag !== 'Agent') return false
        const agent = event.event
        if (agent._tag === 'ToolCall' && EDITS.has(agent.kind)) {
          if (agent.status === 'completed') return true
          if (agent.status !== 'failed') editing.add(`${event.threadId}\u0000${agent.toolCallId}`)
          return false
        }
        if (agent._tag !== 'ToolCallUpdate' || (agent.status !== 'completed' && agent.status !== 'failed')) return false
        return editing.delete(`${event.threadId}\u0000${agent.toolCallId}`) && agent.status === 'completed'
      }

      const onLive = (event: LiveEvent) =>
        Effect.gen(function* () {
          if (!ends(event) || !('threadId' in event)) return
          const taskId = yield* taskOf(event.threadId)
          if (taskId !== null) yield* ask(taskId)
        }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not look at whether a lead’s change meets another task’s', cause)))

      yield* Effect.forkScoped(provide(Stream.runForEach(yield* live.subscribe, onLive)))

      return Overlaps.of({ look: (taskId) => one.withPermits(1)(looked(taskId)) })
    }),
  )
}
