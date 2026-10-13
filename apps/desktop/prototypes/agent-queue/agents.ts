import type { Queued } from '@althar/contracts'

import { queuedOfWords as todayOf, queuedWords as today } from '../../src/renderer/shared/agents'
import type { InLine } from './scene'
import { fullOf, homeOf } from './words'

/* The app's words for agents, as every screen imports them, with waiting work said in the page's direction. */
export { agentLineOf, brandOf, signInWordsOf, waitsWords } from '../../src/renderer/shared/agents'

const of = (queued: Queued) => queued as InLine

export const queuedWords = (queued: Queued, where?: string) =>
  of(queued).direction === undefined || of(queued).direction === 'today' ? today(queued, where) : fullOf(of(queued))

export const queuedOfWords = (n: number, queued: Queued) =>
  of(queued).direction === undefined || of(queued).direction === 'today' ? todayOf(n, queued) : homeOf(n, of(queued))
