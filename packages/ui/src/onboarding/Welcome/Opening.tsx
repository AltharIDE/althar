import { LOGO_BORE, LOGO_SECTION } from '../../foundations/Logo/Logo'
import { cx } from '../../lib/cx'
import s from './Opening.module.css'

/*
 * The welcome's opening. The camera starts close where two construction
 * lines cross, the mark is drawn big around that point and its point is set;
 * then the camera pulls back hard, and the name and the line under it come
 * into focus, as a lens pulls them. Nothing loops or pulses: it plays once
 * and holds.
 *
 * The point is still being chosen, so it has versions to compare: `dot`, a
 * plain cobalt dot set once the mark is filled; `ring`, a plain ink circle
 * drawn first, where the lines will cross, which fills cobalt at the end;
 * `none`, the mark in ink alone.
 *
 * It is drawn on the welcome's table, about a point: its crossing. Begin
 * moves the camera off it across the same table, and its own grid (which it
 * needs to zoom) meets the table's exactly and gives way to it.
 */

export type OpeningPoint = 'dot' | 'ring' | 'none'

export interface OpeningProps {
  name: string
  line: string
  point?: OpeningPoint
  /** Arrive finished, with no motion. */
  still?: boolean
  /** The camera has moved on to the table, whose grid takes over from the opening's own. */
  away?: boolean
  className?: string
}

export function Opening({ name, line, point = 'dot', still = false, away = false, className }: OpeningProps) {
  return (
    <div className={cx(s.opening, still && s.still, away && s.away, className)}>
      <div className={s.pull}>
        <i className={s.grid} aria-hidden="true" />
        <i className={s.hline} aria-hidden="true" />
        <i className={s.vline} aria-hidden="true" />
        <svg viewBox="0 0 24 24" className={s.mark} aria-hidden="true">
          {point === 'ring' && <circle cx="12" cy="14.4" r="0.8" pathLength={1} className={s.ring} />}
          <path d={LOGO_SECTION} pathLength={1} className={s.markLine} />
          <path d={LOGO_SECTION + LOGO_BORE} fillRule="evenodd" className={s.markFill} />
          {point === 'dot' && <circle cx="12" cy="14.4" r="0.8" className={s.point} />}
        </svg>
      </div>
      <h1 className={s.name}>{name}</h1>
      <p className={s.line}>{line}</p>
    </div>
  )
}
