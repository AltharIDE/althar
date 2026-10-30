import { drawGrain } from '@althar/ui/opening'
import { type ReactNode, useLayoutEffect, useRef } from 'react'

import { addDisplay } from '../../home/display'
import { cx } from '../../lib/cx'
import { seeded } from '../footer/random'
import { LightUnder } from '../lightUnder'
import s from './Night.module.css'

/*
 * A page in the homepage's warm dark, opening on a window as the first
 * screen does: its instruments along the top, the page's head large in the
 * middle, and behind them the night side of the planet, its edge lit
 * cobalt: the page's one light. What stands on that edge, under the head,
 * is the page's own: a release's picture, the shifts' strip of days, the
 * ways on from the docs. The changelog, the shifts and the docs open on one.
 *
 * The head's words take the classes `night` exports (over, overLit,
 * headline, why, picture), so each page keeps its own headings.
 */

addDisplay()

export { s as night }

/** The page's main, dark all the way down: the nav turns to smoked glass over it. */
export function Night({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <main id="main" tabIndex={-1} className={cx(s.night, className)}>
      <LightUnder tone="ink" className={s.under} />
      {children}
    </main>
  )
}

/** An instrument: what it reads, and the reading; a way into the page. Set at the strip's start, middle or end. */
export function Readout({
  label,
  href,
  at = 'start',
  children,
}: {
  label: string
  href: string
  at?: 'start' | 'mid' | 'end'
  children: ReactNode
}) {
  return (
    <a className={cx(s.readout, at === 'mid' && s.mid, at === 'end' && s.end)} href={href}>
      <i>{label}</i>
      {children}
    </a>
  )
}

/** The window: its instruments along the top, then what the page puts in it, the planet's lit edge behind. */
export function Window({ deck, className, children }: { deck: ReactNode; className?: string; children: ReactNode }) {
  const grain = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const tile = document.createElement('canvas')
    tile.width = tile.height = 128
    const context = tile.getContext('2d')
    if (!context || !grain.current) return
    drawGrain(context, 128, seeded(11))
    grain.current.style.backgroundImage = `url(${tile.toDataURL()})`
  }, [])
  return (
    <header className={cx(s.window, className)}>
      <div className={s.sky} aria-hidden="true">
        <div className={s.haze} />
        <div className={s.limb} />
        <div ref={grain} className={s.grain} />
      </div>
      <div className={s.deck}>{deck}</div>
      {children}
    </header>
  )
}
