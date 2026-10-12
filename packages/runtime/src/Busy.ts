import { cpus, totalmem } from 'node:os'

import type { Ledger } from '@althar/persistence-sqlite'
import { Cause, Context, Duration, Effect, Layer, Queue, Semaphore, Stream } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { type AtOnceDefault, atOnceFor, clamp } from './atOnce'
import { touchCard } from './cards'
import { RuntimeConfig } from './Config'
import { Live } from './Live'
import { timestamp } from './records'
import { Sessions } from './Sessions'

/*
 * How many tasks are at work at once on this machine, and what waits for a
 * place among them (DEV-58, ADR-031). A task takes a place while it is at
 * work: a step of its run admitted or under way (its lead's, or its
 * reviewer's), its lead asked about a conflict or the checks on one, an
 * agent starting on it, or any of its agents in a turn or with something it
 * left running still running. A lead only waiting on the person's answer to
 * a question takes none, unless what it left running still runs. A task's
 * steps follow one another in its one place, so it never waits on itself.
 * The coordinator, the permission judge and the runs Althar makes itself
 * take no place.
 *
 * Starting a task's work on Althar's own (a plan's first step, a step carried
 * on after a restart or by the person's resume, a step back from a usage
 * limit, a conflict or the checks on one put to its lead) asks for a place
 * first (`enter`). Without one, it waits, written in the store where it
 * waits so a restart doesn't lose it, behind whatever waited before it.
 * When a place frees, what waited longest starts (`queue`): looked at
 * whenever an agent's turn or session ends, what it left running changes, or
 * the person answers or is asked something, and every few seconds while
 * anything waits. What the person does to an agent themselves (a message, an
 * answer) never waits; it takes a place all the same.
 *
 * How many may be at once is the person's number, kept in the profile's
 * settings once they change it; otherwise the default this machine's cores
 * and memory give, worked out at each launch (atOnce.ts).
 */

/** The settings key the person's own number is kept under; none is kept for the default. */
const KEY = 'agents_at_once'

/** How many may be at once, and why. */
export interface AtOnce {
  /** The person's number, else the default. */
  readonly count: number
  /** The person's own number; null where they left the default. */
  readonly own: number | null
  /** The default, worked out at this launch from this machine's cores and memory. */
  readonly machine: AtOnceDefault
}

/** Something waiting for a place: its task, since when, and what starts it once it has one. */
export interface Waiter {
  readonly taskId: string
  /** When it began waiting: what waited longest goes first. */
  readonly since: string
  /**
   * Starts it, outside the queue's lock, its place held for it until this
   * ends: by then what it wrote counts toward the work at once, or it stopped
   * waiting another way (it needs the person, or nothing is left to start).
   */
  readonly start: Effect.Effect<void, unknown>
}

export class Busy extends Context.Service<
  Busy,
  {
    /** How many tasks may be at work at once here, and why. */
    readonly atOnce: Effect.Effect<AtOnce, SqlError.SqlError>
    /** Sets the person's own number, or, null, goes back to the default. It takes effect at once: what waits starts if there is room. */
    set(count: number | null): Effect.Effect<void, SqlError.SqlError>
    /** How many tasks are at work now, and how many may be. */
    readonly now: Effect.Effect<{ readonly busy: number; readonly atOnce: number }, SqlError.SqlError>
    /**
     * Decides, under the queue's lock, whether a task may start work now: one
     * at work already may; another only where a place is free and nothing
     * waits before it. `then` writes what was decided, the work admitted or
     * waiting, still under the lock, so it counts before anything else is
     * decided.
     */
    enter<A, E, R>(taskId: string, then: (room: boolean) => Effect.Effect<A, E, R>): Effect.Effect<A, unknown, R>
    /** Adds where waiting work is read from: each time the queue is looked at, every source is read, and what waited longest starts first. */
    queue(waiting: Effect.Effect<ReadonlyArray<Waiter>, unknown>): Effect.Effect<void>
    /** Looks at the queue again: a place may have freed, or something waits. */
    readonly wake: Effect.Effect<void>
  }
>()('@althar/runtime/Busy') {
  static readonly layer: Layer.Layer<Busy, never, SqlClient.SqlClient | Sessions | Live | Ledger | RuntimeConfig> = Layer.effect(
    Busy,
    Effect.gen(function* () {
      const context = yield* Effect.context<SqlClient.SqlClient | Ledger>()
      const provide = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient | Ledger>) => Effect.provideContext(effect, context)
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* Sessions
      const live = yield* Live
      const options = (yield* RuntimeConfig).busy ?? {}
      const every = options.every ?? Duration.seconds(5)
      // Worked out once a launch: the machine doesn't change while Althar runs.
      const machine = atOnceFor(options.machine ?? { cores: cpus().length, memory: totalmem() })
      const scope = yield* Effect.scope
      const lock = Semaphore.makeUnsafe(1)
      const wakes = yield* Queue.sliding<void>(1)
      const sources: Array<Effect.Effect<ReadonlyArray<Waiter>, unknown>> = []
      /* Tasks whose waiting work has been started and is on its way: each holds its place until its start ends. */
      const starting = new Set<string>()
      /* What the cards of waiting tasks last said, so they are read again when it changes. */
      let said = ''

      const wake = Queue.offer(wakes, undefined).pipe(Effect.asVoid)

      const atOnce = Effect.gen(function* () {
        const [kept] = yield* sql<{ value: string }>`SELECT value FROM settings WHERE key = ${KEY}`
        const own = kept === undefined || !/^\d+$/.test(kept.value) ? null : clamp(Number(kept.value))
        return { count: own ?? machine.count, own, machine } satisfies AtOnce
      })

      /** The tasks at work now, each once. */
      const atWork = Effect.gen(function* () {
        // What the store says is under way, on the thread it is on: a step of a running run on an agent, a round its lead was
        // asked about, an agent starting.
        const under = yield* sql<{ taskId: string; threadId: string | null }>`
          SELECT r.task_id, CASE WHEN n.node_key = 'review' THEN s.id ELSE t.id END AS thread_id
          FROM runs r JOIN workflow_executions e ON e.run_id = r.id JOIN nodes n ON n.execution_id = e.id
          JOIN node_attempts a ON a.node_id = n.id
          JOIN threads t ON t.task_id = r.task_id AND t.kind = 'task'
          LEFT JOIN threads s ON s.task_id = r.task_id AND s.kind = 'step' AND s.node_key = 'review'
          WHERE r.state = 'running' AND a.state IN ('admitted', 'running') AND n.node_key IN ('implement', 'settle', 'review')
          UNION ALL
          SELECT c.task_id, t.id FROM conflict_resolutions c JOIN threads t ON t.task_id = c.task_id AND t.kind = 'task'
          WHERE c.state = 'resolving' AND c.waiting IS NULL
          UNION ALL
          SELECT h.task_id, h.id FROM provider_sessions p JOIN threads h ON h.id = p.thread_id
          WHERE p.state = 'starting' AND h.kind IN ('task', 'step') AND h.task_id IS NOT NULL`
        // A lead waiting on the person's answer isn't using the machine: what it left running still is.
        const asking = new Set(
          (yield* sql<{ threadId: string | null }>`
            SELECT json_extract(payload, '$.threadId') AS thread_id FROM attention_requests WHERE kind = 'question' AND state = 'open'`).map(
            (row) => row.threadId,
          ),
        )
        const tasks = new Set<string>(starting)
        for (const row of under) if (row.threadId === null || !asking.has(row.threadId)) tasks.add(row.taskId)
        for (const session of yield* sessions.onTasks)
          if (session.background || (session.turnRunning && !asking.has(session.threadId))) tasks.add(session.taskId)
        return tasks
      })

      /** Everything waiting, what waited longest first. */
      const waiting = Effect.map(
        Effect.forEach(sources, (source) =>
          source.pipe(Effect.catchCause((cause) => Effect.as(Effect.logWarning('Could not read what waits for a place', cause), []))),
        ),
        (all) => all.flat().toSorted((a, b) => a.since.localeCompare(b.since)),
      )

      /**
       * Starts what waited longest while there are places, and what waits on
       * a task at work already; then, where how many are at work or may be
       * changed, the cards of what still waits are read again.
       */
      const look = lock.withPermits(1)(
        Effect.gen(function* () {
          const queue = yield* waiting
          if (queue.length === 0) return false
          const busy = yield* atWork
          const most = (yield* atOnce).count
          const left: Array<string> = []
          for (const waiter of queue) {
            // On its way already: it is counted, and not started twice.
            if (starting.has(waiter.taskId)) continue
            if (!busy.has(waiter.taskId) && busy.size >= most) {
              left.push(waiter.taskId)
              continue
            }
            busy.add(waiter.taskId)
            starting.add(waiter.taskId)
            yield* Effect.forkIn(
              waiter.start.pipe(
                Effect.catchCause((cause) =>
                  Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.logWarning('Work that waited for a place could not start', cause),
                ),
                Effect.ensuring(
                  Effect.suspend(() => {
                    starting.delete(waiter.taskId)
                    return wake
                  }),
                ),
              ),
              scope,
            )
          }
          const shown = `${busy.size} ${most}`
          if (shown !== said) {
            said = shown
            yield* Effect.forEach(new Set(left), (taskId) => Effect.ignore(provide(touchCard(taskId))), { discard: true })
          }
          return left.length > 0
        }),
      )

      // Looked at whenever something may have freed a place, and every few seconds while anything waits.
      yield* Effect.forkScoped(
        Effect.gen(function* () {
          for (;;) {
            const still = yield* look.pipe(
              Effect.catchCause((cause) => Effect.as(Effect.logWarning('Could not look at what waits for a place', cause), true)),
            )
            if (still) yield* Effect.raceFirst(Queue.take(wakes), Effect.sleep(every))
            else yield* Queue.take(wakes)
          }
        }),
      )
      const events = yield* live.subscribe
      yield* Effect.forkScoped(
        Stream.runForEach(events, (event) =>
          event._tag === 'TurnEnded' ||
          event._tag === 'SessionEnded' ||
          event._tag === 'Background' ||
          event._tag === 'AttentionNeeded' ||
          event._tag === 'AttentionClosed'
            ? wake
            : Effect.void,
        ),
      )

      const enter = <A, E, R>(taskId: string, then: (room: boolean) => Effect.Effect<A, E, R>) =>
        Effect.gen(function* () {
          const decided = yield* lock.withPermits(1)(
            Effect.gen(function* () {
              const busy = yield* atWork
              // Work waiting for a place of its own goes first; what waits on a task at work, or is on its way, takes none.
              const before = (yield* waiting).some((waiter) => waiter.taskId !== taskId && !busy.has(waiter.taskId))
              const room = busy.has(taskId) || (busy.size < (yield* atOnce).count && !before)
              return { room, done: yield* then(room) }
            }),
          )
          // Waiting, it may yet start now: what waits before it may not be able to.
          if (!decided.room) yield* wake
          return decided.done
        })

      const set = (count: number | null) =>
        Effect.gen(function* () {
          if (count === null) yield* sql`DELETE FROM settings WHERE key = ${KEY}`
          else {
            const at = yield* timestamp
            yield* sql`
              INSERT INTO settings ${sql.insert({ key: KEY, value: String(clamp(count)), updatedAt: at })}
              ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
          }
          yield* wake
        })

      return Busy.of({
        atOnce,
        set,
        now: Effect.gen(function* () {
          return { busy: (yield* atWork).size, atOnce: (yield* atOnce).count }
        }),
        enter,
        queue: (source) =>
          Effect.suspend(() => {
            sources.push(source)
            return wake
          }),
        wake,
      })
    }),
  )
}
