import { Schema } from 'effect'

/** A refusal the agent can read and act on. */
export class ToolRefused extends Schema.TaggedError<ToolRefused>()('ToolRefused', { message: Schema.String }) {}
