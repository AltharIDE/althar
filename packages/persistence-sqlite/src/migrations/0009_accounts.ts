import { at, id, index, ref, revision, table } from './0001_initial/columns'

/*
 * Several accounts per agent (ADR-012, docs/architecture/03).
 *
 * An account is one sign-in of an agent on this device, in a folder of its
 * own, its home: the agent's usual folder (no home) is its first. The person
 * names and orders them; one another tool made keeps the tool's name.
 * Removing one keeps its row, so what ran on it stays attributable.
 *
 * A principal, who the agent says it is, is observed per account, so a usage
 * limit puts one account out, not the agent; a session records the account
 * it ran on.
 */
export const statements: ReadonlyArray<string> = [
  "INSERT INTO vocab_aggregate_type (word) VALUES ('agent_account')",
  table('agent_accounts', [
    id('acc'),
    'agent_id TEXT NOT NULL',
    ref('device_id', 'devices'),
    'name TEXT NOT NULL CHECK (length(trim(name)) > 0)',
    'home TEXT',
    'position INTEGER NOT NULL CHECK (position >= 0)',
    'adopted_from TEXT',
    at('created_at'),
    at('removed_at', { nullable: true }),
    revision,
  ]),
  index('agent_accounts_usual', 'agent_accounts (device_id, agent_id)', { unique: true, where: 'home IS NULL AND removed_at IS NULL' }),
  index('agent_accounts_by_home', 'agent_accounts (device_id, home)', { unique: true, where: 'home IS NOT NULL AND removed_at IS NULL' }),
  'ALTER TABLE principals ADD COLUMN account_id TEXT REFERENCES agent_accounts (id)',
  'ALTER TABLE provider_sessions ADD COLUMN account_id TEXT REFERENCES agent_accounts (id)',
]
