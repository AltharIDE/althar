import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { placeOf, viaHost } from './coordinatorPullRequests'
import { ToolRefused } from './toolErrors'

/** Resolve a task's PR. Once a merge step bound it, later steps keep that same PR even if the task goes on. */
export const errandTaskPull = (projectId: string, reference: string, errand?: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [task] = yield* sql<{ id: string }>`SELECT id FROM tasks WHERE project_id = ${projectId}
      AND (id = ${reference} OR slug = ${reference})`
    if (task === undefined) return yield* new ToolRefused({ message: `This project has no task ${reference}. list_tasks shows them.` })
    const bound =
      errand === undefined
        ? []
        : yield* sql<{ url: string }>`
      SELECT s.target AS url FROM errand_steps s JOIN errands e ON e.id = s.errand_id
      WHERE e.project_id = ${projectId} AND e.id = ${errand} AND s.task_id = ${task.id}
        AND s.tool = 'merge_pull_request' AND s.target NOT LIKE 'task:%' ORDER BY s.position`
    const links =
      bound.length > 0
        ? bound
        : yield* sql<{ url: string }>`SELECT url FROM external_links
      WHERE project_id = ${projectId} AND task_id = ${task.id} AND kind = 'change'
      AND listening = 1 ORDER BY created_at DESC, rowid DESC`
    if (links.length === 0) return null
    if (links.length !== 1)
      return yield* new ToolRefused({ message: `${reference} has several pull requests. Keep a step for each PR by its link.` })
    const place = yield* placeOf(projectId, links[0]!.url)
    const change = yield* viaHost(place.host.change(place.repository, place.number, { queue: true }))
    return { ...place, change }
  }).pipe(
    Effect.mapError((error) =>
      error instanceof ToolRefused
        ? error
        : new ToolRefused({
            message: `Could not read the task’s pull request: ${error instanceof Error ? error.message : 'unknown read failure'}`,
          }),
    ),
  )
