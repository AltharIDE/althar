import { type Planned, ROADMAP } from '../../changelog'

/*
 * The roadmap as Coming next shows it: each item of the site's ROADMAP
 * (changelog.ts), with what the lab makes up for it, clearly lab data: its
 * picture, and how Althar's own board would have it (its branch, steps and
 * lead) and how many want it. No dates: what's being built, then next, then
 * later.
 */

export type PictureKey = 'installer' | 'trigger' | 'phone' | 'simulator' | 'knowledge' | 'team'

export interface Coming extends Planned {
  readonly picture: PictureKey
  /** The branch it's built on, in Althar's own repository. */
  readonly branch: string
  /** How many have asked for it, as the lab makes up. */
  readonly wants: number
}

const MORE: Record<string, Omit<Coming, keyof Planned>> = {
  'Windows signing': { picture: 'installer', branch: 'althar/windows-signing', wants: 184 },
  'Event-based automations': { picture: 'trigger', branch: 'althar/event-automations', wants: 342 },
  'Mobile app': { picture: 'phone', branch: 'althar/mobile-asks', wants: 611 },
  'Integrated simulators': { picture: 'simulator', branch: 'althar/simulators', wants: 277 },
  'Project knowledge store': { picture: 'knowledge', branch: 'althar/knowledge-store', wants: 398 },
  'Teams, in the cloud': { picture: 'team', branch: 'althar/teams', wants: 455 },
}

export const COMING: readonly Coming[] = ROADMAP.map((one) => ({
  ...one,
  ...(MORE[one.title] ?? { picture: 'installer', branch: 'althar/next', wants: 0 }),
}))

export const STAGE_WORD = { now: 'Being built', next: 'Next', later: 'Later' } as const

export const inStage = (stage: Coming['stage']) => COMING.filter((one) => one.stage === stage)
