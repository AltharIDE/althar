import {
  BORE,
  clamp,
  type Column,
  COLUMNS,
  DOTS,
  drawGrain,
  jitter,
  PARTICLES,
  particleAt,
  PICTURE,
  dotAt,
  pointAt,
  spring,
  springEasing,
} from '@althar/ui/opening'
import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react'

import { HERO } from '../content/home'
import { cx } from '../lib/cx'
import { Bar } from '../shared/Bar'
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
 */

addDisplay()

/** When the words come in, in ms: the mark set, and seen a moment. */
const OPEN = 1900
/** The mark's canvas, in its 24 grid: the section, with room below for the dots to rise from and fall to. */
const REGION = { x: 1, y: 4.5, width: 22, height: 30 }
/** The bar's height: the light stops short of it. */
const BAR = 64

type Tones = readonly [string, string, string]

/**
 * The light's colours, bottom to top, by how far a column is from the middle:
 * a broad cobalt heart, strong most of the way up so white words read in it,
 * paler out to warm at the edges. `heart` is how wide it is, 0 to 1.
 */
const tonesOf = (d: number, heart: number): Tones =>
  d < heart
    ? ['#2b3bff', '#3042ff', '#5868ff']
    : d < heart + 0.18
      ? ['#3550ff', '#5f86ff', '#bcd2ff']
      : d < 0.86
        ? ['#9fc6ff', '#d4e6ff', '#f3f7ff']
        : ['#ffb995', '#ffd8c0', '#fff3ea']

/** How tall a column stands, as a share of the page: flat across the heart, then falling away, an arch. */
const heightOf = (column: Column, heart: number) =>
  (0.2 + 0.46 * Math.exp(-(Math.max(0, column.d - heart * 0.74) ** 2) * 7)) * (0.94 + 0.06 * jitter(column.i))

/** Where a column's colours change, up its height: strong to 55%, its high tone at 90%, gone at its top. */
const STOPS = [0.55, 0.9, 1] as const

/** A column drawn once, soft already, as the launch draws its own (foundations/Light), in this light's colours. */
const drawColumn = (context: CanvasRenderingContext2D, tones: Tones) => {
  const { width, height, column: inner, blur } = PICTURE
  const left = (width - inner) / 2
  const cap = height * 0.22
  const fill = context.createLinearGradient(0, height, 0, 0)
  fill.addColorStop(0, tones[0])
  fill.addColorStop(STOPS[0], tones[1])
  fill.addColorStop(STOPS[1], tones[2])
  fill.addColorStop(STOPS[2], 'rgba(255, 255, 255, 0)')
  context.clearRect(0, 0, width, height)
  context.filter = `blur(${blur}px)`
  context.fillStyle = fill
  context.beginPath()
  // Past the bottom, so the blur doesn't lift it off the floor; round at the top.
  context.moveTo(left, height + blur * 3)
  context.lineTo(left, cap)
  context.ellipse(left + inner / 2, cap, inner / 2, cap, 0, Math.PI, 0)
  context.lineTo(left + inner, height + blur * 3)
  context.closePath()
  context.fill()
}

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

export function Hero({ nav }: { nav?: ReactNode } = {}) {
  const root = useRef<HTMLDivElement>(null)
  const columns = useRef<Array<HTMLCanvasElement | null>>([])
  const grain = useRef<HTMLDivElement>(null)
  const mark = useRef<HTMLCanvasElement>(null)
  const headline = useRef<HTMLHeadingElement>(null)
  /** When the name last turned, in the hero's time. */
  const turned = useRef(-1e9)
  const clock = useRef(0)
  /** The light's heart: wider on a phone, to hold the words. */
  const heart = typeof window !== 'undefined' && window.innerWidth < 700 ? 0.86 : 0.5

  useLayoutEffect(() => {
    const live = (root.current && getComputedStyle(root.current).getPropertyValue('--live').trim()) || undefined
    COLUMNS.forEach((column, i) => {
      const context = columns.current[i]?.getContext('2d')
      const tones = tonesOf(column.d, heart)
      // The middle's foot is the page's --live, as the mark's dots are.
      if (context) drawColumn(context, tones[0] === '#2b3bff' && live ? [live, tones[1], tones[2]] : tones)
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
    const canvas = mark.current
    const context = canvas?.getContext('2d') ?? null
    if (!el || !canvas || !context) return
    const fast = still()

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
    }
    measure()
    void document.fonts.ready.then(measure)
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (!fast) arrive(el, OPEN)

    let placed = ''
    let markGone = fast
    const drawMark = (t: number) => {
      const width = el.clientWidth
      const height = Math.min(el.clientHeight, window.innerHeight)
      const k = clamp(Math.min(width, height) * 0.0125, 6.5, 11)
      const scale = k * (window.devicePixelRatio || 1)
      const where = `${width}x${height}@${scale}`
      if (where !== placed) {
        placed = where
        canvas.style.left = `${width / 2 + (REGION.x - BORE.x) * k}px`
        canvas.style.top = `${height * 0.44 + (REGION.y - BORE.y) * k}px`
        canvas.style.width = `${REGION.width * k}px`
        canvas.style.height = `${REGION.height * k}px`
        canvas.width = Math.round(REGION.width * scale)
        canvas.height = Math.round(REGION.height * scale)
      }
      context.setTransform(scale, 0, 0, scale, -REGION.x * scale, -REGION.y * scale)
      context.clearRect(REGION.x, REGION.y, REGION.width, REGION.height)
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
    }

    // The pointer, across the light (0 to 1), and how present it is, eased toward.
    const hand = { x: 0.5, on: 0, want: 0, wantX: 0.5 }
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const r = el.getBoundingClientRect()
      // The light runs 8% past either side.
      hand.wantX = ((e.clientX - r.left) / r.width + 0.08) / 1.16
      hand.want = 1
    }
    const leave = () => void (hand.want = 0)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', leave)

    const drawLight = (t: number) => {
      hand.on += (hand.want - hand.on) * 0.04
      hand.x += (hand.wantX - hand.x) * 0.06
      const settled = clamp((t - OPEN) / 1500)
      const since = t - turned.current
      const swell = since > 0 && since < 2400 ? Math.sin((Math.PI * since) / 2400) : 0
      COLUMNS.forEach((column, i) => {
        const node = columns.current[i]
        if (!node) return
        const up = spring(t - (40 + column.d * 300), 1.05, 0.86)
        const sway = 1 + 0.05 * Math.sin(t / 900 + i * 1.7) + 0.035 * Math.sin(t / 2300 + i * 0.9)
        const lift = 0.3 * hand.on * Math.exp(-(((column.left / 100 - hand.x) / 0.11) ** 2)) * settled
        const height = heightOf(column, heart) * up * level * sway * (1 + 0.12 * (1 - column.d) * swell) + lift
        const drift = 9 * Math.sin(t / 930 + i * 2.3)
        node.style.transform = `translateX(${drift.toFixed(2)}px) scaleY(${height.toFixed(4)})`
      })
      if (grain.current) grain.current.style.opacity = String(0.5 * spring(t - 200, 1, 1))
    }

    let frame = 0
    let start = performance.now()
    let held: number | null = null
    const tick = (now: number) => {
      const t = fast ? 60_000 : now - start
      clock.current = t
      drawLight(t)
      if (!markGone) {
        drawMark(t)
        if (t > OPEN + 900) {
          context.setTransform(1, 0, 0, 1, 0, 0)
          context.clearRect(0, 0, canvas.width, canvas.height)
          markGone = true
        }
      }
      frame = fast ? 0 : requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    // Standing still, it is drawn again when the page's size changes.
    const redraw = new ResizeObserver(() => fast && requestAnimationFrame(tick))
    redraw.observe(el)

    // Off screen, it waits where it was.
    const io = new IntersectionObserver(([e]) => {
      if (fast) return
      if (!e?.isIntersecting) {
        held = performance.now() - start
        cancelAnimationFrame(frame)
      } else if (held !== null) {
        start = performance.now() - held
        held = null
        frame = requestAnimationFrame(tick)
      }
    })
    io.observe(el)
    return () => {
      cancelAnimationFrame(frame)
      io.disconnect()
      ro.disconnect()
      redraw.disconnect()
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', leave)
    }
  }, [heart])

  const onTurn = () => {
    turned.current = clock.current
  }

  return (
    <div ref={root} className={s.hero}>
      <div className={s.light} aria-hidden="true">
        {COLUMNS.map((column) => {
          // The picture is wider than the column, by the blur's reach either side.
          const width = (column.width * PICTURE.width) / PICTURE.column
          return (
            <canvas
              key={column.i}
              ref={(node) => void (columns.current[column.i] = node)}
              className={s.column}
              width={PICTURE.width}
              height={PICTURE.height}
              style={{ left: `${column.left - width / 2}%`, width: `${width}%` }}
            />
          )
        })}
        <div ref={grain} className={s.grain} />
      </div>
      <canvas ref={mark} className={s.mark} aria-hidden="true" />

      <div data-arrive>{nav === undefined ? <Bar tone="paper" /> : nav}</div>
      <header className={s.head}>
        <p className={s.kicker} data-arrive>
          <i aria-hidden="true" />
          {HERO.kicker}
        </p>
        <h1 ref={headline} className={s.h1}>
          <span className={cx(s.line, s.pay)} data-line>
            <Words text={HERO.pay} />
          </span>
          <span className={cx(s.line, s.who)} data-line>
            <span className={s.word} data-word>
              <NameSwap names={HERO.names} nameClass={s.name} onTurn={onTurn} after={OPEN + 900} />
            </span>
          </span>
          <span className={s.line} data-line>
            <Words text={HERO.use[0]} />
          </span>
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
