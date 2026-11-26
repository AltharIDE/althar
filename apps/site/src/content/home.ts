/*
 * What the developer page says. The page is for people who code with agents
 * today: one app for the agents they already pay for, a coordinator that
 * hands out the work, and tasks that review and fix themselves. It doesn't
 * pitch project knowledge or talk like an enterprise; the earlier page that
 * did is kept at /enterprise.
 */

export const BRAND = 'Althar'

export const HERO = {
  /** "Agents from every lab, working as one team.": its lines as set, the last one apart in cobalt. */
  lines: ['Agents from', 'every lab, working as'],
  last: 'one team.',
  /** The subhead: what Althar is, the coordinator, the shared memory and where you come in. */
  lead: 'The open source agentic development environment (ADE) where agents from every lab work as one team. One place where your entire software team builds together, all from the same context.',
  /** The orrery's list of agents, for screen readers. */
  agents: 'Agents',
  agentsName: 'Althar at the centre, with the agents it runs in orbit',
  install: 'Install',
  runsOn: 'Runs on',
  soon: 'Coming soon',
} as const

export const CLOSE = {
  no: '05',
  label: 'Get Althar',
  title: ['Bring the agents', 'you already pay for.'],
} as const
