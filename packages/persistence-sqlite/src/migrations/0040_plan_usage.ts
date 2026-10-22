import { at, json, ref, table } from './0001_initial/columns'

/*
 * Plan usage (docs/plans/plan-usage.md): what each account's plan
 * has left, as last read.
 *
 * A reading is kept so a window survives a restart: Claude Code reports a
 * window only when its limits change, so what it last said is what there is
 * to show, and what steering (Limits) goes by.
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
]
