import { Ids, newId } from '@althar/domain'
import { Clock, Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { repositoryOf, viaHost } from './coordinatorPullRequests'
import { errandTaskPull } from './errandTask'
import type { Errands } from './Errands'
import { checksReady } from './externalWaits'
import { timestamp } from './records'

/** Release steps share the merge line's durable sweep and wake the owning thread, without keeping an agent alive. */
export const watchReleaseErrands = (projectId: string, errands: typeof Errands.Service, wake: (threadId: string, said: string) => void) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const steps = yield* sql<{
      errandId: string
      stepKey: string
      threadId: string
      target: string
      tool: string
      request: string
      waits: string
    }>`SELECT s.errand_id, s.step_key, e.thread_id, s.target, s.tool, s.request, s.waits
      FROM errand_steps s JOIN errands e ON e.id = s.errand_id
      WHERE e.project_id = ${projectId} AND e.state = 'open' AND s.state = 'waiting'
        AND s.tool IN ('push_tag', 'approve_release_run', 'publish_release')
        AND NOT EXISTS (SELECT 1 FROM errand_steps earlier WHERE earlier.errand_id = e.id
          AND earlier.position < s.position AND earlier.state <> 'done')`
    for (const step of steps)
      yield* Effect.gen(function* () {
        const request = JSON.parse(step.request) as Record<string, unknown>
        const waits = JSON.parse(step.waits) as Array<{ kind: string; target: string }>
        const where = step.target.split(/ tag | release /)[0]!
        const { host, repository } = yield* repositoryOf(projectId, where)
        for (const wait of waits) {
          switch (wait.kind) {
            case 'task_merged': {
              const pull = yield* errandTaskPull(projectId, wait.target, step.errandId)
              if (pull === null || pull.change.state !== 'merged') return
              break
            }
            case 'checks':
            case 'required-check-missing':
            case 'post-merge':
              if (!checksReady(yield* viaHost(host.checks(repository, wait.target)), 'checks_passed')) return
              break
            case 'run':
              if (!(yield* viaHost(host.runs(repository, wait.target))).some((run) => run.gates.length > 0)) return
              break
            case 'draft':
              if ((yield* viaHost(host.release(repository, wait.target)))?.state !== 'draft') return
              break
            default:
              return
          }
        }
        // Retry news hourly if the coordinator could not take it. Once taken, the next sweep reads the next step.
        const bucket = Math.floor((yield* Clock.currentTimeMillis) / Duration.toMillis(Duration.hours(1)))
        const [heard] = yield* sql<{ n: number }>`SELECT count(*) AS n FROM observations WHERE subject_type = 'errand_wake'
        AND subject_id = ${`${step.errandId}/${step.stepKey}`} AND kind = ${String(bucket)}`
        if ((heard?.n ?? 0) > 0) return
        // A separate observation is not a mutation receipt: only execute can confirm the action.
        yield* sql`INSERT INTO observations ${sql.insert({
          id: yield* newId(Ids.observation),
          projectId,
          subjectType: 'errand_wake',
          subjectId: `${step.errandId}/${step.stepKey}`,
          kind: String(bucket),
          payload: '{}',
          source: 'althar',
          observedAt: yield* timestamp,
        })}`
        yield* errands.news(step.errandId)
        wake(
          step.threadId,
          `- Errand ${step.errandId}, step ${step.stepKey}: its waits are met. Take it now: ${step.tool} with ${JSON.stringify({ ...request, repository: where, errand: step.errandId, step: step.stepKey })}.`,
        )
      }).pipe(Effect.catchCause((cause) => Effect.logWarning('Could not read a release errand’s waits', cause)))
  })
