import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { useMedia } from '../../lib/browser'

import { useClock } from '../bodies/kit/loop'

import { AtWork, BOARD_STILL, BOARD_STORY } from '../bodies/desktop/AtWork'
import { CanvasAtWork } from '../bodies/kit/CanvasAtWork'
import { HomeAtWork } from '../bodies/kit/HomeAtWork'
import s from './Views.module.css'

/*
 * The app at work, three of its views in a row: the board, the home and a
 * canvas, each the kit's own screens playing their own story through, then
 * fading out and in again as it starts over (kit/loop.ts). The one in front is in the middle; the others sit behind it either
 * side, smaller and faded. The scene is pinned and the scroll flips through
 * them (Story.tsx gives which is in front), then lets you on down the page;
 * scrolling back flips back.
 */

interface View {
  id: string
  name: string
  /** The view, playing while it is in front (`active`), held where it is behind. */
  node: (active: boolean) => ReactNode
  /** Where it stands in front, off the first view's place: across (a share of the row) and down (px). */
  at: readonly [string, string]
}

/** The board's story on the views' clock (kit/loop.ts): the conversation's ask and plan, then the board's round as far as it goes before it fades (AtWork.tsx). */
function Board({ active }: { active: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const clock = useClock(box, BOARD_STORY, BOARD_STILL, active)
  return (
    <div ref={box} className={s.board}>
      <AtWork clock={clock} active={active} />
    </div>
  )
}

const VIEWS: readonly View[] = [
  { id: 'board', name: 'The board', node: (active) => <Board active={active} />, at: ['0%', '0px'] },
  { id: 'home', name: 'Home', node: (active) => <HomeAtWork active={active} />, at: ['2.2%', '22px'] },
  { id: 'canvas', name: 'A canvas', node: (active) => <CanvasAtWork active={active} />, at: ['-1.8%', '10px'] },
]

/*
 * On a phone each view is the whole window as a desktop lays it out, scaled down to the screen (Shot.tsx), and only the
 * one in front is drawn live, playing its story; the two behind it are bare windows. Three live at once, at a desktop's
 * size, asked a phone's browser for more layer memory than it has (what moves in each is a layer the size it is laid
 * out at), and it closed the page when the scene was scrolled through fast. One at a time is about what the three laid
 * out for a phone came to. Which is live changes once the scroll has settled on a view, so one passed on the way to
 * another is never drawn.
 */
export const VIEW_COUNT = VIEWS.length

/** Where a view stands from the middle: -1 left, 0 middle, 1 right, round the row. */
const offsetOf = (i: number, at: number, n: number) => {
  const d = (((i - at) % n) + n) % n
  return d > n / 2 ? d - n : d
}

/** How long a view has to be in front, on a phone, before it is the one drawn live: scrolled through fast, none of those passed is. */
const SETTLE = 260

export function Views({ at }: { at: number }) {
  // On a phone only one view is live, the one in front once the scroll has settled on it; the others are bare windows (above).
  const phone = useMedia('(max-width: 699px)')
  const [live, setLive] = useState(at)
  useEffect(() => {
    if (live === at) return
    const timer = setTimeout(() => setLive(at), SETTLE)
    return () => clearTimeout(timer)
  }, [at, live])
  // Where the views start under the window's top once the scene is pinned: on a tablet or a phone they take what is left under it (Views.module.css).
  const row = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = row.current
    const stick = el?.closest<HTMLElement>('[data-stick]')
    if (!el || !stick) return
    const measure = () => {
      const top = (parseFloat(getComputedStyle(stick).top) || 0) + el.getBoundingClientRect().top - stick.getBoundingClientRect().top
      el.style.setProperty('--views-top', `${Math.round(top)}px`)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(stick)
    return () => ro.disconnect()
  }, [])
  return (
    <div className={s.views}>
      <div ref={row} className={s.row}>
        {VIEWS.map((view, i) => {
          const off = offsetOf(i, at, VIEWS.length)
          return (
            <div
              key={view.id}
              className={s.view}
              data-off={off}
              data-bare={(phone && i !== live) || undefined}
              data-fit-box=""
              aria-hidden={off !== 0 || undefined}
              inert={off !== 0 || undefined}
              aria-roledescription="slide"
              aria-label={view.name}
              style={{ '--at-x': view.at[0], '--at-y': view.at[1] } as CSSProperties}
            >
              {(!phone || i === live) && view.node(off === 0)}
            </div>
          )
        })}
      </div>
    </div>
  )
}
