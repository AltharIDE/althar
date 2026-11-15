import {
  type NudgeKind,
  kindWords,
  plainTitle,
  type ReadyTask,
  readyWordOf,
  type ReviewBrief,
  type StuckStep,
  waitingCount,
  waitingOn,
} from '@althar/contracts'
import { Ledger } from '@althar/persistence-sqlite'
import { Cause, Context, Duration, Effect, Layer, Option, PubSub, Ref, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

import { Agents } from './Config'
import { outStep } from './Limits'
import { field, Queries, stuckOf, text } from './Queries'
import { programOf } from './rules'
import { Sessions } from './Sessions'

/*
 * What reaches the person outside the window (docs/plans/usable.md, work
 * that doesn't need you): a nudge each time something comes to need them,
 * a call, work that stopped, or a task ready to accept, each said by its
 * kind so the app can keep to what the person wants told; and how many such
 * things wait, for the app's badge. Never for progress. What waits, and how
 * many things that is, is `waitingOn`'s (in contracts), the rule the board's
 * Needs you, the home, the edge and the tabs count by, over the cards the
 * card watcher keeps (Queries' `waiting`): so the badge, the menu bar and a
 * notification never say ready what the board shows under way, in its merge
 * queue or its checks running, and never leave out what is back in Needs
 * you. A ready task is said in its card's word (`readyWordOf`). With them,
 * whether any work runs, so the app can keep the Mac awake while it does.
 * Read again whenever a change that can bear on it is recorded, a card
 * coming out different among them; what already waited when Althar started
 * isn't nudged again.
 */

/** How long changes are gathered, so a burst is read once. */
const GATHER = Duration.millis(250)

export type { NudgeKind } from '@althar/contracts'
export type NudgeEvent = import('@althar/contracts').AttentionEvent

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
      return `Needs you: ${agent} ran out of usage${stuck.step === 'publish' ? '' : ` ${outStep[stuck.step].during}`}`
    }
    // The lead asks, and waits for the answer: the question is what the person sees first.
    if (stuck.why === 'waiting_on_person') {
      const asked = (stuck.detail ?? '').replace(/\s+/g, ' ').trim()
      return asked === ''
        ? 'Needs you: A step waits on your answer'
        : `Needs you: ${asked.length > 140 ? `${asked.slice(0, 139)}…` : asked}`
    }
    return `Needs you: ${STEPS[stuck.step]} is stuck`
  }
  if (call.kind === 'question') {
    const fields = field(call.payload, 'fields')
    const asks: ReadonlyArray<unknown> = Array.isArray(fields) ? fields : []
    const asked = (text(asks[0], 'question') || text(call.payload, 'message')).replace(/\s+/g, ' ').trim()
    const more = asks.length > 1 ? ` (and ${asks.length - 1} more)` : ''
    return asked === '' ? 'Question' : `Question: ${asked.length > 140 ? `${asked.slice(0, 139)}…` : asked}${more}`
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

/** What a lead left for the person on a tracker, in the words a nudge says it: issues to file, else changes to its issue. */
export const issuesWords = (issues: { readonly drafts: number; readonly changes: number } | undefined): string => {
  const drafts = issues?.drafts ?? 0
  const changes = issues?.changes ?? 0
  if (drafts > 0) return drafts === 1 ? 'An issue to file' : `${drafts} issues to file`
  return changes === 1 ? 'An issue change to apply' : `${changes} issue changes to apply`
}

/** A review drafted, in the words a nudge says it: whose pull request waits for the person to post its review. */
export const draftedWords = (number: number, author: string): string => `Review drafted: #${number} by ${author}`

/**
 * A ready task, in the words its nudge says it: its card's word (`readyWordOf`), so a notification never says ready what
 * its card says isn't; where that is plainly ready, or finished, what its lead last said it did; a review drafted, whose.
 */
export const readyBody = (
  task: ReadyTask & { readonly summary: string | null; readonly reviewing?: ReviewBrief | null | undefined },
): string => {
  const word = readyWordOf(task)
  if (word === kindWords.drafted && task.reviewing != null) return draftedWords(task.reviewing.number, task.reviewing.author)
  return word === kindWords.ready || word === kindWords.finished ? readyWords(task.summary ?? '') : word
}

export class Nudges extends Context.Service<
  Nudges,
  {
    /** How many things wait on the person now and whether work runs, then each nudge and each change of either, as they come. */
    readonly events: Stream.Stream<NudgeEvent>
  }
>()('@althar/runtime/Nudges') {
  static readonly layer: Layer.Layer<Nudges, never, SqlClient.SqlClient | Ledger | Sessions | Agents | Queries> = Layer.effect(
    Nudges,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const ledger = yield* Ledger
      const sessions = yield* Sessions
      const agents = yield* Agents
      const queries = yield* Queries
      const published = yield* PubSub.unbounded<NudgeEvent>()
      const waiting = yield* Ref.make(0)
      const working = yield* Ref.make(false)

      /**
       * Everything that needs the person now, by a key that stays the same
       * while it does, and how many things that is, as the board's Needs you
       * counts them (`waitingOn`): read from the cards the card watcher
       * keeps, none worked out here. Each call is said as it comes, though a
       * task that waits on several is one thing; a task whose lead stopped
       * is counted, but nothing is said of it: the person stopped it, or saw
       * it stop where they were.
       */
      const needs = Effect.gen(function* () {
        const found = new Map<string, Extract<NudgeEvent, { _tag: 'Nudge' }>>()
        const { tasks, calls } = yield* queries.waiting
        const on = waitingOn(tasks, calls)
        const nudge = (key: string, kind: NudgeKind, title: string, body: string, threadId: string) =>
          found.set(key, { _tag: 'Nudge', kind, key, title, body, threadId })
        for (const call of calls)
          nudge(
            `call:${call.id}`,
            call.kind === 'stuck' ? 'stopped' : 'call',
            plainTitle(call.title),
            callWords({ kind: call.kind, payload: call.payload }, agents.list),
            call.threadId,
          )
        // Issues a lead drafted, or changes it proposed to its issue, for the person: one nudge for a task, whatever the number.
        for (const task of on.issues) nudge(`issues:${task.threadId}`, 'call', task.title, issuesWords(task.issues), task.threadId)
        for (const task of on.ready) nudge(`ready:${task.taskId}`, 'ready', task.title, readyBody(task), task.threadId)
        return { found, count: waitingCount(on) }
      })

      /**
       * Whether any work runs, as the home counts it: an agent on a task's
       * step, or on its way to one, a step held until a usage limit resets,
       * which starts again by itself, or a plan counting down to its start;
       * or an agent mid-turn on any thread, as when the person talks to a
       * lead after its run, or to a coordinator, and while it waits on them
       * for a permission. A task stopped, or stuck on the person, runs no more.
       */
      const runs = Effect.gen(function* () {
        const [waiting] = yield* sql<{ id: string }>`
          SELECT a.id FROM node_attempts a JOIN nodes n ON n.id = a.node_id JOIN workflow_executions e ON e.id = n.execution_id
            JOIN runs r ON r.id = e.run_id JOIN tasks k ON k.id = r.task_id JOIN projects p ON p.id = k.project_id AND p.archived_at IS NULL
          WHERE r.state IN ('admitted', 'running') AND k.state NOT IN ('done', 'abandoned')
            AND (a.state IN ('admitted', 'held') OR (a.state = 'running' AND EXISTS (SELECT 1 FROM provider_sessions s JOIN threads h ON h.id = s.thread_id
              WHERE h.task_id = k.id AND s.state IN ('starting', 'active', 'waiting_approval', 'cancelling'))))
          UNION ALL
          SELECT t.id FROM task_plans t JOIN tasks k ON k.id = t.task_id JOIN projects p ON p.id = k.project_id AND p.archived_at IS NULL
          WHERE t.state = 'proposed' AND t.starts_at IS NOT NULL AND k.state NOT IN ('done', 'abandoned')
          UNION ALL
          SELECT id FROM provider_sessions WHERE state = 'starting'
          LIMIT 1`
        if (waiting !== undefined) return true
        const threads = yield* sql<{ threadId: string }>`
          SELECT DISTINCT thread_id FROM provider_sessions WHERE state IN ('active', 'waiting_approval', 'cancelling')`
        for (const { threadId } of threads)
          if (Option.exists(yield* sessions.running(threadId), (session) => session.turnRunning)) return true
        return false
      })

      const latest = Effect.map(sql<{ cursor: number }>`SELECT coalesce(max(cursor), 0) AS cursor FROM change_log`, (rows) =>
        Math.max(0, ...rows.map((row) => row.cursor)),
      )

      /**
       * Whether a change after `cursor` bears on what needs the person: a call,
       * a task's card coming out different (its checks, say), the task, its
       * plan or run, a step, a session starting, a turn ending, a review or an
       * issue drafted, posted, filed or dropped. A thread's items, most of what
       * is recorded, never do.
       */
      const movedSince = (cursor: number) =>
        Effect.map(
          sql<{ moved: number }>`
            SELECT EXISTS (SELECT 1 FROM change_log WHERE cursor > ${cursor} AND aggregate_type IN ('attention_request', 'card', 'project', 'task',
              'task_plan', 'run', 'node_attempt', 'provider_session', 'turn_delivery', 'review_draft', 'issue_draft')) AS moved`,
          (rows) => rows.some((row) => row.moved === 1),
        )

      // What needs the person is read again whenever a change that bears on it is recorded, and what is new is said once.
      yield* Effect.forkScoped(
        Effect.gen(function* () {
          const grown = yield* ledger.listen
          let seen: ReadonlyMap<string, unknown> | undefined
          const round = Effect.gen(function* () {
            const cursor = yield* latest
            const { found: now, count } = yield* needs
            if (seen !== undefined) for (const [key, nudge] of now) if (!seen.has(key)) yield* PubSub.publish(published, nudge)
            if ((yield* Ref.getAndSet(waiting, count)) !== count || seen === undefined)
              yield* PubSub.publish(published, { _tag: 'Waiting', count })
            const busy = yield* runs
            if ((yield* Ref.getAndSet(working, busy)) !== busy || seen === undefined)
              yield* PubSub.publish(published, { _tag: 'Working', working: busy })
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
              // Stopping isn't a failure to read: an interrupt ends it, rather than leaving a warning in the log on every quit.
              Effect.catchCause((cause) =>
                Cause.hasInterruptsOnly(cause)
                  ? Effect.interrupt
                  : Effect.andThen(Effect.logWarning('Could not read what needs the person', cause), grown),
              ),
            ),
          )
        }),
      )

      return Nudges.of({
        events: Stream.unwrap(
          Effect.gen(function* () {
            const subscription = yield* PubSub.subscribe(published)
            const now: ReadonlyArray<NudgeEvent> = [
              { _tag: 'Waiting', count: yield* Ref.get(waiting) },
              { _tag: 'Working', working: yield* Ref.get(working) },
            ]
            return Stream.concat(Stream.fromIterable(now), Stream.fromSubscription(subscription))
          }),
        ),
      })
    }),
  )
}
