import type { ThreadItem } from '@althar/contracts'
import { useEffect } from 'react'

import { locallyReading, messageMove } from './items'

/** Let an accepted send wait for a session to appear; if it never does, put it back in the queue. */
export const useUnstartedSend = (
  absent: boolean,
  items: ReadonlyArray<ThreadItem>,
  refresh: () => Promise<void>,
  release: (moves: ReadonlyArray<string>) => void,
) => {
  const moves = JSON.stringify(items.filter(locallyReading).map(messageMove))
  useEffect(() => {
    if (!absent || moves === '[]') return
    let cancelled = false
    const timer = setTimeout(() => {
      void refresh().then(() => {
        if (!cancelled) release(JSON.parse(moves) as ReadonlyArray<string>)
      })
    }, 2000)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [absent, moves, refresh, release])
}
