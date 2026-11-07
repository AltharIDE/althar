import type { ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { Clock, Context, type Crypto, Duration, Effect, Layer, Option, Schedule, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { envelope } from './envelope'
import { Instance } from './Instance'
import { Live, type LiveEvent } from './Live'
import { Permissions } from './Permissions'
import { fact } from './records'
import { Sessions } from './Sessions'
import { addItem } from './threads'

/*
 * What Althar tells a thread of the work around it (docs/decisions/097,
 * "Situations"), apart from the lead's own: a task a lead started that ended
 * without reaching it, and a call set aside while the person is away.
 *
 * A child that ends. A task a lead started (it has a parent) that is settled
 * without a change, failed, or stopped by the person doesn't reach its parent
 * by itself. Once, Althar puts a line in the parent's thread, in its warning
 * tone, linking the child and its report; and gives the parent's lead the same
 * as news, which starts it if it stopped, as message_lead does. Kept in the
 * record (`task.parent_told`) so neither a later look nor a relaunch says it
 * again.
 *
 * A call that waits while the person is away. A permission that reached a
 * paired device (Permissions.reached) and has waited past `AWAY_AFTER` since
 * doesn't hold its lead's turn: the lead is refused the call with a word
 * saying the person is away, goes on with what doesn't need it, and is told
 * when the person answers. Allowed, the call goes through once it is made
 * again.
 */

type Store = SqlClient.SqlClient | Instance | Sessions | Ledger | Crypto.Crypto | Permissions | Live

/** How long a request waits after it reached the person's device before its lead is let go on without it. */
export const AWAY_AFTER = Duration.minutes(3)

/** How often Althar looks at both. */
const LOOK_EVERY = Duration.seconds(15)

/** How a child ended, as its parent's line and news say it. */
export type Ended = 'unchanged' | 'failed' | 'stopped'

/** What the child's report said, in a line: its first sentence, cut short. */
export const reportLine = (summary: string | undefined): string | undefined => {
  const first = summary
    ?.replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s/)[0]
  if (first === undefined || first === '') return undefined
  return first.length > 160 ? `${first.slice(0, 157).trimEnd()}…` : first
}

/** The line a child's end leaves in its parent's thread, as plain text for where nothing draws it better. */
export const endedLine = (title: string, how: Ended, why?: string): string => {
  const head = how === 'stopped' ? `${title} stopped by you` : `${title} ${how === 'failed' ? 'failed' : 'stopped without a change'}`
  return why === undefined || how === 'stopped' ? `${head}.` : `${head}: ${why.replace(/\.$/, '')}.`
}

/** What the parent's lead is told: the child, how it ended, its report. */
export const endedNews = (child: { readonly title: string; readonly slug: string }, how: Ended, why?: string): string => {
  const ended = how === 'stopped' ? 'was stopped by the person' : how === 'failed' ? 'failed' : 'is settled without a change'
  return `News from Althar: ${child.title} (${child.slug}), the task you started, ${ended}.${why === undefined ? '' : ` Its report: ${why}`} read_task shows the rest. Take it into your work, and say in your report what it means for it.`
}

export class Situations extends Context.Service<
  Situations,
  {
    /** Looks at the children that ended and the calls that wait, now. */
    look(): Effect.Effect<void>
  }
>()('@althar/runtime/Situations') {
  static readonly layer: Layer.Layer<Situations, never, Store> = Layer.effect(
    Situations,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const sessions = yield* Sessions
      const permissions = yield* Permissions
      const live = yield* Live
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)

      interface Child {
        readonly id: string
        readonly slug: string
        readonly title: string
        readonly threadId: string
        readonly projectId: string
        readonly revision: number
        readonly how: Ended
        readonly parentId: string
        readonly parentThreadId: string
        readonly parentOpen: boolean
      }

      /** The children that ended and whose parent hasn't been told, by how. */
      const ended = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{
          id: string
          slug: string
          title: string
          threadId: string
          projectId: string
          revision: number
          state: string
          runState: string | null
          changes: number
          parentId: string
          parentThreadId: string
          parentState: string
          stoppedBy: string | null
        }>`
          SELECT k.id, k.slug, k.title, t.id AS thread_id, k.project_id, k.revision, k.state,
            (SELECT state FROM runs WHERE task_id = k.id ORDER BY created_at DESC, rowid DESC LIMIT 1) AS run_state,
            (SELECT count(*) FROM external_links l WHERE l.task_id = k.id AND l.kind = 'change') AS changes,
            k.parent_task_id AS parent_id, pt.id AS parent_thread_id, p.state AS parent_state,
            (SELECT actor_id FROM record_events e WHERE e.aggregate_type = 'task' AND e.aggregate_id = k.id AND e.type = 'task.abandoned'
              ORDER BY e.sequence DESC LIMIT 1) AS stopped_by
          FROM tasks k
          JOIN tasks p ON p.id = k.parent_task_id
          JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
          JOIN threads pt ON pt.task_id = p.id AND pt.kind = 'task'
          WHERE k.parent_task_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM record_events e WHERE e.aggregate_type = 'task' AND e.aggregate_id = k.id AND e.type = 'task.parent_told')`
        return rows.flatMap((row): ReadonlyArray<Child> => {
          const how: Ended | null =
            row.state === 'abandoned'
              ? row.stoppedBy === instance.personId
                ? 'stopped'
                : null
              : row.state === 'done'
                ? row.changes === 0
                  ? 'unchanged'
                  : null
                : row.runState === 'failed'
                  ? 'failed'
                  : null
          return how === null
            ? []
            : [
                {
                  id: row.id,
                  slug: row.slug,
                  title: row.title,
                  threadId: row.threadId,
                  projectId: row.projectId,
                  revision: row.revision,
                  how,
                  parentId: row.parentId,
                  parentThreadId: row.parentThreadId,
                  parentOpen: row.parentState === 'open',
                },
              ]
        })
      })

      /** What a child's last report said: its summary. */
      const reportOf = (threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<{ summary: string | null }>`
            SELECT json_extract(content, '$.summary') AS summary FROM thread_items
            WHERE thread_id = ${threadId} AND kind = 'step_result' ORDER BY sequence DESC LIMIT 1`
          return reportLine(row?.summary ?? undefined)
        })

      const tellParent = (child: Child) =>
        Effect.gen(function* () {
          const why = yield* reportOf(child.threadId)
          yield* fact({
            projectId: child.projectId as ProjectId,
            aggregateType: 'task',
            aggregateId: child.id,
            revision: child.revision,
            type: 'task.parent_told',
            payload: { how: child.how, parent: child.parentId },
            actorId: instance.systemId,
          })
          yield* addItem({ projectId: child.projectId as ProjectId, threadId: child.parentThreadId }, 'notice', {
            source: 'runtime',
            severity: 'warning',
            title: endedLine(child.title, child.how, why),
            description: null,
            task: { taskId: child.id, slug: child.slug, title: child.title, threadId: child.threadId },
            situation: { kind: 'ended', how: child.how, ...(why === undefined ? {} : { why }) },
          })
          // News that wakes the parent's lead, as message_lead does: after its turn, starting it if it stopped.
          if (!child.parentOpen) return
          const body = endedNews(child, child.how, why)
          const lead = yield* sessions.running(child.parentThreadId)
          yield* sessions.send({
            envelope: yield* envelope('thread.send', { threadId: child.parentThreadId, body }, undefined, instance.systemId),
            threadId: child.parentThreadId,
            body,
            disposition: 'after_current',
            quiet: true,
          })
          if (Option.isNone(lead)) yield* sessions.startLast(child.parentThreadId)
        })

      /** Lets the leads of requests that reached the person's device, and waited, go on without the answer. */
      const away = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ id: string; reachedAt: string | null }>`
          SELECT id, json_extract(payload, '$.reached.at') AS reached_at FROM attention_requests
          WHERE kind = 'permission' AND state = 'open' AND coalesce(json_extract(payload, '$.setAside'), 0) != 1
            AND json_extract(payload, '$.reached.at') IS NOT NULL`
        const now = yield* Clock.currentTimeMillis
        for (const row of rows) {
          const at = row.reachedAt === null ? Number.NaN : Date.parse(row.reachedAt)
          if (Number.isNaN(at) || now - at < Duration.toMillis(AWAY_AFTER)) continue
          yield* permissions.setAside(row.id)
        }
      })

      const look = Effect.gen(function* () {
        for (const child of yield* provide(ended)) yield* provide(tellParent(child))
        yield* provide(away)
      }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not look at the work around a thread', cause)))

      /** The lead of a call it went on without is told what the person answered. */
      const answered = (event: LiveEvent) =>
        Effect.gen(function* () {
          if (event._tag !== 'AttentionClosed' || event.setAside === undefined) return
          const { title, decision } = event.setAside
          const body =
            decision === 'allow'
              ? `The person allowed what you set aside: ${title}. Make the call again; it goes through.`
              : `The person declined what you set aside: ${title}. Don't make it again; do it another way, or say in your report what it needed.`
          yield* sessions.send({
            envelope: yield* envelope('thread.send', { threadId: event.threadId, body }, undefined, instance.systemId),
            threadId: event.threadId,
            body,
            disposition: 'after_current',
            quiet: true,
          })
        }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not tell a lead what the person answered', cause)))

      yield* Effect.forkScoped(look.pipe(Effect.repeat(Schedule.spaced(LOOK_EVERY))))
      yield* Effect.forkScoped(Stream.runForEach(yield* live.subscribe, (event) => provide(answered(event))))

      return Situations.of({ look: () => look })
    }),
  )
}
