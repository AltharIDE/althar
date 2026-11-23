import type { ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { Clock, Context, type Crypto, Duration, Effect, Layer, Option, Schedule, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { envelope } from './envelope'
import { Instance } from './Instance'
import { Live, type LiveEvent } from './Live'
import { Permissions } from './Permissions'
import { fact } from './records'
import { Runs } from './Runs'
import { Sessions } from './Sessions'

/*
 * What Althar tells a thread of the work around it (docs/decisions/097,
 * "Situations"), apart from the lead's own: a task a lead started that ended
 * without reaching it, and a call set aside while the person is away.
 *
 * A child that ends. A task a lead started (it has a parent) that is settled
 * without a change, failed, or stopped by the person doesn't reach its parent
 * by itself. Once, Althar gives the parent's lead the news, which starts it if
 * it stopped, as message_lead does. The parent's chat has no line for it: its
 * one line about the child is where the lead started it. Kept in the record
 * (`task.parent_told`) so neither a later look nor a relaunch says it again.
 *
 * A call that waits while the person is away. A permission that reached a
 * paired device (Permissions.reached) and has waited past `AWAY_AFTER` since
 * doesn't hold its lead's turn: the lead is refused the call with a word
 * saying the person is away, goes on with what doesn't need it, and is told
 * when the person answers. Allowed, the call goes through once it is made
 * again.
 *
 * A finished task held by its issue drafts. A task merged or otherwise done
 * whose lead drafted issues the person hasn't filed or discarded stays in
 * their Needs you: an unfiled issue is theirs to decide. Where nothing else
 * holds it, Althar tells its project's coordinator, once a draft, which task,
 * which drafts, and that they alone hold it, so it says why to the person and
 * asks what they want of each. Kept in the record (`issue_draft.holding_told`).
 */

type Store = SqlClient.SqlClient | Instance | Sessions | Ledger | Crypto.Crypto | Permissions | Live | Runs

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

/** What the parent's lead is told: the child, how it ended, its report. */
export const endedNews = (child: { readonly title: string; readonly slug: string }, how: Ended, why?: string): string => {
  const ended = how === 'stopped' ? 'was stopped by the person' : how === 'failed' ? 'failed' : 'is settled without a change'
  return `News from Althar: ${child.title} (${child.slug}), the task you started, ${ended}.${why === undefined ? '' : ` Its report: ${why}`} read_task shows the rest. Take it into your work, and say in your report what it means for it.`
}

/** A finished task that nothing but its issue drafts keeps in Needs you, as its coordinator hears of it. */
export interface HeldByDrafts {
  readonly slug: string
  readonly title: string
  readonly merged: boolean
  readonly drafts: ReadonlyArray<{ readonly title: string; readonly tracker: string; readonly container: string }>
}

/** What a coordinator is told of finished tasks that only their issue drafts keep in the person's Needs you. */
export const heldNews = (held: ReadonlyArray<HeldByDrafts>): string => {
  const one = held.length === 1
  const lines = held.map((task) => {
    const drafts = task.drafts.map((draft) => `“${draft.title}” (${draft.tracker}, ${draft.container})`).join('; ')
    const n = task.drafts.length
    return `- ${task.title} (${task.slug}) is ${task.merged ? 'merged' : 'done'}. ${n === 1 ? 'An issue its lead drafted waits' : `${n} issues its lead drafted wait`} to be filed: ${drafts}.`
  })
  return [
    `Althar's news (not the person's word): ${one ? 'this task stays' : 'these tasks stay'} in the person's Needs you only because of issues ${one ? 'its' : 'their'} lead drafted that the person hasn't filed or discarded. Nothing else holds ${one ? 'it' : 'them'}.`,
    ...lines,
    `Tell the person this is why ${one ? 'it is' : 'they are'} still in Needs you. Judge whether each draft still matters (read_task and read_thread show the work: the merge may have fixed it, or it may be stale), say so in a line, and ask what they want of each: file it, discard it, or keep it for later. Never file or discard one yourself: its card in the task's thread is theirs. Once every draft is filed or discarded, the task settles by itself.`,
  ].join('\n')
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
      const runs = yield* Runs
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
          // News that wakes the parent's lead, as message_lead does: after its turn, starting it if it stopped. Its chat has its
          // one line about the child where it was started; the child's end isn't a second one.
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

      /** States of a draft still the person's to file or discard: as `issueDraftsWaiting` counts them. */
      const UNFILED = ['pending', 'failed', 'uncertain'] as const

      /**
       * Tells each project's coordinator, once a draft, of its finished tasks that nothing but their issue drafts keeps in
       * Needs you: done, no call open, no change to an issue waiting, in a project that isn't archived.
       */
      const heldByDrafts = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{
          draftId: string
          revision: number
          draftTitle: string
          tracker: string
          container: string
          projectId: string
          slug: string
          title: string
          merged: number
          coordinator: string
        }>`
          SELECT d.id AS draft_id, d.revision, d.title AS draft_title, d.tracker_name AS tracker, d.container_name AS container,
            k.project_id, k.slug, k.title,
            EXISTS (SELECT 1 FROM external_links l WHERE l.task_id = k.id AND l.kind = 'change'
              AND json_extract(l.snapshot, '$.state') = 'merged') AS merged,
            c.id AS coordinator
          FROM issue_drafts d
          JOIN threads t ON t.id = d.thread_id
          JOIN tasks k ON k.id = t.task_id
          JOIN projects p ON p.id = k.project_id AND p.archived_at IS NULL
          JOIN threads c ON c.project_id = k.project_id AND c.kind = 'coordinator' AND c.owner_actor_id = ${instance.personId}
          WHERE k.state = 'done' AND d.state IN ${sql.in(UNFILED)}
            AND NOT EXISTS (SELECT 1 FROM attention_requests a WHERE a.task_id = k.id AND a.state = 'open')
            AND NOT EXISTS (SELECT 1 FROM issue_changes wc JOIN threads wct ON wct.id = wc.thread_id
              WHERE wct.task_id = k.id AND wc.proposed_by = 'lead' AND wc.state IN ('pending', 'failed'))
            AND NOT EXISTS (SELECT 1 FROM record_events e WHERE e.aggregate_type = 'issue_draft' AND e.aggregate_id = d.id
              AND e.type = 'issue_draft.holding_told')
          ORDER BY k.project_id, k.settled_at, k.id, d.created_at`
        const byCoordinator = new Map<
          string,
          { projectId: string; tasks: Map<string, HeldByDrafts & { drafts: Array<HeldByDrafts['drafts'][number]> }> }
        >()
        for (const row of rows) {
          const found = byCoordinator.get(row.coordinator) ?? { projectId: row.projectId, tasks: new Map() }
          byCoordinator.set(row.coordinator, found)
          const task = found.tasks.get(row.slug) ?? { slug: row.slug, title: row.title, merged: row.merged === 1, drafts: [] }
          found.tasks.set(row.slug, task)
          task.drafts.push({ title: row.draftTitle, tracker: row.tracker, container: row.container })
        }
        for (const [threadId, { projectId, tasks }] of byCoordinator) {
          for (const row of rows.filter((one) => one.coordinator === threadId))
            yield* fact({
              projectId: projectId as ProjectId,
              aggregateType: 'issue_draft',
              aggregateId: row.draftId,
              revision: row.revision,
              type: 'issue_draft.holding_told',
              payload: { task: row.slug },
              actorId: instance.systemId,
            })
          const body = heldNews([...tasks.values()])
          // Althar's words, waking the coordinator, as a lead is woken for a child that ended: after its turn, started if it stopped.
          yield* sessions.send({
            envelope: yield* envelope('thread.send', { threadId, body }, undefined, instance.systemId),
            threadId,
            body,
            disposition: 'after_current',
            quiet: true,
          })
          if (Option.isNone(yield* sessions.running(threadId)))
            yield* sessions
              .startLast(threadId)
              .pipe(Effect.catchCause((cause) => Effect.logWarning('Could not start the coordinator for a task its drafts hold', cause)))
        }
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
        yield* provide(heldByDrafts)
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
          const said = yield* envelope('thread.send', { threadId: event.threadId, body }, undefined, instance.systemId)
          // The lead's session may have ended since: a task still open has its lead started again to read it, in its place among
          // the agents at work (Runs.answered); a stopped or settled task is left as it is, the answer queued for when it goes on.
          const sql = yield* SqlClient.SqlClient
          const [on] = yield* sql<{ kind: string; state: string }>`
            SELECT t.kind, k.state FROM threads t LEFT JOIN tasks k ON k.id = t.task_id WHERE t.id = ${event.threadId}`
          if (on?.kind === 'task' && on.state === 'open' && Option.isNone(yield* sessions.running(event.threadId)))
            return yield* runs.answered({ envelope: said, threadId: event.threadId, body })
          yield* sessions.send({ envelope: said, threadId: event.threadId, body, disposition: 'after_current', quiet: true })
        }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not tell a lead what the person answered', cause)))

      yield* Effect.forkScoped(look.pipe(Effect.repeat(Schedule.spaced(LOOK_EVERY))))
      yield* Effect.forkScoped(Stream.runForEach(yield* live.subscribe, (event) => provide(answered(event))))

      return Situations.of({ look: () => look })
    }),
  )
}
