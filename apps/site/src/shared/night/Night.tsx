import { type ReactNode, useRef } from 'react'

import { addDisplay } from '../../home/display'
import { cx } from '../../lib/cx'
import { useGrain } from '../grain'
import { LightUnder } from '../lightUnder'
import { Out } from '../Out'
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

/** The page's main, dark all the way down: the nav turns to smoked glass over it. `head` makes it only the page's head, inside a main of the page's own (the thesis, whose sheet is paper). */
export function Night({ className, head, children }: { className?: string; head?: boolean; children: ReactNode }) {
  const Tag = head ? 'div' : 'main'
  return (
    <Tag id={head ? undefined : 'main'} tabIndex={head ? undefined : -1} className={cx(s.night, head && s.headOnly, className)}>
      <LightUnder tone="ink" className={s.under} />
      {children}
    </Tag>
  )
}

/** Ways on from a page that has little of its own (the docs' place, a page that isn't there): panes of smoked glass on the planet's lit edge. */
export function Panes({ ways }: { ways: readonly { href: string; name: string; note: string }[] }) {
  return (
    <ul className={s.panes}>
      {ways.map((way) => (
        <li key={way.href}>
          <a href={way.href}>
            <b>
              {way.name}
              {/^https?:/.test(way.href) && <Out size={10} />}
            </b>
            <span>{way.note}</span>
          </a>
        </li>
      ))}
    </ul>
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
  useGrain(grain, 11)
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
