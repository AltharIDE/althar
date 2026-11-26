import { useEffect, useRef } from 'react'

import { Fragment } from './Fragment'
import s from './Review.module.css'
import review from './styled/review.html?raw'

/*
 * The work reviewing itself, as a before and after. Today you carry each
 * agent's answer to the other by hand, Copy and Paste, round after round;
 * with Althar one task fills in its own steps, the lead and a reviewer from
 * another lab taking turns down its rail, and only the pull request
 * reaches you.
 *
 * Given `at`, in seconds, it doesn't play by itself: it stands at that
 * moment of its loop, as the home page's scroll sets it; `after`, Althar's
 * side stands at a moment of its own (today's plays first, then Althar's).
 * `flush`: as wide as its place, with no room of its own round it (a column
 * of the scene).
 */

export function Review({ at = null, after, flush = false }: { at?: number | null; after?: number; flush?: boolean } = {}) {
  const box = useRef<HTMLDivElement>(null)
  const driven = at !== null
  useEffect(() => {
    const root = box.current?.querySelector('.rp-task')
    root?.dispatchEvent(new CustomEvent('rv-drive', { detail: driven }))
  }, [driven])
  useEffect(() => {
    if (at === null) return
    const detail = after === undefined ? at : { t: at, tr: after }
    box.current?.querySelector('.rp-task')?.dispatchEvent(new CustomEvent('rv-seek', { detail }))
  }, [at, after])
  return (
    <div ref={box} className={flush ? s.flush : s.wrap}>
      <Fragment source={review} tone="dark" className={s.stage} />
    </div>
  )
}
