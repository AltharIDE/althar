/** A drawing's tone: the landing page draws each in both. */
export type Tone = 'light' | 'dark'

/** One of the landing page's feature drawings, as the README shows it: its file under apps/site's styled drawings (d-<file>.html), and the width it is drawn at. */
export interface Drawing {
  readonly file: string
  readonly width: number
  readonly shows: string
}

export const DRAWINGS: readonly Drawing[] = [
  { file: 'accounts', width: 800, shows: 'Every plan you have: the accounts taken in turn' },
  { file: 'automations', width: 800, shows: 'Work that starts itself' },
  { file: 'conflicts', width: 800, shows: 'Conflicts, settled' },
  { file: 'worktrees', width: 800, shows: 'Ten at once, each in a worktree of its own' },
  { file: 'workspaces', width: 800, shows: 'Every workspace, side by side' },
]
