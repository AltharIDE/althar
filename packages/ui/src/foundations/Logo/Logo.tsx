import { cx } from '../../lib/cx'
import s from './Logo.module.css'
import { LOGO_BORE, LOGO_SECTION } from './Logo.paths'

/*
 * Althar's own mark: the section through an architect's triangular scale
 * ruler, bored through the middle, with a point of cobalt in the bore. Drawn
 * in the ink around it; the point is --live, Althar's colour. Decoration,
 * like the other marks: the name beside it is what reads.
 *
 * On a 24 grid: an equilateral triangle about the centroid (12, 14.4), faces
 * hollowed to a 15.36 radius, tips cut flat, so the section spans 4.8 to
 * 19.2 and sits centred. The point is a touch larger than the drawing it
 * came from, so it still reads at 16px.
 */
export { LOGO_BORE, LOGO_SECTION } from './Logo.paths'

export interface LogoProps {
  size?: number
  className?: string
}

export function Logo({ size = 16, className }: LogoProps) {
  return (
    <svg className={cx(s.logo, className)} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path d={LOGO_SECTION + LOGO_BORE} fillRule="evenodd" />
      <circle className={s.point} cx="12" cy="14.4" r="0.8" />
    </svg>
  )
}
