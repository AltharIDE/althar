import { CommandEnvelope, CommandId, Ids, newId, now } from '@charrette/domain'
import { Commands, Database, Ledger } from '@charrette/persistence-sqlite'
import { Effect, Layer, Schema } from 'effect'

import { Agents, RuntimeConfig, type RuntimeOptions, WebCrypto } from './Config'
import { Instance } from './Instance'
import { Live } from './Live'
import { Permissions } from './Permissions'
import { Projects } from './Projects'
import { Sessions } from './Sessions'

export interface RuntimeLayerOptions extends RuntimeOptions {
  /** The profile's database file, or `:memory:` for tests. */
  readonly database: string
  /** The agents it may start. The registry's, unless a test gives others. */
  readonly agents?: Layer.Layer<Agents>
}

/**
 * The runtime, composed: the store, this launch, and the services clients
 * call. Building it opens and migrates the database and reconciles what an
 * earlier launch left; closing it stops every session and records the end of
 * the launch.
 */
export const layer = (options: RuntimeLayerOptions) => {
  const store = Layer.mergeAll(Ledger.layer, Commands.layer).pipe(
    Layer.provideMerge(Database.layer({ filename: options.database })),
    Layer.provideMerge(WebCrypto),
  )
  const base = Layer.mergeAll(Instance.layer, Live.layer).pipe(
    Layer.provideMerge(store),
    Layer.provideMerge(Layer.succeed(RuntimeConfig, options)),
    Layer.provideMerge(options.agents ?? Agents.registry),
  )
  return Layer.mergeAll(Projects.layer, Sessions.layer).pipe(Layer.provideMerge(Permissions.layer.pipe(Layer.provideMerge(base))))
}

/**
 * A command from the person using this profile, ready to send. A client
 * gives its own id, so a retry is answered from the first one's receipt.
 */
export const envelope = (commandType: string, payload: unknown, commandId?: string) =>
  Effect.gen(function* () {
    const instance = yield* Instance
    return new CommandEnvelope({
      commandId:
        commandId === undefined ? yield* newId(Ids.command) : yield* Effect.orDie(Schema.decodeUnknownEffect(CommandId)(commandId)),
      commandType,
      schemaVersion: 1,
      actorId: instance.personId,
      deviceId: instance.deviceId,
      issuedAt: yield* now,
      payload,
    })
  })
