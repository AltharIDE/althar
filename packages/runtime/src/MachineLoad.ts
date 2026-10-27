import type { Load, LoadOwn, LoadPoint, LoadShare } from '@althar/contracts'
import { Clock, Context, Duration, Effect, Layer, Semaphore } from 'effect'
import { SqlClient } from 'effect/sql'

import { Agents, RuntimeConfig } from './Config'
import { Instance } from './Instance'
import { Launches } from './Launches'
import { ALTHAR, type Listed, marksOf, ownersOf, type Reading, readMachine, sameProcess, usedOf, workIn, workOf } from './machine'

/*
 * How hard this computer works, and Althar's part of it, for the window's
 * bar (`GetLoad`). Read only while a window asks, and at most once every
 * `every` however many ask: each asking within it hears the reading before.
 * What used how much is worked out between that reading and the one before
 * it, so the first, or one after a gap, waits a moment for a second.
 *
 * Althar's part is its work and itself. Its work is each agent process this
 * launch started, as the store records it, and each run of the project still
 * running (`Launches.ts`), with everything they started: a task's lead, its
 * steps' agents and its runs are the task's; a coordinator's is its
 * project's. Each is started with its work in its environment (`workOf`),
 * which everything it starts inherits, so a process that has left the tree,
 * such as a server an agent started in the background, or one an earlier
 * launch's agent left running, is its work's still, as long as the store
 * knows that work. Each process's environment is read once, for one no tree
 * reaches. Althar itself is the app, its windows and the runtime: the app's
 * process (`app`) and what it started that is no work's. The last two
 * minutes of readings are kept in memory, and a gap starts them afresh.
 */

export interface LoadOptions {
  /** How this computer is read: as it is, unless a test says. */
  readonly read?: Effect.Effect<Reading>
  /** Whose work each of some processes carries in its environment, by pid: as this computer says, unless a test says; none where it reads a computer of its own. */
  readonly marks?: (pids: ReadonlyArray<number>) => Effect.Effect<ReadonlyMap<number, string>>
  /** The app's own process, which Althar itself is with what it started: the runtime's, unless the app says. */
  readonly app?: number
  /** The least time between two readings: 2.5 seconds. */
  readonly every?: Duration.Duration
  /** How long a first reading waits for the second, to measure between them: half a second. */
  readonly settle?: Duration.Duration
}

/** How many readings the history keeps: two minutes of a window asking every three seconds. */
export const HISTORY = 40
/** A reading older than this many of `every` is too old to measure from: the readings start afresh. */
const GAP = 4

const clamp = (n: number) => Math.min(1, Math.max(0, n))

/** A piece of work as the store knows it: what it is part of, and who leads it. */
interface Work {
  readonly kind: LoadShare['kind']
  readonly projectId: string
  readonly project: string
  readonly taskId: string | null
  /** The task's own thread, which opens it. */
  readonly threadId: string | null
  readonly title: string | null
  /** The agent it runs, and whether it leads the task (its thread is the task's, not a step's); none for a run. */
  readonly agent: LoadShare['agent']
  readonly leads: boolean
}

/** A piece of work as this launch started it: the process it was started as. */
interface Root extends Work {
  readonly pid: number
}

export class MachineLoad extends Context.Service<
  MachineLoad,
  {
    /** How hard this computer works now: read afresh, or the reading of a moment ago. */
    readonly now: Effect.Effect<Load, unknown>
  }
>()('@althar/runtime/MachineLoad') {
  static readonly layer: Layer.Layer<MachineLoad, never, SqlClient.SqlClient | Instance | Launches | Agents | RuntimeConfig> = Layer.effect(
    MachineLoad,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const instance = yield* Instance
      const launches = yield* Launches
      const agents = yield* Agents
      const options = (yield* RuntimeConfig).load ?? {}
      const read = options.read ?? readMachine()
      // A computer a test stands in for has no environments to read but those it says.
      const marksIn = options.marks ?? (options.read === undefined ? marksOf() : () => Effect.succeed(new Map<number, string>()))
      const app = options.app ?? process.pid
      const every = Duration.toMillis(options.every ?? Duration.millis(2_500))
      const settle = options.settle ?? Duration.millis(500)
      const one = Semaphore.makeUnsafe(1)

      /* The last reading, and when by the clock: how old it is decides whether to measure from it. */
      let last: { readonly at: number; readonly reading: Reading } | null = null
      let answer: { readonly at: number; readonly load: Load } | null = null
      let history: ReadonlyArray<LoadPoint> = []
      /* Whose work each process no tree reached carries in its environment, as read once: by pid, with the process it was. */
      const marked = new Map<number, { readonly process: Listed; readonly work: string | null }>()

      const agentOf = (agentId: string) =>
        agents.get(agentId).pipe(
          Effect.map((entry) => ({ id: agentId, name: entry.definition.name })),
          Effect.orElseSucceed(() => ({ id: agentId, name: agentId })),
        )

      /** Every agent this launch started that still runs, and every run of a project still running. */
      const roots = Effect.gen(function* () {
        const sessions = yield* sql<{
          pid: number
          projectId: string
          project: string
          kind: string
          taskId: string | null
          threadId: string | null
          title: string | null
          agentId: string
        }>`
          SELECT p.pid, p.project_id, j.name AS project, t.kind, t.task_id, h.id AS thread_id, k.title, s.agent_id
          FROM processes p
          JOIN provider_sessions s ON s.id = p.provider_session_id
          JOIN threads t ON t.id = s.thread_id
          JOIN projects j ON j.id = p.project_id
          LEFT JOIN tasks k ON k.id = t.task_id
          LEFT JOIN threads h ON h.task_id = t.task_id AND h.kind = 'task'
          WHERE p.runtime_instance_id = ${instance.id} AND p.purpose = 'agent' AND p.state = 'running' AND p.pid IS NOT NULL
          ORDER BY p.launched_at, p.rowid`
        const runs = yield* Effect.forEach(yield* launches.processes(), (run) =>
          Effect.gen(function* () {
            const [project] = yield* sql<{ name: string }>`SELECT name FROM projects WHERE id = ${run.projectId}`
            const [task] =
              run.taskId === null
                ? []
                : yield* sql<{ title: string; threadId: string | null }>`
                  SELECT k.title, h.id AS thread_id FROM tasks k LEFT JOIN threads h ON h.task_id = k.id AND h.kind = 'task'
                  WHERE k.id = ${run.taskId}`
            return {
              pid: run.pid,
              kind: 'run' as const,
              projectId: run.projectId,
              project: project?.name ?? '',
              taskId: run.taskId,
              threadId: task?.threadId ?? null,
              title: task?.title ?? null,
              agent: null,
              leads: false,
            }
          }),
        )
        const agented = yield* Effect.forEach(sessions, (row) =>
          Effect.map(agentOf(row.agentId), (agent): Root => ({
            pid: row.pid,
            kind: row.kind === 'coordinator' ? 'coordinator' : 'task',
            projectId: row.projectId,
            project: row.project,
            taskId: row.taskId,
            threadId: row.threadId,
            title: row.title,
            agent,
            leads: row.kind === 'task',
          })),
        )
        return [...agented, ...runs]
      })

      /** A piece of work as a process's environment names it, as the store knows it now; null for one it doesn't, such as another Althar's. */
      const workNamed = (key: string) =>
        Effect.gen(function* () {
          const named = workIn(key)
          if (named === null) return null
          const latestAgent = (threadId: string | null) =>
            Effect.gen(function* () {
              if (threadId === null) return null
              const [session] = yield* sql<{ agentId: string }>`
                SELECT agent_id FROM provider_sessions WHERE thread_id = ${threadId} ORDER BY rowid DESC LIMIT 1`
              return session === undefined ? null : yield* agentOf(session.agentId)
            })
          if (named.kind === 'task') {
            const [task] = yield* sql<{ projectId: string; project: string; threadId: string | null; title: string }>`
              SELECT k.project_id, j.name AS project, h.id AS thread_id, k.title
              FROM tasks k JOIN projects j ON j.id = k.project_id LEFT JOIN threads h ON h.task_id = k.id AND h.kind = 'task'
              WHERE k.id = ${named.taskId}`
            if (task === undefined) return null
            return {
              kind: 'task',
              projectId: task.projectId,
              project: task.project,
              taskId: named.taskId,
              threadId: task.threadId,
              title: task.title,
              agent: yield* latestAgent(task.threadId),
              leads: true,
            } satisfies Work
          }
          const [project] = yield* sql<{ name: string; coordinator: string | null }>`
            SELECT name, (SELECT id FROM threads WHERE project_id = j.id AND kind = 'coordinator' ORDER BY rowid LIMIT 1) AS coordinator
            FROM projects j WHERE id = ${named.projectId}`
          if (project === undefined) return null
          return {
            kind: named.kind,
            projectId: named.projectId,
            project: project.name,
            taskId: null,
            threadId: null,
            title: null,
            agent: named.kind === 'coordinator' ? yield* latestAgent(project.coordinator) : null,
            leads: false,
          } satisfies Work
        })

      /**
       * Whose work each process is (`ownersOf`), with the work each names that
       * no root of this launch is: the environment read of each process no
       * tree reaches and that wasn't read before, once.
       */
      const ownership = (listing: ReadonlyMap<number, Listed>, all: ReadonlyArray<Root>) =>
        Effect.gen(function* () {
          const started = all.map((root) => ({ pid: root.pid, key: workOf(root) }))
          const reached = ownersOf(listing, started, app)
          for (const [pid, was] of marked) if (!sameProcess(was.process, listing.get(pid))) marked.delete(pid)
          const unread = [...listing.keys()].filter((pid) => !reached.has(pid) && !marked.has(pid))
          const read = yield* marksIn(unread)
          for (const pid of unread) {
            const process = listing.get(pid)
            if (process !== undefined) marked.set(pid, { process, work: read.get(pid) ?? null })
          }
          const keys = new Set(started.map((root) => root.key))
          const named = new Map<string, Work | null>()
          const marks = new Map<number, string>()
          for (const [pid, { work }] of marked) {
            if (work === null || reached.has(pid)) continue
            if (!keys.has(work) && !named.has(work)) named.set(work, yield* workNamed(work))
            if (keys.has(work) || named.get(work) != null) marks.set(pid, work)
          }
          return { owners: ownersOf(listing, started, app, marks), named }
        })

      /** Each piece of work's part, most CPU first, and Althar's own: its processes' CPU time over all the cores' time between the readings. */
      const sharesOf = (all: ReadonlyArray<Root>, before: Reading, after: Reading) =>
        Effect.gen(function* () {
          if (after.processes === null) return { shares: null, althar: null }
          const { owners, named } = yield* ownership(after.processes, all)
          // Without a listing before, there is nothing to measure from: what each holds shows, and no CPU yet.
          const used = usedOf(owners, before.processes ?? after.processes, after.processes, after.reaped === true)
          const capacity = Math.max(1, (after.at - before.at) * after.cores.count)
          const shares = new Map<string, LoadShare>()
          const share = (key: string, work: Work) => {
            const its = used.get(key)
            if (its === undefined) return
            const was = shares.get(key)?.agent ?? null
            // A task's lead names its agent, before a step's; a run has none.
            const agent = work.agent === null || (was !== null && !work.leads) ? was : work.agent
            shares.set(key, {
              kind: work.taskId === null ? work.kind : 'task',
              projectId: work.projectId,
              project: work.project,
              taskId: work.taskId,
              threadId: work.threadId,
              title: work.title,
              agent,
              cpu: clamp(its.cpu / capacity),
              memory: its.memory,
              processes: its.processes,
            })
          }
          for (const root of all) share(workOf(root), root)
          for (const [key, work] of named) if (work !== null && !shares.has(key)) share(key, work)
          const own = used.get(ALTHAR)
          const althar: LoadOwn | null =
            own === undefined ? null : { cpu: clamp(own.cpu / capacity), memory: own.memory, processes: own.processes }
          return { shares: [...shares.values()].sort((a, b) => b.cpu - a.cpu || b.memory - a.memory), althar }
        })

      const measure = Effect.gen(function* () {
        const at = yield* Clock.currentTimeMillis
        if (answer !== null && at - answer.at < every) return answer.load
        let before = last !== null && at - last.at <= every * GAP ? last : null
        let now = at
        let reading = yield* read
        // A first reading, one after a gap, or one whose times count differently from the one before, as once the Mac's
        // reader is built: a moment's start to measure from, and the readings begin afresh.
        if (before === null || before.reading.reaped !== reading.reaped) {
          before = { at: now, reading }
          history = []
          yield* Effect.sleep(settle)
          now = yield* Clock.currentTimeMillis
          reading = yield* read
        }
        const ticks = reading.cores.total - before.reading.cores.total
        const cpu = ticks > 0 ? clamp((reading.cores.busy - before.reading.cores.busy) / ticks) : 0
        // Still counted differently, the reader built in between: what each holds shows, and its CPU from the next reading.
        const from = before.reading.reaped === reading.reaped ? before.reading : reading
        const { shares, althar } = yield* sharesOf(yield* roots, from, reading)
        const work = Math.min(cpu, clamp((shares ?? []).reduce((sum, share) => sum + share.cpu, althar?.cpu ?? 0)))
        history = [...history, { cpu, work }].slice(-HISTORY)
        const load: Load = {
          cpu,
          memoryUsed: reading.memory.used,
          memoryTotal: reading.memory.total,
          pressure: reading.pressure,
          shares,
          althar,
          history,
        }
        last = { at: now, reading }
        answer = { at: now, load }
        return load
      })

      return MachineLoad.of({ now: one.withPermits(1)(measure) })
    }),
  )
}
