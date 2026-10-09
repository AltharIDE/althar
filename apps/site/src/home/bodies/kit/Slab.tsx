import { Light } from '@althar/ui'
import { type ReactNode, useEffect, useRef } from 'react'

import { cx } from '../../../lib/cx'
import { Shot, type ShotProps } from './Shot'
import s from './Slab.module.css'

/*
 * A piece of the app as a slim slab held up at an angle: it shows its edge,
 * floats a little, and leans toward the pointer, a few degrees at most. Under
 * it, Althar's light. With a touch screen or reduced motion it holds still.
 */

export function Slab({
  children,
  side = 'right',
  light = true,
  className,
  ...shot
}: Omit<ShotProps, 'frame' | 'children'> & { children: ReactNode; side?: 'left' | 'right'; light?: boolean }) {
  const stage = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = stage.current
    if (!el || !window.matchMedia('(hover: hover) and (prefers-reduced-motion: no-preference)').matches) return
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      el.style.setProperty('--tx', (((e.clientX - r.left) / r.width - 0.5) * 2).toFixed(3))
      el.style.setProperty('--ty', (((e.clientY - r.top) / r.height - 0.5) * 2).toFixed(3))
    }
    const leave = () => {
      el.style.removeProperty('--tx')
      el.style.removeProperty('--ty')
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', leave)
    return () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', leave)
    }
  }, [])
  return (
    <div ref={stage} className={cx(s.slabStage, side === 'left' ? s.toLeft : s.toRight, className)}>
      {light && (
        <div className={s.slabLight} aria-hidden="true">
          <Light height={0.55} />
        </div>
      )}
      <div className={s.float}>
        <Shot {...shot} frame={s.slab}>
          {children}
        </Shot>
      </div>
    </div>
  )
}
