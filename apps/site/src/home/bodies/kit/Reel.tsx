import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'

import { cx } from '../../../lib/cx'
import s from './Reel.module.css'

/*
 * A few pictures on one screen, one after another while it is in view, the
 * way a short film plays: each stays its time, then the next comes in over
 * it. Under the screen, a line each with its name, filling while it plays;
 * any can be picked, and pointing at the screen holds it. With motion
 * reduced, or `?t=` in the address, it stands on the first.
 */

export interface ReelMoment {
  /** Its name, under the screen. */
  label: string
  /** A small word before the name: a time, a place. */
  at?: string
  /** How long it stays, in ms. */
  stays: number
  /** The picture, told whether it is the one showing now. */
  render: (active: boolean) => ReactNode
}

const still = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(prefers-reduced-motion: reduce)').matches || new URLSearchParams(window.location.search).has('t'))

export function Reel({
  moments,
  className,
  frame,
  tone = 'paper',
  onChange,
}: {
  moments: readonly ReelMoment[]
  className?: string
  /** The screen's look, around the pictures. */
  frame?: string
  tone?: 'paper' | 'ink'
  onChange?: (at: number) => void
}) {
  const [at, setAt] = useState(0)
  const [was, setWas] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [held, setHeld] = useState(false)
  const stage = useRef<HTMLDivElement>(null)
  const moving = !still()

  useEffect(() => {
    const el = stage.current
    if (!el || !moving) return
    const io = new IntersectionObserver(([e]) => setPlaying(e?.isIntersecting ?? false), { threshold: 0.4 })
    io.observe(el)
    return () => io.disconnect()
  }, [moving])

  const go = (i: number) => {
    setWas(at)
    setAt(i)
    onChange?.(i)
  }

  useEffect(() => {
    if (!playing || held) return
    const timer = window.setTimeout(() => go((at + 1) % moments.length), moments[at]!.stays)
    return () => window.clearTimeout(timer)
  })

  useEffect(() => {
    if (was === null) return
    const timer = window.setTimeout(() => setWas(null), 700)
    return () => window.clearTimeout(timer)
  }, [was])

  const shown = [...new Set([was, at].filter((x): x is number => x !== null))]
  return (
    <div className={cx(s.reel, tone === 'ink' && s.ink, className)}>
      <div ref={stage} className={cx(s.stage, frame)} onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)}>
        {shown.map((i) => (
          <div key={i} className={cx(s.layer, i === at ? s.in : s.out)}>
            {moments[i]!.render(i === at)}
          </div>
        ))}
      </div>
      <ol className={s.moments} style={{ '--n': moments.length } as CSSProperties}>
        {moments.map((m, i) => (
          <li key={m.label}>
            <button
              type="button"
              className={cx(s.moment, i === at && s.current, i < at && s.past)}
              aria-current={i === at ? 'step' : undefined}
              onClick={() => go(i)}
            >
              <span className={s.track}>
                <i
                  key={`${at}-${i}`}
                  style={
                    { animationDuration: `${m.stays}ms`, animationPlayState: playing && !held ? 'running' : 'paused' } as CSSProperties
                  }
                />
              </span>
              {m.at && <time>{m.at}</time>}
              <span className={s.label}>{m.label}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
