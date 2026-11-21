import { Ids, newId } from '@althar/domain'
import { Clock, Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { timestamp } from './records'

/** Retry news hourly while a step is still waiting to be taken. */
export const recordErrandWake = (projectId: string, errandId: string, stepKey: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const subjectId = `${errandId}/${stepKey}`
    const bucket = String(Math.floor((yield* Clock.currentTimeMillis) / Duration.toMillis(Duration.hours(1))))
    const [heard] = yield* sql`SELECT 1 FROM observations WHERE subject_type = 'errand_wake'
      AND subject_id = ${subjectId} AND kind = ${bucket} LIMIT 1`
    if (heard !== undefined) return false
    yield* sql`INSERT INTO observations ${sql.insert({
      id: yield* newId(Ids.observation),
      projectId,
      subjectType: 'errand_wake',
      subjectId,
      kind: bucket,
      payload: '{}',
      source: 'althar',
      observedAt: yield* timestamp,
    })}`
    return true
  })
