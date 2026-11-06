import type { ActorId, ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { Context, type Crypto, Effect, Layer, Option, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Changes } from './Changes'
import { envelope } from './envelope'
import { Instance } from './Instance'
import { quickIn } from './kinds'
import { reviewsIn } from './reviewing'
import { Plans } from './Plans'
import { fact } from './records'
import { Sessions } from './Sessions'
import { actionsOf, standingOf, Tasks } from './Tasks'
import { addItem, updateItem } from './threads'
import { ToolRefused, ToolServer, type Tool, type ToolAccess } from './ToolServer'

/*
 * The coordinator steering a task as the person asks it to (DEV-184,
 * ADR-086): stopping it or only its lead's turn, holding its plan,
 * restarting it, and settling it as done, kept for later or discarded. Each
 * does what the person's own button does, through the same services, so
 * what applies where the task stands is decided once (`actionsOf`).
 *
 * It acts at once only where the live turn holds the person's own message,
 * from the window or a paired device (ADR-081, "The person's word"): their
 * words are quoted in a line in the coordinator's thread and in the task's.
 * A turn that news, a lead or Althar started can't act: it asks instead, a
 * card in the coordinator's thread with one button, which does it as the
 * person's press. Discarding deletes nothing: the task's worktree and
 * branch stay, and its folder goes only as ADR-056's cleanup lets it.
 */

/** What the coordinator can do to a task: the person's own buttons, by what they do. */
export const TaskMove = Schema.Literals(['stop', 'stop_turn', 'hold', 'restart', 'done', 'keep', 'discard'])
export type TaskMove = typeof TaskMove.Type

/** A card asking the person to do one, as the coordinator's thread keeps it: open, done, declined, or no longer applying. */
export interface TaskAskContent {
  readonly taskId: string
  /** The task's own thread, where the card opens it. */
  readonly threadId: string
  readonly slug: string
  readonly title: string
  readonly move: TaskMove
  /** Why the coordinator asks, in a line: what it read that made it ask. */
  readonly why: string | null
  readonly state: 'open' | 'done' | 'declined' | 'moot'
  /** What became of it, once answered: what was done, or why there was nothing to do. */
  readonly said: string | null
}

/** Done, or nothing to do and why: the task already stands so, or the move doesn't apply where it stands. */
type Outcome = { readonly done: true; readonly said: string } | { readonly done: false; readonly said: string }

type Store = SqlClient.SqlClient | Ledger | Instance | Crypto.Crypto | Tasks | Plans | Changes | Sessions

/** What each move did, as a line says it of the task. */
const DID: Readonly<Record<TaskMove, string>> = {
  stop: 'Stopped',
  stop_turn: 'Stopped the lead’s turn on',
  hold: 'Held',
  restart: 'Restarted',
  done: 'Marked done',
  keep: 'Kept for later',
  discard: 'Discarded',
}

/** The same, in the task's own thread. */
const DID_HERE: Readonly<Record<TaskMove, string>> = {
  stop: 'stopped this task',
  stop_turn: 'stopped its lead’s turn',
  hold: 'held this task’s plan',
  restart: 'restarted this task',
  done: 'marked this task done',
  keep: 'kept this task for later',
  discard: 'discarded this task',
}

/** The person's words as a line quotes them: one line, and not too long. */
export const quoted = (words: string) => {
  const line = words.replace(/\s+/g, ' ').trim()
  return `“${line.length > 140 ? `${line.slice(0, 139)}…` : line}”`
}

/**
 * The person's latest message in the live turn, from the window or a paired
 * device, as the tool server read the turn (`Errands.turn`): their word for
 * what the coordinator works out from it. Undefined where the turn has none:
 * news, a lead or Althar started it, or a socket's message.
 */
export const personsWords = (access: ToolAccess) =>
  Effect.gen(function* () {
    if (access.role !== 'coordinator' || access.byPerson !== true || access.turnId == null) return undefined
    const ids = access.messages ?? []
    if (ids.length === 0) return undefined
    const sql = yield* SqlClient.SqlClient
    const [message] = yield* sql<{ body: string }>`
      SELECT body FROM user_inputs WHERE id IN ${sql.in(ids)} ORDER BY sequence DESC LIMIT 1`
    return message?.body
  })

export class TaskActions extends Context.Service<
  TaskActions,
  {
    /** The person answers a card asking them to do a move: yes does it, as their press; no leaves the task as it is. */
    answer(itemId: string, yes: boolean, actorId: ActorId): Effect.Effect<void, unknown>
  }
>()('@althar/runtime/TaskActions') {
  static readonly layer: Layer.Layer<TaskActions, never, Store | ToolServer> = Layer.effect(
    TaskActions,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const instance = yield* Instance
      const tasks = yield* Tasks
      const plans = yield* Plans
      const changes = yield* Changes
      const sessions = yield* Sessions
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)

      /** A task of the project, by its slug or its id, with its thread and whether it is a change. */
      const taskOf = (projectId: string, reference: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [task] = yield* sql<{
            id: string
            slug: string
            title: string
            projectId: ProjectId
            threadId: string
            change: number
          }>`
            SELECT k.id, k.slug, k.title, k.project_id, t.id AS thread_id,
              CASE WHEN ${sql.unsafe(quickIn('k'))} OR ${sql.unsafe(reviewsIn('k'))}
                THEN 0 ELSE 1 END AS change
            FROM tasks k JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
            WHERE k.project_id = ${projectId} AND (k.id = ${reference} OR k.slug = ${reference})`
          return task === undefined
            ? yield* new ToolRefused({ message: `This project has no task ${reference}. list_tasks shows them.` })
            : task
        })

      type Task = Effect.Success<ReturnType<typeof taskOf>>

      /**
       * Does a move, as the person's button does: what it did, or why there was
       * nothing to do. Read where it stands first, so a move that no longer
       * applies does nothing, as a second press does.
       */
      const perform = (task: Task, move: TaskMove, actorId: ActorId) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const standing = yield* standingOf(task.id)
          const can = actionsOf(standing)
          const said = (type: string) => envelope(type, { taskId: task.id }, undefined, actorId)
          const nothing = (why: string): Outcome => ({ done: false, said: why })
          const did = (what = `${DID[move]} ${task.slug}.`): Outcome => ({ done: true, said: what })
          switch (move) {
            case 'stop':
              if (!can.includes('stop')) return nothing(`${task.slug} isn’t running: there is nothing to stop.`)
              yield* tasks.stop({ envelope: yield* said('task.stop'), taskId: task.id })
              yield* changes.leadStopped({ taskId: task.id })
              return did(`Stopped ${task.slug}: its step is cut short and its agents stopped. Restarting carries it on.`)
            case 'stop_turn': {
              const lead = yield* sessions.running(task.threadId)
              if (Option.isNone(lead) || !lead.value.turnRunning)
                return nothing(`${task.slug}’s lead isn’t in a turn: there is nothing to stop.`)
              yield* changes.leadStopped({ threadId: task.threadId }, 'interrupted')
              yield* sessions.interrupt(task.threadId)
              return did(`Stopped the lead’s turn on ${task.slug}: it waits for the next message.`)
            }
            case 'hold': {
              const [plan] = yield* sql<{ id: string; startsAt: string | null }>`
                SELECT id, starts_at FROM task_plans WHERE task_id = ${task.id} AND state = 'proposed' ORDER BY proposed_at DESC LIMIT 1`
              if (plan === undefined)
                return nothing(
                  can.includes('stop')
                    ? `${task.slug} has started: there is no plan to hold. Stop it instead.`
                    : `${task.slug} has no plan waiting to start.`,
                )
              if (plan.startsAt === null) return nothing(`${task.slug} is held already: it waits until it is started.`)
              yield* plans.hold(plan.id, actorId)
              return did(`Held ${task.slug}: its plan waits until it is started.`)
            }
            case 'restart': {
              if (standing.state === 'abandoned') {
                yield* tasks.reopen({ envelope: yield* said('task.reopen'), taskId: task.id })
                // Cut short when it was discarded, it carries on as a stopped one does.
                const again = yield* standingOf(task.id)
                if (actionsOf(again).includes('resume')) yield* tasks.resume({ envelope: yield* said('task.resume'), taskId: task.id })
                return did(`Restarted ${task.slug}: it is open again, on its worktree and branch.`)
              }
              if (can.includes('start')) {
                const [plan] = yield* sql<{ id: string }>`
                  SELECT id FROM task_plans WHERE task_id = ${task.id} AND state = 'proposed' ORDER BY proposed_at DESC LIMIT 1`
                if (plan === undefined) return nothing(`${task.slug} has no plan waiting to start.`)
                const started = yield* plans.start(plan.id, actorId)
                return started === null
                  ? nothing(`${task.slug}’s plan no longer stood to start.`)
                  : did(
                      started === 'waiting'
                        ? `Started ${task.slug}: it waits for a place among the agents at work.`
                        : `Started ${task.slug}.`,
                    )
              }
              if (!can.includes('resume'))
                return nothing(
                  standing.state === 'done'
                    ? `${task.slug} is settled. Writing to its lead opens it again.`
                    : `${task.slug} isn’t stopped, held or discarded: there is nothing to restart. Message its lead to change what it does.`,
                )
              yield* tasks.resume({ envelope: yield* said('task.resume'), taskId: task.id })
              return did(`Restarted ${task.slug}: it carries on from the step it was on, with its last lead.`)
            }
            case 'done': {
              if (standing.state === 'done') return nothing(`${task.slug} is done already: it is in Settled.`)
              if (standing.state === 'abandoned') return nothing(`${task.slug} is discarded: restart it first.`)
              if (task.change === 1)
                return nothing(
                  `${task.slug} is a change: it is done once its pull request merges. Merge it, or discard it to settle it without.`,
                )
              return (yield* tasks.markDone({ envelope: yield* said('task.mark_done'), taskId: task.id }))
                ? did(`Marked ${task.slug} done: it is in Settled, and what it left running stops.`)
                : nothing(`${task.slug} can’t be marked done yet: it is still at work, or something on it waits on the person.`)
            }
            case 'keep': {
              if (task.change === 1)
                return nothing(`${task.slug} is a change: it waits on its pull request, not in Needs you, so there is nothing to keep.`)
              if (standing.state !== 'open') return nothing(`${task.slug} is settled already.`)
              return (yield* tasks.keep({ envelope: yield* said('task.keep'), taskId: task.id }))
                ? did(`Kept ${task.slug} for later: out of Needs you as it is, under Kept for later. Writing to it brings it back.`)
                : nothing(`${task.slug} is kept for later already.`)
            }
            case 'discard': {
              if (standing.state === 'abandoned') return nothing(`${task.slug} is discarded already.`)
              if (standing.state === 'done') {
                // Merged, with commits after its pull requests in none yet: discarding leaves those out, as its menu's Abandon does.
                const before = (yield* sql<{ revision: number }>`SELECT revision FROM tasks WHERE id = ${task.id}`)[0]?.revision
                yield* tasks.leaveOut({ envelope: yield* said('task.leave_out'), taskId: task.id })
                const after = (yield* sql<{ revision: number }>`SELECT revision FROM tasks WHERE id = ${task.id}`)[0]?.revision
                return before === after
                  ? nothing(`${task.slug} merged: it is done, and there is nothing to discard.`)
                  : did(`Left out the commits ${task.slug} made after its pull request: it stays merged, and they stay on its branch.`)
              }
              yield* tasks.abandon({ envelope: yield* said('task.abandon'), taskId: task.id })
              return did(
                `Discarded ${task.slug}: it is in Settled, its agents stopped, and its worktree and branch stay. Restarting opens it again.`,
              )
            }
          }
        })

      /** A line in a thread, as Althar says what happened. */
      const line = (projectId: ProjectId, threadId: string, title: string) =>
        addItem({ projectId, threadId }, 'notice', { source: 'runtime', severity: 'info', title })

      /** What a card says, with what became of it. */
      const settle = (projectId: ProjectId, itemId: string, card: TaskAskContent, state: TaskAskContent['state'], said: string | null) =>
        updateItem(projectId, itemId, { ...card, state, said } satisfies TaskAskContent)

      const Asked = Schema.Struct({ task: Schema.String, why: Schema.optional(Schema.String) })
      const Settling = Schema.Struct({
        task: Schema.String,
        how: Schema.Literals(['done', 'keep', 'discard']),
        why: Schema.optional(Schema.String),
      })
      const Stopping = Schema.Struct({ task: Schema.String, turn: Schema.optional(Schema.Boolean), why: Schema.optional(Schema.String) })
      const read = <A>(schema: Schema.Codec<A, unknown>, input: unknown) =>
        Schema.decodeUnknownEffect(schema)(input).pipe(
          Effect.mapError((error) => new ToolRefused({ message: `Althar couldn't read that: ${error.message}` })),
        )

      /**
       * A move asked of the coordinator: done at once on the person's word in
       * this turn, with a line in both threads; else a card asking them, one
       * for each task and move while it is open.
       */
      const ask = (access: ToolAccess, reference: string, move: TaskMove, why: string | undefined) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const task = yield* taskOf(access.projectId, reference)
          const words = yield* personsWords(access)
          if (words !== undefined) {
            const outcome = yield* perform(task, move, instance.coordinatorId)
            if (!outcome.done) return `Nothing changed: ${outcome.said}`
            yield* line(task.projectId, access.threadId, `${DID[move]} “${task.title}”, as you asked: ${quoted(words)}`)
            yield* line(task.projectId, task.threadId, `The coordinator ${DID_HERE[move]}, as you asked: ${quoted(words)}`)
            yield* fact({
              projectId: task.projectId,
              aggregateType: 'task',
              aggregateId: task.id,
              revision: (yield* sql<{ revision: number }>`SELECT revision FROM tasks WHERE id = ${task.id}`)[0]?.revision ?? 1,
              type: 'task.moved_on_word',
              payload: { move, words },
              actorId: instance.coordinatorId,
            })
            return `${outcome.said} Both threads have a line saying so; say it in a sentence.`
          }
          // Not on the person's word: one card for the move, which a second call finds rather than adding another.
          const [open] = yield* sql<{ id: string }>`
            SELECT id FROM thread_items WHERE thread_id = ${access.threadId} AND kind = 'task_ask'
              AND json_extract(content, '$.taskId') = ${task.id} AND json_extract(content, '$.move') = ${move}
              AND json_extract(content, '$.state') = 'open'`
          if (open !== undefined) return `The person has a card asking this already. Nothing happens until they press it.`
          const card: TaskAskContent = {
            taskId: task.id,
            threadId: task.threadId,
            slug: task.slug,
            title: task.title,
            move,
            why: why?.trim() || null,
            state: 'open',
            said: null,
          }
          yield* addItem({ projectId: task.projectId, threadId: access.threadId }, 'task_ask', card)
          return `This turn has no message from the person, so nothing changed: they have a card asking it, and it happens when they press it. Say why in a sentence.`
        })

      const answer = (itemId: string, yes: boolean, actorId: ActorId) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [item] = yield* sql<{ projectId: ProjectId; threadId: string; content: string }>`
            SELECT project_id, thread_id, content FROM thread_items WHERE id = ${itemId} AND kind = 'task_ask'`
          if (item === undefined) return
          const card = JSON.parse(item.content) as TaskAskContent
          // Answered already, a second press is the first.
          if (card.state !== 'open') return
          const task = yield* taskOf(item.projectId, card.taskId).pipe(Effect.option)
          if (!yes || Option.isNone(task)) {
            yield* settle(item.projectId, itemId, card, 'declined', null)
            yield* heard(item.projectId, card, 'declined', null, actorId)
            return
          }
          const outcome = yield* perform(task.value, card.move, actorId)
          yield* settle(item.projectId, itemId, card, outcome.done ? 'done' : 'moot', outcome.said)
          if (outcome.done)
            yield* line(task.value.projectId, task.value.threadId, `You ${DID_HERE[card.move]}, from the coordinator’s card.`)
          yield* heard(item.projectId, card, outcome.done ? 'done' : 'moot', outcome.said, actorId)
        })

      /** What the person answered, kept for the coordinator to hear at its next turn. */
      const heard = (projectId: ProjectId, card: TaskAskContent, state: TaskAskContent['state'], said: string | null, actorId: ActorId) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [task] = yield* sql<{ revision: number }>`SELECT revision FROM tasks WHERE id = ${card.taskId}`
          yield* fact({
            projectId,
            aggregateType: 'task',
            aggregateId: card.taskId,
            revision: task?.revision ?? 1,
            type: 'task.ask_answered',
            payload: { move: card.move, state, said },
            actorId,
          })
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
                    Effect.logWarning('A task action did not succeed', error),
                    Effect.fail(new ToolRefused({ message: 'Althar could not do that. Try again, or tell the person.' })),
                  ),
            ),
          ),
      })
      const task = { type: 'string', description: "The task's slug, as list_tasks shows it." }
      const why = {
        type: 'string',
        description: 'Only for a card: why you ask, in a line the person reads on it.',
      }

      yield* (yield* ToolServer).serve('coordinator', [
        tool(
          'stop_task',
          'Stops a task when the person asks, as their Stop does: its step is cut short and its agents stop, its work kept. With turn, only its lead’s current turn ends, and it waits for the next message. restart_task carries a stopped task on.',
          { type: 'object', properties: { task, turn: { type: 'boolean' }, why }, required: ['task'] },
          (access, input) =>
            Effect.flatMap(read(Stopping, input), (asked) =>
              ask(access, asked.task, asked.turn === true ? 'stop_turn' : 'stop', asked.why),
            ),
        ),
        tool(
          'hold_task',
          'Holds a task’s plan that is counting down to start, when the person asks: it waits until it is started. For a task already at work, stop it instead.',
          { type: 'object', properties: { task, why }, required: ['task'] },
          (access, input) => Effect.flatMap(read(Asked, input), (asked) => ask(access, asked.task, 'hold', asked.why)),
        ),
        tool(
          'restart_task',
          'Restarts a task when the person asks: a held one starts, a stopped one carries on from its step with its last lead, and a discarded one opens again on its worktree and branch.',
          { type: 'object', properties: { task, why }, required: ['task'] },
          (access, input) => Effect.flatMap(read(Asked, input), (asked) => ask(access, asked.task, 'restart', asked.why)),
        ),
        tool(
          'settle_task',
          'Settles a task when the person says it is done, to keep it for later, or to discard it. done and keep are for a task that isn’t a change (a quick task, or a review); a change is done when its pull request merges. discard settles any task as it stands: its worktree and branch stay, and restart_task opens it again. One call for each task.',
          {
            type: 'object',
            properties: { task, how: { type: 'string', enum: ['done', 'keep', 'discard'] }, why },
            required: ['task', 'how'],
          },
          (access, input) => Effect.flatMap(read(Settling, input), (asked) => ask(access, asked.task, asked.how, asked.why)),
        ),
      ])

      return TaskActions.of({ answer: (itemId, yes, actorId) => provide(answer(itemId, yes, actorId)) })
    }),
  )
}
