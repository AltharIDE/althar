/*
 * What the developer page says. The page is for people who code with agents
 * today: one app for the agents they already pay for, a coordinator that
 * hands out the work, and tasks that review and fix themselves. It doesn't
 * pitch project knowledge or talk like an enterprise; the earlier page that
 * did is kept at /enterprise.
 */

export const BRAND = 'Althar'

export const HERO = {
  /** "Building software has never felt so fast.": a line, then its last word, set apart by its weight. */
  title: 'Building software has never felt so',
  last: 'fast.',
  /** The subhead: open source and independence from the labs, in one sentence (the positioning's second and third messages). */
  lead: 'Althar is an open-source IDE for building with AI agents. It runs the ones you already pay for, and keeps going whatever the labs change.',
  /** The figure's caption, with how many agents ride the orrery; the list of them, for screen readers; and the console under the lead. */
  agents: 'Agents',
  agentsName: 'The agents Althar runs',
  install: 'Install',
} as const

export const CLOSE = {
  no: '05',
  label: 'Get Althar',
  title: ['Bring the agents', 'you already pay for.'],
} as const
