import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'

import type { ThreadItem } from '@althar/contracts'
import { MergingBack, MergingPill, MOTION } from '@althar/ui'

import { type MergingGroup, mergingIn } from './merging'

/*
 * What is on its way into a branch, pinned on the composer's edge as a pill
 * for each branch, so it stays in view while the thread scrolls on
 * (MergingPill), and why one came back, on the composer's notice line while
 * its pill is folded. Once all of a branch's are in, its pill shows them so
 * for a moment, then goes; the thread holds the folded merge line where it was
 * asked. Only what was seen moving goes so: a thread opened after the merge
 * shows none.
 */

/** How long a pill shows all in before it goes. */
const HOLD = 1800

/** What is open on the composer's edge: one at a time, so opening one folds the others. */
export type EdgeOpen = string | null

/** What is open on the composer's edge, and a way to open each that folds the others; closing one closes only it. */
export function useEdge() {
  const [edge, setEdge] = useState<EdgeOpen>(null)
  const opens = useCallback((which: string) => (next: boolean) => setEdge((was) => (next ? which : was === which ? null : was)), [])
  return { edge, opens }
}

/** What a pill opens by on the edge: its card's item, so a fresh card on the same branch starts folded. */
const pillOf = (group: MergingGroup) => `merging:${group.id}`

export function usePinnedMerges(
  items: ReadonlyArray<ThreadItem>,
  edge: EdgeOpen,
  opens: (which: string) => (next: boolean) => void,
): { readonly pills: ReactNode; readonly back: ReactNode } {
  const groups = useMemo(() => mergingIn(items), [items])
  // Those seen moving that are all in now, held for a moment, then going: by their card's item, never their branch's, which a
  // fresh card reuses.
  const [ending, setEnding] = useState<ReadonlyMap<string, 'held' | 'going'>>(new Map())
  const [was, setWas] = useState(groups)
  if (was !== groups) {
    setWas(groups)
    const moved = new Set(was.flatMap((group) => (group.done ? [] : [group.id])))
    const done = groups.filter((group) => group.done && moved.has(group.id) && !ending.has(group.id))
    if (done.length > 0) setEnding(new Map([...ending, ...done.map((group) => [group.id, 'held'] as const)]))
  }
  useEffect(() => {
    const timers = [...ending].map(([key, phase]) =>
      setTimeout(
        () =>
          setEnding((now) => {
            const next = new Map(now)
            if (phase === 'held') next.set(key, 'going')
            else next.delete(key)
            return next
          }),
        phase === 'held' ? HOLD : MOTION.exit.duration,
      ),
    )
    return () => timers.forEach(clearTimeout)
  }, [ending])

  const shown = groups.filter((group) => !group.done || ending.has(group.id))
  // Why one came back, while its pill is folded: the card says it under its row once opened.
  const folded = shown.filter((group) => edge !== pillOf(group)).flatMap((group) => group.rows)
  const backed = folded.some(
    (row) => (row.state === 'sent_back' || row.state === 'conflict') && row.reason !== undefined && row.reason !== '',
  )
  return {
    pills: shown.map((group) => (
      <MergingPill
        key={group.id}
        rows={group.rows}
        branch={group.branch}
        open={edge === pillOf(group)}
        onOpenChange={opens(pillOf(group))}
        leaving={ending.get(group.id) === 'going'}
      />
    )),
    back: backed ? <MergingBack rows={folded} /> : null,
  }
}
