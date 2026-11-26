import type { ApiHandlers } from '@althar/contracts'
import { Effect } from 'effect'

import { Nudges } from '../Nudges'

/**
 * The attention stream a native host subscribes to without the desktop client.
 * Its own group, so a host can build a client of it alone.
 */
export const attentionHandlers = Effect.gen(function* () {
  const nudges = yield* Nudges
  return {
    WatchAttention: () => nudges.events,
  } satisfies Partial<ApiHandlers>
})
