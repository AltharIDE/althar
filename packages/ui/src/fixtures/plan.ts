import { Brand } from '../foundations/brands/brands'
import type { PlanAgent, PlanSilent } from '../chrome/PlanGauge/plan'

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
        { id: 'five_hour', label: '5 hours', left: 52, until: '17:00' },
        { id: 'weekly', label: 'Week', left: 0, until: 'Mon 09:00' },
      ],
    },
    {
      id: 'claude-personal',
      name: 'Personal',
      age: 'read 2 hours ago',
      fault: 'Claude Code didn’t answer when it was last asked; these are its last numbers.',
      windows: [
        { id: 'five_hour', label: '5 hours', left: 80, until: '15:40' },
        { id: 'weekly', label: 'Week', left: 41, until: 'Fri 09:00' },
      ],
    },
  ],
}

export const SILENT: readonly PlanSilent[] = [
  { name: 'GitHub Copilot', why: 'Copilot shares no plan usage with other apps.' },
  { name: 'Junie', why: 'Junie reports credits only inside JetBrains’ own apps.' },
  { name: 'Mistral Vibe', why: 'Vibe’s usage page has no way in for other apps.' },
]
