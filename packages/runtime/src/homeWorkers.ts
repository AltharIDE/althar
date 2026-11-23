import type { HomeWorker, HomeWorkers } from '@althar/contracts'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import type { WorkerExecutionPlatform } from './workerExecution'

/*
 * The home's workers as Settings › Computers and the load popover list them
 * (ADR-103): each worker the home enrolled, from its ledger, whether it is
 * connected now and what it reported, the projects it may work on by name,
 * and the task it runs: the task whose workspace its run holds, a follow-up
 * to a settled task included and through a dropped connection; while it is
 * still being readied, before it holds one, the running task whose accepted
 * plan placed it there. A home that isn't listening for workers says so,
 * with none.
 */

export const homeWorkers = (platform: WorkerExecutionPlatform | undefined) =>
  Effect.gen(function* () {
    const enrolled = platform?.enrolled?.() ?? null
    // A home that is its own authority adds workers itself, listening or not yet.
    const adds = platform?.admin === undefined || platform.adds?.() === false ? {} : { adds: true }
    if (enrolled === null) return { enabled: false, workers: [], ...adds } satisfies HomeWorkers
    if (enrolled.length === 0) return { enabled: true, workers: [], ...adds } satisfies HomeWorkers
    const sql = yield* SqlClient.SqlClient
    const ids = [...new Set(enrolled.flatMap((worker) => worker.projectIds))]
    const names = ids.length === 0 ? [] : yield* sql<{ id: string; name: string }>`SELECT id, name FROM projects WHERE id IN ${sql.in(ids)}`
    const nameOf = new Map(names.map(({ id, name }) => [id, name]))
    type Task = { taskId: string; threadId: string; title: string; project: string }
    // The task each worker's run holds a workspace of, by that workspace.
    const held = enrolled.flatMap((worker) => (worker.workspaceId === undefined ? [] : [worker.workspaceId]))
    const holding =
      held.length === 0
        ? []
        : yield* sql<Task & { workspaceId: string }>`
          SELECT w.id AS workspace_id, t.id AS task_id, th.id AS thread_id, t.title, p.name AS project
          FROM workspaces w JOIN tasks t ON t.id = w.task_id JOIN projects p ON p.id = t.project_id
          JOIN threads th ON th.task_id = t.id AND th.kind = 'task'
          WHERE w.id IN ${sql.in(held)}`
    const byWorkspace = new Map(holding.map(({ workspaceId, ...task }) => [workspaceId, task]))
    // A worker still being readied holds no workspace yet: which of the home's running tasks were placed on which worker.
    const running = enrolled.some((worker) => worker.busy && worker.workspaceId === undefined)
      ? yield* sql<Task & { workerId: string | null }>`
          SELECT t.id AS task_id, th.id AS thread_id, t.title, p.name AS project, (
            SELECT json_extract(tp.parameters, '$.workerId') FROM task_plans tp
            WHERE tp.task_id = t.id AND tp.state = 'accepted' ORDER BY tp.decided_at DESC, tp.rowid DESC LIMIT 1
          ) AS worker_id
          FROM tasks t JOIN projects p ON p.id = t.project_id JOIN threads th ON th.task_id = t.id AND th.kind = 'task'
          WHERE EXISTS (SELECT 1 FROM runs r WHERE r.task_id = t.id AND r.state = 'running')`
      : []
    const placed = new Map(running.flatMap(({ workerId, ...task }) => (workerId === null ? [] : [[workerId, task] as const])))
    const taskOf = (worker: (typeof enrolled)[number]): Task | null =>
      (worker.workspaceId === undefined ? undefined : byWorkspace.get(worker.workspaceId)) ?? placed.get(worker.workerId) ?? null
    const workers = enrolled.map((worker): HomeWorker => ({
      workerId: worker.workerId,
      ...(worker.name === undefined ? {} : { name: worker.name }),
      ...(worker.ssh === undefined ? {} : { ssh: worker.ssh }),
      ...(worker.signedIn === undefined ? {} : { signedIn: worker.signedIn }),
      ...(worker.release === undefined ? {} : { release: worker.release }),
      ...(worker.anyProject === undefined ? {} : { anyProject: worker.anyProject }),
      connected: worker.connected,
      busy: worker.busy,
      ...(worker.capacity === undefined ? {} : { capacity: worker.capacity }),
      providers: worker.providers,
      projects: worker.projectIds.flatMap((id) => {
        const name = nameOf.get(id)
        return name === undefined ? [] : [{ id, name }]
      }),
      task: worker.busy ? taskOf(worker) : null,
    }))
    return { enabled: true, workers, ...adds } satisfies HomeWorkers
  })
