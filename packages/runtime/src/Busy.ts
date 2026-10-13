import { cpus, totalmem } from 'node:os'

import type { Ledger } from '@althar/persistence-sqlite'
import { Cause, Clock, Context, Duration, Effect, Layer, Queue, Semaphore, Stream } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { type AtOnceDefault, atOnceFor, clamp } from './atOnce'
import { touchTask } from './cards'
import { RuntimeConfig } from './Config'
import { Live } from './Live'
import { treeMembers, workedBetween } from './processTree'
import { timestamp } from './records'
import { Sessions } from './Sessions'

/*
 * How many agents are at work at once on this machine, and what waits for a
 * place among them (DEV-58, ADR-032). An agent at work takes a place: a
 * task's lead, while a step of its run is admitted or under way (implement,
 * settle), it is asked about a conflict or the checks on one, it is starting,
 * or it is in a turn; and a task's reviewer, while a review is admitted or
 * under way, or in a turn. Either one with something it left running that is
 * at work takes its place too, though its step is done: its process tree uses
 * real CPU, or did within the last `quiet` (`working`). A server left running
 * and sitting idle takes none. A lead or reviewer only waiting on the
 * person's answer to a question takes none, unless what it left running is
 * at work; nor once the person answered, while the answer waits for a place
 * to be told. The coordinator, the permission judge and
 * the runs Althar makes itself take no place.
 *
 * Starting an agent on work asks for a place first (`enter`): a plan's first
 * step, the step after it (a review after the lead's, the lead settling
 * after a review), a step carried on after a restart or by the person's
 * resume, a step back from a usage limit, a conflict or the checks on one put
 * to its lead, and an answer told to an agent that waits on it. So does every
 * turn of a lead or a reviewer not already at work (`turn`): what the person
 * says to it, an agent they start or switch to. Without a place, it waits:
 * written in the store where it waits, so a restart doesn't lose it, or, a
 * turn, in what the thread has queued; behind whatever waited before it.
 * When a place frees, what waited longest starts (`queue`): looked at
 * whenever an agent's turn or session ends, what it left running changes or
 * goes idle or starts working, or the person answers or is asked something,
 * and every few seconds while anything waits. One agent's work follows on in its own place: a lead at
 * work on a step takes no other for its turns.
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

/** Which of a task's agents: its lead, or its reviewer. */
export interface Agent {
  readonly taskId: string
  /** Its reviewer, not its lead. */
  readonly review?: boolean | undefined
}

/** How a step after another on the same task enters: the agent it follows, whose place frees unless what it left running still runs. */
export interface Entering<A> {
  /** Its reviewer's place, not its lead's. */
  readonly review?: boolean | undefined
  /** It follows this agent of the same task, done with its step. */
  readonly after?: 'lead' | 'review' | undefined
  /** With a place, what starts it, run holding the place, so nothing takes it meanwhile. */
  readonly next?: ((done: A) => Effect.Effect<void, unknown>) | undefined
}

/** Who holds a place: a task's agent, and whether only what it left running does. */
export interface Holder extends Agent {
  /** The thread its agent is on, where what it left running is stopped. */
  readonly threadId: string | null
  /** Its step and turns are done: what it left running, which is at work, is what keeps its place. */
  readonly kept: boolean
}

/** How much of a core, of the time between two samples, what an agent left running must use to count as at work. */
const WORKING_SHARE = 0.05

/** Something waiting for a place: its task's agent, since when, and what starts it once it has one. */
export interface Waiter extends Agent {
  /** When it began waiting: what waited longest goes first. */
  readonly since: string
  /**
   * Starts it, outside the queue's lock, its place held for it until this
   * ends, or until it says it is `begun`: by then what it wrote, or its
   * agent's turn, counts toward the work at once, or it stopped waiting
   * another way (it needs the person, or nothing is left to start).
   */
  readonly start: Effect.Effect<void, unknown> | ((begun: Effect.Effect<void>) => Effect.Effect<void, unknown>)
}

/** A task's agent as it is counted: its lead by the task, its reviewer apart. */
const keyOf = (taskId: string, review?: boolean) => (review === true ? `${taskId} review` : taskId)
const waiterKey = (waiter: Agent) => keyOf(waiter.taskId, waiter.review)

export class Busy extends Context.Service<
  Busy,
  {
    /** How many tasks may be at work at once here, and why. */
    readonly atOnce: Effect.Effect<AtOnce, SqlError.SqlError>
    /** Sets the person's own number, or, null, goes back to the default. It takes effect at once: what waits starts if there is room. */
    set(count: number | null): Effect.Effect<void, SqlError.SqlError>
    /** How many agents are at work now, and how many may be. */
    readonly now: Effect.Effect<
      { readonly busy: number; readonly atOnce: number; readonly holders: ReadonlyArray<Holder> },
      SqlError.SqlError
    >
    /**
     * Decides, under the queue's lock, whether a task may start work now: one
     * at work already may; another only where a place is free and nothing
     * waits before it. `then` writes what was decided, the work admitted or
     * waiting, still under the lock, so it counts before anything else is
     * decided.
     */
    enter<A, E, R>(taskId: string, then: (room: boolean) => Effect.Effect<A, E, R>, how?: Entering<A>): Effect.Effect<A, unknown, R>
    /**
     * A turn of a task's lead or reviewer: `work` delivers it, now where the
     * agent is at work already or a place is free, else once one frees, the
     * input waiting in its thread meanwhile. True where it ran now.
     */
    turn(
      agent: Agent & { readonly threadId: string; readonly sessionId: string },
      work: (begun: Effect.Effect<void>) => Effect.Effect<void>,
    ): Effect.Effect<boolean>
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
      const sampleEvery = options.sample ?? Duration.seconds(2)
      const quiet = Duration.toMillis(options.quiet ?? Duration.seconds(30))
      const cpuOf =
        options.cpuOf ??
        ((agents: ReadonlyArray<{ readonly threadId: string; readonly pid: number | null }>) =>
          Effect.map(
            treeMembers(agents.flatMap((agent) => (agent.pid === null ? [] : [agent.pid]))),
            (used) => new Map(agents.map((agent) => [agent.threadId, agent.pid === null ? null : (used.get(agent.pid) ?? null)])),
          ))
      // Worked out once a launch: the machine doesn't change while Althar runs.
      const machine = atOnceFor(options.machine ?? { cores: cpus().length, memory: totalmem() })
      const scope = yield* Effect.scope
      const lock = Semaphore.makeUnsafe(1)
      const wakes = yield* Queue.sliding<void>(1)
      const sources: Array<Effect.Effect<ReadonlyArray<Waiter>, unknown>> = []
      /* The agents whose waiting work has been started and is on its way, each held until its start ends, by how many hold it. */
      const starting = new Map<string, number>()
      const hold = (key: string) => starting.set(key, (starting.get(key) ?? 0) + 1)
      const release = (key: string) =>
        Effect.suspend(() => {
          const left = (starting.get(key) ?? 1) - 1
          if (left > 0) starting.set(key, left)
          else starting.delete(key)
          return wake
        })
      /** Lets a hold on `key` go, once however often it is told. */
      const releaseOnce = (key: string) => {
        let gone = false
        return Effect.suspend(() => {
          if (gone) return Effect.void
          gone = true
          return release(key)
        })
      }
      /*
       * Turns waiting for a place, by their thread, with the session they are for. Each is kept on its thread too
       * (`waits_for_place`), what it delivers in the thread's queue, so a restart starts its agent again once there is one.
       */
      const turns = new Map<string, Waiter & { readonly sessionId: string }>()
      /* What the cards of waiting tasks last said, so they are read again when it changes. */
      let said = ''
      /*
       * What each thread's left running used of the CPU when last read, by thread: the agent's process (what it
       * started is part of its tree), each process in the tree with its CPU time then, when, when it last showed real
       * use, and whether it counts as at work. Read now and then while any session has something running (`sample`).
       */
      const sampled = new Map<
        string,
        { pid: number | null; at: number; tree: ReadonlyMap<number, number> | null; busyAt: number; working: boolean }
      >()

      const wake = Queue.offer(wakes, undefined).pipe(Effect.asVoid)

      const atOnce = Effect.gen(function* () {
        const [kept] = yield* sql<{ value: string }>`SELECT value FROM settings WHERE key = ${KEY}`
        const own = kept === undefined || !/^\d+$/.test(kept.value) ? null : clamp(Number(kept.value))
        return { count: own ?? machine.count, own, machine } satisfies AtOnce
      })

      /**
       * Reads the CPU of what sessions left running, and keeps whether each is at work. A server that sits idle isn't:
       * it takes no place however long it runs (ADR-032). One just started, or whose CPU can't be read, counts, until
       * it has been quiet for `quiet`; one quiet that uses CPU again counts at once. A flip looks at the queue again.
       */
      const sample = Effect.gen(function* () {
        const left = (yield* sessions.onTasks).flatMap((session) =>
          session.background ? [{ threadId: session.threadId, pid: session.pid }] : [],
        )
        const threads = new Set(left.map((session) => session.threadId))
        for (const threadId of sampled.keys()) if (!threads.has(threadId)) sampled.delete(threadId)
        if (left.length === 0) return
        const read = yield* cpuOf(left)
        const now = yield* Clock.currentTimeMillis
        let flipped = false
        for (const { threadId, pid } of left) {
          const tree = read.get(threadId) ?? null
          const before = sampled.get(threadId)
          // A first reading, or one that can't be compared, says nothing: it counts.
          const busy =
            before === undefined ||
            before.pid !== pid ||
            before.tree === null ||
            tree === null ||
            workedBetween(before.tree, tree, now - before.at, WORKING_SHARE)
          const busyAt = busy || before === undefined ? now : before.busyAt
          const working = busy || now - busyAt < quiet
          if (before !== undefined && before.working !== working) flipped = true
          sampled.set(threadId, { pid, at: now, tree, busyAt, working })
        }
        if (flipped) yield* wake
      })

      /** The agents at work now, each once (`at`), those whose step may be done but whose left running still runs (`lingering`), and who holds each place (`holders`). */
      const atWork = Effect.gen(function* () {
        // What the store says is under way, on the thread it is on: a step of a running run on an agent, a round its lead was
        // asked about, an agent starting.
        const under = yield* sql<{ taskId: string; threadId: string | null; review: number }>`
          SELECT r.task_id, CASE WHEN n.node_key = 'review' THEN s.id ELSE t.id END AS thread_id, n.node_key = 'review' AS review
          FROM runs r JOIN workflow_executions e ON e.run_id = r.id JOIN nodes n ON n.execution_id = e.id
          JOIN node_attempts a ON a.node_id = n.id
          JOIN threads t ON t.task_id = r.task_id AND t.kind = 'task'
          LEFT JOIN threads s ON s.task_id = r.task_id AND s.kind = 'step' AND s.node_key = 'review'
          WHERE r.state = 'running' AND a.state IN ('admitted', 'running') AND n.node_key IN ('implement', 'settle', 'review')
          UNION ALL
          SELECT c.task_id, t.id, 0 FROM conflict_resolutions c JOIN threads t ON t.task_id = c.task_id AND t.kind = 'task'
          WHERE c.state = 'resolving' AND c.waiting IS NULL
          UNION ALL
          SELECT h.task_id, h.id, h.kind = 'step' FROM provider_sessions p JOIN threads h ON h.id = p.thread_id
          WHERE p.state = 'starting' AND h.kind IN ('task', 'step') AND h.task_id IS NOT NULL`
        // An agent waiting on the person's answer isn't using the machine, nor while their answer waits for a place: what it
        // left running still is.
        const asking = new Set(
          (yield* sql<{ threadId: string | null }>`
            SELECT json_extract(payload, '$.threadId') AS thread_id FROM attention_requests WHERE kind = 'question'
              AND (state = 'open' OR (state = 'answered' AND json_extract(payload, '$.waitsForPlace') IS NOT NULL))`).map(
            (row) => row.threadId,
          ),
        )
        const at = new Set<string>()
        const holders = new Map<string, Holder>()
        const take = (taskId: string, review: boolean, threadId: string | null, kept: boolean) => {
          const key = keyOf(taskId, review)
          const had = holders.get(key)
          at.add(key)
          // At work in its step or a turn, whatever else it left running.
          if (had === undefined || (had.kept && !kept))
            holders.set(key, { taskId, review, threadId: threadId ?? had?.threadId ?? null, kept })
        }
        for (const key of starting.keys()) take(key.replace(/ review$/, ''), key.endsWith(' review'), null, false)
        for (const row of under)
          if (row.threadId === null || !asking.has(row.threadId)) take(row.taskId, row.review === 1, row.threadId, false)
        const lingering = new Set<string>()
        for (const session of yield* sessions.onTasks) {
          // Left running and idle, it is nothing to wait for; not yet read, it counts.
          const working = session.background && (sampled.get(session.threadId)?.working ?? true)
          if (working) lingering.add(keyOf(session.taskId, session.reviewer))
          const turning = session.turnRunning && !asking.has(session.threadId)
          if (working || turning) take(session.taskId, session.reviewer, session.threadId, !turning)
        }
        return { at, lingering, holders: [...holders.values()] }
      })

      /** Everything waiting, what waited longest first. */
      const waiting = Effect.map(
        Effect.forEach(sources, (source) =>
          source.pipe(Effect.catchCause((cause) => Effect.as(Effect.logWarning('Could not read what waits for a place', cause), []))),
        ),
        (all) => [...all.flat(), ...turns.values()].toSorted((a, b) => a.since.localeCompare(b.since)),
      )

      /** Whether `key` has a place now: its agent at work already, or one free with nothing waiting before it. */
      const roomFor = (key: string, at: ReadonlySet<string>) =>
        Effect.gen(function* () {
          if (at.has(key)) return true
          if (at.size >= (yield* atOnce).count) return false
          // Work waiting for a place of its own goes first; what waits on an agent at work, or is on its way, takes none.
          return !(yield* waiting).some((waiter) => waiterKey(waiter) !== key && !at.has(waiterKey(waiter)))
        })

      /**
       * Starts what waited longest while there are places, and what waits on
       * an agent at work already; then, where how many are at work or may be
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
            const key = waiterKey(waiter)
            // On its way already: it is counted, and not started twice.
            if (starting.has(key)) continue
            if (!busy.has(key) && busy.size >= most) {
              left.push(waiter.taskId)
              continue
            }
            busy.add(key)
            hold(key)
            // A turn that waited has its place now: it waits no more, here or on its thread.
            for (const [threadId, turn] of turns)
              if (turn === waiter) {
                turns.delete(threadId)
                yield* sql`UPDATE threads SET waits_for_place = NULL WHERE id = ${threadId}`
              }
            const done = releaseOnce(key)
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
          // Who holds the places, and whether by what they left running, is on the cards too: read again when that changes.
          const shown = `${holders
            .map((holder) => `${keyOf(holder.taskId, holder.review)}${holder.kept ? ' kept' : ''}`)
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
      // What agents left running is read for CPU as long as any is, so a server gone idle frees its place without another event.
      yield* Effect.forkScoped(
        Effect.forever(
          sample.pipe(
            Effect.catchCause((cause) => Effect.logWarning('Could not read what agents left running', cause)),
            Effect.andThen(Effect.sleep(sampleEvery)),
          ),
        ),
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
            : event._tag === 'Background'
              ? Effect.suspend(() => {
                  // Nothing left running: whatever it leaves running next starts afresh, counted until it has been quiet.
                  if (event.background.every((left) => left.ended !== null)) sampled.delete(event.threadId)
                  // What a task keeps a place by is on the cards of those that wait: read them again.
                  said = ''
                  return wake
                })
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
       * own turn waits in `turns`), or its task is stopped or settled.
       */
      const restored = Effect.gen(function* () {
        const rows = yield* sql<{ threadId: string; taskId: string; kind: string; since: string }>`
          SELECT h.id AS thread_id, h.task_id, h.kind, h.waits_for_place AS since FROM threads h
          JOIN tasks k ON k.id = h.task_id JOIN projects p ON p.id = h.project_id
          WHERE h.waits_for_place IS NOT NULL AND k.state IN ('draft', 'open') AND p.archived_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.task_id = h.task_id AND r.state = 'suspended'
              AND r.created_at = (SELECT max(created_at) FROM runs WHERE task_id = h.task_id))`
        const live = new Set((yield* sessions.onTasks).map((session) => session.threadId))
        return rows
          .filter((row) => !live.has(row.threadId))
          .map((row) => ({
            taskId: row.taskId,
            review: row.kind === 'step',
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
          const key = keyOf(taskId, how.review)
          const decided = yield* lock.withPermits(1)(
            Effect.gen(function* () {
              const { at, lingering } = yield* atWork
              // The agent it follows is done with its step: its place is this one's, unless what it left running still runs.
              const before = how.after === undefined ? undefined : keyOf(taskId, how.after === 'review')
              if (before !== undefined && before !== key && !lingering.has(before)) at.delete(before)
              const room = yield* roomFor(key, at)
              const done = yield* then(room)
              // Held from here, so nothing takes the place before what starts it is under way.
              if (room && how.next !== undefined) hold(key)
              return { room, done }
            }),
          )
          // Waiting, it may yet start now: what waits before it may not be able to.
          if (!decided.room) yield* wake
          else if (how.next !== undefined) yield* how.next(decided.done).pipe(Effect.ensuring(release(key)))
          return decided.done
        })

      const turn = (
        agent: Agent & { readonly threadId: string; readonly sessionId: string },
        work: (begun: Effect.Effect<void>) => Effect.Effect<void>,
      ) =>
        Effect.gen(function* () {
          const key = keyOf(agent.taskId, agent.review)
          const room = yield* lock.withPermits(1)(
            Effect.gen(function* () {
              const room = yield* roomFor(key, (yield* atWork).at)
              if (room) {
                hold(key)
                turns.delete(agent.threadId)
                yield* sql`UPDATE threads SET waits_for_place = NULL WHERE id = ${agent.threadId} AND waits_for_place IS NOT NULL`
                return true
              }
              // Since when it waits, kept where it was first said: a turn asked again keeps its place in the queue.
              yield* sql`UPDATE threads SET waits_for_place = coalesce(waits_for_place, ${yield* timestamp}) WHERE id = ${agent.threadId}`
              const [kept] = yield* sql<{ since: string }>`SELECT waits_for_place AS since FROM threads WHERE id = ${agent.threadId}`
              turns.set(agent.threadId, { ...agent, since: kept?.since ?? (yield* timestamp), start: work })
              return false
            }),
          )
          if (!room) {
            yield* Effect.ignore(provide(touchTask(agent.taskId)))
            yield* wake
            return false
          }
          const done = releaseOnce(key)
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
