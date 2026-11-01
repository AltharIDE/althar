import { Schema } from 'effect'

/** A refusal the agent can read and act on. */
export class ToolRefused extends Schema.TaggedError<ToolRefused>()('ToolRefused', { message: Schema.String }) {}

/** Positive proof an asked-for action neither happened nor remains in flight. */
export class ActionNotPerformed extends Schema.TaggedError<ActionNotPerformed>()('ActionNotPerformed', { message: Schema.String }) {}
