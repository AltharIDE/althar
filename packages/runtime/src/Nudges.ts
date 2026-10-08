import type { StuckStep } from '@althar/contracts'
import { Ledger } from '@althar/persistence-sqlite'
import { Context, Duration, Effect, Layer, Option, PubSub, Ref, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { Agents } from './Config'
import { parse, stuckOf, text } from './Queries'
import { programOf } from './rules'
import { Sessions } from './Sessions'

/*
 * What reaches the person outside the window (docs/plans/usable.md, work
 * that doesn't need you): a nudge each time something comes to need them,
 * a call or a task ready to accept, and how many such things wait, for the
 * app's badge. Never for progress. Read from the store, in two small
 * queries, whenever a change that can bear on it is recorded; what already
 * waited when Althar started isn't nudged again.
 */

/** How long changes are gathered, so a burst is read once. */
const GATHER = Duration.millis(250)

export type NudgeEvent =
  /** Something came to need the person: a call, or a task ready to accept. */
  | { readonly _tag: 'Nudge'; readonly key: string; readonly title: string; readonly body: string; readonly threadId: string }
  /** How many things wait on the person, across every project. */
  | { readonly _tag: 'Waiting'; readonly count: number }

/** What a step that needs the person is called in a nudge. */
const STEPS: Readonly<Record<StuckStep['step'], string>> = {
  implement: 'Implement',
  review: 'Review',
  settle: 'Settling the review',
  publish: 'Opening the pull request',
}

/**
 * A call, in the words a nudge says it: which step stopped, or what the agent
 * asks to do. A notification can show on a locked screen, so a command is
 * named only by what it runs (`vercel deploy`); its arguments, which may hold
 * a secret, stay in the window.
 */
export const callWords = (
  call: { readonly kind: string; readonly payload: unknown },
  agents: ReadonlyArray<{ readonly definition: { readonly id: string; readonly name: string } }>,
): string => {
  if (call.kind === 'stuck') {
    const stuck = stuckOf(call.payload)
    if (stuck.why === 'usage_limit' && stuck.agentId !== null) {
      const agent = agents.find((entry) => entry.definition.id === stuck.agentId)?.definition.name ?? stuck.agentId
      return `Needs you: ${agent} reached its usage limit`
    }
    return `Needs you: ${STEPS[stuck.step]} is stuck`
  }
  const program = text(call.payload, 'kind') === 'execute' ? programOf(text(call.payload, 'command')) : undefined
  if (program !== undefined) return `Needs you: ${program}`
  const reason = text(call.payload, 'reason')
  return reason === '' ? 'Needs you: An agent asks first' : `Needs you: ${reason}`
}

/** A task ready to accept, in the words a nudge says it: what its lead last said it did. */
export const readyWords = (summary: string): string => {
  const said = summary.trim().split('\n', 1).join('').trim()
  return said === '' ? 'Ready to look at' : `Ready: ${said}`
}

export class Nudges extends Context.Service<
  Nudges,
  {
    /** How many things wait on the person now, then each nudge and each change of that count, as they come. */
    readonly events: Stream.Stream<NudgeEvent>
  }
>()('@althar/runtime/Nudges') {
  static readonly layer: Layer.Layer<Nudges, never, SqlClient.SqlClient | Ledger | Sessions | Agents> = Layer.effect(
    Nudges,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const ledger = yield* Ledger
      const sessions = yield* Sessions
      const agents = yield* Agents
      const published = yield* PubSub.unbounded<NudgeEvent>()
      const waiting = yield* Ref.make(0)

      /** Everything that needs the person now, by a key that stays the same while it does. */
      const needs = Effect.gen(function* () {
        const found = new Map<string, Extract<NudgeEvent, { _tag: 'Nudge' }>>()
        const calls = yield* sql<{ id: string; kind: string; payload: string; threadId: string; title: string }>`
          SELECT a.id, a.kind, a.payload, t.id AS thread_id, k.title
          FROM attention_requests a JOIN tasks k ON k.id = a.task_id JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
          WHERE a.state = 'open' ORDER BY a.created_at, a.id`
        for (const call of calls)
          found.set(`call:${call.id}`, {
            _tag: 'Nudge',
            key: `call:${call.id}`,
            title: call.title,
            body: callWords({ kind: call.kind, payload: parse(call.payload) }, agents.list),
            threadId: call.threadId,
          })
        // Ready as its card reads it (Queries): its last run succeeded, nothing it planned waits to start, no call waits,
        // and no agent of its is starting or mid-turn.
        const ready = yield* sql<{ taskId: string; threadId: string; title: string; review: string | null; latest: string | null }>`
          SELECT k.id AS task_id, t.id AS thread_id, k.title,
            (SELECT s.id FROM threads s WHERE s.task_id = k.id AND s.kind = 'step' LIMIT 1) AS review,
            (SELECT i.content FROM thread_items i WHERE i.thread_id = t.id AND i.kind = 'step_result'
              AND json_extract(i.content, '$.step') IN ('implement', 'settle') ORDER BY i.sequence DESC LIMIT 1) AS latest
          FROM tasks k
          JOIN threads t ON t.task_id = k.id AND t.kind = 'task'
          JOIN runs r ON r.id = (SELECT id FROM runs WHERE task_id = k.id ORDER BY created_at DESC LIMIT 1)
          JOIN projects p ON p.id = k.project_id AND p.archived_at IS NULL
          WHERE k.state NOT IN ('done', 'abandoned') AND r.state = 'succeeded'
            AND coalesce((SELECT state FROM task_plans WHERE task_id = k.id AND state IN ('proposed', 'accepted')
              ORDER BY proposed_at DESC LIMIT 1), '') <> 'proposed'
            AND NOT EXISTS (SELECT 1 FROM attention_requests x WHERE x.task_id = k.id AND x.state = 'open')
            AND NOT EXISTS (SELECT 1 FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
              WHERE e.run_id = r.id AND a.state = 'admitted')
            AND NOT EXISTS (SELECT 1 FROM provider_sessions s JOIN threads h ON h.id = s.thread_id
              WHERE h.task_id = k.id AND s.state = 'starting')
          ORDER BY k.created_at, k.id`
        for (const task of ready) {
          const turning = (threadId: string | null) =>
            threadId === null
              ? Effect.succeed(false)
              : Effect.map(
                  sessions.running(threadId),
                  Option.exists((session) => session.turnRunning),
                )
          if ((yield* turning(task.threadId)) || (yield* turning(task.review))) continue
          found.set(`ready:${task.taskId}`, {
            _tag: 'Nudge',
            key: `ready:${task.taskId}`,
            title: task.title,
            body: readyWords(text(parse(task.latest), 'summary')),
            threadId: task.threadId,
          })
        }
        return found
      })

      const latest = Effect.map(sql<{ cursor: number }>`SELECT coalesce(max(cursor), 0) AS cursor FROM change_log`, (rows) =>
        Math.max(0, ...rows.map((row) => row.cursor)),
      )

      /**
       * Whether a change after `cursor` bears on what needs the person: a call,
       * a task, its plan or run, a step, a session starting, a turn ending. A
       * thread's items, most of what is recorded, never do.
       */
      const movedSince = (cursor: number) =>
        Effect.map(
          sql<{ moved: number }>`
            SELECT EXISTS (SELECT 1 FROM change_log WHERE cursor > ${cursor} AND aggregate_type IN ('attention_request', 'task',
              'task_plan', 'run', 'node_attempt', 'provider_session', 'turn_delivery')) AS moved`,
          (rows) => rows.some((row) => row.moved === 1),
        )

      // What needs the person is read again whenever a change that bears on it is recorded, and what is new is said once.
      yield* Effect.forkScoped(
        Effect.gen(function* () {
          const grown = yield* ledger.listen
          let seen: ReadonlyMap<string, unknown> | undefined
          const round = Effect.gen(function* () {
            const cursor = yield* latest
            const now = yield* needs
            if (seen !== undefined) for (const [key, nudge] of now) if (!seen.has(key)) yield* PubSub.publish(published, nudge)
            if ((yield* Ref.getAndSet(waiting, now.size)) !== now.size || seen === undefined)
              yield* PubSub.publish(published, { _tag: 'Waiting', count: now.size })
            seen = now
            // Changes are gathered for a moment, so a burst is read once.
            do {
              yield* grown
              yield* Effect.sleep(GATHER)
            } while (!(yield* movedSince(cursor)))
          })
          // Read again once the record next grows, when it couldn't be read.
          yield* Effect.forever(
            round.pipe(
              Effect.catchCause((cause) => Effect.andThen(Effect.logWarning('Could not read what needs the person', cause), grown)),
            ),
          )
        }),
      )

      return Nudges.of({
        events: Stream.unwrap(
          Effect.gen(function* () {
            const subscription = yield* PubSub.subscribe(published)
            const count = yield* Ref.get(waiting)
            const now: NudgeEvent = { _tag: 'Waiting', count }
            return Stream.concat(Stream.make(now), Stream.fromSubscription(subscription))
          }),
        ),
      })
    }),
  )
}
