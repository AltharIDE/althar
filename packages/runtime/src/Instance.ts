import { type ActorId, type DeviceId, Ids, newId, now, type RuntimeInstanceId } from '@charrette/domain'
import { Context, Crypto, Effect, Layer, type Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { Ledger, type RevisionConflict, type RowNotFound } from '@charrette/persistence-sqlite'

import { RuntimeConfig } from './Config'
import { reconcile } from './reconcile'

export interface InstanceInfo {
  /** This launch of the runtime. */
  readonly id: RuntimeInstanceId
  readonly deviceId: DeviceId
  /** The person using this profile. */
  readonly personId: ActorId
  /** Charrette itself: the actor of what the rules decide and the runtime observes. */
  readonly systemId: ActorId
}

const findOrCreateActor = (kind: 'person' | 'system', displayName: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [existing] = yield* sql<{ id: ActorId }>`SELECT id FROM actors WHERE kind = ${kind} ORDER BY created_at, id LIMIT 1`
    if (existing !== undefined) return existing.id
    const id = yield* newId(Ids.actor)
    yield* sql`INSERT INTO actors ${sql.insert({ id, kind, displayName, agentId: null, createdAt: yield* now })}`
    return id
  })

/**
 * The runtime's launch (docs/architecture/02). Starting records it, finds or
 * creates this device and its actors, and reconciles what an earlier launch
 * left behind before anything new starts. Its scope ending records that the
 * launch ended.
 */
export class Instance extends Context.Service<Instance, InstanceInfo>()('@charrette/runtime/Instance') {
  static readonly layer: Layer.Layer<
    Instance,
    SqlError.SqlError | Schema.SchemaError | RowNotFound | RevisionConflict,
    SqlClient.SqlClient | Ledger | Crypto.Crypto | RuntimeConfig
  > = Layer.effect(
    Instance,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const config = yield* RuntimeConfig
      const info = yield* sql.withTransaction(
        Effect.gen(function* () {
          const [device] = yield* sql<{ id: DeviceId }>`SELECT id FROM devices ORDER BY created_at, id LIMIT 1`
          const deviceId = device?.id ?? (yield* newId(Ids.device))
          if (device === undefined)
            yield* sql`INSERT INTO devices ${sql.insert({ id: deviceId, name: config.deviceName, createdAt: yield* now })}`
          const personId = yield* findOrCreateActor('person', 'You')
          const systemId = yield* findOrCreateActor('system', 'Charrette')
          const id = yield* newId(Ids.runtimeInstance)
          yield* sql`INSERT INTO runtime_instances ${sql.insert({ id, deviceId, pid: process.pid, appVersion: config.appVersion, startedAt: yield* now })}`
          return { id, deviceId, personId, systemId }
        }),
      )
      yield* reconcile(info)
      yield* Effect.addFinalizer(() =>
        Effect.ignore(Effect.flatMap(now, (at) => sql`UPDATE runtime_instances SET ended_at = ${at} WHERE id = ${info.id}`)),
      )
      return Instance.of(info)
    }),
  )
}
