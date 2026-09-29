import type { ActorId, ProjectId, RuntimeInstanceId } from '@charrette/domain'
import { osStartTime, stopProcessGroup } from '@charrette/provider-adapters'
import { Duration, Effect } from 'effect'
import { SqlClient } from 'effect/sql'

import { change, fact, timestamp } from './records'

/*
 * What an earlier launch of the runtime left unfinished, settled before
 * anything new starts (docs/architecture/02, Runtime crash). Nothing is
 * resumed or repeated: a session is marked lost, a turn whose end was never
 * seen is marked uncertain, and a request no one answered is cancelled.
 *
 * A process is stopped only when it is provably the one that was started: its
 * pid is alive and the OS gives the start time recorded when it was launched.
 * A pid alone may have been reused.
 */

interface StaleProcess {
  readonly id: string
  readonly pid: number | null
  readonly osStartedAt: string | null
}

export interface Reconciled {
  readonly processesStopped: number
  readonly processesUnknown: number
  readonly sessionsLost: number
  readonly turnsUncertain: number
  readonly turnsFailed: number
  readonly requestsCancelled: number
}

export const reconcile = Effect.fn('reconcile')(function* (instance: { readonly id: RuntimeInstanceId; readonly systemId: ActorId }) {
  const sql = yield* SqlClient.SqlClient
  const actorId = instance.systemId

  const processes = yield* sql<StaleProcess>`
    SELECT id, pid, os_started_at FROM processes
    WHERE state IN ('launching', 'running') AND runtime_instance_id <> ${instance.id}`
  let processesStopped = 0
  for (const stale of processes) {
    const ours = stale.pid !== null && stale.osStartedAt !== null && (yield* osStartTime(stale.pid)) === stale.osStartedAt
    const stop = ours && stale.pid !== null ? yield* stopProcessGroup(stale.pid, Duration.seconds(2)) : undefined
    if (ours) processesStopped += 1
    yield* change('processes', stale.id, {
      state: ours ? 'killed' : 'unknown',
      signal: stop === undefined || stop.signal === 'none' ? null : stop.signal,
      endedAt: yield* timestamp,
    })
  }

  const sessions = yield* sql<{ id: string; projectId: ProjectId; state: string }>`
    SELECT id, project_id, state FROM provider_sessions
    WHERE state IN ('starting', 'active', 'waiting_approval', 'cancelling')`
  for (const session of sessions) {
    // Every lifecycle edge out of a live state: a session still starting failed, one cancelling is uncertain, the rest are lost.
    const state = session.state === 'cancelling' ? 'uncertain' : ['active', 'waiting_approval'].includes(session.state) ? 'lost' : 'failed'
    const revision = yield* change('provider_sessions', session.id, { state, endedAt: yield* timestamp })
    yield* fact({
      projectId: session.projectId,
      aggregateType: 'provider_session',
      aggregateId: session.id,
      revision,
      type: `provider_session.${state}`,
      payload: { reason: 'runtime_restarted' },
      actorId,
    })
  }

  const turns = yield* sql<{ id: string; projectId: ProjectId; state: string }>`
    SELECT id, project_id, state FROM turn_deliveries WHERE state IN ('pending', 'delivered')`
  for (const turn of turns) {
    // A turn sent to the agent may have acted; one never sent did nothing.
    const state = turn.state === 'delivered' ? 'interruption_uncertain' : 'failed'
    const revision = yield* change('turn_deliveries', turn.id, { state, errorClass: 'runtime_restarted', endedAt: yield* timestamp })
    yield* fact({
      projectId: turn.projectId,
      aggregateType: 'turn_delivery',
      aggregateId: turn.id,
      revision,
      type: `turn_delivery.${state}`,
      actorId,
    })
  }

  const requests = yield* sql<{ id: string; projectId: ProjectId }>`SELECT id, project_id FROM permission_requests WHERE state = 'open'`
  for (const request of requests) {
    const revision = yield* change('permission_requests', request.id, { state: 'cancelled' })
    yield* fact({
      projectId: request.projectId,
      aggregateType: 'permission_request',
      aggregateId: request.id,
      revision,
      type: 'permission_request.cancelled',
      payload: { reason: 'runtime_restarted' },
      actorId,
    })
  }
  const attention = yield* sql<{ id: string; projectId: ProjectId }>`
    SELECT id, project_id FROM attention_requests WHERE state = 'open' AND kind = 'permission'`
  for (const request of attention) {
    const revision = yield* change('attention_requests', request.id, { state: 'withdrawn' })
    yield* fact({
      projectId: request.projectId,
      aggregateType: 'attention_request',
      aggregateId: request.id,
      revision,
      type: 'attention_request.withdrawn',
      actorId,
    })
  }

  yield* sql`UPDATE runtime_instances SET ended_at = ${yield* timestamp} WHERE ended_at IS NULL AND id <> ${instance.id}`
  return {
    processesStopped,
    processesUnknown: processes.length - processesStopped,
    sessionsLost: sessions.length,
    turnsUncertain: turns.filter((turn) => turn.state === 'delivered').length,
    turnsFailed: turns.filter((turn) => turn.state === 'pending').length,
    requestsCancelled: requests.length,
  } satisfies Reconciled
})
