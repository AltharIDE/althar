import type { UsageAccountRow, UsageGroup } from '../chrome/Usage/Usage'

/* Plan usage on a Tuesday afternoon: three agents, several accounts, and every kind of fault. Made up, and the same on every run. */

const FIVE_HOURS: UsageAccountRow['meters'][number] = { id: 'five_hour', label: '5 hours', left: 72, resets: '17:00' }
const WEEK: UsageAccountRow['meters'][number] = { id: 'weekly', label: 'Week', left: 58, resets: 'Mon 9:00 AM' }

export const CLAUDE_WORK: UsageAccountRow = {
  id: 'claude-work',
  name: 'work',
  plan: 'Max',
  paidBy: 'plan',
  meters: [FIVE_HOURS, WEEK, { id: 'weekly:Opus', label: 'Opus', left: 81, resets: 'Mon 9:00 AM' }],
  source: 'From Claude Code’s last report · 4m ago',
  fault: null,
}

export const CLAUDE_PERSONAL: UsageAccountRow = {
  id: 'claude-personal',
  name: 'personal',
  plan: 'Pro',
  paidBy: 'plan',
  meters: [
    { id: 'five_hour', label: '5 hours', left: 22, resets: '15:40' },
    { id: 'weekly', label: 'Week', left: 9, resets: 'Fri 9:00 AM' },
  ],
  source: 'From Claude Code’s last report · 1h ago',
  fault: null,
}

export const CODEX_WORK: UsageAccountRow = {
  id: 'codex-work',
  name: 'work',
  plan: 'Pro',
  paidBy: 'plan',
  meters: [
    { id: 'five_hour', label: '5 hours', left: 40, resets: '17:00' },
    { id: 'weekly', label: 'Week', left: 4, resets: 'Sun 6:12 PM' },
  ],
  source: 'Reported by Codex · just now',
  fault: null,
}

export const OPENCODE_KEY: UsageAccountRow = {
  id: 'opencode-key',
  name: 'gateway',
  plan: null,
  paidBy: 'key',
  meters: [],
  source: null,
  fault: null,
}

export const OPENCODE_GO: UsageAccountRow = {
  id: 'opencode-go',
  name: 'go',
  plan: 'Go',
  paidBy: 'plan',
  meters: [
    { id: 'five_hour', label: '5 hours', left: 90, resets: '18:30' },
    { id: 'monthly', label: 'Month', left: 64, resets: '1 Nov' },
  ],
  source: 'From the provider · 2m ago',
  fault: null,
}

/** Every account healthy. */
export const HEALTHY: UsageGroup[] = [
  { id: 'claude-code', name: 'Claude Code', accounts: [CLAUDE_WORK] },
  { id: 'codex', name: 'Codex', accounts: [{ ...CODEX_WORK, meters: [FIVE_HOURS, WEEK], source: 'Reported by Codex · just now' }] },
  { id: 'opencode', name: 'OpenCode', accounts: [OPENCODE_GO] },
]

/** Accounts running low at each threshold, beside one that is not. */
export const RUNNING_LOW: UsageGroup[] = [
  { id: 'claude-code', name: 'Claude Code', accounts: [CLAUDE_WORK, CLAUDE_PERSONAL] },
  { id: 'codex', name: 'Codex', accounts: [CODEX_WORK] },
  { id: 'opencode', name: 'OpenCode', accounts: [OPENCODE_GO] },
]

/** One account for each kind of fault, the last numbers kept beside a few. */
export const FAULTS: UsageGroup[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    accounts: [
      {
        ...CLAUDE_PERSONAL,
        id: 'claude-signed-out',
        name: 'personal',
        fault: { kind: 'sign_in_again', message: 'Claude Code no longer accepts this account’s sign-in.' },
        source: 'From Claude Code’s last report · 3h ago',
      },
      {
        ...CLAUDE_WORK,
        id: 'claude-changed',
        meters: [],
        source: null,
        fault: { kind: 'source_changed', message: 'Claude Code reports usage in a form Althar does not know yet.' },
      },
    ],
  },
  {
    id: 'codex',
    name: 'Codex',
    accounts: [
      {
        ...CODEX_WORK,
        id: 'codex-unreachable',
        fault: { kind: 'unreachable', message: 'Codex did not answer in time.' },
        source: 'Reported by Codex · 40m ago',
      },
      {
        ...CODEX_WORK,
        id: 'codex-no-data',
        name: 'side',
        meters: [],
        source: null,
        fault: { kind: 'no_data_yet', message: 'Codex has not reported usage for this account since it was added.' },
      },
    ],
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    accounts: [
      {
        ...OPENCODE_GO,
        id: 'opencode-no-source',
        meters: [],
        source: null,
        fault: { kind: 'no_source', message: 'This provider offers no way to read plan usage.' },
      },
      {
        ...OPENCODE_GO,
        id: 'opencode-unknown',
        name: 'other',
        plan: null,
        paidBy: 'unknown',
        meters: [],
        source: null,
        fault: { kind: 'cannot_classify', message: 'Althar could not tell whether this account is on a plan or a key.' },
      },
    ],
  },
]

/** An account on an API key: no plan window, and nothing wrong. */
export const WITH_KEY: UsageGroup[] = [
  { id: 'claude-code', name: 'Claude Code', accounts: [CLAUDE_WORK] },
  { id: 'opencode', name: 'OpenCode', accounts: [OPENCODE_KEY, OPENCODE_GO] },
]
