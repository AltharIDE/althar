import type { ReactNode } from 'react'

import { useNow } from './time'

/**
 * The time now, to what it draws: again as it ticks (`useNow`), drawing that
 * again and not the screen around it, which says only whether it ticks.
 */
export function Now({ ticking, every, children }: { ticking: boolean; every?: number; children: (now: string) => ReactNode }) {
  return children(useNow(ticking, every))
}
