import { cx } from '../../lib/cx'
import { Brand, BRANDS } from '../brands/brands'
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
