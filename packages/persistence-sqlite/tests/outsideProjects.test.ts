import { CommandEnvelope, Ids, newId, now } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Commands } from '../src/Commands'
import { Ledger } from '../src/Ledger'
import { seed } from './fixtures'
import { InMemory, WebCrypto } from './support'

/*
 * Commands and changes that belong to no project or aggregate: settings a
 * person changes for the whole app, an agent installed on the device.
 */

const Env = Layer.mergeAll(Commands.layer, Ledger.layer).pipe(Layer.provideMerge(Layer.mergeAll(InMemory, WebCrypto)))

describe('outside any project', () => {
  it.effect('keeps a receipt for a command with no aggregate, and answers its retry from it', () =>
    Effect.gen(function* () {
      const commands = yield* Commands
      const sql = yield* SqlClient.SqlClient
      const { actorId, deviceId } = yield* seed
      const envelope = new CommandEnvelope({
        commandId: yield* newId(Ids.command),
        commandType: 'settings.update',
        schemaVersion: 1,
        actorId,
        deviceId,
        issuedAt: yield* now,
        payload: { keepAwake: true },
      })
      const first = yield* commands.execute({ envelope, result: Schema.Boolean, handle: Effect.succeed(true) })
      const retry = yield* commands.execute({ envelope, result: Schema.Boolean, handle: Effect.die('ran twice') })
      assert.isTrue(first)
      assert.isTrue(retry)
      const receipts = yield* sql<{ aggregateId: string | null; projectId: string | null }>`
        SELECT aggregate_id, project_id FROM command_receipts`
      assert.deepStrictEqual(receipts, [{ aggregateId: null, projectId: null }])
    }).pipe(Effect.provide(Env)),
  )

  it.effect('puts a change that belongs to no project on the feed', () =>
    Effect.gen(function* () {
      const ledger = yield* Ledger
      yield* ledger.notify({ aggregateType: 'agent_installation', aggregateId: 'claude-code', aggregateRevision: 3 })
      const [change] = yield* ledger.changesSince(0, 10)
      assert.deepStrictEqual(
        { project: change?.projectId, type: change?.aggregateType, id: change?.aggregateId, revision: change?.aggregateRevision },
        { project: null, type: 'agent_installation', id: 'claude-code', revision: 3 },
      )
    }).pipe(Effect.provide(Env)),
  )
})
