import { Brand } from '../foundations/brands/brands'
import type { PlanAgent } from '../chrome/PlanGauge/plan'

/* Plan usage on a Tuesday afternoon, least room first. Made up, and the same on every run. */

export const CLAUDE_PLENTY: PlanAgent = {
  id: 'claude-code',
  name: 'Claude Code',
  brand: Brand.ClaudeCode,
  left: 62,
  limit: 'five-hour limit',
  until: '17:00',
  account: null,
  accounts: [
    {
      id: 'claude-work',
      name: null,
      age: null,
      fault: null,
      windows: [
        { id: 'five_hour', label: '5 hours', left: 62, until: '17:00' },
        { id: 'weekly', label: 'Week', left: 71, until: 'Mon 09:00' },
        { id: 'weekly:Opus', label: 'Opus week', left: 81, until: 'Mon 09:00' },
      ],
    },
  ],
}

export const CODEX_PLENTY: PlanAgent = {
  id: 'codex',
  name: 'Codex',
  brand: Brand.Codex,
  left: 74,
  limit: 'weekly limit',
  until: 'Sun 18:12',
  account: null,
  accounts: [
    {
      id: 'codex-work',
      name: null,
      age: null,
      fault: null,
      windows: [
        { id: 'five_hour', label: '5 hours', left: 88, until: '18:40' },
        { id: 'weekly', label: 'Week', left: 74, until: 'Sun 18:12' },
      ],
    },
  ],
}

/** Codex's five hours nearly gone, until 14:00 today. */
export const CODEX_NEARLY: PlanAgent = {
  ...CODEX_PLENTY,
  left: 3,
  limit: 'five-hour limit',
  until: '14:00',
  accounts: [
    {
      id: 'codex-work',
      name: null,
      age: null,
      fault: null,
      windows: [
        { id: 'five_hour', label: '5 hours', left: 3, until: '14:00' },
        { id: 'weekly', label: 'Week', left: 74, until: 'Sun 18:12' },
      ],
    },
  ],
}

/** Codex's one account signed out: its last numbers saved, but no work can start on it. */
export const CODEX_SIGNED_OUT: PlanAgent = {
  ...CODEX_PLENTY,
  left: 0,
  stopped: 'Signed out',
  accounts: [
    {
      id: 'codex-work',
      name: null,
      age: 'read 3 hours ago',
      fault: 'Sign in to Codex to see its usage.',
      windows: [
        { id: 'five_hour', label: '5 hours', left: 80, until: '11:00' },
        { id: 'weekly', label: 'Week', left: 74, until: 'Sun 18:12' },
      ],
    },
  ],
}

/** Claude Code's windows all reset since it was last read, and its sign-in has expired since: no figure, its age and why in the detail. */
export const CLAUDE_UNREAD: PlanAgent = {
  ...CLAUDE_PLENTY,
  left: 0,
  limit: '',
  until: null,
  unread: 'Not read since reset',
  accounts: [
    {
      id: 'claude-personal',
      name: null,
      age: 'read 2 days ago',
      fault: 'Its sign-in has expired. Claude Code renews it the next time it runs on this account.',
      windows: [],
    },
  ],
}

/** Two accounts, one out: work goes to the one with room, Personal, whose figure is the agent's. */
export const CLAUDE_TWO: PlanAgent = {
  ...CLAUDE_PLENTY,
  left: 41,
  limit: 'weekly limit',
  until: 'Fri 09:00',
  account: 'Personal',
  accounts: [
    {
      id: 'claude-work',
      name: 'Work',
      age: null,
      fault: null,
      windows: [
        { id: 'five_hour', label: '5 hours', left: 52, until: '17:00', resets: 'resets 17:00 · in 2 h 10 m' },
        { id: 'weekly', label: 'Week', left: 0, until: 'Mon 09:00', resets: 'resets Mon 09:00 · in 3 d 18 h' },
      ],
    },
    {
      id: 'claude-personal',
      name: 'Personal',
      age: 'read 2 hours ago',
      fault: 'Claude Code didn’t answer when it was last asked; these are its last numbers.',
      windows: [
        { id: 'five_hour', label: '5 hours', left: 80, until: '15:40', resets: 'resets 15:40 · in 50 m' },
        { id: 'weekly', label: 'Week', left: 41, until: 'Fri 09:00', resets: 'resets Fri 09:00 · in 1 d 18 h' },
      ],
    },
  ],
}

/**
 * Claude Code's detail in each state a reset can be in: a window with time left, one that reset since it was read (no figure,
 * never an empty limit), and one the provider gave no reset time for.
 */
export const CLAUDE_RESETS: PlanAgent = {
  ...CLAUDE_PLENTY,
  left: 45,
  limit: 'weekly limit',
  until: 'Fri 09:00',
  accounts: [
    {
      id: 'claude-personal',
      name: null,
      age: null,
      fault: null,
      windows: [
        { id: 'five_hour', label: '5 hours', left: 0, until: '14:00', resets: 'reset at 14:00 · not read since', unread: true },
        { id: 'weekly', label: 'Week', left: 45, until: 'Fri 09:00', resets: 'resets Fri 09:00 · in 1 d 18 h' },
        { id: 'weekly:Opus', label: 'Opus week', left: 70, until: null, resets: 'no reset time given' },
      ],
    },
  ],
}

/** OpenCode Go read through the account's OpenCode Console sign-in: its five hours, week and month, the week tightest. */
export const OPENCODE_GO: PlanAgent = {
  id: 'opencode',
  name: 'OpenCode Go',
  brand: Brand.OpenCode,
  left: 58,
  limit: 'weekly limit',
  until: 'Mon 01:00',
  account: null,
  accounts: [
    {
      id: 'opencode-usual',
      name: null,
      age: null,
      fault: null,
      windows: [
        { id: 'five_hour', label: '5 hours', left: 91, until: '21:54' },
        { id: 'weekly', label: 'Week', left: 58, until: 'Mon 01:00' },
        { id: 'monthly', label: 'Month', left: 77, until: '3 Dec' },
      ],
    },
  ],
}

/** OpenCode Go signed in with its key alone: it can run, but nothing reads how much is left. */
export const OPENCODE_GO_CONNECTED: PlanAgent = {
  id: 'opencode',
  name: 'OpenCode Go',
  brand: Brand.OpenCode,
  left: 0,
  limit: '',
  until: null,
  account: null,
  connected: 'Connected',
  accounts: [
    {
      id: 'opencode-usual',
      name: null,
      age: null,
      fault: 'OpenCode reads Go’s usage only through an OpenCode Console sign-in, and this account has none.',
      windows: [],
    },
  ],
}

/** OpenCode Go's key refused: it runs nothing until it is signed in again, from its row. */
export const OPENCODE_GO_SIGN_IN: PlanAgent = {
  id: 'opencode',
  name: 'OpenCode Go',
  brand: Brand.OpenCode,
  left: 0,
  limit: '',
  until: null,
  account: null,
  stopped: 'Signed out',
  signIn: true,
  accounts: [{ id: 'opencode-usual', name: null, age: null, fault: 'OpenCode Go needs signing in again.', windows: [] }],
}
