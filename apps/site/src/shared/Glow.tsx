import { COLUMNS, PICTURE } from '@althar/ui/opening'
import { type CSSProperties, useLayoutEffect, useRef } from 'react'

import { cx } from '../lib/cx'
import { drawColumn, heightOf, tonesOf } from './light'
import s from './Glow.module.css'

/*
 * The site's light, standing: the first screen's columns, graded cobalt to
 * warm, at their heights, each breathing a little on a beat of its own.
 * It fills the nearest positioned ancestor, a little wider than it, and
 * stands on its floor; that ancestor clips it. `heart` is how wide the
 * cobalt is, 0 to 1. With reduced motion it holds still. Decoration.
 */

const vary = (i: number, n: number) => {
  const v = Math.sin(i * 12.9898 + n * 78.233 + 1.7) * 43758.5453
  return v - Math.floor(v)
}

export function Glow({ heart = 0.5, className }: { heart?: number; className?: string }) {
  const columns = useRef<Array<HTMLCanvasElement | null>>([])
  useLayoutEffect(() => {
    COLUMNS.forEach((column, i) => {
      const context = columns.current[i]?.getContext('2d')
      if (context) drawColumn(context, tonesOf(column.d, heart))
    })
  }, [heart])
  return (
    <div className={cx(s.glow, className)} aria-hidden="true">
      {COLUMNS.map((column) => {
        const width = (column.width * PICTURE.width) / PICTURE.column
        return (
          <canvas
            key={column.i}
            ref={(node) => void (columns.current[column.i] = node)}
            className={s.column}
            width={PICTURE.width}
            height={PICTURE.height}
            style={
              {
                left: `${column.left - width / 2}%`,
                width: `${width}%`,
                '--h': heightOf(column, heart).toFixed(3),
                '--up': (1.06 + 0.08 * vary(column.i, 1)).toFixed(3),
                '--beat': `${(5200 + vary(column.i, 2) * 4200).toFixed(0)}ms`,
                '--after': `${(-vary(column.i, 3) * 8000).toFixed(0)}ms`,
              } as CSSProperties
            }
          />
        )
      })}
    </div>
  )
}
