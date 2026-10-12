import { BORE, clamp, COLUMNS, DOTS, drawGrain, PARTICLES, particleAt, PICTURE, dotAt, pointAt, springEasing } from '@althar/ui/opening'
import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react'

import { HERO } from '../content/home'
import { useHydrated, useMedia } from '../lib/browser'
import { cx } from '../lib/cx'
import { Bar } from '../shared/Bar'
import { drawColumn, heightOf, STOPS, tonesOf } from '../shared/light'
import { Get } from '../shared/Close'
import { addDisplay } from './display'
import s from './Hero.module.css'
import { NameSwap } from './NameSwap'

/*
 * The first screen opens the way the app's window does, in Althar's light.
 * The light floods up off the bottom of the page, broad and cobalt in its
 * middle, and the mark comes up in it as a halftone, in white, dot by dot.
 * Then the dots fall back into the light and the words rise out of it, one
 * by one, the bottom line first: white, in Inter's display cut, light, with
 * only the agent's name heavy. The light stays, its middle reaching just
 * above the words, swaying; it swells a little each time the name turns and
 * lifts under the pointer.
 *
 * The light is measured to the words: tall enough that its strong cobalt
 * stands behind all of them, never up over the bar. With reduced motion, or
 * `?t=` in the address, it is drawn standing and the words are simply there.
 *
 * As in the app (foundations/Light), the light moves on the compositor:
 * each column is drawn once, and only transforms are animated, so nothing
 * else the page does can make it stutter. A column is three boxes, each
 * with one motion: its place lifts under the pointer (a transition), inside
 * it a swell for the name's turn, and inside that the column itself rises
 * on a spring and then sways on a loop of its own. The light's height
 * against the words is one scale on the whole. Only the mark, while it
 * comes up and falls back, is drawn frame by frame.
 */

addDisplay()

/** When the words come in, in ms: the mark set, and seen a moment. */
const OPEN = 1900
/** The mark's canvas, in its 24 grid: the section, with room below for the dots to rise from and fall to. */
const REGION = { x: 1, y: 4.5, width: 22, height: 30 }
/** The bar's height: the light stops short of it. */
const BAR = 64
/** How strongly the grain shows over the light, as the app's home has it (foundations/Light). */
const GRAIN = 0.9

const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches || new URLSearchParams(window.location.search).has('t')

/** A line's words, each its own piece, so they rise one by one and keep their kerning. */
function Words({ text, className }: { text: string; className?: string }) {
  const words = text.split(' ')
  return (
    <>
      {words.map((word, i) => (
        <span key={i}>
          <span className={cx(s.word, className)} data-word>
            {word}
          </span>
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </>
  )
}

/**
 * The words rise out of the light: the headline's lowest line first, word by
 * word, then the lines above it; then the rest, top to bottom.
 */
const arrive = (within: HTMLElement, at: number) => {
  const rise = springEasing(0.7, 0.82)
  const lines = [...within.querySelectorAll<HTMLElement>('[data-line]')]
  lines.forEach((line, l) => {
    line.querySelectorAll<HTMLElement>('[data-word]').forEach((word, w) => {
      const delay = at + 60 + (lines.length - 1 - l) * 120 + w * 60
      word.animate([{ transform: 'translateY(0.42em)' }, { transform: 'none' }], {
        duration: rise.duration,
        delay,
        easing: rise.easing,
        fill: 'backwards',
      })
      word.animate(
        [
          { opacity: 0, filter: 'blur(14px)' },
          { opacity: 1, filter: 'blur(0)' },
        ],
        {
          duration: 520,
          delay,
          easing: 'cubic-bezier(0.33, 1, 0.68, 1)',
          fill: 'backwards',
        },
      )
    })
  })
  const after = at + 60 + lines.length * 120 + 160
  const box = within.getBoundingClientRect()
  for (const piece of within.querySelectorAll<HTMLElement>('[data-arrive]')) {
    const delay = after + clamp((piece.getBoundingClientRect().top - box.top) / Math.max(1, window.innerHeight)) * 260
    piece.animate([{ transform: 'translateY(16px)' }, { transform: 'none' }], {
      duration: rise.duration,
      delay,
      easing: rise.easing,
      fill: 'backwards',
    })
    piece.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, delay, easing: 'ease-out', fill: 'backwards' })
  }
}

/** The same small unevenness every time, 0 to 1, for column `i` and a stream `n`. */
const vary = (i: number, n: number) => {
  const v = Math.sin(i * 12.9898 + n * 78.233 + 1.7) * 43758.5453
  return v - Math.floor(v)
}

/** How the light moves, in ms and shares of a column's height. */
const MOTION = {
  /** Up on a spring, the middle first. */
  rise: { start: 40, spread: 300, ...springEasing(1.05, 0.86) },
  /** Each column's sway: taller and shorter on two beats, leaning either way, over a loop of its own. */
  sway: { length: 5200, slower: 3400, tall: 0.05, taller: 0.035, lean: 9 },
  /** Each time the name turns, taller, most in the middle. */
  swell: { length: 2100, by: 0.12 },
  /** Under the pointer: how much it lifts (of the hero's height) and how wide. How slowly it follows is the place's transition (Hero.module.css). */
  lift: { by: 0.3, wide: 0.11 },
}

/** A column's loop of sway, from where it stands and back: sampled, as the compositor runs keyframes in straight lines. */
const swayOf = (i: number, rest: number): Keyframe[] => {
  const { tall, taller, lean } = MOTION.sway
  const steps = 24
  const way = vary(i, 3) < 0.5 ? -1 : 1
  const reach = lean * (0.6 + 0.4 * vary(i, 4))
  return Array.from({ length: steps + 1 }, (_, n) => {
    const a = (n / steps) * Math.PI * 2
    const height = rest * (1 + tall * Math.sin(a) + way * taller * Math.sin(2 * a))
    return { transform: `translateX(${(way * reach * Math.sin(a)).toFixed(2)}px) scaleY(${height.toFixed(4)})` }
  })
}

const SWELL_STEPS = 12

export function Hero({ nav }: { nav?: ReactNode } = {}) {
  const root = useRef<HTMLDivElement>(null)
  const light = useRef<HTMLDivElement>(null)
  const places = useRef<Array<HTMLSpanElement | null>>([])
  const swells = useRef<Array<HTMLSpanElement | null>>([])
  const columns = useRef<Array<HTMLCanvasElement | null>>([])
  const grain = useRef<HTMLDivElement>(null)
  const mark = useRef<HTMLCanvasElement>(null)
  const headline = useRef<HTMLHeadingElement>(null)
  /** When the hero opened, on the page's clock, and whether the light has risen once. */
  const opened = useRef<number | null>(null)
  /** Swells the name's turn, from the effect that knows the light. */
  const swell = useRef<() => void>(() => undefined)
  /** The light's heart: wider on a phone, to hold the words, with sky and warmth still at its sides. */
  const heart = useMedia('(max-width: 699px)') ? 0.7 : 0.46
  const hydrated = useHydrated()

  useLayoutEffect(() => {
    const live = (root.current && getComputedStyle(root.current).getPropertyValue('--live').trim()) || undefined
    COLUMNS.forEach((column, i) => {
      const canvas = columns.current[i]
      const tones = tonesOf(column.d, heart)
      // The middle's foot is the page's --live, as the mark's dots are.
      if (canvas) drawColumn(canvas, tones[0] === '#2b3bff' && live ? [live, tones[1], tones[2]] : tones)
    })
    const tile = document.createElement('canvas')
    tile.width = tile.height = 128
    const context = tile.getContext('2d')
    if (context && grain.current) {
      drawGrain(context, 128)
      grain.current.style.backgroundImage = `url(${tile.toDataURL()})`
    }
  }, [heart])

  useEffect(() => {
    const el = root.current
    const whole = light.current
    if (!el || !whole) return
    const fast = still()
    const first = opened.current === null
    if (first) opened.current = performance.now()
    const since = () => performance.now() - (opened.current ?? 0)
    const rests = COLUMNS.map((column) => heightOf(column, heart))

    /*
     * How tall the light stands, as a share of how the launch has it: its
     * strong part reaching just above the words, its top short of the bar.
     * Read from the headline, which the words' arrival doesn't move.
     */
    let level = 1
    const middle = heightOf(COLUMNS[Math.floor(COLUMNS.length / 2)]!, heart)
    const measure = () => {
      const h = el.clientHeight
      const top = (headline.current?.getBoundingClientRect().top ?? 0) - el.getBoundingClientRect().top
      const floor = h * 1.04
      const tallest = Math.min((floor - top + 24) / STOPS[1], floor - BAR)
      level = clamp(tallest / h / middle, 0.5, 3)
      whole.style.transform = `scaleY(${level.toFixed(4)})`
    }
    measure()
    void document.fonts.ready.then(measure)
    const ro = new ResizeObserver(measure)
    ro.observe(el)

    /*
     * The light rises, then sways, each column on its own beat, all on the
     * compositor. One animation at a time on each column: the browser
     * moves a box off the main thread only while nothing else animates the
     * same property on it, so the rise is set down as the column's own
     * style when it ends, and only then does the sway start.
     */
    let live = true
    const runs = new Set<Animation>()
    const { rise } = MOTION
    const sway = (node: HTMLCanvasElement, i: number, after: number) => {
      const length = MOTION.sway.length + vary(i, 1) * MOTION.sway.slower
      const run = node.animate(swayOf(i, rests[i]!), { duration: length, delay: after + vary(i, 2) * length * 0.5, iterations: Infinity })
      if (!seen) run.pause()
      runs.add(run)
    }
    let seen = true
    COLUMNS.forEach((column, i) => {
      const node = columns.current[i]
      if (!node) return
      const stand = `translateX(0px) scaleY(${rests[i]!.toFixed(4)})`
      // Risen already (the page changed size across a phone's width), or held still, it stands at once.
      if (fast || !first) {
        node.style.transform = stand
        if (!fast) sway(node, i, 0)
        return
      }
      const up = node.animate([{ transform: 'translateX(0px) scaleY(0)' }, { transform: stand }], {
        duration: rise.duration,
        delay: rise.start + column.d * rise.spread,
        easing: rise.easing,
        fill: 'forwards',
      })
      runs.add(up)
      void up.finished.then(
        () => {
          if (!live) return
          node.style.transform = stand
          up.cancel()
          runs.delete(up)
          sway(node, i, 0)
        },
        () => undefined,
      )
    })
    if (grain.current) {
      if (fast || !first) grain.current.style.opacity = String(GRAIN)
      else runs.add(grain.current.animate([{ opacity: 0 }, { opacity: GRAIN }], { ...springEasing(1, 1), delay: 200, fill: 'both' }))
    }

    // The name's turn swells it, a breath up and back, most in the middle.
    const swelling: Array<Animation | undefined> = []
    swell.current = () => {
      if (fast) return
      COLUMNS.forEach((column, i) => {
        const node = swells.current[i]
        if (!node) return
        const by = MOTION.swell.by * (1 - column.d)
        swelling[i]?.cancel()
        swelling[i] = node.animate(
          Array.from({ length: SWELL_STEPS + 1 }, (_, n) => ({
            transform: `scaleY(${(1 + by * Math.sin((Math.PI * n) / SWELL_STEPS)).toFixed(4)})`,
          })),
          { duration: MOTION.swell.length },
        )
      })
    }

    /*
     * Under the pointer it lifts, the columns nearest it most. Each column's
     * place follows on a transition the compositor runs; the pointer only
     * says where to, and only when that has changed.
     */
    const lifted = COLUMNS.map(() => 1)
    let pointer: number | null = null
    let asked = 0
    const lift = () => {
      asked = 0
      const { by, wide } = MOTION.lift
      COLUMNS.forEach((column, i) => {
        const node = places.current[i]
        if (!node) return
        const up = pointer === null ? 0 : by * Math.exp(-(((column.left / 100 - pointer) / wide) ** 2))
        // In the column's own measure: the lift is of the hero's height, the column stands rests[i] × level of it.
        const k = 1 + up / (rests[i]! * level)
        if (Math.abs(k - lifted[i]!) < 0.003) return
        lifted[i] = k
        node.style.transform = k === 1 ? '' : `scaleY(${k.toFixed(4)})`
      })
    }
    const move = (e: PointerEvent) => {
      // Not until the words are in and the light has settled.
      if (e.pointerType !== 'mouse' || fast || since() < OPEN + 1500) return
      const r = el.getBoundingClientRect()
      // The light runs 8% past either side. In steps of half a percent: finer, nobody sees, and each step restyles the columns.
      const at = Math.round((((e.clientX - r.left) / r.width + 0.08) / 1.16) * 200) / 200
      if (at === pointer) return
      pointer = at
      if (!asked) asked = requestAnimationFrame(lift)
    }
    const leave = () => {
      pointer = null
      if (!asked) asked = requestAnimationFrame(lift)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', leave)

    // Off screen, the sway rests where it was.
    const io = new IntersectionObserver(([e]) => {
      seen = e?.isIntersecting ?? true
      for (const run of runs) {
        if (run.effect?.getTiming().iterations !== Infinity) continue
        if (seen) run.play()
        else run.pause()
      }
    })
    io.observe(el)

    return () => {
      live = false
      runs.forEach((run) => run.cancel())
      swelling.forEach((run) => run?.cancel())
      swell.current = () => undefined
      cancelAnimationFrame(asked)
      io.disconnect()
      ro.disconnect()
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', leave)
    }
  }, [heart])

  // The words come in once, as the mark falls back.
  useEffect(() => {
    if (root.current && !still()) arrive(root.current, OPEN)
  }, [])

  // The mark comes up in the light as a halftone and falls back into it: drawn frame by frame, for its few seconds only.
  useEffect(() => {
    const el = root.current
    const canvas = mark.current
    const context = canvas?.getContext('2d') ?? null
    if (!el || !canvas || !context || still()) return
    const place = () => {
      const width = el.clientWidth
      const height = Math.min(el.clientHeight, window.innerHeight)
      const k = clamp(Math.min(width, height) * 0.0125, 6.5, 11)
      const scale = k * (window.devicePixelRatio || 1)
      canvas.style.left = `${width / 2 + (REGION.x - BORE.x) * k}px`
      canvas.style.top = `${height * 0.44 + (REGION.y - BORE.y) * k}px`
      canvas.style.width = `${REGION.width * k}px`
      canvas.style.height = `${REGION.height * k}px`
      canvas.width = Math.round(REGION.width * scale)
      canvas.height = Math.round(REGION.height * scale)
      return { k, scale }
    }
    const { k, scale } = place()
    const start = performance.now()
    let frame = 0
    const draw = (now: number) => {
      const t = now - start
      context.setTransform(scale, 0, 0, scale, -REGION.x * scale, -REGION.y * scale)
      context.clearRect(REGION.x, REGION.y, REGION.width, REGION.height)
      if (t > OPEN + 900) return
      // In the cobalt, the mark comes up white.
      context.fillStyle = '#ffffff'
      const least = 0.6 / k
      const speck = (item: { x: number; y: number; r: number; alpha: number } | null, floor = 0) => {
        if (item === null) return
        context.globalAlpha = item.alpha
        context.beginPath()
        context.arc(item.x, item.y, Math.max(item.r, floor), 0, Math.PI * 2)
        context.fill()
      }
      for (const dot of DOTS) speck(dotAt(dot, t, OPEN), least)
      for (let i = 0; i < PARTICLES.length; i++) speck(particleAt(i, t))
      speck(pointAt(t, OPEN))
      context.globalAlpha = 1
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [])

  const onTurn = () => swell.current()

  return (
    <div ref={root} className={s.hero} data-ready={hydrated || undefined}>
      <div ref={light} className={s.light} aria-hidden="true">
        {COLUMNS.map((column) => {
          // The picture is wider than the column, by the blur's reach either side.
          const width = (column.width * PICTURE.width) / PICTURE.column
          return (
            <span
              key={column.i}
              ref={(node) => void (places.current[column.i] = node)}
              className={s.place}
              style={{ left: `${column.left - width / 2}%`, width: `${width}%` }}
            >
              <span ref={(node) => void (swells.current[column.i] = node)} className={s.swell}>
                <canvas
                  ref={(node) => void (columns.current[column.i] = node)}
                  className={s.column}
                  width={PICTURE.width}
                  height={PICTURE.height}
                />
              </span>
            </span>
          )
        })}
      </div>
      <div ref={grain} className={s.grain} aria-hidden="true" />
      <canvas ref={mark} className={s.mark} aria-hidden="true" />

      <div data-arrive>{nav === undefined ? <Bar tone="paper" /> : nav}</div>
      <header className={s.head}>
        {/* The spaces between the lines don't show, as the lines are blocks; they keep the words apart for anything that reads the text alone. */}
        <h1 ref={headline} className={s.h1}>
          <span className={cx(s.line, s.pay)} data-line>
            <Words text={HERO.pay} />
          </span>{' '}
          <span className={cx(s.line, s.who)} data-line>
            <span className={s.word} data-word>
              <NameSwap names={HERO.names} nameClass={s.name} onTurn={onTurn} after={OPEN + 900} />
            </span>
          </span>{' '}
          <span className={s.line} data-line>
            <Words text={HERO.use[0]} />
          </span>{' '}
          <span className={s.line} data-line>
            <Words text={HERO.use[1]} className={s.accent} />
          </span>
        </h1>
        <p className={s.lead} data-arrive>
          <span className={s.long}>{HERO.lead}</span>
          <span className={s.short}>{HERO.short}</span>
        </p>
        <div className={s.ctas} data-arrive>
          <Get tone="blue" />
        </div>
        <p className={s.fine} data-arrive>
          {HERO.fine}
        </p>
      </header>
    </div>
  )
}
