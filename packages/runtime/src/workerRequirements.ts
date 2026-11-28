import type { WorkerPlanRequirements } from '@althar/contracts'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/** Whether a plan runs only on this home: as it says, else as its `here` does (runRecords.ts, `PlanParameters.homeOnly`). */
export const homeOnlyOf = (parameters: { readonly here?: boolean | undefined; readonly homeOnly?: boolean | undefined }) =>
  parameters.homeOnly ?? parameters.here === true

export const workerRequirementsOf = (taskId: string, flags: Pick<WorkerPlanRequirements, 'homeOnly' | 'readOnly'>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ repositoryCount: number }>`
      SELECT count(*) AS repository_count FROM task_repository_requirements WHERE task_id = ${taskId}`
    return { ...flags, repositoryCount: row?.repositoryCount ?? 0 }
  })

export const workerRequirementFields = (taskId: string, homeOnly: boolean, readOnly: boolean) =>
  Effect.map(workerRequirementsOf(taskId, { homeOnly, readOnly }), (workerRequirements) => ({ workerRequirements }))
