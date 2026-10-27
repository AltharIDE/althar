import { drawGrain } from '@althar/ui/opening'
import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { preload } from 'react-dom'

import { TRAIN as WORDS } from '../content/train'
import { addDisplay } from '../home/display'
import { useHydrated } from '../lib/browser'
import { Get } from '../shared/Close'
import { flare, inOut, knocked, wobble } from '../train/motion'
import { clamp, seeded, smooth } from '../train/paint'
import { type Fire, makeFire } from './fire'
import { AT, brokenAt, flowAt, heatAt, shakeAt, speedAt } from './journey'
import { GLASS, PLATE } from './plate'
import plasmaUrl from './plate/plasma.webp'
import skyUrl from './plate/sky.webp'
import s from './ReentryHero.module.css'

/*
 * The first screen, coming in from orbit: the capsule's cabin comes up out
 * of the dark, two astronauts strapped in, a faint glow at the windows. The
 * headline comes in; the glow catches and builds into fire streaming past
 * the glass, faster and faster, sparks shooting by, the capsule shaking
 * harder and pressed down, the cabin lit by it; at its height the windows go
 * white; and then it breaks, torn away, and there is the sky and the cloud
 * far below, and the headline's last word, forged in it and cooling: "fast."
 *
 * The cabin is a photograph with its windows keyed out (plate.ts), laid over
 * the page to cover it. Behind it, the fire and the sky are drawn on the
 * graphics card (fire.ts) by the photograph's measure, by the clock
 * (journey.ts). The words are the page's own, set in the large window.
 *
 * With reduced motion it is one frame, after the fire; `?t=` in the address
 * holds it at that second.
 */

addDisplay()

/** The frame shown with reduced motion: the fire gone, the sky. */
const STILL_AT = 8
/** The most pixels the fire is drawn in, so a large screen keeps its frame rate. */
const MOST_PIXELS = 2.2e6
/** How long the capsule waits for its photographs before setting off without them. */
const WAIT = 1800

const heldAt = () => {
  const t = Number(new URLSearchParams(window.location.search).get('t') ?? Number.NaN)
  if (Number.isFinite(t)) return t
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? STILL_AT : null
}

/** A photograph, decoded. */
const picture = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () =>
      void img.decode().then(
        () => resolve(img),
        () => resolve(img),
      )
    img.onerror = () => reject(new Error(`couldn't load ${src}`))
    img.src = src
  })

/** The plate's measure, for the stylesheet: its size, the point it keeps in view, and the large window. */
const STAGE = {
  '--pw': PLATE.width,
  '--ph': PLATE.height,
  '--fx-wide': PLATE.focus.x,
  '--fy': PLATE.focus.y,
  '--fx-phone': PLATE.phone.x,
  '--wx': PLATE.big.x,
  '--wy': PLATE.big.y,
  '--ww': PLATE.big.w,
  '--wh': PLATE.big.h,
} as CSSProperties

/** Quick out, long settle: an expo out. */
const EXPO = 'cubic-bezier(0.19, 1, 0.22, 1)'

/** A line's words, each in a mask it rises out of. */
function Words({ text }: { text: string }) {
  const words = text.split(' ')
  return (
    <>
      {words.map((word, i) => (
        <span key={i}>
          <span className={s.mask}>
            <span className={s.word} data-word>
              {word}
            </span>
          </span>
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </>
  )
}

/** The headline's words rise out of their masks one after another; then the rest. */
const arrive = (within: HTMLElement) => {
  const animate = (el: Element, frames: Keyframe[], options: KeyframeAnimationOptions) =>
    el.animate(frames, { fill: 'backwards', ...options })
  return [
    ...[...within.querySelectorAll('[data-word]')].map((word, i) =>
      animate(word, [{ transform: 'translateY(108%) rotate(5deg)' }, { transform: 'none' }], {
        duration: 1050,
        delay: AT.words * 1000 + i * 55,
        easing: EXPO,
      }),
    ),
    ...[...within.querySelectorAll<HTMLElement>('[data-arrive]')].flatMap((el) => {
      const delay = AT.rest * 1000 + Number(el.dataset.arrive || 0)
      return [
        animate(el, [{ transform: 'translateY(14px)' }, { transform: 'none' }], { duration: 1000, delay, easing: EXPO }),
        animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay, easing: 'ease-out' }),
      ]
    }),
  ]
}

/** The first screen, coming in from orbit. */
export function ReentryHero({ nav }: { nav?: ReactNode } = {}) {
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const plate = useRef<HTMLDivElement>(null)
  const dim = useRef<HTMLDivElement>(null)
  const firelit = useRef<HTMLDivElement>(null)
  const daylit = useRef<HTMLDivElement>(null)
  const camera = useRef<HTMLDivElement>(null)
  const flash = useRef<HTMLDivElement>(null)
  const fast = useRef<HTMLSpanElement>(null)
  const grain = useRef<HTMLDivElement>(null)
  const [drawn, setDrawn] = useState(false)
  const hydrated = useHydrated()
  // The sky and the fire, asked for with the page rather than once its script has run.
  preload(skyUrl, { as: 'image' })
  preload(plasmaUrl, { as: 'image' })

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
    const box = plate.current
    const word = fast.current
    if (!el || !cv || !box || !word) return
    const held = heldAt()
    let live = true
    let fire: Fire | null = null
    let size = ''

    /** Sets the fire's canvas over the glass, for the size; false if nothing changed. */
    const place = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      // Where the photograph stands, by its layout box: the camera's shaking is a transform, which this ignores.
      const scale = box.offsetWidth / PLATE.width
      const left = box.offsetLeft
      const top = box.offsetTop
      const next = `${w}x${h}@${left},${top},${scale.toFixed(4)}`
      if (next === size || w < 10 || h < 10 || scale <= 0) return false
      size = next
      // Over all the glass that is on the screen, and a good way round it for the shaking.
      const x = Math.max(0, Math.floor(left + GLASS.x * scale - 40))
      const y = Math.max(0, Math.floor(top + GLASS.y * scale - 40))
      const r = Math.min(w, Math.ceil(left + (GLASS.x + GLASS.w) * scale + 40))
      const b = Math.min(h, Math.ceil(top + (GLASS.y + GLASS.h) * scale + 40))
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(MOST_PIXELS / Math.max(1, (r - x) * (b - y))))
      fire?.place({ plate: { left, top, scale }, box: { x, y, w: r - x, h: b - y }, dpr })
      return true
    }

    const draw = (t: number) => {
      // Up out of the dark as it sets off, fire or not.
      el.style.setProperty('--dark', (1 - smooth(AT.open, AT.opened, t)).toFixed(3))
      const heat = heatAt(t)
      const broken = brokenAt(t)
      // The break's flash: the glass white for a moment as the fire tears away.
      const white = clamp(0.5 * flare(t, AT.break, 4))
      if (fire) fire.draw({ t, heat, flow: flowAt(t), speed: speedAt(t), broken, white, drift: 34 * Math.max(0, t - AT.break) })
      // The cabin: dark, then lit by the fire, flickering; then the cool light of the sky.
      const flicker = 0.78 + 0.22 * (wobble(t * 9, 4) * 0.6 + wobble(t * 23, 8) * 0.4)
      if (dim.current) dim.current.style.opacity = (0.55 * (1 - heat) * (1 - broken) + 0.08).toFixed(3)
      if (firelit.current) firelit.current.style.opacity = clamp(heat * flicker * 1.1).toFixed(3)
      if (daylit.current) daylit.current.style.opacity = (0.75 * broken).toFixed(3)
      // "fast.", forged in the fire at its height, glowing, then cooling as it breaks.
      const forged = smooth(AT.peak + 0.1, AT.peak + 0.4, t)
      const cool = smooth(AT.break, AT.broken + 0.7, t)
      word.style.opacity = forged.toFixed(3)
      word.style.setProperty('--cool', cool.toFixed(3))
      word.style.setProperty('--punch', (1 - smooth(AT.peak + 0.1, AT.peak + 0.55, t)).toFixed(3))
      direct(t, heat, broken)
    }

    /*
     * The camera, strapped in: drawing back from the window as the cabin comes
     * up, then shaking with the heat, harder and faster the hotter, pressed
     * down as the capsule slows; thrown as the fire breaks, then settling into
     * a slow sway under the sky.
     */
    const direct = (t: number, heat: number, broken: number) => {
      const shake = shakeAt(t) * 9
      const dolly = 0.06 * (1 - inOut(t / 2.6))
      const base = {
        x: wobble(t * 0.3, 3) * 4 + (wobble(t * 23, 1) * 0.6 + wobble(t * 41, 2) * 0.4) * shake,
        y: wobble(t * 0.25, 7) * 3 + (wobble(t * 29, 4) * 0.6 + wobble(t * 47, 5) * 0.4) * shake + 6 * heat,
        turn: wobble(t * 0.2, 9) * 0.25 + wobble(t * 19, 6) * 0.04 * shake,
        zoom: 1 + dolly + 0.035 * heat * (1 - broken),
      }
      const cam = knocked(t, base, [{ at: AT.break, x: 12, y: -7, zoom: -0.03, freq: 8, decay: 2.4 }])
      if (camera.current)
        camera.current.style.transform = `translate3d(${cam.x.toFixed(2)}px, ${cam.y.toFixed(2)}px, 0) rotate(${cam.turn.toFixed(3)}deg) scale(${cam.zoom.toFixed(4)})`
      if (flash.current) flash.current.style.opacity = clamp(0.9 * flare(t, AT.break - 0.02, 2.6)).toFixed(3)
    }

    let frame = 0
    let start = performance.now()
    let pausedAt: number | null = null
    let seen = true
    let runs: Animation[] = []
    let begun = false
    const now = () => (performance.now() - start) / 1000
    const tick = () => {
      draw(now())
      frame = requestAnimationFrame(tick)
    }

    // It sets off once the fire is in, or after a moment without it; the words come with it, or are there at once when held still.
    const begin = () => {
      if (begun || !live) return
      begun = true
      el.dataset.begun = ''
      start = performance.now()
      runs = arrive(el)
      if (held !== null) {
        for (const run of runs) {
          run.pause()
          run.currentTime = held * 1000
        }
        draw(held)
      } else frame = requestAnimationFrame(tick)
    }
    const waited = window.setTimeout(begin, WAIT)
    void Promise.all([picture(skyUrl), picture(plasmaUrl)]).then(
      ([sky, plasma]) => {
        if (!live) return
        fire = makeFire(cv, PLATE, sky, plasma)
        if (fire) {
          size = ''
          place()
          setDrawn(true)
        }
        begin()
        if (held !== null) draw(held)
      },
      () => begin(),
    )
    place()

    // Off screen it stops, and takes up where it left off when it's back.
    const io = new IntersectionObserver(([e]) => {
      if (held !== null || !begun) return
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
        if (place()) draw(held ?? now())
      }, 120)
    })
    ro.observe(el)

    return () => {
      live = false
      delete el.dataset.begun
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      clearTimeout(waited)
      io.disconnect()
      ro.disconnect()
      runs.forEach((run) => run.cancel())
    }
  }, [])

  const mask = { maskImage: `url(${PLATE.src})`, WebkitMaskImage: `url(${PLATE.src})` }
  return (
    <div ref={root} className={s.hero} data-ready={hydrated || undefined} data-drawn={drawn || undefined}>
      {/* What the camera sees: the fire and the sky, the light, and the cabin and the words in it. */}
      <div ref={camera} className={s.camera}>
        <canvas ref={canvas} className={s.fire} aria-hidden="true" />
        <div className={s.stage} style={STAGE}>
          {/* Until the fire is drawn, and without scripts, the sky through the glass. */}
          <div className={s.sky} style={{ backgroundImage: `url(${skyUrl})` }} aria-hidden="true" />
          <div ref={plate} className={s.plate} aria-hidden="true">
            <img
              className={s.photo}
              src={PLATE.src}
              alt=""
              width={PLATE.width}
              height={PLATE.height}
              decoding="async"
              fetchPriority="high"
            />
            <div ref={dim} className={s.dim} style={mask} />
            <div ref={firelit} className={s.firelit} style={mask} />
            <div ref={daylit} className={s.daylit} style={mask} />
          </div>
          <div ref={flash} className={s.flash} aria-hidden="true" />
          <div className={s.curtain} aria-hidden="true" />
          <div ref={grain} className={s.grain} aria-hidden="true" />
          <div className={s.vignette} aria-hidden="true" />
          <div className={s.words}>
            <h1 className={s.h1}>
              <span className={s.line}>
                <Words text={WORDS.title} />
              </span>{' '}
              <span ref={fast} className={s.fast}>
                {WORDS.last}
              </span>
            </h1>
          </div>
        </div>
      </div>
      {/* In front of the camera, so its shaking leaves them be: the lead and the ways in. */}
      <footer className={s.foot}>
        <p className={s.lead} data-arrive={0}>
          {WORDS.lead}
        </p>
        <div className={s.ways} data-arrive={120}>
          <Get tone="blue" />
        </div>
      </footer>
      {nav}
    </div>
  )
}
