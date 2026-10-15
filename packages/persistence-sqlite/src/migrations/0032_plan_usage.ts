import { at, json, ref, table } from './0001_initial/columns'

/*
 * Plan usage (docs/plans/plan-usage.md, ADR-043): what each account's plan
 * has left, as last read, and the warnings raised as it ran down.
 *
 * A reading is kept so a window survives a restart: Claude Code reports a
 * window only when its limits change, so what it last said is what there is
 * to show. A warning row is one window's state: the lowest threshold told
 * for the reset it belongs to, and whether the person has seen it. A
 * threshold is told once per reset period, so a restart does not tell it
 * again.
 */
export const statements: ReadonlyArray<string> = [
  table('plan_usage_readings', [
    ref('account_id', 'agent_accounts'),
    'agent_id TEXT NOT NULL',
    'source TEXT NOT NULL',
    'plan TEXT',
    json('windows'),
    at('observed_at'),
    'PRIMARY KEY (account_id)',
  ]),
  table('plan_usage_warnings', [
    ref('account_id', 'agent_accounts'),
    'window_key TEXT NOT NULL',
    'threshold INTEGER NOT NULL CHECK (threshold BETWEEN 0 AND 100)',
    'resets_at TEXT',
    at('raised_at'),
    at('acknowledged_at', { nullable: true }),
    'PRIMARY KEY (account_id, window_key)',
  ]),
]
