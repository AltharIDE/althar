import type { HomeWorker, HomeWorkers } from '@althar/contracts'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import type { WorkerExecutionPlatform } from './workerExecution'

/*
 * The home's workers as Settings › Computers and the load popover list them
 * (ADR-103): each worker the home enrolled, from its ledger, whether it is
 * connected now and what it reported, the projects it may work on by name,
 * and the task it runs, which is the running task whose accepted plan placed
 * it there. A home that isn't listening for workers says so, with none.
 */

export const homeWorkers = (platform: WorkerExecutionPlatform | undefined) =>
  Effect.gen(function* () {
    const enrolled = platform?.enrolled?.() ?? null
    if (enrolled === null) return { enabled: false, workers: [] } satisfies HomeWorkers
    if (enrolled.length === 0) return { enabled: true, workers: [] } satisfies HomeWorkers
    const sql = yield* SqlClient.SqlClient
    const ids = [...new Set(enrolled.flatMap((worker) => worker.projectIds))]
    const names = ids.length === 0 ? [] : yield* sql<{ id: string; name: string }>`SELECT id, name FROM projects WHERE id IN ${sql.in(ids)}`
    const nameOf = new Map(names.map(({ id, name }) => [id, name]))
    // Only while one runs something: which of the home's running tasks were placed on which worker.
    const running = enrolled.some((worker) => worker.busy)
      ? yield* sql<{ taskId: string; threadId: string; title: string; project: string; workerId: string | null }>`
          SELECT t.id AS task_id, th.id AS thread_id, t.title, p.name AS project, (
            SELECT json_extract(tp.parameters, '$.workerId') FROM task_plans tp
            WHERE tp.task_id = t.id AND tp.state = 'accepted' ORDER BY tp.decided_at DESC, tp.rowid DESC LIMIT 1
          ) AS worker_id
          FROM tasks t JOIN projects p ON p.id = t.project_id JOIN threads th ON th.task_id = t.id AND th.kind = 'task'
          WHERE EXISTS (SELECT 1 FROM runs r WHERE r.task_id = t.id AND r.state = 'running')`
      : []
    const taskOf = new Map(running.flatMap(({ workerId, ...task }) => (workerId === null ? [] : [[workerId, task] as const])))
    const workers = enrolled.map((worker): HomeWorker => ({
      workerId: worker.workerId,
      connected: worker.connected,
      busy: worker.busy,
      ...(worker.capacity === undefined ? {} : { capacity: worker.capacity }),
      providers: worker.providers,
      projects: worker.projectIds.flatMap((id) => {
        const name = nameOf.get(id)
        return name === undefined ? [] : [{ id, name }]
      }),
      task: worker.busy ? (taskOf.get(worker.workerId) ?? null) : null,
    }))
    return { enabled: true, workers } satisfies HomeWorkers
  })
