import { Schema } from 'effect'

import { ActorId, CommandId, DeviceId } from './ids'
import { Timestamp } from './time'

/**
 * A request to change authoritative state (docs/architecture/02). The command
 * id makes a retry safe: the runtime answers a repeated command with its first
 * result instead of running it again.
 */
export class CommandEnvelope extends Schema.Class<CommandEnvelope>('@althar/domain/CommandEnvelope')({
  commandId: CommandId,
  commandType: Schema.String.check(Schema.isPattern(/^[a-z][a-z_]*(\.[a-z_]+)+$/)),
  schemaVersion: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  actorId: ActorId,
  /** The person a command acts for, when an agent issues it: the coordinator acts for its owner. */
  onBehalfOfActorId: Schema.optional(ActorId),
  deviceId: DeviceId,
  aggregateId: Schema.optional(Schema.String),
  expectedRevision: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  issuedAt: Timestamp,
  payload: Schema.Unknown,
}) {}
