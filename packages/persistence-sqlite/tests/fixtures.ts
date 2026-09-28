import { type ActorId, type DeviceId, Ids, newId, now, type ProjectId } from '@charrette/domain'
import { Effect } from 'effect'
import { SqlClient } from 'effect/sql'

/** A device, a person and a project to hang other rows off. */
export const seed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const createdAt = yield* now
  const deviceId: DeviceId = yield* newId(Ids.device)
  const actorId: ActorId = yield* newId(Ids.actor)
  const projectId: ProjectId = yield* newId(Ids.project)
  yield* sql`INSERT INTO devices ${sql.insert({ id: deviceId, name: 'This Mac', createdAt })}`
  yield* sql`INSERT INTO actors ${sql.insert({ id: actorId, kind: 'person', displayName: 'Ada', agentId: null, createdAt })}`
  yield* sql`INSERT INTO projects ${sql.insert({ id: projectId, name: 'Meridian', slug: 'meridian', createdByActorId: actorId, createdAt, archivedAt: null })}`
  return { deviceId, actorId, projectId, createdAt }
})
