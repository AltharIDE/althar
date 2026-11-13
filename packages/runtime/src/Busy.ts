import { cpus, totalmem } from 'node:os'

import type { Ledger } from '@althar/persistence-sqlite'
import { Cause, Clock, Context, Duration, Effect, Layer, Queue, Semaphore, Stream } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { type AtOnceDefault, atOnceFor, clamp } from './atOnce'
import { automatedTasks } from './automated'
import { touchTask } from './cards'
import { RuntimeConfig } from './Config'
import { Connectivity } from './Connectivity'
import { Live } from './Live'
import { treeMembers, workedBetween } from './processTree'
import { plannedSmall, QUICK_LANE } from './quickLane'
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
 * and sitting idle takes none. What a task's agents left running is part of
 * the task's place, not another: kept only by that, a task holds one place,
 * and none beside an agent of its own at work. A lead or reviewer waiting on the person, on
 * a question or a permission, keeps its place for `askGrace` (five minutes,
 * while its agent's cache is warm, so an answer soon goes on where it was),
 * then takes none, unless what it left running is at work; nor once the
 * person answered, while an answer kept before waits to be told. The
 * coordinator, its asides, the permission judge and the runs Althar makes itself take no
 * place. An aside's lead starts and takes every turn at once, including after a restart;
 * once it leaves Scratch it takes a task's place again.
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
 * task's lead's first turn), which is its project's line. Everything that
 * waits for a place with none of its task's agents at work is up next on its
 * board (ADR-065): what is under way first, then the line. Within each, what waited longest goes first; in the line, unless
 * the person put it in an order of their own (`move`), kept on each task
 * (`line_at`), so a restart keeps it and a task that joins later goes to its
 * end. A task never loses its place between its own steps: a step after
 * another on the same task takes the place of the agent before it, ahead of
 * whatever waits, what that agent left running going on in it; so does any
 * work of a task that holds its place only by what its agents left running.
 * Work of a task that has to wait while another of its agents is at work
 * (`owed`) has the task's place first once that agent's frees, though the
 * person's work has taken every other place and more.
 * Without a place, work waits: written in the store where it waits, so a
 * restart doesn't lose it, or, a turn, in what the thread has queued. When a
 * place frees, what stands first starts (`queue`): looked at whenever an
 * agent's turn or session ends, what it left running changes or goes idle or
 * starts working, or the person answers or is asked something, and every few
 * seconds while anything waits. One agent's work follows on in its own place:
 * a lead at work on a step takes no other for its turns.
 *
 * While the computer is offline, nothing but what the person did takes a
 * place it hasn't already (ADR-060): work waiting in Up next, or the next
 * step of a task, would only start into a dead connection and fail, so it
 * waits until the computer is back, when the queue is looked at again.
 *
 * How many may be at once is the person's number, kept in the profile's
 * settings once they change it; otherwise the default this machine's cores
 * and memory give, worked out at each launch (atOnce.ts).
 *
 * A task planned small (quickLane.ts: no review, its lead at a light effort)
 * has the quick lane besides: one place beyond the number, so a one-line fix
 * never waits behind long tasks. Its lead takes a place of the number where
 * one is free, else the one beyond it; past that it waits as any task does,
 * for either. Only tasks planned small stand before it for that place. A
 * card counts it as any work beyond the number: "4 of 4 busy, and 1 more".
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
 * last, an automation's run, every step of it (ADR-061).
 */
export type Order = 'person' | 'underway' | 'new' | 'automation'

/*
 * Work under way and new work stand in one band, Up next's (ADR-065): by default what is under way first (`tier`), then
 * new work, each by since when it waits; once the person puts the band in their order, by where they put each task.
 */
const RANK: Readonly<Record<Order, number>> = { person: 0, underway: 1, new: 1, automation: 3 }

/** How many automations' tasks may be at work at once, unless a test says: one, so nothing of the person's waits behind them. */
const AUTOMATIONS_AT_ONCE = 1

/** Where work stands, as its task makes it: an automation's run's waits last, unless the person did it. */
export const orderIn = (order: Order, taskId: string, automated: ReadonlySet<string>): Order =>
  order === 'person' ? 'person' : automated.has(taskId) ? 'automation' : order

/** Which of a task's agents: its lead, its reviewer, or one of its lead's helpers. */
export interface Agent {
  readonly taskId: string
  /** Its reviewer, not its lead. */
  readonly review?: boolean | undefined
  /** One of its lead's helpers, by its thread: a place of its own (ADR-087), never its lead's or its reviewer's. */
  readonly helper?: string | undefined
}

/** How a step after another on the same task enters: the agent it follows, whose place it takes, with what that agent left running. */
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

/** How many of a task's helpers are at work at once (ADR-087); more wait for a place, up to ten (Helpers.ts). */
export const HELPERS_AT_ONCE = 4

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

/** A task's agent as it is counted: its lead by the task, its reviewer apart, and each of its helpers apart. */
const keyOf = (taskId: string, review?: boolean, helper?: string) =>
  helper !== undefined ? `${taskId} helper ${helper}` : review === true ? `${taskId} review` : taskId
const waiterKey = (waiter: Agent) => keyOf(waiter.taskId, waiter.review, waiter.helper)
/** A key's task, and which of its agents. */
const agentOf = (key: string): Agent => {
  const helper = / helper (\S+)$/.exec(key)
  if (helper !== null) return { taskId: key.slice(0, helper.index), helper: helper[1] }
  return key.endsWith(' review') ? { taskId: key.replace(/ review$/, ''), review: true } : { taskId: key }
}

/** Where something waiting stands: its rank, then within it work under way before new work (`tier`), then a time. */
interface Standing {
  readonly rank: number
  /** Within its rank: work under way before new work that waits as it came. */
  readonly tier: number
  readonly at: string
}

/**
 * Something waiting, where it stands: its rank, its tier, and the time it
 * stands at within them (since when it waits, or, where the person put its
 * project's work in an order of their own, that of the place it took there),
 * and whether it is in its project's line: nothing of its task has had an
 * agent yet.
 */
interface Ranked extends Standing {
  readonly waiter: Waiter
  /** Where it stands by its task: an automation's run's is an automation's, unless the person did it. */
  readonly order: Order
  readonly line: boolean
  /** The person put its task somewhere in Up next: it stands where its project's order puts it, whatever it waits for. */
  readonly placed: boolean
  /** Where it would stand had nobody moved anything. */
  readonly natural: Standing
  /** Its place in its project's order where the person put that in an order of their own: ties go by it. */
  readonly nth: number
}

/** What stands first: by rank, then tier, then the time it stands at. */
const ahead = (a: Standing, b: Standing) => a.rank - b.rank || a.tier - b.tier || a.at.localeCompare(b.at)

/**
 * A project's work that waits for a place, as its board's Up next shows it
 * (ADR-065): first its tasks already under way whose next work waits, none of
 * their agents at work, in the order they get one; then its line, the tasks
 * no agent has worked on yet, in the order they start, and whether that is
 * the person's order rather than the oldest first.
 */
export interface Line {
  readonly continuing: ReadonlyArray<string>
  readonly tasks: ReadonlyArray<string>
  /** Both, in the one order they get a place: what continues and the line, as the person put them. */
  readonly order: ReadonlyArray<string>
  readonly reordered: boolean
}

/** What a time a millisecond later is, as the store keeps times. */
const after = (at: string) => new Date(Date.parse(at) + 1).toISOString()

/** What Busy reads: the store, the sessions, what happens, its settings, and whether the computer is online. */
type Reads = SqlClient.SqlClient | Sessions | Live | Ledger | RuntimeConfig | Connectivity

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
    /**
     * A project's work that waits for a place, in the order it gets one: its tasks under way with none of their agents at
     * work, then its line, its tasks that wait before any agent has worked on them.
     */
    line(projectId: string): Effect.Effect<Line>
    /**
     * Puts a task in its project's Up next at a place, from 0, the rest keeping
     * their order, as the person moved it; a place past the end is its end.
     * What continues and the line are one order here: either goes anywhere in
     * it. False, and nothing moved, where it doesn't wait there; `joining`,
     * one about to wait (a plan the person starts by moving it) is put there
     * for when it does.
     */
    move(taskId: string, to: number, joining?: boolean): Effect.Effect<boolean, SqlError.SqlError>
    /**
     * Lets go of the turns a task's lead and reviewer wait for a place to
     * give: the threads they were for, none where nothing waited.
     */
    letGo(taskId: string): Effect.Effect<ReadonlyArray<string>, SqlError.SqlError>
    /** Puts a project's line back in the order its tasks began waiting. */
    oldestFirst(projectId: string): Effect.Effect<void, SqlError.SqlError>
    /** Adds where waiting work is read from: each time the queue is looked at, every source is read, and what waited longest starts first. */
    queue(waiting: Effect.Effect<ReadonlyArray<Waiter>, unknown>): Effect.Effect<void>
    /** Looks at the queue again: a place may have freed, or something waits. */
    readonly wake: Effect.Effect<void>
  }
>()('@althar/runtime/Busy') {
  static readonly layer: Layer.Layer<Busy, never, Reads> = Layer.effect(
    Busy,
    Effect.gen(function* () {
      const context = yield* Effect.context<SqlClient.SqlClient | Ledger>()
      const provide = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient | Ledger>) => Effect.provideContext(effect, context)
      const sql = yield* SqlClient.SqlClient
      const sessions = yield* Sessions
      const live = yield* Live
      const connectivity = yield* Connectivity
      const options = (yield* RuntimeConfig).busy ?? {}
      const every = options.every ?? Duration.seconds(5)
      const sampleEvery = options.sample ?? Duration.seconds(2)
      const quiet = Duration.toMillis(options.quiet ?? Duration.seconds(30))
      const askGrace = Duration.toMillis(options.askGrace ?? Duration.minutes(5))
      const automationsAtOnce = options.automations ?? AUTOMATIONS_AT_ONCE
      const quickLane = options.quick ?? QUICK_LANE
      /**
       * Which of these tasks are planned small, by the plan of their run under way (quickLane.ts): their leads have the
       * quick lane. None where it can't be read, so each waits as any task does.
       */
      const smallOf = (taskIds: ReadonlyArray<string>) =>
        quickLane === 0 || taskIds.length === 0
          ? Effect.succeed(new Set<string>() as ReadonlySet<string>)
          : sql<{ taskId: string; parameters: string }>`
              SELECT task_id, parameters FROM runs WHERE plan_id IS NOT NULL AND state IN ('admitted', 'running')
                AND task_id IN (SELECT value FROM json_each(${JSON.stringify([...new Set(taskIds)])}))`.pipe(
              Effect.map(
                (rows) => new Set(rows.flatMap((row) => (plannedSmall(row.parameters) ? [row.taskId] : []))) as ReadonlySet<string>,
              ),
              Effect.catchCause((cause) =>
                Effect.as(
                  Effect.logWarning('Could not read which tasks are planned small', cause),
                  new Set<string>() as ReadonlySet<string>,
                ),
              ),
            )
      /** The most at work that leaves room for an agent: the number, and for a small task's lead the quick lane beyond it. */
      const roomUpTo = (most: number, agent: Agent, small: ReadonlySet<string>) =>
        agent.review !== true && agent.helper === undefined && small.has(agent.taskId) ? most + quickLane : most
      /** The tasks automations' runs started that are under way; none where they can't be read, so nothing waits for that. */
      const automated = provide(automatedTasks).pipe(
        Effect.catchCause((cause) =>
          Effect.as(Effect.logWarning('Could not read which tasks are automations’ runs', cause), new Set<string>() as ReadonlySet<string>),
        ),
      )
      /** How many automations' tasks are at work, of those at work. */
      const automationsAt = (at: ReadonlySet<string>, tasks: ReadonlySet<string>) =>
        new Set([...at].map((key) => agentOf(key).taskId).filter((taskId) => tasks.has(taskId))).size
      /** Whether a task's helpers take as many places as they may (ADR-087): another waits its turn, however many are free. */
      const helpersFull = (agent: Agent, at: ReadonlySet<string>) =>
        agent.helper !== undefined &&
        [...at].filter((key) => {
          const one = agentOf(key)
          return one.taskId === agent.taskId && one.helper !== undefined
        }).length >= HELPERS_AT_ONCE
      /** Whether as many automations' runs are at work as may be (ADR-061): another takes no new place. */
      const automationsFull = (order: Order, at: ReadonlySet<string>, tasks: ReadonlySet<string>) =>
        order === 'automation' && automationsAt(at, tasks) >= automationsAtOnce
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
      /*
       * Tasks with work waiting while another of their agents held a place: once it frees, that work has it before
       * anything else that waits, as the task's own (ADR-037), over the number too, as it was the task's.
       */
      const owed = new Set<string>()
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

      const asides = Effect.map(
        sql<{ id: string }>`SELECT id FROM tasks WHERE shelf = 'scratch'`,
        (rows) => new Set(rows.map((row) => row.id)),
      ).pipe(Effect.catchCause((cause) => Effect.as(Effect.logWarning('Could not read which tasks are asides', cause), new Set<string>())))
      const chatting = (agent: Agent, scratch: ReadonlySet<string>) =>
        agent.review !== true && agent.helper === undefined && scratch.has(agent.taskId)

      /** The agents at work now, each once (`at`), and who holds each place (`holders`): a task kept only by what its agents left running holds one. */
      const atWork = Effect.gen(function* () {
        const scratch = yield* asides
        // What the store says is under way, on the thread it is on: a step of a running run on an agent, a round its lead was
        // asked about, an agent starting.
        const under = yield* sql<{ taskId: string; threadId: string | null; review: number; helper: string | null }>`
          SELECT r.task_id, CASE WHEN n.node_key = 'review' THEN s.id ELSE t.id END AS thread_id, n.node_key = 'review' AS review,
            NULL AS helper
          FROM runs r JOIN workflow_executions e ON e.run_id = r.id JOIN nodes n ON n.execution_id = e.id
          JOIN node_attempts a ON a.node_id = n.id
          JOIN threads t ON t.task_id = r.task_id AND t.kind = 'task'
          LEFT JOIN threads s ON s.task_id = r.task_id AND s.kind = 'step' AND s.node_key = 'review'
          WHERE r.state = 'running' AND a.state IN ('admitted', 'running') AND n.node_key IN ('implement', 'settle', 'review')
            -- A round of work after the plan counts as its lead's turns do (ADR-034): in one, or starting, not between them.
            AND NOT (r.plan_id IS NULL AND n.node_key = 'implement' AND a.state = 'running')
          UNION ALL
          SELECT c.task_id, t.id, 0, NULL FROM conflict_resolutions c JOIN threads t ON t.task_id = c.task_id AND t.kind = 'task'
          WHERE c.state = 'resolving' AND c.waiting IS NULL
          UNION ALL
          -- A helper starting takes a place of its own, by its thread (ADR-087).
          SELECT h.task_id, h.id, h.kind = 'step' AND coalesce(h.node_key, '') NOT LIKE 'helper:%',
            CASE WHEN h.node_key LIKE 'helper:%' THEN h.id END
          FROM provider_sessions p JOIN threads h ON h.id = p.thread_id
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
        const holders = new Map<string, Holder>()
        const take = (taskId: string, review: boolean, threadId: string | null, kept: boolean, helper?: string) => {
          if (chatting({ taskId, review, helper }, scratch)) return
          const key = keyOf(taskId, review, helper)
          // What is under way is taken first, so an agent at work in its step or a turn is never kept only by what it left running.
          if (!holders.has(key)) holders.set(key, { taskId, review, threadId, kept, ...(helper === undefined ? {} : { helper }) })
        }
        for (const key of starting.keys()) {
          const agent = agentOf(key)
          take(agent.taskId, agent.review === true, null, false, agent.helper)
        }
        for (const row of under)
          if (row.threadId === null || !asking.has(row.threadId))
            take(row.taskId, row.review === 1, row.threadId, false, row.helper ?? undefined)
        // What the person said to an agent, still to be delivered, is its next turn on its way: the place isn't given to
        // anything else in between.
        const told = new Set(
          (yield* sql<{ threadId: string }>`
            SELECT DISTINCT i.thread_id FROM user_inputs i JOIN actors a ON a.id = i.author_actor_id
            WHERE i.state = 'queued' AND a.kind = 'person'`).map((row) => row.threadId),
        )
        for (const session of yield* sessions.onTasks) {
          // Left running and idle, it is nothing to wait for; not yet read, it counts.
          const working = session.background && (sampled.get(session.threadId)?.working ?? true)
          const turning =
            (session.turnRunning || (session.acceptingTurns !== false && told.has(session.threadId))) && !asking.has(session.threadId)
          if (working || turning)
            take(session.taskId, session.reviewer, session.threadId, !turning, session.helper ? session.threadId : undefined)
        }
        // One task, one place: what its agents left running counts once, and not at all beside an agent of its at work.
        const placed = new Set([...holders.values()].flatMap((holder) => (holder.kept ? [] : [holder.taskId])))
        const held = [...holders.values()].filter((holder) => {
          if (!holder.kept) return true
          if (placed.has(holder.taskId)) return false
          placed.add(holder.taskId)
          return true
        })
        return { at: new Set(held.map((holder) => keyOf(holder.taskId, holder.review, holder.helper))), holders: held }
      })

      /** The place a task holds only by what its agents left running, which its next work takes; undefined where it holds none so. */
      const keptPlace = (taskId: string, holders: ReadonlyArray<Holder>) => {
        const its = holders.filter((holder) => holder.taskId === taskId)
        return its.length === 1 && its[0]?.kept === true ? keyOf(taskId, its[0].review, its[0].helper) : undefined
      }

      /** Whether nothing of a task has had an agent yet: no turn of any of its agents reached one. */
      const untouched = (taskId: string) =>
        Effect.map(
          sql<{ one: number }>`
            SELECT 1 AS one FROM turn_deliveries d JOIN threads h ON h.id = d.thread_id
            WHERE h.task_id = ${taskId} AND d.delivered_at IS NOT NULL LIMIT 1`,
          (rows) => rows.length === 0,
        )

      /** Everything waiting, from every source, and the turns that wait. */
      const everything = Effect.map(
        Effect.forEach(sources, (source) =>
          source.pipe(Effect.catchCause((cause) => Effect.as(Effect.logWarning('Could not read what waits for a place', cause), []))),
        ),
        (read): ReadonlyArray<Waiter> => [...read.flat(), ...turns.values()],
      )

      /**
       * What waits, in the order it starts: what the person did, then work
       * under way, then the line, each what waited longest first. A project
       * the person put in an order of their own stands in that order, in the
       * places its work stands at by default, so other projects' work keeps
       * where it stood (ADR-065).
       */
      const rank = (all: ReadonlyArray<Waiter>) =>
        Effect.gen(function* () {
          const scratch = yield* asides
          // A task's lead or reviewer waiting stands where the person put its task in Up next; its lead waiting before anything of
          // its task has had an agent is in the line.
          const asked = [
            ...new Set(all.flatMap((waiter) => (waiter.order === 'person' || waiter.helper !== undefined ? [] : [waiter.taskId]))),
          ]
          const read =
            asked.length === 0
              ? []
              : yield* sql<{ id: string; projectId: string; lineAt: string | null; untouched: number }>`
                  SELECT k.id, k.project_id, k.line_at, NOT EXISTS (SELECT 1 FROM turn_deliveries d JOIN threads h ON h.id = d.thread_id
                      WHERE h.task_id = k.id AND d.delivered_at IS NOT NULL) AS untouched
                  FROM tasks k WHERE k.id IN (SELECT value FROM json_each(${JSON.stringify(asked)}))`.pipe(
                  Effect.catchCause((cause) => Effect.as(Effect.logWarning('Could not read the line of what waits', cause), [])),
                )
          const line = new Set(read.flatMap((row) => (row.untouched === 1 ? [row.id] : [])))
          const put = new Map(read.flatMap((row) => (row.lineAt === null ? [] : [[row.id, row.lineAt] as const])))
          const projectOf = new Map(read.map((row) => [row.id, row.projectId] as const))
          const tasks = yield* automated
          const each = all.map((waiter) => {
            // A saved aside waiting from an older build starts at once too, outside the task line.
            const asked = chatting(waiter, scratch) ? 'person' : waiter.order
            const theirs = asked !== 'person' && waiter.helper === undefined
            const inLine = theirs && waiter.review !== true && line.has(waiter.taskId)
            const owes = asked !== 'person' && owed.has(waiter.taskId)
            // An automation's run waits after everything else, in the line or not (ADR-061).
            const order = orderIn(asked, waiter.taskId, tasks)
            const natural: Standing = {
              // Owed its task's place, it stands before all but what the person did; an automation's run, else, after all.
              rank: owes ? RANK.person + 0.5 : RANK[order],
              tier: !inLine && asked !== 'new' ? 0 : 1,
              at: waiter.since,
            }
            const lineAt = theirs ? put.get(waiter.taskId) : undefined
            return { waiter, order, line: inLine, natural, lineAt, project: theirs && !owes ? projectOf.get(waiter.taskId) : undefined }
          })
          const projects = new Map<string, Array<(typeof each)[number]>>()
          for (const one of each) if (one.project !== undefined) projects.set(one.project, [...(projects.get(one.project) ?? []), one])
          const slotted = new Map<(typeof each)[number], { readonly standing: Standing; readonly nth: number }>()
          for (const ours of projects.values()) {
            if (ours.every((one) => one.lineAt === undefined)) continue
            const places = ours.map((one) => one.natural).toSorted(ahead)
            // Within the project, what the person put somewhere stands at its time as work under way does, and what they didn't
            // where it would.
            const within = (one: (typeof each)[number]): Standing =>
              one.lineAt === undefined ? one.natural : { rank: RANK.underway, tier: 0, at: one.lineAt }
            ours
              .toSorted((a, b) => ahead(within(a), within(b)) || ahead(a.natural, b.natural))
              .forEach((one, nth) => slotted.set(one, { standing: places[nth] ?? one.natural, nth }))
          }
          return each
            .map((one): Ranked => {
              const slot = slotted.get(one)
              return {
                waiter: one.waiter,
                order: one.order,
                line: one.line,
                placed: one.lineAt !== undefined,
                natural: one.natural,
                ...(slot?.standing ?? one.natural),
                nth: slot?.nth ?? 0,
              }
            })
            .toSorted((a, b) => ahead(a, b) || a.nth - b.nth)
        })

      /** Everything waiting, in the order it starts. */
      const waiting = Effect.flatMap(everything, rank)

      /** A task at work, or gone from Up next: where the person put it there no longer stands. */
      const unplace = (taskId: string) => sql`UPDATE tasks SET line_at = NULL WHERE id = ${taskId} AND line_at IS NOT NULL`

      /**
       * Whether a task's agent has a place now: what the person did always has; its agent at work already has; so has
       * its task's place kept only by what its agents left running; otherwise one free, with nothing waiting that stands
       * before it.
       */
      const roomFor = (
        agent: Agent,
        { at, holders }: { readonly at: ReadonlySet<string>; readonly holders: ReadonlyArray<Holder> },
        asked: Order,
      ) =>
        Effect.gen(function* () {
          if (chatting(agent, yield* asides)) return true
          const key = keyOf(agent.taskId, agent.review, agent.helper)
          const tasks = yield* automated
          const order = orderIn(asked, agent.taskId, tasks)
          if (order === 'person' || at.has(key)) return true
          // Offline, it waits for the computer to be back rather than start into a dead connection.
          if (!(yield* connectivity.online)) return false
          // A task's helpers, or automations' runs, as many at work as may be: it waits its turn, whatever is free.
          if (helpersFull(agent, at)) return false
          if (agent.helper === undefined && keptPlace(agent.taskId, holders) !== undefined) return true
          const most = (yield* atOnce).count
          // Every place of the number taken, only a small task's lead has room, in the quick lane beyond it.
          const beyond = at.size >= most
          if (beyond && at.size >= roomUpTo(most, agent, yield* smallOf([agent.taskId]))) return false
          if (automationsFull(order, at, tasks)) return false
          // Work waiting for a place of its own, standing where this does or before it, goes first; what waits on an agent at
          // work, or is on its way, takes none, nor what its kind's limit holds back. In the quick lane, only what could take its
          // place stands before it. This stands after all else of its rank, unless the person put it somewhere in Up next: then
          // it stands there.
          const asking: Waiter = { ...agent, order: asked, since: '\uffff', start: Effect.void }
          const queue = yield* rank([...(yield* everything).filter((one) => waiterKey(one) !== key), asking])
          const small = beyond ? yield* smallOf(queue.map(({ waiter }) => waiter.taskId)) : new Set<string>()
          // Ranked with the rest, it is among them.
          const mine = queue.find((one) => one.waiter === asking)!
          return !queue.some(
            (one) =>
              waiterKey(one.waiter) !== key &&
              !at.has(waiterKey(one.waiter)) &&
              ahead(one, mine) <= 0 &&
              !helpersFull(one.waiter, at) &&
              !automationsFull(one.order, at, tasks) &&
              (!beyond || roomUpTo(most, one.waiter, small) > most),
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
          const online = yield* connectivity.online
          const scratch = yield* asides
          // Which of what waits is planned small, read only where every place of the number may be taken: those have the quick lane.
          const small = busy.size + queue.length > most ? yield* smallOf(queue.map(({ waiter }) => waiter.taskId)) : new Set<string>()
          const left: Array<string> = []
          // The tasks whose place kept by what they left running is taken in this look: by one of their work only.
          const taken = new Set<string>()
          for (const { waiter, order, placed } of queue) {
            const key = waiterKey(waiter)
            // On its way already: it is counted, and not started twice.
            if (starting.has(key)) continue
            // Offline, only what the person did starts, and what follows on for an agent at work.
            if (!online && order !== 'person' && !busy.has(key)) {
              left.push(waiter.taskId)
              continue
            }
            // A task's helpers take four places at most at once (ADR-087), however many are free: the rest wait their turn, after a
            // restart too, where what waited is started from here.
            if (!busy.has(key) && helpersFull(waiter, busy)) {
              left.push(waiter.taskId)
              continue
            }
            const kept = taken.has(waiter.taskId) ? undefined : keptPlace(waiter.taskId, holders)
            // Owed its task's place, which its agent has freed since: it takes that place, though others hold every one.
            const back = owed.has(waiter.taskId) && !holders.some((holder) => holder.taskId === waiter.taskId)
            // Its task's own place, kept or owed, is no new one: an automation's run takes it beyond how many may be at work. A new
            // place it takes only while fewer automations than it may have are at work, wherever the person put it in Up next.
            if (
              order !== 'person' &&
              !busy.has(key) &&
              kept === undefined &&
              !back &&
              (busy.size >= roomUpTo(most, waiter, small) || automationsFull(order, busy, tasks))
            ) {
              left.push(waiter.taskId)
              continue
            }
            // Its task's own place: what its agents left running goes on in it, counted no more.
            if (kept !== undefined) {
              busy.delete(kept)
              taken.add(waiter.taskId)
            }
            owed.delete(waiter.taskId)
            if (!chatting(waiter, scratch)) busy.add(key)
            hold(key)
            // Out of Up next: where the person put it no longer stands.
            if (placed) yield* unplace(waiter.taskId)
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
          // What waits while another agent of its task holds a place has that place first once it frees; nothing else is owed.
          const waits = new Set(left)
          for (const taskId of owed) if (!waits.has(taskId)) owed.delete(taskId)
          for (const taskId of waits) if (holders.some((holder) => holder.taskId === taskId)) owed.add(taskId)
          // Who holds the places, and whether by what they left running, is on the cards too, as is each one's place in Up next:
          // read again when either changes.
          const shown = `${holders
            .map((holder) => `${keyOf(holder.taskId, holder.review, holder.helper)}${holder.kept ? ' kept' : ''}`)
            .toSorted()
            .join(',')} ${most} ${queue.map(({ waiter }) => waiterKey(waiter)).join(',')}`
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
              : event._tag === 'TurnEnded' ||
                  event._tag === 'AttentionNeeded' ||
                  event._tag === 'AttentionClosed' ||
                  event._tag === 'Connection'
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
        const rows = yield* sql<{ threadId: string; taskId: string; kind: string; nodeKey: string | null; since: string }>`
          SELECT h.id AS thread_id, h.task_id, h.kind, h.node_key, h.waits_for_place AS since FROM threads h
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
              review: row.kind === 'step' && !(row.nodeKey ?? '').startsWith('helper:'),
              ...((row.nodeKey ?? '').startsWith('helper:') ? { helper: row.threadId } : {}),
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

      // A place held is let go by what it holds it for, attached with nothing between the two: no interruption loses it.
      const enter = <A, E, R>(taskId: string, then: (room: boolean) => Effect.Effect<A, E, R>, how: Entering<A> = {}) =>
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const key = keyOf(taskId, how.review)
            const decided = yield* restore(
              lock.withPermits(1)(
                Effect.gen(function* () {
                  const work = yield* atWork
                  // The agent it follows, at work and done with its step, hands this one its place, ahead of whatever waits: a
                  // task never loses its place between its own steps. What that agent left running goes on in it, counted once.
                  const before = how.after === undefined ? undefined : keyOf(taskId, how.after === 'review')
                  const handed = before !== undefined && before !== key && work.at.has(before)
                  const room =
                    handed ||
                    (yield* roomFor({ taskId, review: how.review }, work, how.order ?? (how.after === undefined ? 'new' : 'underway')))
                  const done = yield* then(room)
                  // At work now, it no longer stands where the person put it in Up next.
                  if (room) yield* unplace(taskId)
                  // Held from here, so nothing takes the place before what starts it is under way.
                  if (room && how.next !== undefined) hold(key)
                  return { room, done }
                }),
              ),
            )
            // Waiting, it may yet start now: what waits before it may not be able to.
            if (!decided.room) yield* wake
            else if (how.next !== undefined) yield* restore(how.next(decided.done)).pipe(Effect.ensuring(release(key)))
            return decided.done
          }),
        )

      const turn = (
        agent: Agent & { readonly threadId: string; readonly sessionId: string; readonly byPerson?: boolean },
        work: (begun: Effect.Effect<void>) => Effect.Effect<void>,
      ) =>
        Effect.gen(function* () {
          const key = keyOf(agent.taskId, agent.review, agent.helper)
          // What the person says to an agent, or an agent they started or switched to, goes on at once; what Althar tells it is the
          // work of a task under way, or new work where nothing of its task has had an agent yet, as a review's first turn.
          const order: Order =
            agent.byPerson === true || (yield* personSaid(agent.threadId))
              ? 'person'
              : agent.review !== true && (yield* untouched(agent.taskId))
                ? 'new'
                : 'underway'
          return yield* Effect.uninterruptibleMask((restore) =>
            Effect.gen(function* () {
              const room = yield* restore(
                lock.withPermits(1)(
                  Effect.gen(function* () {
                    const room = yield* roomFor(agent, yield* atWork, order)
                    if (room) {
                      yield* unplace(agent.taskId)
                      turns.delete(agent.threadId)
                      yield* sql`UPDATE threads SET waits_for_place = NULL WHERE id = ${agent.threadId} AND waits_for_place IS NOT NULL`
                      // Held last, so nothing that fails after leaves it held; let go by the turn, attached with nothing between.
                      hold(key)
                      return true
                    }
                    // Since when it waits, kept where it was first said: a turn asked again keeps its place in the queue.
                    yield* sql`UPDATE threads SET waits_for_place = coalesce(waits_for_place, ${yield* timestamp}) WHERE id = ${agent.threadId}`
                    const [kept] = yield* sql<{ since: string }>`SELECT waits_for_place AS since FROM threads WHERE id = ${agent.threadId}`
                    turns.set(agent.threadId, { ...agent, order, since: kept?.since ?? (yield* timestamp), start: work })
                    return false
                  }),
                ),
              )
              if (!room) {
                yield* restore(Effect.andThen(Effect.ignore(provide(touchTask(agent.taskId))), wake))
                return false
              }
              const done = releaseOnce(key)
              yield* restore(work(done)).pipe(Effect.ensuring(done))
              return true
            }),
          )
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

      /**
       * A project's work that waits for a place, in the order it gets one, each task once (ADR-065): its tasks under way, none
       * of whose agents is at work (one with an agent at work is running, and what else of it waits goes on beside that), and
       * its line, the tasks no agent has worked on yet, in one band: what is under way first unless the person put them in an
       * order of their own. Each with the time it stands at, since when it waits, whether it is in the line, whether the
       * person put it where it stands, and where it would stand had nobody moved anything.
       */
      const standingOf = (projectId: string) =>
        Effect.gen(function* () {
          const queue = yield* waiting
          if (queue.length === 0) return []
          const ids = [...new Set(queue.map((entry) => entry.waiter.taskId))]
          const ours = new Set(
            (yield* sql<{ id: string }>`
              SELECT id FROM tasks WHERE project_id = ${projectId} AND id IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`).map(
              (row) => row.id,
            ),
          )
          const lined = new Set(queue.flatMap((entry) => (entry.line ? [entry.waiter.taskId] : [])))
          const under = queue.some(({ waiter: { taskId } }) => ours.has(taskId) && !lined.has(taskId))
          // Who is at work is read only where something of the project's under way waits: the line alone needs none of it.
          const working = under
            ? new Set((yield* atWork).holders.flatMap((holder) => (holder.kept ? [] : [holder.taskId])))
            : new Set<string>()
          const seen = new Set<string>()
          return queue.flatMap(({ waiter, at, placed, natural }) => {
            const { taskId } = waiter
            if (!ours.has(taskId) || seen.has(taskId) || (!lined.has(taskId) && working.has(taskId))) return []
            seen.add(taskId)
            return [{ taskId, at, since: waiter.since, line: lined.has(taskId), placed, natural }]
          })
        })

      /** The cards of a line's tasks, read again: each one's place in it changed. */
      const touchLine = (line: ReadonlyArray<{ readonly taskId: string }>) =>
        Effect.forEach(line, (one) => Effect.ignore(provide(touchTask(one.taskId))), { discard: true })

      const move = (taskId: string, to: number, joining = false) =>
        Effect.gen(function* () {
          const [task] = yield* sql<{ projectId: string }>`SELECT project_id FROM tasks WHERE id = ${taskId}`
          if (task === undefined) return false
          const moved = yield* lock.withPermits(1)(
            Effect.gen(function* () {
              const band = yield* standingOf(task.projectId)
              // One about to join, such as a plan the person starts by moving it: it stands where they put it once it waits.
              const found = band.find((one) => one.taskId === taskId)
              const it = found ?? (joining ? { taskId, at: yield* timestamp } : undefined)
              if (it === undefined) return null
              const others = band.filter((one) => one.taskId !== taskId)
              const at = Math.max(0, Math.min(others.length, Math.floor(to)))
              const order = [...others.slice(0, at), it, ...others.slice(at)]
              // What the person put somewhere is the order up to the last task not where it would stand by default; those after
              // it stand where they would anyway, an automation's run after everything else, and are put nowhere. Back in the
              // default order, nothing of the project's is the person's, as with oldestFirst.
              const natural = band.toSorted((a, b) => ahead(a.natural, b.natural))
              const put = order.findLastIndex((one, i) => one.taskId !== natural[i]?.taskId) + 1
              // Each put takes one of the times the band stands at now, in its new order, rising: the project's own order. Its
              // work keeps the places it stands at among other projects' (`rank`), and a task that joins later goes after them.
              const times = [...band.map((one) => one.at), ...(found === undefined ? [it.at] : [])]
              let last = ''
              yield* sql.withTransaction(
                put === 0
                  ? Effect.asVoid(sql`UPDATE tasks SET line_at = NULL WHERE project_id = ${task.projectId} AND line_at IS NOT NULL`)
                  : Effect.forEach(
                      order,
                      (one, i) => {
                        if (i >= put) return sql`UPDATE tasks SET line_at = NULL WHERE id = ${one.taskId} AND line_at IS NOT NULL`
                        const stands = times[i] ?? one.at
                        last = stands > last ? stands : after(last)
                        return sql`UPDATE tasks SET line_at = ${last} WHERE id = ${one.taskId}`
                      },
                      { discard: true },
                    ),
              )
              return order
            }),
          )
          if (moved === null) return false
          yield* touchLine(moved)
          yield* wake
          return true
        })

      const oldestFirst = (projectId: string) =>
        Effect.gen(function* () {
          const band = yield* lock.withPermits(1)(
            Effect.gen(function* () {
              const band = yield* standingOf(projectId)
              yield* sql`UPDATE tasks SET line_at = NULL WHERE project_id = ${projectId} AND line_at IS NOT NULL`
              return band
            }),
          )
          yield* touchLine(band)
          yield* wake
        })

      /**
       * Lets go of the turns a task's lead and reviewer wait for a place to give: they wait no more, here or on their threads,
       * and the task leaves Up next. The threads they were for; what they would have delivered is the caller's.
       */
      const letGo = (taskId: string) =>
        Effect.gen(function* () {
          const gone = yield* lock.withPermits(1)(
            Effect.gen(function* () {
              const threads = (yield* sql<{ id: string }>`
                SELECT id FROM threads WHERE task_id = ${taskId} AND waits_for_place IS NOT NULL
                  AND coalesce(node_key, '') NOT LIKE 'helper:%'`).map((row) => row.id)
              for (const [threadId, turn] of turns) if (turn.taskId === taskId && turn.helper === undefined) threads.push(threadId)
              const all = [...new Set(threads)]
              for (const threadId of all) {
                turns.delete(threadId)
                yield* sql`UPDATE threads SET waits_for_place = NULL WHERE id = ${threadId}`
              }
              if (all.length > 0) yield* unplace(taskId)
              return all
            }),
          )
          if (gone.length > 0) {
            yield* Effect.ignore(provide(touchTask(taskId)))
            yield* wake
          }
          return gone
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
          Effect.map(standingOf(projectId), (band): Line => {
            // The order the person hasn't changed: what continues first, then the line, each by since when it waits, an
            // automation's run after them all.
            const natural = band.toSorted((a, b) => ahead(a.natural, b.natural))
            return {
              continuing: band.flatMap((one) => (one.line ? [] : [one.taskId])),
              tasks: band.flatMap((one) => (one.line ? [one.taskId] : [])),
              order: band.map((one) => one.taskId),
              reordered: band.some((one, i) => one.taskId !== natural[i]?.taskId),
            }
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.as(Effect.logWarning('Could not read a project’s line', cause), {
                continuing: [],
                tasks: [],
                order: [],
                reordered: false,
              }),
            ),
          ),
        move,
        oldestFirst,
        letGo,
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
