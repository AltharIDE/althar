// Scrappy: a thread's blocks as each direction has them in the gap. Never the app's own wait for the reply (C, as built): only the direction's sign of life shows. Today's as they are; in every direction, the message just sent reads as sent (not a flash of Queued), and the agent's error is the direction's to say. In B, the message carries the receipt.
import { Delivery } from '@althar/ui'

import type { Screen } from '../data'
import type { State } from '../store'

/** What B's You reads as the time under a message: the receipt goes there. */
export const RECEIPT = '\u0000receipt'

export const adjust = <B extends { readonly kind: string; readonly id: string }>(
  blocks: ReadonlyArray<B>,
  st: State,
  screen: Screen,
): ReadonlyArray<B> => {
  const gap = st.gap
  const theirs = blocks.filter((block) => block.kind !== 'waiting')
  if (st.d === 'T' || gap === null || gap.screen !== screen || gap.phase === 'queued') return theirs
  const kept = theirs.filter((block) => block.id !== `${gap.id}-failed`)
  const last = kept.findLastIndex((block) => block.kind === 'you')
  if (last === -1) return kept
  const receipt = st.d === 'B' && (gap.phase === 'waiting' || gap.phase === 'failed' || gap.phase === 'stopped')
  return kept.map((block, index) =>
    index !== last ? block : ({ ...block, delivery: Delivery.Delivered, ...(receipt ? { at: RECEIPT } : {}) } as B),
  )
}
