import type { ProjectId } from '@althar/domain'
import type { Ledger } from '@althar/persistence-sqlite'
import { Context, type Crypto, Duration, Effect, Layer, Option, Queue, Scope } from 'effect'
import { SqlClient } from 'effect/sql'

import { RuntimeConfig } from './Config'
import { contained } from './Failures'
import { Launches } from './Launches'
import { ALTHAR, type Listed, listProcesses, marksOf, ownersOf, workIn } from './machine'
import { Sessions } from './Sessions'
import { stopProcesses } from './stopping'
import { addItem } from './threads'

/*
 * What a task leaves running once it settles, however it settles: merged
 * (its merge read back, or heard from its host), marked done, abandoned, its
 * commits after a merge left out, a review posted, a round that made nothing
 * new putting it back where it was. Each of them says so here (`settled`),
 * after the settled fact, and everything of the task stops in the background:
 * every agent on its threads (its lead, its steps', its reviewer) once its
 * turn ends, what each left running in the background first, through the
 * agent, then the task's runs, and last whatever still carries the task in
 * its environment (`ALTHAR_WORK`, machine.ts), as a server does that left its
 * agent's process group: asked to stop, then killed, with its whole group.
 * Nothing waits on it, and nothing fails for it: what wouldn't stop is
 * logged, and said in the task's thread as one line. Reopened, a task's agents
 * start again as they always do, when they are next asked for.
 *
 * Settling only stops what Althar keeps track of now. What it lost track of,
 * as what ran before Althar last quit, is found by its mark: a while after
 * Althar starts and every few minutes after, every process outside Althar's
 * own tree that carries a settled task's work, or a removed project's, stops,
 * and so does an agent left idle on a settled task. A process that carries no
 * mark, or one of work this store doesn't know, as another Althar's, is never
 * touched; nor is Althar itself, or what it runs under.
 */

/** How long settling waits for an agent's turn to end, so what it says reaches the person, before it stops it all the same. */
const TURN_ENDS = Duration.minutes(2)

/** How long one task's stopping may take in all. */
const WITHIN = Duration.minutes(4)

/** When the sweep first looks after Althar starts, and how often after. */
const FIRST = Duration.seconds(20)
const EVERY = Duration.minutes(5)

/** How long an agent on a settled task must have been idle before the sweep stops it: not one just asked something. */
const IDLE_FOR = Duration.minutes(1)

/** A process's whole tree, as `ownersOf` claims it, under this name: what Althar keeps track of, never stopped by its mark. */
const KEPT = 'kept'

/**
 * What to stop by its mark: every process whose mark `doomed` says, with all
 * it started, but nothing in Althar's own tree (`app`, which holds what it
 * keeps track of: its agents and its runs) and nothing it runs under
 * (`spared`).
 */
export const doomedOf = (
  listing: ReadonlyMap<number, Listed>,
  marks: ReadonlyMap<number, string>,
  doomed: (work: string) => boolean,
  app: number,
  spared: ReadonlySet<number> = new Set(),
): ReadonlyArray<number> =>
  [...ownersOf(listing, [{ pid: app, key: KEPT }], null, marks)].flatMap(([pid, work]) =>
    work !== KEPT && work !== ALTHAR && !spared.has(pid) && doomed(work) ? [pid] : [],
  )

/** A process and what it runs under, up to the first: what Althar must never stop. */
export const forebearsOf = (listing: ReadonlyMap<number, Listed>, pid: number): ReadonlySet<number> => {
  const forebears = new Set<number>()
  for (let at: number | undefined = pid; at !== undefined && !forebears.has(at); at = listing.get(at)?.parent) forebears.add(at)
  return forebears
}

type Store = SqlClient.SqlClient | Ledger | Crypto.Crypto | Sessions | Launches | RuntimeConfig

export class LeftBehind extends Context.Service<
  LeftBehind,
  {
    /**
     * The task settled, its settled fact written or about to be in the
     * caller's transaction: everything of it stops, in the background, once
     * that is written. Never fails, and never waits.
     */
    settled(taskId: string): Effect.Effect<void>
    /** Stops what settled tasks and removed projects left running that Althar lost track of, and agents left idle on settled tasks. */
    readonly sweep: Effect.Effect<void>
  }
>()('@althar/runtime/LeftBehind') {
  static readonly layer: Layer.Layer<LeftBehind, never, Store> = Layer.effect(
    LeftBehind,
    Effect.gen(function* () {
      const context = yield* Effect.context<Store>()
      const provide = <A, E>(effect: Effect.Effect<A, E, Store>) => Effect.provideContext(effect, context)
      const config = yield* RuntimeConfig
      const sessions = yield* Sessions
      const launches = yield* Launches
      const scope = yield* Scope.fork(yield* Effect.scope, 'sequential')
      const marks = marksOf()
      // Tasks being stopped now: one said settled twice is stopped once.
      const stopping = new Set<string>()

      /** The task's project and its own thread, where it is settled now; undefined where it isn't, as reopened since. */
      const settledNow = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [task] = yield* sql<{ projectId: ProjectId; threadId: string | null }>`
            SELECT k.project_id,
              (SELECT t.id FROM threads t WHERE t.task_id = k.id AND t.kind = 'task' ORDER BY t.created_at, t.rowid LIMIT 1) AS thread_id
            FROM tasks k WHERE k.id = ${taskId} AND k.state IN ('done', 'abandoned')`
          return task
        })

      /** Stops what carries work `doomed` says in its environment, outside Althar's own tree; what outlived it. */
      const stopMarked = <E>(doomed: (work: string) => Effect.Effect<boolean, E, SqlClient.SqlClient>) =>
        Effect.gen(function* () {
          const listing = yield* listProcesses()
          if (listing === null) return []
          const spared = forebearsOf(listing, process.pid)
          const inTree = ownersOf(listing, [{ pid: process.pid, key: KEPT }], null)
          // Only those no tree of Althar's reaches carry a mark worth reading.
          const read = yield* marks([...listing.keys()].filter((pid) => !inTree.has(pid) && !spared.has(pid)))
          const works = new Map<string, boolean>()
          for (const work of new Set(read.values())) works.set(work, yield* doomed(work))
          const pids = doomedOf(listing, read, (work) => works.get(work) === true, process.pid, spared)
          if (pids.length > 0) yield* Effect.logInfo('Stopping what settled work left running', { pids })
          return yield* stopProcesses(pids)
        })

      /** Waits for the agent on the thread to end its turn, up to `TURN_ENDS`. */
      const turnEnds = (threadId: string) =>
        Effect.gen(function* () {
          const until = Date.now() + Duration.toMillis(TURN_ENDS)
          for (;;) {
            const running = yield* sessions.running(threadId)
            if (Option.isNone(running) || !running.value.turnRunning || Date.now() >= until) return
            yield* Effect.sleep(Duration.millis(200))
          }
        })

      /** Whether something waits to be said to the agent on the thread: its next turn, which opens its task again. */
      const waitingOn = (threadId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const [row] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM user_inputs WHERE thread_id = ${threadId} AND state = 'queued'`
          return (row?.n ?? 0) > 0
        })

      /** Stops the agent on a thread of a settled task: what it left running first, through it, then the agent. What wouldn't stop. */
      const stopAgent = (taskId: string, threadId: string) =>
        Effect.gen(function* () {
          if (Option.isNone(yield* sessions.running(threadId))) return []
          yield* turnEnds(threadId)
          // Opened again while its turn ended, or written to already, as by the person: its agent stays.
          if ((yield* settledNow(taskId)) === undefined || (yield* waitingOn(threadId))) return []
          const running = yield* sessions.running(threadId)
          if (Option.isNone(running)) return []
          const stuck: Array<string> = []
          for (const left of running.value.background)
            if (left.ended === null)
              yield* sessions.stopBackground(threadId, left.id).pipe(
                Effect.timeout(Duration.seconds(10)),
                Effect.catchCause((cause) =>
                  Effect.andThen(
                    Effect.logWarning('Could not stop what a settled task left running', cause),
                    Effect.sync(() => void stuck.push(left.name || left.label || left.command)),
                  ),
                ),
              )
          // Stopping it stops its process group, with whatever of it is left.
          yield* sessions.stop(threadId).pipe(Effect.ignore)
          // Written to as it stopped: what was said starts it again, as it would have found no agent.
          if (yield* waitingOn(threadId)) yield* sessions.startLast(threadId).pipe(Effect.ignore)
          return stuck
        })

      const stopTask = (taskId: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const task = yield* settledNow(taskId)
          if (task === undefined) return
          const threads = yield* sql<{ id: string }>`SELECT id FROM threads WHERE task_id = ${taskId} ORDER BY created_at, rowid`
          const stuck = (yield* Effect.forEach(threads, (thread) => stopAgent(taskId, thread.id), { concurrency: 'unbounded' })).flat()
          yield* launches.stopAll(task.projectId, taskId)
          // Whatever still carries the task, as a server that left its agent's group: not if it opened again meanwhile.
          const work = `task:${taskId}`
          const outlived = (yield* settledNow(taskId)) === undefined ? [] : yield* stopMarked((one) => Effect.succeed(one === work))
          if (stuck.length === 0 && outlived.length === 0) return
          yield* Effect.logWarning('A settled task left something running that wouldn’t stop', { taskId, stuck, outlived })
          if (task.threadId === null) return
          const what = [...stuck, ...(outlived.length === 0 ? [] : [outlived.length === 1 ? 'a process' : `${outlived.length} processes`])]
          yield* addItem({ projectId: task.projectId, threadId: task.threadId }, 'notice', {
            source: 'runtime',
            severity: 'info',
            title: `Couldn’t stop everything it left running: ${what.join(', ')}.`,
            description: null,
          })
        })

      const settle = (taskId: string) =>
        Effect.suspend(() => {
          if (stopping.has(taskId)) return Effect.void
          stopping.add(taskId)
          return stopTask(taskId).pipe(
            Effect.timeout(WITHIN),
            contained('LeftBehind.stop', () => undefined),
            Effect.ensuring(Effect.sync(() => stopping.delete(taskId))),
          )
        })

      /*
       * Said settled, often inside the transaction that settles it: the task is
       * handed to a fiber of this layer's, which reads it once that is written,
       * and stops it in a fiber of its own, so none waits on another.
       */
      const asked = yield* Queue.unbounded<string>()
      yield* Effect.forkIn(
        provide(Effect.forever(Effect.flatMap(Queue.take(asked), (taskId) => Effect.forkIn(provide(settle(taskId)), scope)))),
        scope,
      )

      /** Whether a mark is of work settled or removed in this store: one it doesn't know is someone else's. */
      const over = (work: string) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          const named = workIn(work)
          if (named === null) return false
          if (named.kind === 'task') {
            const [task] = yield* sql<{ over: number }>`
              SELECT k.state IN ('done', 'abandoned') OR p.archived_at IS NOT NULL AS over
              FROM tasks k JOIN projects p ON p.id = k.project_id WHERE k.id = ${named.taskId}`
            return task?.over === 1
          }
          const [project] = yield* sql<{ over: number }>`SELECT archived_at IS NOT NULL AS over FROM projects WHERE id = ${named.projectId}`
          return project?.over === 1
        })

      const sweep = Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        // An agent left idle on a settled task, by a settling it outlived or an Althar from before this one.
        const idleBefore = Date.now() - Duration.toMillis(IDLE_FOR)
        for (const session of yield* sessions.onTasks) {
          if (session.turnRunning) continue
          const [task] = yield* sql<{ id: string }>`SELECT id FROM tasks WHERE id = ${session.taskId} AND state IN ('done', 'abandoned')`
          const running = yield* sessions.running(session.threadId)
          const ended = Option.isSome(running) ? running.value.turnEndedAt : null
          if (task === undefined || ended === null || ended > idleBefore || (yield* waitingOn(session.threadId))) continue
          yield* settle(session.taskId)
        }
        const outlived = yield* stopMarked(over)
        if (outlived.length > 0) yield* Effect.logWarning('What settled work left running wouldn’t stop', { outlived })
      })

      // A while after Althar starts, then every few minutes: what ran before it, and what settling missed.
      yield* Effect.forkIn(
        provide(
          Effect.sleep(config.leftFirst ?? FIRST).pipe(
            Effect.andThen(
              Effect.forever(
                sweep.pipe(
                  contained('LeftBehind.sweep', () => undefined),
                  Effect.andThen(Effect.sleep(config.leftEvery ?? EVERY)),
                ),
              ),
            ),
          ),
        ),
        scope,
      )

      return LeftBehind.of({
        settled: (taskId) => Queue.offer(asked, taskId).pipe(Effect.asVoid),
        sweep: provide(sweep.pipe(contained('LeftBehind.sweep', () => undefined))),
      })
    }),
  )
}
