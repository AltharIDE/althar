import { type ActorId, CommandEnvelope, CommandId, Ids, newId, now } from '@charrette/domain'
import { Effect, Schema } from 'effect'

import { Instance } from './Instance'

/**
 * A command, ready to send: from the person using this profile unless another
 * actor, such as the coordinator, issues it. A client gives its own id, so a
 * retry is answered from the first one's receipt.
 */
export const envelope = (commandType: string, payload: unknown, commandId?: string, actorId?: ActorId) =>
  Effect.gen(function* () {
    const instance = yield* Instance
    return new CommandEnvelope({
      commandId:
        commandId === undefined ? yield* newId(Ids.command) : yield* Effect.orDie(Schema.decodeUnknownEffect(CommandId)(commandId)),
      commandType,
      schemaVersion: 1,
      actorId: actorId ?? instance.personId,
      deviceId: instance.deviceId,
      issuedAt: yield* now,
      payload,
    })
  })
