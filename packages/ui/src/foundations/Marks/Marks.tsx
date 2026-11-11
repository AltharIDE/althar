import { cx } from '../../lib/cx'
import { Brand, BRANDS } from '../brands/brands'
import { Icon } from '../Icon/Icon'
import s from './Marks.module.css'

/*
 * A product's mark: a lab, a runtime, a place work comes from. Drawn in the
 * ink around it, never in brand colour (Linear's issue card colours the mark
 * itself). Like icons, marks are decoration: the text beside them names the
 * product. The drawings and the lookups live in foundations/brands.
 */

export interface BrandMarkProps {
  brand: Brand
  size?: number
  className?: string
}

export function BrandMark({ brand, size = 14, className }: BrandMarkProps) {
  const drawing = BRANDS[brand]
  return (
    <svg
      className={cx(s.mark, className)}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fillRule={drawing.evenOdd ? 'evenodd' : 'nonzero'}
      aria-hidden="true"
      focusable="false"
    >
      {drawing.paths.map((p, i) => (
        <path key={i} d={p.d} opacity={p.opacity} />
      ))}
    </svg>
  )
}

export interface BrandChipProps {
  /** Its mark; without one, a plug, as for an agent of the person's own. */
  brand?: Brand
  /** The tile's side, in pixels; the mark is half of it. */
  size?: number
  className?: string
}

/** A mark on a small paper tile, for a product named beside it: an agent, a code host. */
export function BrandChip({ brand, size = 32, className }: BrandChipProps) {
  const mark = Math.round(size / 2)
  return (
    <span className={cx(s.chip, className)} style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }} aria-hidden="true">
      {brand === undefined ? <Icon name="plug" size={mark} /> : <BrandMark brand={brand} size={mark} />}
    </span>
  )
}
