import { Schema } from 'effect'

/*
 * The two ways a skills operation fails (ADR-047): one the person caused or can put right, shown to them and never
 * reported; and one Althar didn't expect, of its own side (the store, the catalog it ships, a run's copy), which the
 * runtime logs and reports where it is kept.
 */

/** A refusal in words for the person: a skill that won't install, a repository GitHub won't give, a version that isn't the one reviewed. */
export class SkillRefused extends Schema.TaggedError<SkillRefused>()('SkillRefused', {
  message: Schema.String,
}) {}

/** Althar's own side of skills didn't work: a file it couldn't read or write, a damaged store or catalog, a run laid out wrong. */
export class SkillStoreFailed extends Schema.TaggedError<SkillStoreFailed>()('SkillStoreFailed', {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export type SkillError = SkillRefused | SkillStoreFailed

/** What an error says of itself, for a message. */
export const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))
