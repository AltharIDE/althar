import { drawGrain, springEasing } from '@althar/ui/opening'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { TRAIN } from '../content/train'
import { useHydrated } from '../lib/browser'
import { cx } from '../lib/cx'
import { Get } from '../shared/Close'
import { addDisplay } from '../home/display'
import { bakeCarriage, type Carriage } from './carriage'
import { AT, distanceAt, lurchAt, pace, speedAt, whenPace } from './journey'
import { clamp, roundRect, seeded, smooth } from './paint'
import s from './TrainHero.module.css'
import { bakeWorld, drawWorld, lightAt, type World } from './world'

/*
 * The first screen, seen from a train: the carriage comes up out of the
 * dark with the train already rolling, slowly, two passengers looking out.
 * The headline rises in the middle window, then the train pulls, gathers
 * speed over a few seconds and is flying, the near ground gone to streaks,
 * and the headline's last word comes in on the speed: "fast."
 *
 * The scene is one canvas: what's outside (world.ts), slid along by the
 * journey's clock (journey.ts), then the carriage over it (carriage.ts),
 * both painted once for the size. Each frame only lays those down. The words
 * are the page's own, over the canvas, in the box the window is drawn
 * round.
 *
 * With reduced motion it is one frame, flying, and the words are simply
 * there; `?t=` in the address holds it at that second.
 */

addDisplay()

/** The frame shown with reduced motion: flat out. */
const STILL_AT = 9.5
/** The most pixels the canvas draws, so a large screen keeps its frame rate. */
const MOST_PIXELS = 3.6e6

const heldAt = () => {
  const t = Number(new URLSearchParams(window.location.search).get('t') ?? Number.NaN)
  if (Number.isFinite(t)) return t
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? STILL_AT : null
}

/** A line's words, each its own piece, so they rise one by one. */
function Words({ text }: { text: string }) {
  const words = text.split(' ')
  return (
    <>
      {words.map((word, i) => (
        <span key={i}>
          <span className={s.word} data-word>
            {word}
          </span>
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </>
  )
}

/** The words rise in, line by line, as the train rolls; the last word waits for the speed. */
function arrive(within: HTMLElement) {
  const rise = springEasing(0.7, 0.82)
  const lines = [...within.querySelectorAll<HTMLElement>('[data-line]')]
  const runs: Animation[] = []
  lines.forEach((line, l) => {
    line.querySelectorAll<HTMLElement>('[data-word]').forEach((word, w) => {
      const delay = (l === 0 ? AT.first : AT.second) * 1000 + w * 90
      runs.push(
        word.animate([{ transform: 'translateY(0.36em)' }, { transform: 'none' }], { ...rise, delay, fill: 'backwards' }),
        word.animate(
          [
            { opacity: 0, filter: 'blur(12px)' },
            { opacity: 1, filter: 'blur(0)' },
          ],
          { duration: 620, delay, easing: 'cubic-bezier(0.33, 1, 0.68, 1)', fill: 'backwards' },
        ),
      )
    })
  })
  // "fast." comes in from ahead of the train, smeared, and lands as the train passes half speed.
  const fast = within.querySelector<HTMLElement>('[data-fast]')
  if (fast) {
    const delay = whenPace(0.5) * 1000
    runs.push(
      fast.animate(
        [
          { transform: 'translateX(60vw) skewX(-18deg) scaleX(1.9)', opacity: 0, filter: 'blur(18px)' },
          { transform: 'translateX(-0.06em) skewX(4deg) scaleX(0.98)', opacity: 1, filter: 'blur(0)', offset: 0.72 },
          { transform: 'none', opacity: 1, filter: 'blur(0)' },
        ],
        { duration: 900, delay, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' },
      ),
    )
  }
  // The rest, each at its own time (data-arrive, in ms from the opening).
  for (const piece of within.querySelectorAll<HTMLElement>('[data-arrive]')) {
    const delay = Number(piece.dataset.arrive || 0)
    runs.push(
      piece.animate([{ transform: 'translateY(14px)' }, { transform: 'none' }], { ...rise, delay, fill: 'backwards' }),
      piece.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 480, delay, easing: 'ease-out', fill: 'backwards' }),
    )
  }
  return runs
}

/** How the carriage rides: rocking slowly and knocking over the rail joints when slow, a fine hum when fast. In CSS px. */
function rideAt(t: number, metres: number, k: number) {
  const p = pace(t)
  const slow = 1 - smooth(0, 0.6, p)
  // Two knocks a rail, 25 m apart, front and back bogie.
  const joint = (metres % 25) / 25
  const knock = (at: number) => Math.exp(-((((joint - at) * 25) / 0.9) ** 2))
  const knocks = (knock(0.1) + knock(0.18) * 0.8) * slow * 1.4
  const rock = Math.sin(t * 2.1) * 0.9 * slow + Math.sin(t * 1.3 + 1) * 0.6
  const hum = (Math.sin(t * 61) * 0.5 + Math.sin(t * 89 + 2) * 0.35) * smooth(0.5, 1, p)
  return { bob: (knocks + rock + hum) * k, lurch: lurchAt(t) * 5 * k }
}

export function TrainHero({ nav }: { nav?: ReactNode } = {}) {
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const pane = useRef<HTMLDivElement>(null)
  const headline = useRef<HTMLHeadingElement>(null)
  const grain = useRef<HTMLDivElement>(null)
  const [drawn, setDrawn] = useState(false)
  const hydrated = useHydrated()

  useLayoutEffect(() => {
    const tile = document.createElement('canvas')
    tile.width = tile.height = 128
    const context = tile.getContext('2d')
    if (!context || !grain.current) return
    drawGrain(context, 128, seeded(7))
    grain.current.style.backgroundImage = `url(${tile.toDataURL()})`
  }, [])

  useEffect(() => {
    const el = root.current
    const cv = canvas.current
    const box = pane.current
    const ctx = cv?.getContext('2d')
    if (!el || !cv || !box || !ctx) return
    const held = heldAt()
    let world: World | null = null
    let carriage: Carriage | null = null
    let size = ''
    let dpr = 1
    let k = 1

    const bake = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      const r = el.getBoundingClientRect()
      const b = box.getBoundingClientRect()
      const next = `${w}x${h}`
      if (next === size || w < 10 || h < 10) return false
      size = next
      dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MOST_PIXELS / (w * h)))
      cv.width = Math.round(w * dpr)
      cv.height = Math.round(h * dpr)
      const win = { x: b.left - r.left, y: b.top - r.top, w: b.width, h: b.height }
      // The horizon's height in the window is the window's own, from its stylesheet: lower on a phone, under the words.
      const horizon = win.y + win.h * (Number.parseFloat(getComputedStyle(box).getPropertyValue('--horizon')) || 0.64)
      const head = headline.current?.getBoundingClientRect()
      const words = head ? { top: head.top - r.top, bottom: head.bottom - r.top } : { top: win.y, bottom: win.y + win.h * 0.4 }
      const view = { w, h, dpr, win, horizon, words }
      k = clamp(win.h / 640, 0.5, 1.4)
      world = bakeWorld(view)
      carriage = bakeCarriage(view)
      return true
    }

    const draw = (t: number) => {
      if (!world || !carriage) return
      const { w, h } = world.view
      const metres = distanceAt(t)
      const speed = speedAt(t)
      const ride = rideAt(t, metres, k)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
      // Outside, through the windows only.
      ctx.save()
      ctx.beginPath()
      for (const b of carriage.windows) roundRect(ctx, b.x - 2, b.y - 2, b.w + 4, b.h + 4, carriage.radius + 2)
      ctx.clip()
      drawWorld(ctx, world, { metres, speed, t, bob: ride.bob })
      ctx.restore()
      // The carriage, and the light it gets through the glass.
      ctx.drawImage(carriage.shadow, ride.lurch, 0, w, h)
      ctx.globalAlpha = lightAt(world, metres)
      ctx.drawImage(carriage.light, ride.lurch, 0, w, h)
      // Up out of the dark.
      const dark = 1 - smooth(AT.open, AT.opened, t)
      if (dark > 0) {
        ctx.globalAlpha = dark
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, w, h)
      }
      ctx.globalAlpha = 1
    }

    bake()
    setDrawn(true)

    let frame = 0
    let start = performance.now()
    let pausedAt: number | null = null
    let seen = true
    const now = () => (performance.now() - start) / 1000
    const tick = () => {
      draw(now())
      frame = requestAnimationFrame(tick)
    }

    // The words: with the train, or there at once when held still.
    const runs = held === null ? arrive(el) : []

    if (held !== null) draw(held)
    else frame = requestAnimationFrame(tick)

    // Off screen it stops, and takes up where it left off when it's back.
    const io = new IntersectionObserver(([e]) => {
      if (held !== null) return
      const was = seen
      seen = e?.isIntersecting ?? true
      if (was && !seen) {
        pausedAt = now()
        cancelAnimationFrame(frame)
        runs.forEach((run) => run.pause())
      } else if (!was && seen) {
        if (pausedAt !== null) start = performance.now() - pausedAt * 1000
        pausedAt = null
        runs.forEach((run) => run.play())
        frame = requestAnimationFrame(tick)
      }
    })
    io.observe(el)

    let timer = 0
    const ro = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        if (bake()) draw(held ?? now())
      }, 120)
    })
    ro.observe(el)

    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      io.disconnect()
      ro.disconnect()
      runs.forEach((run) => run.cancel())
    }
  }, [])

  return (
    <div ref={root} className={s.hero} data-ready={hydrated || undefined} data-drawn={drawn || undefined}>
      <canvas ref={canvas} className={s.scene} aria-hidden="true" />
      <div ref={grain} className={s.grain} aria-hidden="true" />
      <div className={s.vignette} aria-hidden="true" />
      {nav}
      <div ref={pane} className={s.window}>
        <header className={s.head}>
          <p className={s.kicker} data-arrive={AT.first * 1000 - 300}>
            {TRAIN.kicker}
          </p>
          <h1 ref={headline} className={s.h1}>
            <span className={s.line} data-line>
              <Words text={TRAIN.title[0]} />
            </span>{' '}
            <span className={s.line} data-line>
              <Words text={TRAIN.title[1]} />{' '}
              <span className={cx(s.word, s.fast)} data-fast>
                {TRAIN.last}
              </span>
            </span>
          </h1>
          <p className={s.short} data-arrive={AT.rest * 1000 + 80}>
            {TRAIN.short}
          </p>
          <div className={s.ctas} data-arrive={AT.rest * 1000 + 140}>
            <Get tone="blue" />
          </div>
        </header>
      </div>
      <div className={s.foot}>
        <p className={s.lead} data-arrive={AT.rest * 1000 + 220}>
          {TRAIN.lead}
        </p>
        <p className={s.fine} data-arrive={AT.rest * 1000 + 300}>
          {TRAIN.fine}
        </p>
      </div>
    </div>
  )
}
