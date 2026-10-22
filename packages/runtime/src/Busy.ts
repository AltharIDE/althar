import { cpus, totalmem } from 'node:os'

import type { Ledger } from '@althar/persistence-sqlite'
import { Cause, Clock, Context, Duration, Effect, Layer, Queue, Semaphore, Stream } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { type AtOnceDefault, atOnceFor, clamp } from './atOnce'
import { automatedTasks } from './automated'
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
 * and sitting idle takes none. A lead or reviewer waiting on the person, on
 * a question or a permission, keeps its place for `askGrace` (five minutes,
 * while its agent's cache is warm, so an answer soon goes on where it was),
 * then takes none, unless what it left running is at work; nor once the
 * person answered, while an answer kept before waits to be told. The
 * coordinator, the permission judge and the runs Althar makes itself take no
 * place.
 *
 * Starting an agent on work asks for a place first (`enter`): a plan's first
 * step, the step after it (a review after the lead's, the lead settling
 * after a review), a step carried on after a restart or by the person's
 * resume, a step back from a usage limit, a conflict or the checks on one put
 * to its lead, and an answer told to an agent that waits on it. So does every
 * turn of a lead or a reviewer not already at work (`turn`): what the person
 * says to it, an agent they start or switch to, and what Althar tells it.
 *
 * What waits goes in the order the person would choose (`Order`, ADR-037, ADR-049):
 * first what the person did, which never waits, and starts though every place
 * is taken (their answer, what they say to an agent, a task they resume); then
 * the work of a task already under way (the step after another, a step
 * carried on after a restart or back from a usage limit, a conflict or check
 * round, what Althar tells an agent); then new work, what waits before any
 * agent has worked on its task (a plan's first step, a review's or a quick
 * task's lead's first turn), which is its project's line, up next on its
 * board. Within each, what waited longest goes first; in the line, unless
 * the person put it in an order of their own (`move`), kept on each task
 * (`line_at`), so a restart keeps it and a task that joins later goes to its
 * end. A step after another on the same task takes the place of the agent
 * before it, ahead of whatever waits, so a task never loses its place between
 * its own steps; unless what that agent left running still runs, when the two
 * would be two agents at work.
 * Without a place, work waits: written in the store where it waits, so a
 * restart doesn't lose it, or, a turn, in what the thread has queued. When a
 * place frees, what stands first starts (`queue`): looked at whenever an
 * agent's turn or session ends, what it left running changes or goes idle or
 * starts working, or the person answers or is asked something, and every few
 * seconds while anything waits. One agent's work follows on in its own place:
 * a lead at work on a step takes no other for its turns.
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

/**
 * Where work that waits for a place stands (ADR-037): what the person did,
 * which starts at once; the work of a task already under way; new work; and
 * last, an automation's run, every step of it (ADR-057).
 */
export type Order = 'person' | 'underway' | 'new' | 'automation'

const RANK: Readonly<Record<Order, number>> = { person: 0, underway: 1, new: 2, automation: 3 }

/** How many automations' tasks may be at work at once, unless a test says: one, so nothing of the person's waits behind them. */
const AUTOMATIONS_AT_ONCE = 1

/** Where work stands, as its task makes it: an automation's run's waits last, unless the person did it. */
export const orderIn = (order: Order, taskId: string, automated: ReadonlySet<string>): Order =>
  order === 'person' ? 'person' : automated.has(taskId) ? 'automation' : order

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
  /** Where it stands among what waits: new work, unless said; a step after another, under way. */
  readonly order?: Order | undefined
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

/** Something waiting for a place: its task's agent, where it stands, since when, and what starts it once it has one. */
export interface Waiter extends Agent {
  /** Where it stands: what the person did first, then work under way, then new work. */
  readonly order: Order
  /** When it began waiting: within its order, what waited longest goes first. */
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

/**
 * Something waiting, where it stands: its rank, the time it stands at within
 * it (since when it waits, or where the person put it), and whether it is in
 * its project's line: nothing of its task has had an agent yet.
 */
interface Ranked {
  readonly waiter: Waiter
  readonly rank: number
  readonly at: string
  readonly line: boolean
}

/** A project's line: its tasks in the order they start, and whether that is the person's order rather than the oldest first. */
export interface Line {
  readonly tasks: ReadonlyArray<string>
  readonly reordered: boolean
}

/** What a time a millisecond later is, as the store keeps times. */
const after = (at: string) => new Date(Date.parse(at) + 1).toISOString()

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
      agent: Agent & { readonly threadId: string; readonly sessionId: string; readonly byPerson?: boolean },
      work: (begun: Effect.Effect<void>) => Effect.Effect<void>,
    ): Effect.Effect<boolean>
    /** Who waits for a place, in the order they start, and whether each is in its project's line. */
    readonly order: Effect.Effect<ReadonlyArray<Agent & { readonly line: boolean }>>
    /** A project's line: its tasks that wait for a place before any agent has worked on them, in the order they start. */
    line(projectId: string): Effect.Effect<Line>
    /**
     * Puts a task in its project's line at a place, from 0, the rest keeping
     * their order, as the person moved it; a place past the end is its end.
     * False, and nothing moved, where it isn't in the line.
     */
    move(taskId: string, to: number): Effect.Effect<boolean, SqlError.SqlError>
    /** Puts a project's line back in the order its tasks began waiting. */
    oldestFirst(projectId: string): Effect.Effect<void, SqlError.SqlError>
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
      const askGrace = Duration.toMillis(options.askGrace ?? Duration.minutes(5))
      const automationsAtOnce = options.automations ?? AUTOMATIONS_AT_ONCE
      /** The tasks automations' runs started that are under way; none where they can't be read, so nothing waits for that. */
      const automated = provide(automatedTasks).pipe(
        Effect.catchCause((cause) =>
          Effect.as(Effect.logWarning('Could not read which tasks are automations’ runs', cause), new Set<string>() as ReadonlySet<string>),
        ),
      )
      /** How many automations' tasks are at work, of those at work. */
      const automationsAt = (at: ReadonlySet<string>, tasks: ReadonlySet<string>) =>
        new Set([...at].map((key) => key.replace(/ review$/, '')).filter((taskId) => tasks.has(taskId))).size
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
            -- A round of work after the plan counts as its lead's turns do (ADR-034): in one, or starting, not between them.
            AND NOT (r.plan_id IS NULL AND n.node_key = 'implement' AND a.state = 'running')
          UNION ALL
          SELECT c.task_id, t.id, 0 FROM conflict_resolutions c JOIN threads t ON t.task_id = c.task_id AND t.kind = 'task'
          WHERE c.state = 'resolving' AND c.waiting IS NULL
          UNION ALL
          SELECT h.task_id, h.id, h.kind = 'step' FROM provider_sessions p JOIN threads h ON h.id = p.thread_id
          WHERE p.state = 'starting' AND h.kind IN ('task', 'step') AND h.task_id IS NOT NULL`
        // An agent waiting on the person's answer, to a question or a permission, keeps its place a few minutes, so an answer
        // soon goes on where it was; past that it isn't using the machine, nor while an answer kept before waits for a place.
        // What it left running still is.
        const askedBefore = new Date((yield* Clock.currentTimeMillis) - askGrace).toISOString()
        const asking = new Set(
          (yield* sql<{ threadId: string | null }>`
            SELECT json_extract(payload, '$.threadId') AS thread_id FROM attention_requests WHERE kind = 'question'
              AND ((state = 'open' AND created_at <= ${askedBefore})
                OR (state = 'answered' AND json_extract(payload, '$.waitsForPlace') IS NOT NULL))
            UNION ALL
            SELECT s.thread_id FROM attention_requests q JOIN permission_requests r ON r.id = q.permission_request_id
            JOIN provider_sessions s ON s.id = r.provider_session_id
            WHERE q.kind = 'permission' AND q.state = 'open' AND q.created_at <= ${askedBefore}`).map((row) => row.threadId),
        )
        const at = new Set<string>()
        const holders = new Map<string, Holder>()
        const take = (taskId: string, review: boolean, threadId: string | null, kept: boolean) => {
          const key = keyOf(taskId, review)
          at.add(key)
          // What is under way is taken first, so an agent at work in its step or a turn is never kept only by what it left running.
          if (!holders.has(key)) holders.set(key, { taskId, review, threadId, kept })
        }
        for (const key of starting.keys()) take(key.replace(/ review$/, ''), key.endsWith(' review'), null, false)
        for (const row of under)
          if (row.threadId === null || !asking.has(row.threadId)) take(row.taskId, row.review === 1, row.threadId, false)
        // What the person said to an agent, still to be delivered, is its next turn on its way: the place isn't given to
        // anything else in between.
        const told = new Set(
          (yield* sql<{ threadId: string }>`
            SELECT DISTINCT i.thread_id FROM user_inputs i JOIN actors a ON a.id = i.author_actor_id
            WHERE i.state = 'queued' AND a.kind = 'person'`).map((row) => row.threadId),
        )
        const lingering = new Set<string>()
        for (const session of yield* sessions.onTasks) {
          // Left running and idle, it is nothing to wait for; not yet read, it counts.
          const working = session.background && (sampled.get(session.threadId)?.working ?? true)
          if (working) lingering.add(keyOf(session.taskId, session.reviewer))
          const turning = (session.turnRunning || told.has(session.threadId)) && !asking.has(session.threadId)
          if (working || turning) take(session.taskId, session.reviewer, session.threadId, !turning)
        }
        return { at, lingering, holders: [...holders.values()] }
      })

      /** Whether nothing of a task has had an agent yet: no turn of any of its agents reached one. */
      const untouched = (taskId: string) =>
        Effect.map(
          sql<{ one: number }>`
            SELECT 1 AS one FROM turn_deliveries d JOIN threads h ON h.id = d.thread_id
            WHERE h.task_id = ${taskId} AND d.delivered_at IS NOT NULL LIMIT 1`,
          (rows) => rows.length === 0,
        )

      /**
       * Everything waiting, in the order it starts: what the person did, then
       * work under way, then the line, where the person put it, else what
       * waited longest first.
       */
      const waiting = Effect.gen(function* () {
        const all = [
          ...(yield* Effect.forEach(sources, (source) =>
            source.pipe(Effect.catchCause((cause) => Effect.as(Effect.logWarning('Could not read what waits for a place', cause), []))),
          )).flat(),
          ...turns.values(),
        ]
        // A task's lead waiting before anything of its task has had an agent is in the line, with where the person put it.
        const asked = [...new Set(all.flatMap((waiter) => (waiter.order === 'person' || waiter.review === true ? [] : [waiter.taskId])))]
        const lined =
          asked.length === 0
            ? []
            : yield* sql<{ id: string; lineAt: string | null }>`
                SELECT k.id, k.line_at FROM tasks k WHERE k.id IN (SELECT value FROM json_each(${JSON.stringify(asked)}))
                  AND NOT EXISTS (SELECT 1 FROM turn_deliveries d JOIN threads h ON h.id = d.thread_id
                    WHERE h.task_id = k.id AND d.delivered_at IS NOT NULL)`.pipe(
                Effect.catchCause((cause) => Effect.as(Effect.logWarning('Could not read the line of what waits', cause), [])),
              )
        const line = new Map(lined.map((row) => [row.id, row.lineAt]))
        const tasks = yield* automated
        return all
          .map((waiter): Ranked => {
            const inLine = waiter.order !== 'person' && waiter.review !== true && line.has(waiter.taskId)
            // An automation's run waits after everything else, in the line or not (ADR-057).
            const order = orderIn(waiter.order, waiter.taskId, tasks)
            return {
              waiter,
              line: inLine,
              rank: order === 'automation' ? RANK.automation : inLine ? RANK.new : RANK[waiter.order],
              at: (inLine ? line.get(waiter.taskId) : null) ?? waiter.since,
            }
          })
          .toSorted((a, b) => a.rank - b.rank || a.at.localeCompare(b.at))
      })

      /**
       * Whether `key` has a place now: what the person did always has; its agent at work already has; otherwise one free,
       * with nothing waiting that stands before it.
       */
      const roomFor = (key: string, at: ReadonlySet<string>, asked: Order) =>
        Effect.gen(function* () {
          const tasks = yield* automated
          const order = orderIn(asked, key.replace(/ review$/, ''), tasks)
          if (order === 'person' || at.has(key)) return true
          if (at.size >= (yield* atOnce).count) return false
          // An automation's run takes a place only while fewer automations than it may have are at work.
          if (order === 'automation' && automationsAt(at, tasks) >= automationsAtOnce) return false
          // Work waiting for a place of its own, standing where this does or before it, goes first; what waits on an agent at
          // work, or is on its way, takes none.
          return !(yield* waiting).some(
            ({ waiter, rank }) => waiterKey(waiter) !== key && !at.has(waiterKey(waiter)) && rank <= RANK[order],
          )
        })

      /** Whether the person's own words wait in the thread to be delivered: then a turn there is theirs. What Althar writes quietly is its own. */
      const personSaid = (threadId: string) =>
        Effect.map(
          sql<{ one: number }>`
            SELECT 1 AS one FROM user_inputs i JOIN actors a ON a.id = i.author_actor_id
            WHERE i.thread_id = ${threadId} AND i.state = 'queued' AND a.kind = 'person' LIMIT 1`,
          (rows) => rows.length > 0,
        )

      /**
       * Starts what stands first while there are places, what the person did
       * whether or not there is one, and what waits on an agent at work
       * already; then, where how many are at work or may be changed, the
       * cards of what still waits are read again.
       */
      const look = lock.withPermits(1)(
        Effect.gen(function* () {
          const queue = yield* waiting
          if (queue.length === 0) return false
          const { at: busy, holders } = yield* atWork
          const most = (yield* atOnce).count
          const tasks = yield* automated
          const left: Array<string> = []
          for (const { waiter, line, rank } of queue) {
            const key = waiterKey(waiter)
            // On its way already: it is counted, and not started twice.
            if (starting.has(key)) continue
            if (
              waiter.order !== 'person' &&
              !busy.has(key) &&
              (busy.size >= most || (rank === RANK.automation && automationsAt(busy, tasks) >= automationsAtOnce))
            ) {
              left.push(waiter.taskId)
              continue
            }
            busy.add(key)
            hold(key)
            // Out of the line: where the person put it no longer stands.
            if (line) yield* sql`UPDATE tasks SET line_at = NULL WHERE id = ${waiter.taskId} AND line_at IS NOT NULL`
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
       * own turn waits in `turns`), or its task is stopped or abandoned; a
       * merged one's lead goes back to work for it (ADR-034).
       */
      const restored = Effect.gen(function* () {
        const rows = yield* sql<{ threadId: string; taskId: string; kind: string; since: string }>`
          SELECT h.id AS thread_id, h.task_id, h.kind, h.waits_for_place AS since FROM threads h
          JOIN tasks k ON k.id = h.task_id JOIN projects p ON p.id = h.project_id
          WHERE h.waits_for_place IS NOT NULL AND k.state IN ('draft', 'open', 'done') AND p.archived_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.task_id = h.task_id AND r.state = 'suspended'
              AND r.created_at = (SELECT max(created_at) FROM runs WHERE task_id = h.task_id))`
        const live = new Set((yield* sessions.onTasks).map((session) => session.threadId))
        return yield* Effect.forEach(
          rows.filter((row) => !live.has(row.threadId)),
          (row) =>
            Effect.map(Effect.all([personSaid(row.threadId), untouched(row.taskId)]), ([person, fresh]) => ({
              taskId: row.taskId,
              review: row.kind === 'step',
              // What the person said starts at once; what Althar said to it is the work of a task under way, or new work
              // where nothing of its task has had an agent yet.
              order: person ? ('person' as const) : fresh ? ('new' as const) : ('underway' as const),
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
            })),
        )
      })
      sources.push(restored)

      const enter = <A, E, R>(taskId: string, then: (room: boolean) => Effect.Effect<A, E, R>, how: Entering<A> = {}) =>
        Effect.gen(function* () {
          const key = keyOf(taskId, how.review)
          const decided = yield* lock.withPermits(1)(
            Effect.gen(function* () {
              const { at, lingering } = yield* atWork
              // The agent it follows, at work and done with its step, hands this one its place, ahead of whatever waits: a
              // task never loses its place between its own steps. Unless what that agent left running still runs: then the
              // two would be two agents at work, and this one waits for a place of its own, as work under way.
              const before = how.after === undefined ? undefined : keyOf(taskId, how.after === 'review')
              const handed = before !== undefined && before !== key && at.has(before) && !lingering.has(before)
              if (handed) at.delete(before)
              const room = handed || (yield* roomFor(key, at, how.order ?? (how.after === undefined ? 'new' : 'underway')))
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
        agent: Agent & { readonly threadId: string; readonly sessionId: string; readonly byPerson?: boolean },
        work: (begun: Effect.Effect<void>) => Effect.Effect<void>,
      ) =>
        Effect.gen(function* () {
          const key = keyOf(agent.taskId, agent.review)
          // What the person says to an agent, or an agent they started or switched to, goes on at once; what Althar tells it is the
          // work of a task under way, or new work where nothing of its task has had an agent yet, as a review's first turn.
          const order: Order =
            agent.byPerson === true || (yield* personSaid(agent.threadId))
              ? 'person'
              : agent.review !== true && (yield* untouched(agent.taskId))
                ? 'new'
                : 'underway'
          const room = yield* lock.withPermits(1)(
            Effect.gen(function* () {
              const room = yield* roomFor(key, (yield* atWork).at, order)
              if (room) {
                hold(key)
                turns.delete(agent.threadId)
                yield* sql`UPDATE threads SET waits_for_place = NULL WHERE id = ${agent.threadId} AND waits_for_place IS NOT NULL`
                return true
              }
              // Since when it waits, kept where it was first said: a turn asked again keeps its place in the queue.
              yield* sql`UPDATE threads SET waits_for_place = coalesce(waits_for_place, ${yield* timestamp}) WHERE id = ${agent.threadId}`
              const [kept] = yield* sql<{ since: string }>`SELECT waits_for_place AS since FROM threads WHERE id = ${agent.threadId}`
              turns.set(agent.threadId, { ...agent, order, since: kept?.since ?? (yield* timestamp), start: work })
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

      /** A project's line in the order it starts: each task once, with the time it stands at and since when it waits. */
      const lineOf = (projectId: string) =>
        Effect.gen(function* () {
          const lined = (yield* waiting).filter((entry) => entry.line)
          if (lined.length === 0) return []
          const ids = [...new Set(lined.map((entry) => entry.waiter.taskId))]
          const ours = new Set(
            (yield* sql<{ id: string }>`
              SELECT id FROM tasks WHERE project_id = ${projectId} AND id IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`).map(
              (row) => row.id,
            ),
          )
          const seen = new Set<string>()
          return lined.flatMap(({ waiter, at }) => {
            if (!ours.has(waiter.taskId) || seen.has(waiter.taskId)) return []
            seen.add(waiter.taskId)
            return [{ taskId: waiter.taskId, at, since: waiter.since }]
          })
        })

      /** The cards of a line's tasks, read again: each one's place in it changed. */
      const touchLine = (line: ReadonlyArray<{ readonly taskId: string }>) =>
        Effect.forEach(line, (one) => Effect.ignore(provide(touchTask(one.taskId))), { discard: true })

      const move = (taskId: string, to: number) =>
        Effect.gen(function* () {
          const [task] = yield* sql<{ projectId: string }>`SELECT project_id FROM tasks WHERE id = ${taskId}`
          if (task === undefined) return false
          const moved = yield* lock.withPermits(1)(
            Effect.gen(function* () {
              const line = yield* lineOf(task.projectId)
              const it = line.find((one) => one.taskId === taskId)
              if (it === undefined) return null
              const others = line.filter((one) => one !== it)
              const at = Math.max(0, Math.min(others.length, Math.floor(to)))
              const order = [...others.slice(0, at), it, ...others.slice(at)]
              // Each takes one of the times the line stands at now, in its new order: a task that joins later, waiting since
              // later, still goes after them all, and the line keeps its place among other projects' work.
              let last = ''
              yield* sql.withTransaction(
                Effect.forEach(
                  order,
                  (one, i) => {
                    const stands = line[i]?.at ?? one.at
                    last = stands > last ? stands : after(last)
                    return sql`UPDATE tasks SET line_at = ${last} WHERE id = ${one.taskId}`
                  },
                  { discard: true },
                ),
              )
              return line
            }),
          )
          if (moved === null) return false
          yield* touchLine(moved)
          yield* wake
          return true
        })

      const oldestFirst = (projectId: string) =>
        Effect.gen(function* () {
          const line = yield* lock.withPermits(1)(
            Effect.gen(function* () {
              const line = yield* lineOf(projectId)
              yield* sql`UPDATE tasks SET line_at = NULL WHERE project_id = ${projectId} AND line_at IS NOT NULL`
              return line
            }),
          )
          yield* touchLine(line)
          yield* wake
        })

      return Busy.of({
        atOnce,
        set,
        now: Effect.gen(function* () {
          const { at, holders } = yield* atWork
          return { busy: at.size, atOnce: (yield* atOnce).count, holders }
        }),
        order: Effect.map(waiting, (all) => all.map(({ waiter, line }) => ({ taskId: waiter.taskId, review: waiter.review, line }))),
        line: (projectId) =>
          Effect.map(lineOf(projectId), (line): Line => {
            const oldest = line.toSorted((a, b) => a.since.localeCompare(b.since))
            return { tasks: line.map((one) => one.taskId), reordered: line.some((one, i) => one.taskId !== oldest[i]?.taskId) }
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.as(Effect.logWarning('Could not read a project’s line', cause), { tasks: [], reordered: false }),
            ),
          ),
        move,
        oldestFirst,
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
