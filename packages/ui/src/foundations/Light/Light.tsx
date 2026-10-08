import { useEffect, useLayoutEffect, useRef } from 'react'

import { cx } from '../../lib/cx'
import { reducedMotion } from '../../lib/motion'
import type { RootProps } from '../../lib/props'
import { springEasing } from '../../lib/spring'
import { COLUMNS, type Column, drawColumn, drawGrain, PICTURE } from './columns'
import s from './Light.module.css'

/*
 * Althar's light, standing at the foot of what holds it: the columns the
 * window opens in (screens/Launch), kept lower, for a screen at rest. It
 * rises once, the middle first, on a spring. Then it drifts: each column
 * rises and settles on a rhythm of its own and brightens and dims on
 * another, leaning a little as it goes, and the whole light sways slowly,
 * as an aurora's curtains do. Told to sink, it lies down from the edges in,
 * from wherever it stood.
 *
 * Everything moves on the compositor: each column is drawn once, soft
 * already, and only its transform and opacity are animated. The drift rests
 * while the window is behind others or hidden, and with motion reduced the
 * light just stands. Decoration: hidden from assistive technology.
 *
 * It fills the nearest positioned ancestor, a little wider than it so its
 * edges are never seen to end; that ancestor clips it.
 */

export type LightMotion = 'drift' | 'still'

export type LightProps = RootProps<
  'div',
  {
    /** How tall it stands against the launch's light, 0 to 1. */
    height?: number
    /** How it moves once it stands. With motion reduced it is still whatever this says. */
    motion?: LightMotion
    /** Lie down, from the edges in. */
    sink?: boolean
    /** It has lain down. */
    onSunk?: () => void
  }
>

/** How the light moves, in ms and shares of a column's height. */
export const LIGHT = {
  rise: { start: 120, spread: 340, response: 0.9, damping: 0.86 },
  sink: { length: 520, spread: 160 },
  /** A column rises by this share of its height, plus up to `more`, over `length` plus up to `slower`. */
  breathe: { up: 0.22, more: 0.25, length: 4600, slower: 3600, lean: 70 },
  glow: { low: 0.62, lower: 0.14, length: 5200, slower: 4000 },
  sway: { length: 17000, reach: 1.6 },
} as const

/** The same small unevenness every time, 0 to 1, for column `i` and a stream `n`. */
export const vary = (i: number, n: number) => {
  const v = Math.sin(i * 12.9898 + n * 78.233 + 1.7) * 43758.5453
  return v - Math.floor(v)
}

interface Drift {
  readonly frames: Keyframe[]
  readonly duration: number
  /** How long after it stands it starts, so the columns don't move in step. */
  readonly after: number
}

/** How a column drifts once it stands at `to`: each from rest, on its own beat. */
export const driftOf = (column: Column, to: number): ReadonlyArray<Drift> => {
  const { breathe, glow } = LIGHT
  const rest = `translateX(0px) scaleY(${to})`
  const length = breathe.length + vary(column.i, 4) * breathe.slower
  return [
    {
      frames: [
        { transform: rest },
        {
          transform: `translateX(${((vary(column.i, 2) - 0.5) * breathe.lean).toFixed(1)}px) scaleY(${to * (1 + breathe.up + vary(column.i, 1) * breathe.more)})`,
          offset: 0.42 + vary(column.i, 3) * 0.16,
        },
        { transform: rest },
      ],
      duration: length,
      after: vary(column.i, 5) * length * 0.6,
    },
    {
      frames: [{ opacity: 1 }, { opacity: glow.low + vary(column.i, 6) * glow.lower }, { opacity: 1 }],
      duration: glow.length + vary(column.i, 7) * glow.slower,
      after: vary(column.i, 8) * 3000,
    },
  ]
}

const canAnimate = (element: Element | null): element is HTMLElement =>
  element !== null && typeof (element as HTMLElement).animate === 'function'

export function Light({ height = 0.62, motion = 'drift', sink = false, onSunk, className, ...rest }: LightProps) {
  const root = useRef<HTMLDivElement>(null)
  const columns = useRef<Array<HTMLCanvasElement | null>>([])
  const grain = useRef<HTMLDivElement>(null)
  // What moves it now. Handed over, not cancelled, when it sinks, so it sinks from where it stood.
  const moving = useRef<Animation[]>([])
  const sunk = useRef(onSunk)
  useEffect(() => void (sunk.current = onSunk), [onSunk])

  // Each column drawn once, soft already, and the grain.
  useLayoutEffect(() => {
    const live = (root.current && getComputedStyle(root.current).getPropertyValue('--live').trim()) || undefined
    COLUMNS.forEach((column, i) => {
      const context = columns.current[i]?.getContext('2d')
      if (context) drawColumn(context, column, live)
    })
    const tile = document.createElement('canvas')
    tile.width = tile.height = 128
    const context = tile.getContext('2d')
    if (context && grain.current) {
      drawGrain(context, 128)
      grain.current.style.backgroundImage = `url(${tile.toDataURL()})`
    }
  }, [])

  useEffect(() => () => moving.current.forEach((run) => run.cancel()), [])

  useEffect(() => {
    const still = motion === 'still' || reducedMotion()
    const quick = reducedMotion()
    const stood = columns.current
      .map((element) => (element ? getComputedStyle(element) : null))
      .map((style) => style && { transform: style.transform, opacity: style.opacity })
    const swayed = root.current ? getComputedStyle(root.current).transform : 'none'
    moving.current.forEach((run) => run.cancel())
    const runs: Animation[] = []
    moving.current = runs

    if (sink) {
      const last: Array<Animation> = []
      if (canAnimate(root.current) && swayed !== 'none' && swayed !== '')
        runs.push(root.current.animate([{ transform: swayed }, { transform: swayed }], { duration: 1, fill: 'forwards' }))
      COLUMNS.forEach((column, i) => {
        const element = columns.current[i] ?? null
        if (!canAnimate(element)) return
        const now = stood[i]
        const from = {
          transform: now && now.transform !== 'none' ? now.transform : `scaleY(${column.height * height})`,
          opacity: now?.opacity || '1',
        }
        const run = element.animate([from, { transform: 'scaleY(0)', opacity: from.opacity }], {
          duration: quick ? 1 : LIGHT.sink.length,
          delay: quick ? 0 : (1 - column.d) * LIGHT.sink.spread,
          easing: 'cubic-bezier(0.5, 0, 0.75, 0)',
          fill: 'both',
        })
        runs.push(run)
        last.push(run)
      })
      if (last.length === 0) sunk.current?.()
      else
        void Promise.all(last.map((run) => run.finished)).then(
          () => sunk.current?.(),
          () => undefined,
        )
      return
    }

    const spring = springEasing(LIGHT.rise.response, LIGHT.rise.damping)
    COLUMNS.forEach((column, i) => {
      const element = columns.current[i] ?? null
      if (!canAnimate(element)) return
      const to = column.height * height
      // The middle first, the edges after.
      const delay = quick ? 0 : LIGHT.rise.start + column.d * LIGHT.rise.spread
      runs.push(
        element.animate([{ transform: 'scaleY(0)' }, { transform: `translateX(0px) scaleY(${to})` }], {
          duration: quick ? 1 : spring.duration,
          delay,
          easing: spring.easing,
          fill: 'both',
        }),
      )
      if (still) return
      for (const drift of driftOf(column, to))
        runs.push(
          element.animate(drift.frames, {
            duration: drift.duration,
            delay: delay + spring.duration + drift.after,
            iterations: Infinity,
            easing: 'ease-in-out',
          }),
        )
    })
    if (!still && canAnimate(root.current)) {
      const { reach, length } = LIGHT.sway
      runs.push(
        root.current.animate(
          [
            { transform: 'translateX(0%)' },
            { transform: `translateX(${reach}%)` },
            { transform: `translateX(${-reach * 0.9}%)` },
            { transform: 'translateX(0%)' },
          ],
          { duration: length, delay: 900, iterations: Infinity, easing: 'ease-in-out' },
        ),
      )
    }

    // The drift rests while the window is behind others or hidden.
    const forever = runs.filter((run) => run.effect?.getTiming().iterations === Infinity)
    if (forever.length === 0) return
    const rest = () => forever.forEach((run) => run.pause())
    const wake = () => {
      if (document.visibilityState !== 'hidden') forever.forEach((run) => run.play())
    }
    window.addEventListener('blur', rest)
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      window.removeEventListener('blur', rest)
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [height, motion, sink])

  return (
    <div ref={root} className={cx(s.light, className)} aria-hidden="true" {...rest}>
      {COLUMNS.map((column) => {
        // The picture is wider than the column, by the blur's reach either side.
        const width = (column.width * PICTURE.width) / PICTURE.column
        return (
          <canvas
            key={column.i}
            ref={(element) => void (columns.current[column.i] = element)}
            className={s.column}
            width={PICTURE.width}
            height={PICTURE.height}
            style={{ left: `${column.left - width / 2}%`, width: `${width}%` }}
          />
        )
      })}
      <div ref={grain} className={s.grain} />
    </div>
  )
}
