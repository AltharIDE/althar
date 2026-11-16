import { type ActorId, type DeviceId, type HomeId, Ids, newId, now, type RuntimeInstanceId } from '@althar/domain'
import { Cause, Context, Crypto, Effect, Exit, Layer, type Schema } from 'effect'
import { SqlClient, type SqlError } from 'effect/sql'

import { Ledger, type RevisionConflict, type RowNotFound } from '@althar/persistence-sqlite'

import { RuntimeConfig } from './Config'
import { reconcile } from './reconcile'

export interface InstanceInfo {
  /** The durable profile home. This does not change on restart or when a client device is registered. */
  readonly homeId: HomeId
  /** This launch of the runtime. */
  readonly id: RuntimeInstanceId
  readonly deviceId: DeviceId
  /** The person using this profile. */
  readonly personId: ActorId
  /** Althar itself: the actor of what the rules decide and the runtime observes. */
  readonly systemId: ActorId
  /** The coordinator (docs/architecture/04): the actor of the tasks it drafts and the messages it passes on. */
  readonly coordinatorId: ActorId
  /**
   * The launch before this one didn't close cleanly: Althar crashed, failed
   * on something it couldn't carry on past, or was killed, rather than quit,
   * updated or restarted. A first launch follows none.
   */
  readonly afterCrash: boolean
}

/**
 * One person and one Althar per profile; an agent actor by its agent id.
 * The coordinator's is `coordinator`, its role: it runs on whichever agent is
 * chosen, and each of its sessions records which.
 */
const findOrCreateActor = (kind: 'person' | 'system' | 'agent', displayName: string, agentId: string | null = null) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [existing] = yield* sql<{ id: ActorId }>`
      SELECT id FROM actors WHERE kind = ${kind} AND agent_id IS ${agentId} ORDER BY created_at, id LIMIT 1`
    if (existing !== undefined) return existing.id
    const id = yield* newId(Ids.actor)
    yield* sql`INSERT INTO actors ${sql.insert({ id, kind, displayName, agentId, createdAt: yield* now })}`
    return id
  })

/**
 * The runtime's launch (docs/architecture/02). Starting records it, finds or
 * creates this device and its actors, and reconciles what an earlier launch
 * left behind before anything new starts. Its scope closing cleanly records
 * that the launch ended, as quitting, updating or restarting Althar
 * interrupts it: a launch with no end recorded crashed, failed or was killed.
 */
export class Instance extends Context.Service<Instance, InstanceInfo>()('@althar/runtime/Instance') {
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
          const [home] = yield* sql<{
            id: HomeId
            deviceId: DeviceId
            personId: ActorId
          }>`SELECT id, device_id, person_id FROM runtime_homes WHERE singleton = 1`
          const [device] =
            home === undefined
              ? yield* sql<{
                  id: DeviceId
                }>`SELECT d.id FROM devices d ORDER BY EXISTS (SELECT 1 FROM runtime_instances r WHERE r.device_id = d.id) DESC, d.created_at, d.id LIMIT 1`
              : [{ id: home.deviceId }]
          const deviceId = device?.id ?? (yield* newId(Ids.device))
          if (device === undefined)
            yield* sql`INSERT INTO devices ${sql.insert({ id: deviceId, name: config.deviceName, createdAt: yield* now })}`
          const personId = home?.personId ?? (yield* findOrCreateActor('person', 'You'))
          const homeId = home?.id ?? (yield* newId(Ids.home))
          if (home === undefined)
            yield* sql`INSERT INTO runtime_homes ${sql.insert({ singleton: 1, id: homeId, deviceId, personId, createdAt: yield* now })}`
          const systemId = yield* findOrCreateActor('system', 'Althar')
          const coordinatorId = yield* findOrCreateActor('agent', 'Coordinator', 'coordinator')
          // Read before reconciling closes it: a launch that closed cleanly says when it ended; one that crashed, failed or was killed, never.
          const [before] = yield* sql<{ endedAt: string | null }>`
            SELECT ended_at FROM runtime_instances ORDER BY started_at DESC, rowid DESC LIMIT 1`
          const afterCrash = before !== undefined && before.endedAt === null
          const id = yield* newId(Ids.runtimeInstance)
          yield* sql`INSERT INTO runtime_instances ${sql.insert({ id, deviceId, pid: process.pid, appVersion: config.appVersion, startedAt: yield* now })}`
          return { id, homeId, deviceId, personId, systemId, coordinatorId, afterCrash }
        }),
      )
      yield* reconcile(info)
      // Only a clean close: the runtime's scope also closes on a failure it stops for, which is a crash all the same.
      yield* Effect.addFinalizer((exit) =>
        Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)
          ? Effect.ignore(Effect.flatMap(now, (at) => sql`UPDATE runtime_instances SET ended_at = ${at} WHERE id = ${info.id}`))
          : Effect.void,
      )
      return Instance.of(info)
    }),
  )
}
