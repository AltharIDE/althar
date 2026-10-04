import type { ActorId, DeviceId, ProjectId, RuntimeInstanceId } from '@althar/domain'
import { osStartTime, stopProcessGroup, type StopReport } from '@althar/provider-adapters'
import { Duration, Effect, Option } from 'effect'
import { SqlClient } from 'effect/sql'

import { currentBranch, git } from './git'
import { change, fact, timestamp } from './records'
import { addItem } from './threads'

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

export const reconcile = Effect.fn('reconcile')(function* (instance: {
  readonly id: RuntimeInstanceId
  readonly deviceId: DeviceId
  readonly systemId: ActorId
}) {
  const sql = yield* SqlClient.SqlClient
  const actorId = instance.systemId

  const processes = yield* sql<StaleProcess>`
    SELECT id, pid, os_started_at FROM processes
    WHERE state IN ('launching', 'running') AND runtime_instance_id <> ${instance.id}`
  let processesStopped = 0
  for (const stale of processes) {
    let stop: StopReport | undefined
    if (stale.pid !== null) {
      const leaderStarted = yield* osStartTime(stale.pid)
      // Ours when the leader is the process recorded; or when the leader has gone but its group lives on, since a
      // pid isn't reused while a group with that id exists. Then what the agent left running, such as a dev server, is stopped too.
      const ours = leaderStarted === undefined || leaderStarted === stale.osStartedAt
      if (ours) stop = yield* stopProcessGroup(stale.pid, Duration.seconds(2))
    }
    const stopped = stop !== undefined && stop.signal !== 'none'
    if (stopped) processesStopped += 1
    yield* change('processes', stale.id, {
      state: stopped ? 'killed' : 'unknown',
      signal: stopped ? stop?.signal : null,
      endedAt: yield* timestamp,
    })
  }

  // A worktree a crash interrupted: ready if git finished adding it, failed otherwise.
  const preparing = yield* sql<{ id: string; projectId: ProjectId; path: string; branch: string }>`
    SELECT id, project_id, path, branch FROM workspaces WHERE state = 'preparing' AND device_id = ${instance.deviceId}`
  for (const workspace of preparing) {
    const branch = yield* currentBranch(workspace.path)
    const head = branch === workspace.branch ? yield* git(workspace.path, 'rev-parse', 'HEAD').pipe(Effect.option) : Option.none()
    const revision = yield* change(
      'workspaces',
      workspace.id,
      Option.isSome(head) ? { state: 'ready', baseCommit: head.value } : { state: 'failed' },
    )
    yield* fact({
      projectId: workspace.projectId,
      aggregateType: 'workspace',
      aggregateId: workspace.id,
      revision,
      type: Option.isSome(head) ? 'workspace.ready' : 'workspace.failed',
      payload: { reason: 'runtime_restarted' },
      actorId,
    })
  }

  const sessions = yield* sql<{ id: string; projectId: ProjectId; threadId: string | null; state: string }>`
    SELECT id, project_id, thread_id, state FROM provider_sessions
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
    // The thread says so, in the words the glossary gives it.
    if (session.threadId !== null)
      yield* addItem({ projectId: session.projectId, threadId: session.threadId, sessionId: session.id }, 'notice', {
        source: 'runtime',
        severity: 'warning',
        title: 'Althar restarted.',
        description: {
          uncertain: 'The lead was stopping when it did. Start it again to carry on; nothing it was doing runs twice.',
          lost: 'The lead stopped with it. Start it again to carry on; nothing it was doing runs twice.',
          failed: "The lead hadn't started yet. Start it again to carry on.",
        }[state],
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
