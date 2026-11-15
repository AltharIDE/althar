import { useState } from 'react'

/**
 * What the person removed, gone from the window in the frame they pressed it
 * (docs/decisions/foundations.md, "The UI is instant"). Each stays hidden by
 * its id until a read without it lands, however many removals overlap and in
 * whatever order their reads come back, so no read from before a removal
 * brings it back for a moment; `back` returns one the runtime kept.
 */
export function useGoneAtOnce<T>(items: ReadonlyArray<T> | undefined, idOf: (item: T) => string) {
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set())
  // A read without it says it is gone: from then on it is the read's to show.
  if (items !== undefined && gone.size > 0) {
    const held = [...gone].filter((id) => items.some((item) => idOf(item) === id))
    if (held.length !== gone.size) setGone(new Set(held))
  }
  return {
    shown: items === undefined || gone.size === 0 ? items : items.filter((item) => !gone.has(idOf(item))),
    hide: (ids: ReadonlyArray<string>) => setGone((was) => new Set([...was, ...ids])),
    back: (id: string) =>
      setGone((was) => {
        const next = new Set(was)
        next.delete(id)
        return next
      }),
  }
}
