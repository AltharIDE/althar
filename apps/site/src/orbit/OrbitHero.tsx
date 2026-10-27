import { drawGrain } from '@althar/ui/opening'
import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { preload } from 'react-dom'

import { TRAIN as WORDS } from '../content/train'
import { addDisplay } from '../home/display'
import { useHydrated } from '../lib/browser'
import { Get } from '../shared/Close'
import { flare, inOut, knocked, release, wobble } from '../train/motion'
import { clamp, seeded, smooth } from '../train/paint'
import { type Earth, makeEarth, onPlate, sunDirection } from './earth'
import { AT, DIP, dawnAt, groundAt, lapseAt, sunAt } from './journey'
import s from './OrbitHero.module.css'
import { GLASS, PLATE } from './plate'
import dayUrl from './plate/day.webp'
import nightUrl from './plate/night.webp'

/*
 * The first screen, from a space station: the cabin comes up out of the dark
 * on the night side, two astronauts at the dome's windows, the lights of a
 * coast drifting by below at the station's real speed. The headline comes
 * in; then the view runs faster and faster, a time-lapse, the lights drawn
 * into streaks, the limb beginning to glow; and the sun breaks over it, the
 * cabin flooding with its light, and the headline's last word is there in
 * it: "fast." Then the day, running calmer.
 *
 * The cabin is a photograph with its windows keyed out (plate.ts), laid over
 * the page to cover it, keeping the round window's top in view. Behind it,
 * the Earth is drawn on the graphics card (earth.ts), through the
 * photograph's own lens, by the clock (journey.ts). The words are the page's
 * own, set over it by the photograph's measure.
 *
 * With reduced motion it is one frame, by day; `?t=` in the address holds it
 * at that second.
 */

addDisplay()

/** The frame shown with reduced motion: by day, the sun up. */
const STILL_AT = 9
/** The most pixels the Earth is drawn in, so a large screen keeps its frame rate. */
const MOST_PIXELS = 2.2e6
/** How long the view waits for its photographs before setting off without them. */
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

/** The plate's measure, for the stylesheet: its size and the point it keeps in view. */
const STAGE = {
  '--pw': PLATE.width,
  '--ph': PLATE.height,
  '--fx-wide': PLATE.focus.x,
  '--fy': PLATE.focus.y,
  '--fx-phone': PLATE.phone.x,
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

/** The first screen from the station. */
export function OrbitHero({ nav }: { nav?: ReactNode } = {}) {
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const plate = useRef<HTMLDivElement>(null)
  const dim = useRef<HTMLDivElement>(null)
  const sunlit = useRef<HTMLDivElement>(null)
  const camera = useRef<HTMLDivElement>(null)
  const flash = useRef<HTMLDivElement>(null)
  const fast = useRef<HTMLSpanElement>(null)
  const grain = useRef<HTMLDivElement>(null)
  const [drawn, setDrawn] = useState(false)
  const hydrated = useHydrated()
  // The Earth's photographs, asked for with the page rather than once its script has run.
  preload(dayUrl, { as: 'image' })
  preload(nightUrl, { as: 'image' })

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
    let earth: Earth | null = null
    let size = ''
    // Where the sun breaks the limb, on the screen: where the light reveals "fast." from, and the flash is brightest.
    let sunrise = { x: 0, y: 0 }

    /** Sets the Earth's canvas over the glass and the sunrise's point, for the size; false if nothing changed. */
    const place = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      // Where the photograph stands, by its layout box: the camera's drift is a transform, which this ignores.
      const scale = box.offsetWidth / PLATE.width
      const left = box.offsetLeft
      const top = box.offsetTop
      const next = `${w}x${h}@${left},${top},${scale.toFixed(4)}`
      if (next === size || w < 10 || h < 10 || scale <= 0) return false
      size = next
      // Over all the glass that is on the screen, and a little round it for the drift.
      const x = Math.max(0, Math.floor(left + GLASS.x * scale - 16))
      const y = Math.max(0, Math.floor(top + GLASS.y * scale - 16))
      const r = Math.min(w, Math.ceil(left + (GLASS.x + GLASS.w) * scale + 16))
      const b = Math.min(h, Math.ceil(top + (GLASS.y + GLASS.h) * scale + 16))
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(MOST_PIXELS / Math.max(1, (r - x) * (b - y))))
      earth?.place({ plate: { left, top, scale }, box: { x, y, w: r - x, h: b - y }, dpr })
      const sun = onPlate(PLATE, sunDirection(-DIP))
      sunrise = { x: left + sun.x * scale, y: top + sun.y * scale }
      el.style.setProperty('--sun-x', `${sunrise.x.toFixed(1)}px`)
      el.style.setProperty('--sun-y', `${sunrise.y.toFixed(1)}px`)
      // And on the photograph, for the sunlight falling on the cabin.
      el.style.setProperty('--sun-u', `${((sun.x / PLATE.width) * 100).toFixed(2)}%`)
      el.style.setProperty('--sun-v', `${((sun.y / PLATE.height) * 100).toFixed(2)}%`)
      // The same point, from the word's own box (the headline spans the first screen, so its offsets are the screen's).
      word.style.setProperty('--sx', `${(sunrise.x - word.offsetLeft).toFixed(1)}px`)
      word.style.setProperty('--sy', `${(sunrise.y - word.offsetTop).toFixed(1)}px`)
      return true
    }

    const draw = (t: number) => {
      // Up out of the dark as it sets off, Earth or not.
      el.style.setProperty('--dark', (1 - smooth(AT.open, AT.opened, t)).toFixed(3))
      if (earth) earth.draw({ ground: groundAt(t), lapse: lapseAt(t), sun: sunAt(t) })
      // The cabin: by its own lamps and the night's faint glow, then the sun flooding in, brightest as it breaks.
      const dawn = dawnAt(t)
      const breaking = flare(t, AT.sunrise, 3.2)
      if (dim.current) dim.current.style.opacity = (0.5 * (1 - dawn) + 0.06).toFixed(3)
      if (sunlit.current) sunlit.current.style.opacity = Math.min(1, 0.55 * dawn + 0.6 * breaking).toFixed(3)
      // "fast.", in the sunrise's light: none before it, then spreading out from where the sun breaks.
      const r = t < AT.sunrise ? 0 : 1900 * (1 - Math.exp(-(t - AT.sunrise) * 2.3))
      word.style.setProperty('--r', `${r.toFixed(0)}px`)
      word.style.setProperty('--glow', breaking.toFixed(3))
      direct(t)
    }

    /*
     * The camera, floating: drifting slowly as nothing holds it, drawing back
     * from the window as the cabin comes up, leaning in as the view runs on
     * faster, and flinching from the sun as it breaks, the light flaring
     * through the glass.
     */
    const direct = (t: number) => {
      const dolly = 0.07 * (1 - inOut(t / 3))
      const lean = t < AT.sunrise ? 0.03 * smooth(AT.lapse, AT.sunrise, t) : 0.03 * release(t, AT.sunrise, 6, 2.6)
      const base = {
        x: wobble(t * 0.22, 3) * 7,
        y: wobble(t * 0.18, 7) * 5,
        turn: wobble(t * 0.13, 9) * 0.4,
        zoom: 1 + dolly + lean,
      }
      const cam = knocked(t, base, [{ at: AT.sunrise, x: -7, y: 5, zoom: -0.018, freq: 11, decay: 2.8 }])
      if (camera.current)
        camera.current.style.transform = `translate3d(${cam.x.toFixed(2)}px, ${cam.y.toFixed(2)}px, 0) rotate(${cam.turn.toFixed(3)}deg) scale(${cam.zoom.toFixed(4)})`
      if (flash.current) flash.current.style.opacity = clamp(0.85 * flare(t, AT.sunrise - 0.02, 2.4)).toFixed(3)
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

    // It sets off once the Earth is in, or after a moment without it; the words come with it, or are there at once when held still.
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
    void Promise.all([picture(dayUrl), picture(nightUrl)]).then(
      ([day, night]) => {
        if (!live) return
        earth = makeEarth(cv, PLATE, day, night)
        if (earth) {
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

  return (
    <div ref={root} className={s.hero} data-ready={hydrated || undefined} data-drawn={drawn || undefined}>
      {/* What the camera sees: the Earth, the light, and the cabin and the words in it. */}
      <div ref={camera} className={s.camera}>
        <canvas ref={canvas} className={s.earth} aria-hidden="true" />
        <div className={s.stage} style={STAGE}>
          {/* Until the Earth is drawn, and without scripts, space through the glass. */}
          <div className={s.space} aria-hidden="true" />
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
            <div ref={dim} className={s.dim} style={{ maskImage: `url(${PLATE.src})`, WebkitMaskImage: `url(${PLATE.src})` }} />
            <div ref={sunlit} className={s.sunlit} style={{ maskImage: `url(${PLATE.src})`, WebkitMaskImage: `url(${PLATE.src})` }} />
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
              <span ref={fast} className={s.fast} data-word={WORDS.last}>
                {WORDS.last}
              </span>
            </h1>
          </div>
        </div>
      </div>
      {/* In front of the camera, so its drift leaves them be: the lead and the ways in. */}
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
