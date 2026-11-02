import { at, ref, table } from './0001_initial/columns'

/*
 * ADR-084: what a task, or the coordinator's day, used of each account its
 * agents ran on.
 *
 * - A session keeps the cost its agent last said (ACP's usage_update), a
 *   running total for the session, in its currency: what was paid per use.
 * - An account on a plan keeps each reading of its week as it moves, so the
 *   rise between two readings can be put on the turns that ran on it then.
 */
export const statements: ReadonlyArray<string> = [
  'ALTER TABLE provider_sessions ADD COLUMN reported_cost REAL CHECK (reported_cost IS NULL OR reported_cost >= 0)',
  'ALTER TABLE provider_sessions ADD COLUMN reported_currency TEXT',
  table('plan_usage_weeks', [
    ref('account_id', 'agent_accounts'),
    'used_percent REAL NOT NULL CHECK (used_percent >= 0 AND used_percent <= 100)',
    // As its source said it: when the week starts again.
    'resets_at TEXT',
    at('observed_at'),
    'PRIMARY KEY (account_id, observed_at)',
  ]),
]
