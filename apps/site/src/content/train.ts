import { HERO } from './home'

/*
 * What the train concept's first screen says (/train): the same page as the
 * developer page below it, with a first screen seen from a train's window
 * as it pulls away and gathers speed.
 */

export const TRAIN = {
  /** "Building software has never felt so fast.": a line, then its last word, large, arriving with the speed. */
  title: 'Building software has never felt so',
  last: 'fast.',
  /** The speed readout's unit. The number is the train's own, as it goes. */
  unit: 'km/h',
  lead: 'Althar runs Claude Code, Codex and OpenCode as one crew, on the plans you already pay for. One plans, one builds, another reviews, and when one runs out the next takes over.',
  /** The lead on a phone, where the first screen has less room. */
  short: 'Claude Code, Codex and OpenCode as one crew, on the plans you already have.',
  fine: HERO.fine,
} as const
