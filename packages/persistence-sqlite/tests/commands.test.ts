import { CommandEnvelope, type CommandId, Ids, newId, now } from '@althar/domain'
import { assert, describe, it } from '@effect/vitest'
import { Effect, Exit, Layer, Ref, Schema } from 'effect'
import { SqlClient } from 'effect/sql'

import { Commands } from '../src/Commands'
import { CommandIdReused } from '../src/errors'
import { seed } from './fixtures'
import { InMemory, WebCrypto } from './support'

const Env = Commands.layer.pipe(Layer.provideMerge(Layer.mergeAll(InMemory, WebCrypto)))

const Renamed = Schema.Struct({ name: Schema.String, revision: Schema.Int })

/** The fields of a rename command for a freshly seeded project; tests vary them to build envelopes. */
const renameFields = (commandId: CommandId, payload: unknown) =>
  Effect.gen(function* () {
    const { actorId, deviceId, projectId } = yield* seed
    const fields = {
      commandId,
      commandType: 'project.rename',
      schemaVersion: 1,
      actorId,
      deviceId,
      aggregateId: projectId,
      issuedAt: yield* now,
      payload,
    }
    return { projectId, fields, envelope: new CommandEnvelope(fields) }
  })

describe('Commands', () => {
  it.effect('runs a command once, and answers a retry with the first result', () =>
    Effect.gen(function* () {
      const commands = yield* Commands
      const sql = yield* SqlClient.SqlClient
      const runs = yield* Ref.make(0)
      const commandId = yield* newId(Ids.command)
      const { envelope: command, fields, projectId } = yield* renameFields(commandId, { name: 'Renamed', note: { b: 1, a: 2 } })
      const handle = Effect.gen(function* () {
        yield* Ref.update(runs, (count) => count + 1)
        yield* sql`UPDATE projects SET name = 'Renamed', revision = revision + 1 WHERE id = ${projectId}`
        return { name: 'Renamed', revision: 2 }
      })
      const first = yield* commands.execute({ envelope: command, result: Renamed, handle })
      const retry = yield* commands.execute({
        envelope: new CommandEnvelope({ ...fields, payload: { note: { a: 2, b: 1 }, name: 'Renamed' } }),
        result: Renamed,
        handle,
      })
      assert.deepStrictEqual(first, { name: 'Renamed', revision: 2 })
      assert.deepStrictEqual(retry, first)
      assert.strictEqual(yield* Ref.get(runs), 1)
      const [project] = yield* sql<{ revision: number }>`SELECT revision FROM projects WHERE id = ${projectId}`
      assert.strictEqual(project?.revision, 2)
    }).pipe(Effect.provide(Env)),
  )

  it.effect('refuses the same id for a different command', () =>
    Effect.gen(function* () {
      const commands = yield* Commands
      const commandId = yield* newId(Ids.command)
      const { envelope: command, fields } = yield* renameFields(commandId, { name: 'One' })
      const handle = Effect.succeed({ name: 'One', revision: 2 })
      yield* commands.execute({ envelope: command, result: Renamed, handle })
      const changed = yield* Effect.flip(
        commands.execute({ envelope: new CommandEnvelope({ ...fields, payload: { name: 'Two' } }), result: Renamed, handle }),
      )
      assert.instanceOf(changed, CommandIdReused)
      const retyped = yield* Effect.flip(
        commands.execute({ envelope: new CommandEnvelope({ ...fields, commandType: 'project.archive' }), result: Renamed, handle }),
      )
      assert.instanceOf(retyped, CommandIdReused)
    }).pipe(Effect.provide(Env)),
  )

  it.effect('leaves no receipt and no writes when the command fails', () =>
    Effect.gen(function* () {
      const commands = yield* Commands
      const sql = yield* SqlClient.SqlClient
      const commandId = yield* newId(Ids.command)
      const { envelope: command, projectId } = yield* renameFields(commandId, { name: 'Renamed' })
      const failing = Effect.gen(function* () {
        yield* sql`UPDATE projects SET name = 'Renamed' WHERE id = ${projectId}`
        return yield* Effect.fail('name taken' as const)
      })
      const exit = yield* Effect.exit(commands.execute({ envelope: command, result: Renamed, handle: failing }))
      assert.isTrue(Exit.isFailure(exit))
      assert.lengthOf(yield* sql`SELECT 1 FROM command_receipts`, 0)
      const [project] = yield* sql<{ name: string }>`SELECT name FROM projects WHERE id = ${projectId}`
      assert.strictEqual(project?.name, 'Meridian')
      const succeeded = yield* commands.execute({
        envelope: command,
        result: Renamed,
        handle: Effect.succeed({ name: 'Renamed', revision: 2 }),
      })
      assert.strictEqual(succeeded.name, 'Renamed')
    }).pipe(Effect.provide(Env)),
  )

  it.effect('keeps a receipt for a command that returns nothing', () =>
    Effect.gen(function* () {
      const commands = yield* Commands
      const sql = yield* SqlClient.SqlClient
      const { envelope: command } = yield* renameFields(yield* newId(Ids.command), { name: 'Quiet' })
      yield* commands.execute({ envelope: command, result: Schema.Void, handle: Effect.void })
      yield* commands.execute({ envelope: command, result: Schema.Void, handle: Effect.die('ran twice') })
      const [receipt] = yield* sql<{ result: string }>`SELECT result FROM command_receipts`
      assert.strictEqual(receipt?.result, 'null')
    }).pipe(Effect.provide(Env)),
  )

  it.effect("keeps receipts per actor, so one actor's id reveals nothing of another's", () =>
    Effect.gen(function* () {
      const commands = yield* Commands
      const sql = yield* SqlClient.SqlClient
      const commandId = yield* newId(Ids.command)
      const { fields } = yield* renameFields(commandId, { name: 'Mine' })
      yield* commands.execute({
        envelope: new CommandEnvelope(fields),
        result: Renamed,
        handle: Effect.succeed({ name: 'Mine', revision: 2 }),
      })
      const otherActor = yield* newId(Ids.actor)
      yield* sql`INSERT INTO actors ${sql.insert({ id: otherActor, kind: 'person', displayName: 'Lin', createdAt: fields.issuedAt })}`
      const theirs = yield* commands.execute({
        envelope: new CommandEnvelope({ ...fields, actorId: otherActor }),
        result: Renamed,
        handle: Effect.succeed({ name: 'Theirs', revision: 2 }),
      })
      assert.strictEqual(theirs.name, 'Theirs')
      assert.lengthOf(yield* sql`SELECT 1 FROM command_receipts WHERE command_id = ${commandId}`, 2)
    }).pipe(Effect.provide(Env)),
  )

  it.effect('records who a command acts for, as part of the command', () =>
    Effect.gen(function* () {
      const commands = yield* Commands
      const sql = yield* SqlClient.SqlClient
      const { fields, projectId } = yield* renameFields(yield* newId(Ids.command), { name: 'For Ada' })
      const coordinator = yield* newId(Ids.actor)
      yield* sql`INSERT INTO actors ${sql.insert({ id: coordinator, kind: 'agent', displayName: 'Coordinator', agentId: 'claude-code', createdAt: fields.issuedAt })}`
      const forAda = { ...fields, actorId: coordinator, onBehalfOfActorId: fields.actorId }
      yield* commands.execute({
        envelope: new CommandEnvelope(forAda),
        projectId,
        result: Renamed,
        handle: Effect.succeed({ name: 'For Ada', revision: 2 }),
      })
      const [receipt] = yield* sql<{
        onBehalfOfActorId: string
        projectId: string
      }>`SELECT on_behalf_of_actor_id, project_id FROM command_receipts`
      assert.deepStrictEqual(receipt, { onBehalfOfActorId: fields.actorId, projectId })
      const forNobody = yield* Effect.flip(
        commands.execute({
          envelope: new CommandEnvelope({ ...forAda, onBehalfOfActorId: undefined }),
          result: Renamed,
          handle: Effect.succeed({ name: 'x', revision: 2 }),
        }),
      )
      assert.instanceOf(forNobody, CommandIdReused)
    }).pipe(Effect.provide(Env)),
  )
})
