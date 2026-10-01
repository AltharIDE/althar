import { at, table } from './0001_initial/columns'

/*
 * The models agents offer (docs/architecture/03).
 *
 * Asking an agent never run what it offers starts it: a process like any
 * other, recorded before it is spawned so a crash in between is reconciled,
 * with no session of its own.
 *
 * A model's default effort is the person's, kept for the profile: a session
 * on that model starts at it unless the plan or the person picks another.
 */
export const statements: ReadonlyArray<string> = [
  "INSERT INTO vocab_process_purpose (word) VALUES ('probe')",
  table(
    'model_preferences',
    ['agent_id TEXT NOT NULL', 'model TEXT NOT NULL', 'effort TEXT NOT NULL', at('updated_at')],
    ['PRIMARY KEY (agent_id, model)'],
  ),
]
