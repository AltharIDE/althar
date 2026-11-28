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
      age: 'Last read 3 hours ago',
      fault: 'Signed out. Sign in again to read usage.',
      stale: true,
      signedOut: true,
      windows: [
        { id: 'five_hour', label: '5 hours', left: 80, until: '11:00' },
        { id: 'weekly', label: 'Week', left: 74, until: 'Sun 18:12' },
      ],
    },
  ],
}

/**
 * Codex on two accounts: Plus has room, so work goes there and its five hours are the figure; Main is signed out, its last
 * month saved.
 */
export const CODEX_MAIN_SIGNED_OUT: PlanAgent = {
  ...CODEX_PLENTY,
  left: 61,
  limit: 'five-hour limit',
  until: '13:55',
  elapsed: 98,
  account: 'Plus',
  accounts: [
    {
      id: 'codex-plus',
      name: 'Plus',
      age: null,
      fault: null,
      windows: [
        { id: 'five_hour', label: '5 hours', left: 61, until: '13:55', resets: 'in 6m', resetsTitle: 'Resets 13:55 · in 6m', elapsed: 98 },
        {
          id: 'weekly',
          label: 'Week',
          left: 64,
          until: 'Sun 00:47',
          resets: 'in 10h 58m',
          resetsTitle: 'Resets Sun 00:47 · in 10h 58m',
          elapsed: 93,
        },
      ],
    },
    {
      id: 'codex-main',
      name: 'Main',
      age: 'Last read 1h ago',
      fault: 'Signed out. Sign in again to read usage.',
      stale: true,
      signedOut: true,
      windows: [
        { id: 'monthly', label: 'Month', left: 81, until: '22 Dec', resets: 'in 24d 9h', resetsTitle: 'Resets 22 Dec 22:49 · in 24d 9h' },
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
      age: 'Last read 2 days ago',
      fault: 'Sign-in expired. Claude Code renews it on its next run.',
      windows: [],
    },
  ],
}

/**
 * Both of Codex's accounts signed out the same way (its sign-in expired): said once, above them, and their last week drawn
 * quieter, with how old it is.
 */
export const CODEX_EXPIRED: PlanAgent = {
  ...CODEX_PLENTY,
  left: 0,
  limit: '',
  until: null,
  stopped: 'Signed out',
  signIn: true,
  fault: 'Signed out. Sign in again to read usage.',
  accounts: ['Main', 'Pro'].map((name) => ({
    id: `codex-${name.toLowerCase()}`,
    name,
    age: 'Last read 20m ago',
    fault: null,
    stale: true,
    signedOut: true,
    windows: [
      { id: 'weekly', label: 'Week', left: 51, until: 'Mon 11:00', resets: 'in 3d 23h', resetsTitle: 'Resets Mon 11:00 · in 3d 23h' },
    ],
  })),
}

/** Both of Claude Code's accounts rate limited: its figure is the last one read, the line said once, each reading drawn quieter. */
export const CLAUDE_RATE_LIMITED: PlanAgent = {
  ...CLAUDE_PLENTY,
  left: 58,
  limit: 'five-hour limit',
  until: '17:00',
  account: 'Work',
  fault: 'Rate limited. Tries again later.',
  accounts: [
    {
      id: 'claude-work',
      name: 'Work',
      age: 'Last read 6m ago',
      fault: null,
      stale: true,
      windows: [
        { id: 'five_hour', label: '5 hours', left: 58, until: '17:00', resets: 'in 2h 10m', resetsTitle: 'Resets 17:00 · in 2h 10m' },
        { id: 'weekly', label: 'Week', left: 71, until: 'Mon 09:00', resets: 'in 3d 18h', resetsTitle: 'Resets Mon 09:00 · in 3d 18h' },
      ],
    },
    {
      id: 'claude-personal',
      name: 'Personal',
      age: 'Last read 6m ago',
      fault: null,
      stale: true,
      windows: [
        { id: 'five_hour', label: '5 hours', left: 12, until: '15:40', resets: 'in 50m', resetsTitle: 'Resets 15:40 · in 50m' },
        { id: 'weekly', label: 'Week', left: 40, until: 'Fri 09:00', resets: 'in 1d 18h', resetsTitle: 'Resets Fri 09:00 · in 1d 18h' },
      ],
    },
  ],
}

/** Two accounts, one out: work goes to the one with room, Personal, first, whose figure is the agent's. Personal's last read didn't answer: its numbers are the last good ones. */
export const CLAUDE_TWO: PlanAgent = {
  ...CLAUDE_PLENTY,
  left: 41,
  limit: 'weekly limit',
  until: 'Fri 09:00',
  account: 'Personal',
  accounts: [
    {
      id: 'claude-personal',
      name: 'Personal',
      age: 'Last read 2 hours ago',
      fault: 'No reply. Tries again soon.',
      stale: true,
      windows: [
        { id: 'five_hour', label: '5 hours', left: 80, until: '15:40', resets: 'in 50m', resetsTitle: 'Resets 15:40 · in 50m' },
        { id: 'weekly', label: 'Week', left: 41, until: 'Fri 09:00', resets: 'in 1d 18h', resetsTitle: 'Resets Fri 09:00 · in 1d 18h' },
      ],
    },
    {
      id: 'claude-work',
      name: 'Work',
      age: null,
      fault: null,
      windows: [
        { id: 'five_hour', label: '5 hours', left: 52, until: '17:00', resets: 'in 2h 10m', resetsTitle: 'Resets 17:00 · in 2h 10m' },
        { id: 'weekly', label: 'Week', left: 0, until: 'Mon 09:00', resets: 'in 3d 18h', resetsTitle: 'Resets Mon 09:00 · in 3d 18h' },
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
        {
          id: 'five_hour',
          label: '5 hours',
          left: 0,
          until: '14:00',
          resets: 'reset 14:00',
          resetsTitle: 'Reset at 14:00 · not read since',
          note: 'not read since',
          unread: true,
        },
        { id: 'weekly', label: 'Week', left: 45, until: 'Fri 09:00', resets: 'in 1d 18h', resetsTitle: 'Resets Fri 09:00 · in 1d 18h' },
        {
          id: 'weekly:Opus',
          label: 'Opus week',
          left: 70,
          until: null,
          resets: 'no reset time',
          resetsTitle: 'The provider gave no reset time for this window.',
        },
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
  accounts: [{ id: 'opencode-usual', name: null, age: null, fault: 'OpenCode Go needs signing in again.', signedOut: true, windows: [] }],
}

/** 40% through the week with 65% left: use is a little under the clock's pace, so the fill runs past the tick (at the 60% of the week left). */
export const CLAUDE_AHEAD: PlanAgent = {
  ...CLAUDE_PLENTY,
  left: 65,
  limit: 'weekly limit',
  until: 'Fri 09:00',
  elapsed: 40,
  accounts: [
    {
      id: 'claude-work',
      name: null,
      age: null,
      fault: null,
      windows: [
        // Even pace: 30% through, 70% left, the fill ends on the tick.
        { id: 'five_hour', label: '5 hours', left: 70, until: '17:00', elapsed: 30 },
        { id: 'weekly', label: 'Week', left: 65, until: 'Fri 09:00', elapsed: 40 },
        // Behind, though much is left: 40% through with 50% left ends the fill before the tick.
        { id: 'weekly:Opus', label: 'Opus week', left: 50, until: 'Fri 09:00', elapsed: 40 },
      ],
    },
  ],
}

/** Used faster than the clock: 70% through the week with 20% left, the fill ending well before the tick at 30%. */
export const CODEX_BEHIND: PlanAgent = {
  ...CODEX_PLENTY,
  left: 20,
  limit: 'weekly limit',
  until: 'Sun 18:12',
  elapsed: 70,
  accounts: [
    {
      id: 'codex-work',
      name: null,
      age: null,
      fault: null,
      windows: [
        { id: 'five_hour', label: '5 hours', left: 20, until: '18:40', elapsed: 90 },
        { id: 'weekly', label: 'Week', left: 20, until: 'Sun 18:12', elapsed: 70 },
      ],
    },
  ],
}
