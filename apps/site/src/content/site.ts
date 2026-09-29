import { Brand } from '@charrette/ui'

import type { AGENTS } from './facts'
import { NOTES } from './meridian'

/*
 * The building site's cast, shared by the site concepts: six tasks in
 * Meridian, which agent ran each, and the note each one left. The notes are
 * the floors, rooms or words the cranes set down. Three are your decisions,
 * shown in violet wherever they appear.
 */

export interface SiteTask {
  who: string
  task: string
  /** The note it left, in full. */
  note: string
  /** The same note, short enough to name a floor or a room. */
  short: string
  kind: string
  you?: boolean
}

export const TASKS: readonly SiteTask[] = [
  { who: 'Claude Code', task: 'Task 311', note: NOTES[0]?.title ?? '', short: 'Money in minor units', kind: 'Convention' },
  { who: 'Codex', task: 'Task 344', note: 'Ledger tests run on the fixed test clock', short: 'The fixed test clock', kind: 'Convention' },
  { who: 'Gemini CLI', task: 'Task 356', note: NOTES[1]?.title ?? '', short: 'Idempotent webhooks', kind: 'Your decision', you: true },
  { who: 'Cursor', task: 'Task 402', note: NOTES[3]?.title ?? '', short: 'A 5-minute refresh', kind: 'Seen in a task' },
  { who: 'Codex', task: 'Task 415', note: NOTES[4]?.title ?? '', short: 'No cascade deletes', kind: 'Your decision', you: true },
  {
    who: 'Claude Code',
    task: 'Task 418',
    note: 'A failed token rotation retries once, then fails',
    short: 'Retry once, then fail',
    kind: 'Your decision',
    you: true,
  },
]

/** A short name split over two lines, as evenly as the words allow. */
export function twoLines(text: string): [string, string] {
  const words = text.split(' ')
  let best: [string, string] = [text, '']
  let worst = Infinity
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ')
    const b = words.slice(i).join(' ')
    const w = Math.max(a.length, b.length)
    if (w < worst) {
      worst = w
      best = [a, b]
    }
  }
  return best
}

/** Each agent's mark, by the name on its plate. */
export const BRAND_OF: Record<(typeof AGENTS)[number], Brand> = {
  'Claude Code': Brand.ClaudeCode,
  Codex: Brand.Codex,
  'Gemini CLI': Brand.GeminiCli,
  Cursor: Brand.Cursor,
  'GitHub Copilot': Brand.GitHubCopilot,
  Ollama: Brand.Ollama,
  OpenRouter: Brand.OpenRouter,
}

export const brandOf = (name: string): Brand | null => (name in BRAND_OF ? BRAND_OF[name as keyof typeof BRAND_OF] : null)
