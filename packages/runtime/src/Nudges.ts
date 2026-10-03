import type { StuckStep } from '@charrette/contracts'
import { Ledger } from '@charrette/persistence-sqlite'
import { Context, Duration, Effect, Layer, Option, PubSub, Ref, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { Agents } from './Config'
import { stuckOf } from './Queries'
import { programOf } from './rules'
import { Sessions } from './Sessions'

/*
 * What reaches the person outside the window (docs/plans/usable.md, work
 * that doesn't need you): a nudge each time something comes to need them,
 * a call or a task ready to accept, and how many such things wait, for the
 * app's badge. Never for progress. Read from the store, in two small
 * queries, whenever a change that can bear on it is recorded; what already
 * waited when Charrette started isn't nudged again.
 */

/** Changes are gathered for a moment, so a burst is read once. */
const GATHER = Duration.millis(250)

/** How many changes are read at a time to see whether any bears on what needs the person. */
const PAGE = 500

/**
 * What changes when something comes to need the person or stops doing so: a
 * call, a task, its plan or run, a step, a session starting, a turn ending. A
 * thread's items, most of what is recorded, never do.
 */
const MOVES: ReadonlySet<string> = new Set([
  'attention_request',
  'task',
  'task_plan',
  'run',
  'node_attempt',
  'provider_session',
  'turn_delivery',
])

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

const parse = (json: string | null): unknown => {
  if (json === null) return null
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

const text = (value: unknown, key: string): string => {
  const found = typeof value === 'object' && value !== null && key in value ? (value as Record<string, unknown>)[key] : undefined
  return typeof found === 'string' ? found : ''
}

/**
 * A call, in the words a nudge says it: which step stopped, or what the agent
 * asks to do. A notification can show on a locked screen, so a command is
 * named only by what it runs (`vercel deploy`); its arguments, which may hold
 * a secret, stay in the window.
 */
export const callWords = (call: { readonly kind: string; readonly payload: unknown }, agentName: (agentId: string) => string): string => {
  if (call.kind === 'stuck') {
    const stuck = stuckOf(call.payload)
    if (stuck.why === 'usage_limit' && stuck.agentId !== null) return `Needs you: ${agentName(stuck.agentId)} reached its usage limit`
    return `Needs you: ${STEPS[stuck.step]} is stuck`
  }
  const program = text(call.payload, 'kind') === 'execute' ? programOf(text(call.payload, 'command')) : undefined
  if (program !== undefined) return `Needs you: ${program}`
  const reason = text(call.payload, 'reason')
  return reason === '' ? 'Needs you: An agent asks first' : `Needs you: ${reason}`
}

/** A task ready to accept, in the words a nudge says it: what its lead last said it did. */
export const readyWords = (summary: string | null): string => {
  const said = summary?.split('\n')[0]?.trim()
  return said === undefined || said === '' ? 'Ready to look at' : `Ready: ${said}`
}

export class Nudges extends Context.Service<
  Nudges,
  {
    /** How many things wait on the person now, then each nudge and each change of that count, as they come. */
    readonly events: Stream.Stream<NudgeEvent>
  }
>()('@charrette/runtime/Nudges') {
  static readonly layer: Layer.Layer<Nudges, never, SqlClient.SqlClient | Ledger | Sessions | Agents> = Layer.effect(
    Nudges,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const ledger = yield* Ledger
      const sessions = yield* Sessions
      const agents = yield* Agents
      const published = yield* PubSub.unbounded<NudgeEvent>()
      const waiting = yield* Ref.make(0)

      const agentName = (agentId: string) => agents.list.find((entry) => entry.definition.id === agentId)?.definition.name ?? agentId

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
            body: callWords({ kind: call.kind, payload: parse(call.payload) }, agentName),
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
            body: readyWords(text(parse(task.latest), 'summary') || null),
            threadId: task.threadId,
          })
        }
        return found
      })

      const latest = Effect.map(
        sql<{ cursor: number }>`SELECT coalesce(max(cursor), 0) AS cursor FROM change_log`,
        ([row]) => row?.cursor ?? 0,
      )

      /** Whether a change after `cursor` bears on what needs the person, and the cursor to read on from. */
      const movedSince = (cursor: number) =>
        Effect.gen(function* () {
          let at = cursor
          for (;;) {
            const changes = yield* ledger.changesSince(at, PAGE)
            if (changes.some((change) => MOVES.has(change.aggregateType))) return { at: yield* latest, moved: true }
            at = changes.at(-1)?.cursor ?? at
            if (changes.length < PAGE) return { at, moved: false }
          }
        })

      // What needs the person is read again whenever a change that bears on it is recorded, and what is new is said once.
      yield* Effect.forkScoped(
        Effect.gen(function* () {
          const grown = yield* ledger.listen
          let cursor = yield* latest.pipe(Effect.orElseSucceed(() => 0))
          let seen: ReadonlyMap<string, unknown> | undefined
          for (;;) {
            const now = yield* needs.pipe(
              Effect.catchCause((cause) => Effect.as(Effect.logWarning('Could not read what needs the person', cause), undefined)),
            )
            if (now !== undefined) {
              if (seen !== undefined) for (const [key, nudge] of now) if (!seen.has(key)) yield* PubSub.publish(published, nudge)
              if ((yield* Ref.getAndSet(waiting, now.size)) !== now.size || seen === undefined)
                yield* PubSub.publish(published, { _tag: 'Waiting', count: now.size })
              seen = now
            }
            for (;;) {
              yield* grown
              yield* Effect.sleep(GATHER)
              const read = yield* movedSince(cursor).pipe(Effect.orElseSucceed(() => ({ at: cursor, moved: true })))
              cursor = read.at
              if (read.moved) break
            }
          }
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
