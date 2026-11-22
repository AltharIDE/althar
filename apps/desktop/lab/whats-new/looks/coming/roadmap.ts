import { type Planned, ROADMAP } from '../../changelog'

/*
 * The roadmap as Coming next shows it: each item of the site's ROADMAP
 * (changelog.ts), with what the lab makes up for it, clearly lab data: its
 * picture, and how Althar's own board would have it (its branch, steps and
 * lead). No dates: what's being built, then next, then later.
 */

export type PictureKey = 'installer' | 'trigger' | 'phone' | 'simulator' | 'knowledge' | 'team'

export interface Coming extends Planned {
  readonly picture: PictureKey
  /** The branch it's built on, in Althar's own repository. */
  readonly branch: string
}

const MORE: Record<string, Omit<Coming, keyof Planned>> = {
  'Windows signing': { picture: 'installer', branch: 'althar/windows-signing' },
  'Event-based automations': { picture: 'trigger', branch: 'althar/event-automations' },
  'Mobile app': { picture: 'phone', branch: 'althar/mobile-pairing' },
  'Integrated simulators': { picture: 'simulator', branch: 'althar/simulators' },
  'Project knowledge store': { picture: 'knowledge', branch: 'althar/knowledge-store' },
  'Teams, in the cloud': { picture: 'team', branch: 'althar/teams' },
}

export const COMING: readonly Coming[] = ROADMAP.map((one) => ({
  ...one,
  ...(MORE[one.title] ?? { picture: 'installer', branch: 'althar/next' }),
}))

export const STAGE_WORD = { now: 'Being built', next: 'Next', later: 'Later' } as const

export const inStage = (stage: Coming['stage']) => COMING.filter((one) => one.stage === stage)
