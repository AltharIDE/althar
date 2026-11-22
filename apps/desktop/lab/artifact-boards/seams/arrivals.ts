import { useEffect, useRef } from 'react'

import type { ThreadItem } from '@althar/contracts'

import { GIFT } from '../artifacts'
import { lab } from '../state'

/*
 * The lab's arrivals (in place of features/canvases/arrivals.ts, for a
 * task's view): a task whose lead drew Gift a class opens with it beside the
 * conversation, as if it had just been published, in the directions that
 * keep it there (A, D). What arrives after opens nothing: the canvas follows
 * its versions itself.
 */

export const arrived = (items: ReadonlyArray<ThreadItem>, seen: ReadonlySet<string>) => {
  const fresh = items.flatMap((item) => (item.kind === 'canvas' && !seen.has(item.id) ? [item] : []))
  return { fresh, opens: fresh.findLast((item) => item.content.open) ?? null }
}

export const useCanvasArrivals = (
  items: ReadonlyArray<ThreadItem> | undefined,
  open: (canvasId: string, version: number | null, follow: boolean) => void,
) => {
  const done = useRef(false)
  useEffect(() => {
    if (items === undefined || done.current) return
    done.current = true
    const { d } = lab.get()
    if ((d === 'a' || d === 'c' || d === 'd') && items.some((item) => item.kind === 'canvas' && item.content.canvasId === GIFT))
      open(GIFT, null, true)
  }, [items, open])
}
