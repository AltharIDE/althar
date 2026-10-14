import { cpus, totalmem } from 'node:os'

import type { Ledger } from '@althar/persistence-sqlite'
import { Cause, Context, Duration, Effect, Layer, Queue, Semaphore, Stream } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { type AtOnceDefault, atOnceFor, clamp } from './atOnce'
import { touchTask } from './cards'
import { RuntimeConfig } from './Config'
import { Live } from './Live'
import { timestamp } from './records'
import { Sessions } from './Sessions'

/*
 * How many tasks are at work at once on this machine, and what waits for a
 * place among them (DEV-58, ADR-032, ADR-037). A task at work takes one
 * place, whichever of its agents is on it: it takes it when its run's first
 * step starts, and keeps it until the run ends, through the steps after it
 * (the review after the lead's, the lead settling after a review,
 * publishing), the lead's turns between them, and while it waits on the
 * person. It gives it up while a step of it is held, for a usage limit, an
 * agent that isn't there, or a place. A round of work after the plan
 * (ADR-034) takes it as its lead's turns do, in one or starting, and for its
 * review and settle, but not between its lead's turns. A conflict or the
 * checks on one asked of its lead take it too, and so does an agent of the
 * task starting or in a turn, or its lead with what the person said while
 * its turn ran still to be told. What a task left running takes none. The
 * coordinator, the permission judge and the runs Althar makes itself take
 * none either. All of it is read from the store and the live sessions, so a
 * restart reads the same places back.
 *
 * Starting work asks for a place first (`enter`): a plan's first step, a
 * step carried on after a restart or by the person's resume, a step back
 * from a usage limit, a conflict or the checks on one put to its lead, and
 * an answer told to an agent that waits on it. So does every turn of a lead
 * or a reviewer whose task isn't at work (`turn`): what the person says to
 * it, an agent they start or switch to. A task at work has room for all of
 * it, and the step after another of the same task always does: it is in the
 * task's place. Without a place, it waits: written in the store where it
 * waits, so a restart doesn't lose it, or, a turn, in what the thread has
 * queued. When a place frees, what waits starts in order (`queue`): what was
 * at work when Althar stopped, what the person did, the work of a task
 * already under way, then the rest, each what waited longest first. The
 * queue is looked at whenever an agent's turn or session ends, a run ends,
 * the person answers or is asked something, and every few seconds while
 * anything waits.
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

/** How a step enters. */
export interface Entering<A> {
  /** It follows another step of the same task, done with it: it is in the task's place, and starts whatever else waits. */
  readonly after?: boolean | undefined
  /** With a place, what starts it, run holding the place, so nothing takes it meanwhile. */
  readonly next?: ((done: A) => Effect.Effect<void, unknown>) | undefined
}

/** Who holds a place: a task at work, and the thread it is on. */
export interface Holder {
  readonly taskId: string
  readonly threadId: string | null
}

/**
 * Why something that waits goes before what waited longer (ADR-037): it was
 * at work when Althar stopped (`working`), the person did it (`person`), or
 * its task is under way already (`started`). Without any, it goes in turn
 * after all three.
 */
export type Ahead = 'working' | 'person' | 'started'

/** Something waiting for a place: its task, since when, and what starts it once it has one. */
export interface Waiter {
  readonly taskId: string
  /** When it began waiting: what waited longest goes first, among what goes ahead for the same reason. */
  readonly since: string
  /** Why it goes ahead, where it does. A turn is read from what waits on its thread instead. */
  readonly ahead?: Ahead | undefined
  /** The thread of a turn that waits: it goes ahead for what the person said there, or for a round of work under way. */
  readonly threadId?: string | undefined
  /**
   * Starts it, outside the queue's lock, its place held for it until this
   * ends, or until it says it is `begun`: by then what it wrote, or its
   * agent's turn, counts toward the work at once, or it stopped waiting
   * another way (it needs the person, or nothing is left to start).
   */
  readonly start: Effect.Effect<void, unknown> | ((begun: Effect.Effect<void>) => Effect.Effect<void, unknown>)
}

/** Its place in the queue, by why it goes ahead: what was at work first, then the person's, then a task's under way, then the rest. */
const RANK: Readonly<Record<Ahead | 'none', number>> = { working: 0, person: 1, started: 2, none: 3 }

/**
 * What waits, in the order it starts (ADR-037): what was at work when Althar
 * stopped, what the person did, what goes on with a task under way, then the
 * rest, each what waited longest first. A turn goes ahead for what the person said on its thread, still to
 * be told (`told`, by thread), or for its task's run under way (`going`, by
 * task).
 */
export const inOrder = <W extends Waiter>(
  waiters: ReadonlyArray<W>,
  told: ReadonlySet<string>,
  going: ReadonlySet<string>,
): ReadonlyArray<W> => {
  const aheadOf = (waiter: Waiter): Ahead | 'none' =>
    waiter.ahead ??
    (waiter.threadId === undefined ? 'none' : told.has(waiter.threadId) ? 'person' : going.has(waiter.taskId) ? 'started' : 'none')
  return waiters
    .map((waiter) => ({ waiter, rank: RANK[aheadOf(waiter)] }))
    .toSorted((a, b) => a.rank - b.rank || a.waiter.since.localeCompare(b.waiter.since))
    .map(({ waiter }) => waiter)
}

export class Busy extends Context.Service<
  Busy,
  {
    /** How many tasks may be at work at once here, and why. */
    readonly atOnce: Effect.Effect<AtOnce, SqlError.SqlError>
    /** Sets the person's own number, or, null, goes back to the default. It takes effect at once: what waits starts if there is room. */
    set(count: number | null): Effect.Effect<void, SqlError.SqlError>
    /** How many tasks are at work now, which, and how many may be. */
    readonly now: Effect.Effect<
      { readonly busy: number; readonly atOnce: number; readonly holders: ReadonlyArray<Holder> },
      SqlError.SqlError
    >
    /**
     * Decides, under the queue's lock, whether a task may start work now: one
     * at work already may, as may a step after another of it; another only
     * where a place is free and nothing waits before it. `then` writes what
     * was decided, the work admitted or waiting, still under the lock, so it
     * counts before anything else is decided.
     */
    enter<A, E, R>(taskId: string, then: (room: boolean) => Effect.Effect<A, E, R>, how?: Entering<A>): Effect.Effect<A, unknown, R>
    /**
     * A turn of a task's lead or reviewer: `work` delivers it, now where its
     * task is at work already or a place is free, else once one frees, the
     * input waiting in its thread meanwhile. True where it ran now.
     */
    turn(
      agent: { readonly taskId: string; readonly threadId: string; readonly sessionId: string },
      work: (begun: Effect.Effect<void>) => Effect.Effect<void>,
    ): Effect.Effect<boolean>
    /** Adds where waiting work is read from: each time the queue is looked at, every source is read, and what goes first starts first. */
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
      /* The tasks whose waiting work has been started and is on its way, each held until its start ends, by how many hold it. */
      const starting = new Map<string, number>()
      const hold = (taskId: string) => starting.set(taskId, (starting.get(taskId) ?? 0) + 1)
      const release = (taskId: string) =>
        Effect.suspend(() => {
          const left = (starting.get(taskId) ?? 1) - 1
          if (left > 0) starting.set(taskId, left)
          else starting.delete(taskId)
          return wake
        })
      /** Lets a hold on `taskId` go, once however often it is told. */
      const releaseOnce = (taskId: string) => {
        let gone = false
        return Effect.suspend(() => {
          if (gone) return Effect.void
          gone = true
          return release(taskId)
        })
      }
      /*
       * Turns waiting for a place, by their thread, with the session they are for. Each is kept on its thread too
       * (`waits_for_place`), what it delivers in the thread's queue, so a restart starts its agent again once there is one.
       */
      const turns = new Map<string, Waiter & { readonly sessionId: string }>()
      /* What the cards of waiting tasks last said, so they are read again when it changes. */
      let said = ''

      const wake = Queue.offer(wakes, undefined).pipe(Effect.asVoid)

      const atOnce = Effect.gen(function* () {
        const [kept] = yield* sql<{ value: string }>`SELECT value FROM settings WHERE key = ${KEY}`
        const own = kept === undefined || !/^\d+$/.test(kept.value) ? null : clamp(Number(kept.value))
        return { count: own ?? machine.count, own, machine } satisfies AtOnce
      })

      /** The tasks at work now, each once (`at`), and who holds each place (`holders`), with the thread it is on. */
      const atWork = Effect.gen(function* () {
        const rows = yield* sql<{ taskId: string; threadId: string | null }>`
          -- A run under way, from its first step until it ends, between its steps and while it waits on the person too: its
          -- latest step admitted, at work, waiting on the person, or done with the next to come. Not while it is held, or
          -- stopped and not yet resumed. A round of work after the plan (ADR-034) not while its lead's step runs: then its
          -- lead's turns count, in one or starting, not between them.
          SELECT r.task_id, t.id AS thread_id FROM runs r JOIN threads t ON t.task_id = r.task_id AND t.kind = 'task'
          WHERE r.state = 'running'
            AND (SELECT a.state FROM workflow_executions e JOIN nodes n ON n.execution_id = e.id JOIN node_attempts a ON a.node_id = n.id
              WHERE e.run_id = r.id ORDER BY a.admitted_at DESC, a.rowid DESC LIMIT 1) NOT IN ('held', 'cancelled', 'failed', 'superseded')
            AND NOT EXISTS (SELECT 1 FROM workflow_executions e JOIN nodes n ON n.execution_id = e.id
              JOIN node_attempts a ON a.node_id = n.id WHERE e.run_id = r.id
                AND r.plan_id IS NULL AND n.node_key = 'implement' AND a.state = 'running')
          UNION ALL
          SELECT c.task_id, t.id FROM conflict_resolutions c JOIN threads t ON t.task_id = c.task_id AND t.kind = 'task'
          WHERE c.state = 'resolving' AND c.waiting IS NULL
          UNION ALL
          SELECT h.task_id, h.id FROM provider_sessions p JOIN threads h ON h.id = p.thread_id
          WHERE p.state = 'starting' AND h.kind IN ('task', 'step') AND h.task_id IS NOT NULL`
        const holders = new Map<string, Holder>()
        const take = (taskId: string, threadId: string | null) => {
          if (!holders.has(taskId)) holders.set(taskId, { taskId, threadId })
        }
        for (const taskId of starting.keys()) take(taskId, null)
        for (const row of rows) take(row.taskId, row.threadId)
        // A lead the person said more to while its turn ran goes on with it in the same place: its next turn is on its way.
        const followed = new Set(
          (yield* sql<{ threadId: string }>`
            SELECT DISTINCT i.thread_id FROM user_inputs i JOIN actors a ON a.id = i.author_actor_id
            JOIN turn_deliveries d ON d.id = (SELECT id FROM turn_deliveries WHERE thread_id = i.thread_id
              ORDER BY requested_at DESC, rowid DESC LIMIT 1)
            WHERE i.state = 'queued' AND a.kind = 'person' AND i.accepted_at >= d.requested_at
              AND (d.ended_at IS NULL OR i.accepted_at <= d.ended_at)`).map((row) => row.threadId),
        )
        for (const session of yield* sessions.onTasks)
          if (session.turnRunning || followed.has(session.threadId)) take(session.taskId, session.threadId)
        return { at: new Set(holders.keys()), holders: [...holders.values()] }
      })

      /** Everything waiting, in the order it starts: what the person did, then what goes on with a task under way, then the rest. */
      const waiting = Effect.gen(function* () {
        const all = yield* Effect.forEach(sources, (source) =>
          source.pipe(Effect.catchCause((cause) => Effect.as(Effect.logWarning('Could not read what waits for a place', cause), []))),
        )
        const listed = [...all.flat(), ...turns.values()]
        if (listed.length === 0) return []
        const told = new Set(
          (yield* sql<{ threadId: string }>`
            SELECT DISTINCT i.thread_id FROM user_inputs i JOIN actors a ON a.id = i.author_actor_id
            WHERE i.state = 'queued' AND a.kind = 'person'`).map((row) => row.threadId),
        )
        const going = new Set((yield* sql<{ taskId: string }>`SELECT task_id FROM runs WHERE state = 'running'`).map((row) => row.taskId))
        return inOrder(listed, told, going)
      })

      /** Whether `taskId` has a place now: at work already, or one free with nothing waiting before it. */
      const roomFor = (taskId: string, at: ReadonlySet<string>) =>
        Effect.gen(function* () {
          if (at.has(taskId)) return true
          if (at.size >= (yield* atOnce).count) return false
          // Work waiting for a place of its own goes first; what waits on a task at work, or on its way, takes none.
          return !(yield* waiting).some((waiter) => waiter.taskId !== taskId && !at.has(waiter.taskId))
        })

      /**
       * Starts what goes first while there are places, and what waits on a
       * task at work already; then, where who is at work or how many may be
       * changed, the cards of what still waits are read again.
       */
      const look = lock.withPermits(1)(
        Effect.gen(function* () {
          const queue = yield* waiting
          if (queue.length === 0) return false
          const { at: busy, holders } = yield* atWork
          const most = (yield* atOnce).count
          const left: Array<string> = []
          for (const waiter of queue) {
            const taskId = waiter.taskId
            // On its way already: it is counted, and not started twice.
            if (starting.has(taskId)) continue
            if (!busy.has(taskId) && busy.size >= most) {
              left.push(taskId)
              continue
            }
            busy.add(taskId)
            hold(taskId)
            // A turn that waited has its place now: it waits no more, here or on its thread.
            for (const [threadId, turn] of turns)
              if (turn === waiter) {
                turns.delete(threadId)
                yield* sql`UPDATE threads SET waits_for_place = NULL WHERE id = ${threadId}`
              }
            const done = releaseOnce(taskId)
            yield* Effect.forkIn(
              (typeof waiter.start === 'function' ? waiter.start(done) : waiter.start).pipe(
                Effect.catchCause((cause) =>
                  Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.logWarning('Work that waited for a place could not start', cause),
                ),
                Effect.ensuring(done),
              ),
              scope,
            )
          }
          // Who holds the places is on the cards too: read again when that changes.
          const shown = `${holders
            .map((holder) => holder.taskId)
            .toSorted()
            .join(',')} ${most}`
          if (shown !== said) {
            said = shown
            yield* Effect.forEach(new Set(left), (taskId) => Effect.ignore(provide(touchTask(taskId))), { discard: true })
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
      /**
       * A session that ended takes the turn it waited to give with it: one
       * stopped, or gone on its own, waits no more, and its task says so; one
       * another agent took over from asks again in the new session.
       */
      const ended = (threadId: string, sessionId: string, state: string) =>
        Effect.gen(function* () {
          const waited = turns.get(threadId)
          if (waited === undefined || waited.sessionId !== sessionId) return
          turns.delete(threadId)
          if (state !== 'superseded') yield* sql`UPDATE threads SET waits_for_place = NULL WHERE id = ${threadId}`
          yield* Effect.ignore(provide(touchTask(waited.taskId)))
        }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not let a waiting turn go', cause)))

      const events = yield* live.subscribe
      yield* Effect.forkScoped(
        Stream.runForEach(events, (event) =>
          event._tag === 'SessionEnded'
            ? Effect.andThen(ended(event.threadId, event.sessionId, event.state), wake)
            : event._tag === 'TurnEnded' || event._tag === 'AttentionNeeded' || event._tag === 'AttentionClosed'
              ? wake
              : Effect.void,
        ),
      )

      /**
       * Turns that waited for a place when Althar stopped, kept on their
       * threads: once there is one, the agent last on the thread, as the
       * person last started or switched to it, starts again, and its first
       * turn delivers what waited. Not where a session is on the thread (its
       * own turn waits in `turns`), or its task is stopped or abandoned; a
       * merged one's lead goes back to work for it (ADR-034).
       */
      const restored = Effect.gen(function* () {
        const rows = yield* sql<{ threadId: string; taskId: string; since: string }>`
          SELECT h.id AS thread_id, h.task_id, h.waits_for_place AS since FROM threads h
          JOIN tasks k ON k.id = h.task_id JOIN projects p ON p.id = h.project_id
          WHERE h.waits_for_place IS NOT NULL AND k.state IN ('draft', 'open', 'done') AND p.archived_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.task_id = h.task_id AND r.state = 'suspended'
              AND r.created_at = (SELECT max(created_at) FROM runs WHERE task_id = h.task_id))`
        const live = new Set((yield* sessions.onTasks).map((session) => session.threadId))
        return rows
          .filter((row) => !live.has(row.threadId))
          .map((row) => ({
            taskId: row.taskId,
            threadId: row.threadId,
            since: row.since,
            // Its place held until its first turn is under way, or waits again in its own session's queue.
            start: Effect.gen(function* () {
              // No agent was ever on it to start again: nothing waits.
              if (!(yield* sessions.startLast(row.threadId)))
                return yield* sql`UPDATE threads SET waits_for_place = NULL WHERE id = ${row.threadId}`
              for (let waited = 0; waited < 30_000; waited += 100) {
                const on = (yield* sessions.onTasks).find((session) => session.threadId === row.threadId)
                if (on === undefined || on.turnRunning || turns.has(row.threadId)) return
                yield* Effect.sleep(Duration.millis(100))
              }
            }),
          }))
      })
      sources.push(restored)

      const enter = <A, E, R>(taskId: string, then: (room: boolean) => Effect.Effect<A, E, R>, how: Entering<A> = {}) =>
        Effect.gen(function* () {
          const decided = yield* lock.withPermits(1)(
            Effect.gen(function* () {
              // The step after another of the same task is in the task's place, kept from its first step to its last (ADR-037).
              const room = how.after === true || (yield* roomFor(taskId, (yield* atWork).at))
              const done = yield* then(room)
              // Held from here, so nothing takes the place before what starts it is under way.
              if (room && how.next !== undefined) hold(taskId)
              return { room, done }
            }),
          )
          // Waiting, it may yet start now: what waits before it may not be able to.
          if (!decided.room) yield* wake
          else if (how.next !== undefined) yield* how.next(decided.done).pipe(Effect.ensuring(release(taskId)))
          return decided.done
        })

      const turn = (
        agent: { readonly taskId: string; readonly threadId: string; readonly sessionId: string },
        work: (begun: Effect.Effect<void>) => Effect.Effect<void>,
      ) =>
        Effect.gen(function* () {
          const room = yield* lock.withPermits(1)(
            Effect.gen(function* () {
              const room = yield* roomFor(agent.taskId, (yield* atWork).at)
              if (room) {
                hold(agent.taskId)
                turns.delete(agent.threadId)
                yield* sql`UPDATE threads SET waits_for_place = NULL WHERE id = ${agent.threadId} AND waits_for_place IS NOT NULL`
                return true
              }
              // Since when it waits, kept where it was first said: a turn asked again keeps its place in the queue.
              yield* sql`UPDATE threads SET waits_for_place = coalesce(waits_for_place, ${yield* timestamp}) WHERE id = ${agent.threadId}`
              const [kept] = yield* sql<{ since: string }>`SELECT waits_for_place AS since FROM threads WHERE id = ${agent.threadId}`
              turns.set(agent.threadId, {
                taskId: agent.taskId,
                threadId: agent.threadId,
                sessionId: agent.sessionId,
                since: kept?.since ?? (yield* timestamp),
                start: work,
              })
              return false
            }),
          )
          if (!room) {
            yield* Effect.ignore(provide(touchTask(agent.taskId)))
            yield* wake
            return false
          }
          const done = releaseOnce(agent.taskId)
          yield* work(done).pipe(Effect.ensuring(done))
          return true
        }).pipe(Effect.catchCause((cause) => Effect.as(Effect.logWarning('Could not ask for a place for a turn', cause), true)))

      // Every turn of a lead or a reviewer asks for a place first.
      yield* sessions.gateTurns((agent, work) => turn(agent, work))

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
          const { at, holders } = yield* atWork
          return { busy: at.size, atOnce: (yield* atOnce).count, holders }
        }),
        enter,
        turn,

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
