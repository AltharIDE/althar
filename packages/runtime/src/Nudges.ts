import type { BoardCall, BoardTask } from '@charrette/contracts'
import { Ledger } from '@charrette/persistence-sqlite'
import { Context, Duration, Effect, Layer, PubSub, Ref, Stream } from 'effect'

import { Queries } from './Queries'

/*
 * What reaches the person outside the window (docs/plans/usable.md, work
 * that doesn't need you): a nudge each time something comes to need them,
 * a call or a task ready to accept, and how many such things wait, for the
 * app's badge. Never for progress. Worked out from every project's board
 * whenever the record grows; what already waited when Charrette started
 * isn't nudged again.
 */

/** How often the boards are read again when nothing says the record grew: a fallback. */
const FALLBACK = Duration.seconds(5)

/** Changes are gathered for a moment, so a burst is read once. */
const GATHER = Duration.millis(250)

export type NudgeEvent =
  /** Something came to need the person: a call, or a task ready to accept. */
  | { readonly _tag: 'Nudge'; readonly key: string; readonly title: string; readonly body: string; readonly threadId: string }
  /** How many things wait on the person, across every project. */
  | { readonly _tag: 'Waiting'; readonly count: number }

/** What a step that needs the person is called in a nudge. */
const STEPS: Readonly<Record<string, string>> = {
  implement: 'Implement',
  review: 'Review',
  settle: 'Settling the review',
  publish: 'Opening the pull request',
}

/** A call, in the words a nudge says it: what the agent asks, or which step stopped. */
export const callWords = (call: BoardCall): string => {
  if (call.kind === 'permission' || call.stuck === null) return `Needs you: ${call.title}`
  return `Needs you: ${STEPS[call.stuck.step] ?? 'A step'} is stuck`
}

/** A task ready to accept, in the words a nudge says it: what its lead last said it did. */
export const readyWords = (task: BoardTask): string => {
  const said = task.summary?.split('\n')[0]?.trim()
  return said === undefined || said === '' ? 'Ready to look at' : `Ready: ${said}`
}

export class Nudges extends Context.Service<
  Nudges,
  {
    /** How many things wait on the person now, then each nudge and each change of that count, as they come. */
    readonly events: Stream.Stream<NudgeEvent>
  }
>()('@charrette/runtime/Nudges') {
  static readonly layer: Layer.Layer<Nudges, never, Queries | Ledger> = Layer.effect(
    Nudges,
    Effect.gen(function* () {
      const queries = yield* Queries
      const ledger = yield* Ledger
      const published = yield* PubSub.unbounded<NudgeEvent>()
      const waiting = yield* Ref.make(0)

      /** Everything that needs the person now, by a key that stays the same while it does. */
      const needs = Effect.gen(function* () {
        const found = new Map<string, Extract<NudgeEvent, { _tag: 'Nudge' }>>()
        const { projects } = yield* queries.projects
        for (const project of projects) {
          const board = yield* queries.board(project.id)
          for (const call of board.calls)
            found.set(`call:${call.id}`, {
              _tag: 'Nudge',
              key: `call:${call.id}`,
              title: call.taskTitle,
              body: callWords(call),
              threadId: call.threadId,
            })
          for (const task of board.tasks)
            if (task.phase === 'ready')
              found.set(`ready:${task.taskId}`, {
                _tag: 'Nudge',
                key: `ready:${task.taskId}`,
                title: task.title,
                body: readyWords(task),
                threadId: task.threadId,
              })
        }
        return found
      })

      // The boards are read again whenever the record grows, and what is new to need the person is said once.
      yield* Effect.forkScoped(
        Effect.gen(function* () {
          const grown = yield* ledger.listen
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
            yield* Effect.raceFirst(grown, Effect.sleep(FALLBACK))
            yield* Effect.sleep(GATHER)
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
