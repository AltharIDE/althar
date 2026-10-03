import { vocabulary } from './0001_initial/columns'

/*
 * Usage limits (docs/architecture/03 and 05).
 *
 * What a project does when an agent's account reaches its usage limit is the
 * project's setting: move the work on to the next free agent, or wait for the
 * reset. Without one, it moves on.
 */
export const statements: ReadonlyArray<string> = [
  ...vocabulary('usage_limit_policy', ['move', 'wait']),
  'ALTER TABLE project_settings ADD COLUMN usage_limit TEXT REFERENCES vocab_usage_limit_policy (word)',
]
