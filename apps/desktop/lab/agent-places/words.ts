import { isLowered, type Places, type Why } from './data'

/*
 * What the takes say, as little as each needs. On screen an agent place is an
 * agent, as the slider already counts them ("Agents at once").
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Until when the number stays lowered: it comes back by itself. */
const UNTIL: Record<Why, string> = { memory: 'until memory frees up', cpu: 'until the CPU frees up' }

export const words = {
  agents: 'Agents',
  atOnce: 'Agents at once',
  /** C: where every agent is at work, the way to more: the slider, in the quick settings. */
  allowMore: 'Allow more',

  /** How many work, of the number. */
  of: (places: Places) => `${places.agents.length} of ${places.configured}`,

  /** The number lowered for now, and until when; null while it isn't. */
  lowered: (places: Places) => (isLowered(places) && places.why !== null ? `${places.atOnce} at a time ${UNTIL[places.why]}` : null),

  /** What waits for an agent. */
  waiting: (n: number) => `${plural(n, 'task')} waiting`,

  /** B: the slider's one line in This Mac, what is so now: lowered, all at work, or how many work. */
  live: (places: Places, waiting: number) => {
    const lowered = words.lowered(places)
    if (lowered !== null) return lowered
    if (waiting > 0) return `All ${places.agents.length} at work, ${plural(waiting, 'task')} waiting`
    return `${places.agents.length} at work`
  },

  /** C: the one sentence This Mac keeps, only while something waits or the number is lowered; null otherwise. */
  sentence: (places: Places, waiting: number) => {
    const turn = waiting > 0 ? ` ${plural(waiting, 'task')} wait their turn.` : ''
    if (isLowered(places) && places.why !== null) return `${plural(places.atOnce, 'agent')} at a time ${UNTIL[places.why]}.${turn}`
    if (waiting > 0) return `All ${places.agents.length} agents are at work.${turn}`
    return null
  },
}
