import type { Load, LoadPoint, LoadShare } from '@althar/contracts'
import { Clock, Context, Duration, Effect, Layer, Semaphore } from 'effect'
import { SqlClient } from 'effect/sql'

import { Agents, RuntimeConfig } from './Config'
import { Instance } from './Instance'
import { Launches } from './Launches'
import { type Reading, readMachine, usedBy } from './machine'

/*
 * How hard this computer works, and Althar's work's part of it, for the
 * window's bar (`GetLoad`). Read only while a window asks, and at most once
 * every `every` however many ask: each asking within it hears the reading
 * before. What used how much is worked out between that reading and the one
 * before it, so the first, or one after a gap, waits a moment for a second.
 * Althar's work is each agent process this launch started, as the store
 * records it, and each run of the project still running (`Launches.ts`),
 * with everything they started: a task's lead, its steps' agents and its
 * runs are the task's; a coordinator's is its project's. The last two
 * minutes of readings are kept in memory, and a gap starts them afresh.
 */

export interface LoadOptions {
  /** How this computer is read: as it is, unless a test says. */
  readonly read?: Effect.Effect<Reading>
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

/** A piece of work as the store and the runs know it: the process it was started as, and what it is part of. */
interface Root {
  readonly pid: number
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

const keyOf = (root: Root) => (root.taskId === null ? `${root.kind} ${root.projectId}` : `task ${root.taskId}`)

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
      const every = Duration.toMillis(options.every ?? Duration.millis(2_500))
      const settle = options.settle ?? Duration.millis(500)
      const one = Semaphore.makeUnsafe(1)

      /* The last reading, and when by the clock: how old it is decides whether to measure from it. */
      let last: { readonly at: number; readonly reading: Reading } | null = null
      let answer: { readonly at: number; readonly load: Load } | null = null
      let history: ReadonlyArray<LoadPoint> = []

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

      /** Each piece of work's part, most CPU first: its processes' CPU time over all the cores' time between the readings. */
      const sharesOf = (all: ReadonlyArray<Root>, before: Reading, after: Reading): ReadonlyArray<LoadShare> | null => {
        if (after.processes === null) return null
        // Without a listing before, there is nothing to measure from: what each holds shows, and no CPU yet.
        const used = usedBy(
          all.map((root) => ({ pid: root.pid, key: keyOf(root) })),
          before.processes ?? after.processes,
          after.processes,
        )
        const capacity = Math.max(1, (after.at - before.at) * after.cores.count)
        const shares = new Map<string, LoadShare>()
        for (const root of all) {
          const key = keyOf(root)
          const its = used.get(key)
          if (its === undefined) continue
          const was = shares.get(key)?.agent ?? null
          // A task's lead names its agent, before a step's; a run has none.
          const agent = root.agent === null || (was !== null && !root.leads) ? was : root.agent
          shares.set(key, {
            kind: root.taskId === null ? root.kind : 'task',
            projectId: root.projectId,
            project: root.project,
            taskId: root.taskId,
            threadId: root.threadId,
            title: root.title,
            agent,
            cpu: clamp(its.cpu / capacity),
            memory: its.memory,
            processes: its.processes,
          })
        }
        return [...shares.values()].sort((a, b) => b.cpu - a.cpu || b.memory - a.memory)
      }

      const measure = Effect.gen(function* () {
        const at = yield* Clock.currentTimeMillis
        if (answer !== null && at - answer.at < every) return answer.load
        let before = last
        if (before === null || at - before.at > every * GAP) {
          // A first reading, or one after a gap: a moment's start to measure from, and the readings begin afresh.
          before = { at, reading: yield* read }
          history = []
          yield* Effect.sleep(settle)
        }
        const now = yield* Clock.currentTimeMillis
        const reading = yield* read
        const ticks = reading.cores.total - before.reading.cores.total
        const cpu = ticks > 0 ? clamp((reading.cores.busy - before.reading.cores.busy) / ticks) : 0
        const shares = sharesOf(yield* roots, before.reading, reading)
        const work = Math.min(cpu, clamp((shares ?? []).reduce((sum, share) => sum + share.cpu, 0)))
        history = [...history, { cpu, work }].slice(-HISTORY)
        const load: Load = {
          cpu,
          memoryUsed: reading.memory.used,
          memoryTotal: reading.memory.total,
          pressure: reading.pressure,
          shares,
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
