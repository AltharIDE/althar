import { at, table } from './0001_initial/columns'

/*
 * The models the person switched off, kept for the profile (ADR-015): no
 * plan picks one, and no picker offers it. A model is an agent's, by the
 * agent's id for it, since each agent names its models its own way.
 */
export const statements: ReadonlyArray<string> = [
  table('model_blocks', ['agent_id TEXT NOT NULL', 'model TEXT NOT NULL', at('updated_at')], ['PRIMARY KEY (agent_id, model)']),
]
