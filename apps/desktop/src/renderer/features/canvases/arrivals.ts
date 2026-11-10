import { useEffect, useRef } from 'react'

import type { ThreadItem } from '@althar/contracts'

/*
 * A canvas its agent publishes or opens beside the conversation, as it
 * arrives (ADR-104): the newest such item the thread hears of opens on the
 * workbench, a publish following the canvas's latest version, an open at
 * the version it named. What the thread held when the window first read it
 * opens nothing: only what arrives while the person is here.
 */

/** The canvas items a thread holds now that it didn't before, the newest that asks to open last. */
export const arrived = (items: ReadonlyArray<ThreadItem>, seen: ReadonlySet<string>) => {
  const fresh = items.flatMap((item) => (item.kind === 'canvas' && !seen.has(item.id) ? [item] : []))
  return { fresh, opens: fresh.findLast((item) => item.content.open) ?? null }
}

export const useCanvasArrivals = (
  items: ReadonlyArray<ThreadItem> | undefined,
  open: (canvasId: string, version: number | null, follow: boolean) => void,
) => {
  const seen = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (items === undefined) return
    const known = seen.current
    if (known === null) {
      seen.current = new Set(items.flatMap((item) => (item.kind === 'canvas' ? [item.id] : [])))
      return
    }
    const { fresh, opens } = arrived(items, known)
    for (const item of fresh) known.add(item.id)
    if (opens === null) return
    const { canvasId, version, action } = opens.content
    open(canvasId, action === 'opened' ? version : null, action === 'published')
  }, [items, open])
}
