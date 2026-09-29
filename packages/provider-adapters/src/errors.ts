import { Schema } from 'effect'

/** The agent could not be started: the command is missing, or it failed to launch. */
export class AgentStartFailed extends Schema.TaggedError<AgentStartFailed>()('AgentStartFailed', {
  command: Schema.String,
  reason: Schema.String,
}) {}

/** The agent's process exited, or its connection closed, while Charrette still needed it. */
export class AgentExited extends Schema.TaggedError<AgentExited>()('AgentExited', {
  code: Schema.NullOr(Schema.Number),
  signal: Schema.NullOr(Schema.String),
  stderr: Schema.String,
}) {}

/** A request to the agent failed, classified as in docs/architecture/03's failure table. */
export class AgentRequestFailed extends Schema.TaggedError<AgentRequestFailed>()('AgentRequestFailed', {
  method: Schema.String,
  failure: Schema.Literals(['usage_limit', 'context_full', 'auth_required', 'invalid_request', 'transient', 'unknown']),
  message: Schema.String,
  resetsAt: Schema.optional(Schema.String),
}) {}

/** The agent does not offer a mode or option value Charrette asked for. */
export class OptionUnavailable extends Schema.TaggedError<OptionUnavailable>()('OptionUnavailable', {
  configId: Schema.String,
  value: Schema.String,
  available: Schema.Array(Schema.String),
}) {}

/** A prompt arrived while the session's current turn was still running. One turn runs at a time; interrupt it first. */
export class TurnInProgress extends Schema.TaggedError<TurnInProgress>()('TurnInProgress', {
  sessionId: Schema.String,
}) {}
