import { CopyButton } from '@althar/ui'
import { drawGrain } from '@althar/ui/opening'
import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { preload } from 'react-dom'

import { AGENTS } from '../content/agents'
import { INSTALL } from '../content/facts'
import { HERO } from '../content/home'
import { useHydrated } from '../lib/browser'
import { cx } from '../lib/cx'
import { AgentMark } from '../shared/AgentMark'
import { Get } from '../shared/Close'
import { seeded } from '../shared/footer/random'
import { LightUnder } from '../shared/lightUnder'
import { addDisplay } from './display'
import s from './Hero.module.css'
import { type Fire, makeFire } from './hero/fire'
import { altitudeAt, AT, brokenAt, driftAt, flowAt, heatAt, shakeAt, speedAt, swayAt, velocityAt } from './hero/journey'
import { clamp, flare, inOut, ring, smooth, wobble } from './hero/motion'
import { PHONE, type Plate, TALL, WIDE } from './hero/plate'
import plasmaUrl from './hero/plate/plasma.webp'
import skyUrl from './hero/plate/sky.webp'

/*
 * The developer page's first screen, coming in from orbit: the capsule's cabin comes up out
 * of the dark, two astronauts strapped in, a faint glow at the window. The
 * headline comes in; the glow catches and builds into fire streaming past
 * the glass, faster and faster, sparks shooting by, the capsule shaking
 * harder and pressed down, the cabin lit by it; at its height the headline's
 * last word is forged in it, "fast."; and then the fire breaks, torn away,
 * the glass flashing white, and there is the sky and the cloud far below,
 * the word cooling to white. Then everything comes to rest: from then on
 * nothing is drawn, and the browser keeps it gently moving. In the window's
 * top corners the flight deck reads the capsule slowing and falling; under
 * the lead, a console holds the agents, the install and the download.
 *
 * The cabin is a photograph with its window keyed out (hero/plate.ts),
 * wide, or tall on a phone, laid over the page to cover it. Behind it, the
 * fire and the sky are drawn on the graphics card (hero/fire.ts) by the
 * photograph's measure, by the clock (hero/journey.ts). The words are the
 * page's own, set in the window. The scene is dark, so the nav over it turns
 * to smoked glass (LightUnder, tone ink).
 *
 * With reduced motion it is the last frame, at rest; `?t=` in the address
 * holds it at that second. Without the graphics card, or without scripts,
 * the window shows the sky.
 */

addDisplay()

/** The most pixels the fire is drawn in, so a large screen keeps its frame rate. */
const MOST_PIXELS = 1.6e6
/** How long the capsule waits for its photographs before setting off without them. */
const WAIT = 1800

/** The second to hold at, if any: `?t=`, or the last frame with reduced motion. */
const heldAt = () => {
  const t = Number(new URLSearchParams(window.location.search).get('t') ?? Number.NaN)
  if (Number.isFinite(t)) return t
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? AT.settled : null
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

/**
 * Each photograph's measure, for the stylesheet, which takes the tall one's
 * on a phone: its size, the point it keeps in view, the window, the sky
 * behind it, and the photograph itself as the mask for the cabin's light.
 */
const measure = (plate: Plate, end: string) => ({
  [`--pw-${end}`]: plate.width,
  [`--ph-${end}`]: plate.height,
  [`--fx-${end}`]: plate.focus.x,
  [`--fy-${end}`]: plate.focus.y,
  [`--wx-${end}`]: plate.window.x,
  [`--wy-${end}`]: plate.window.y,
  [`--ww-${end}`]: plate.window.w,
  [`--wh-${end}`]: plate.window.h,
  [`--sx-${end}`]: plate.sky.x,
  [`--sy-${end}`]: plate.sky.y,
  [`--sw-${end}`]: plate.sky.w,
  [`--sh-${end}`]: plate.sky.h,
  // How far the sky has drifted by the time everything is at rest, in the plate's px: where the page's own picture of it then stands.
  [`--sd-${end}`]: driftAt(AT.settled) * plate.unit,
  [`--mask-${end}`]: `url(${plate.src})`,
})
const STAGE = { ...measure(WIDE, 'w'), ...measure(TALL, 't') } as CSSProperties

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

/** Writes a style only when it changes: the frame runs sixty times a second. */
const put = (el: HTMLElement | null, name: string, value: string) => {
  if (el && el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value)
}

/** The flight deck's readouts at second `t`, as they read. */
const READ = {
  velocity: (t: number) => `${velocityAt(t).toFixed(2)} km/s`,
  altitude: (t: number) => `${Math.round(altitudeAt(t))} km`,
}

/** Writes a readout only when it changes. */
const say = (el: HTMLElement | null, text: string) => {
  if (el && el.textContent !== text) el.textContent = text
}

/** Every agent Althar runs, as its mark, named on hover and to a screen reader. */
function Agents() {
  return (
    <ul className={s.agents} aria-label={HERO.agentsName}>
      {AGENTS.map((agent) => (
        <li key={agent.id} title={agent.name}>
          <AgentMark agent={agent.id} size={17} />
          <span className={s.sr}>{agent.name}</span>
        </li>
      ))}
    </ul>
  )
}

/** The developer page's first screen, coming in from orbit. */
export function Hero({ nav }: { nav?: ReactNode } = {}) {
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
  const velocity = useRef<HTMLElement>(null)
  const altitude = useRef<HTMLElement>(null)
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
    // The photograph the stylesheet is showing: the tall one on a phone.
    const phone = window.matchMedia(PHONE)
    let shown: Plate = phone.matches ? TALL : WIDE

    /** Sets the fire's canvas over the glass, for the size; false if nothing changed. */
    const place = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      // Where the photograph stands, by its layout box: the camera's shaking is a transform, which this ignores.
      shown = phone.matches ? TALL : WIDE
      const scale = box.offsetWidth / shown.width
      const left = box.offsetLeft
      const top = box.offsetTop
      const next = `${w}x${h}@${left},${top},${scale.toFixed(4)},${shown.width}`
      if (next === size || w < 10 || h < 10 || scale <= 0) return false
      size = next
      // Over the glass that is on the screen, and a good way round it for the shaking.
      const glass = shown.window
      const x = Math.max(0, Math.floor(left + glass.x * scale - 40))
      const y = Math.max(0, Math.floor(top + glass.y * scale - 40))
      const r = Math.min(w, Math.ceil(left + (glass.x + glass.w) * scale + 40))
      const b = Math.min(h, Math.ceil(top + (glass.y + glass.h) * scale + 40))
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(MOST_PIXELS / Math.max(1, (r - x) * (b - y))))
      fire?.place({ plate: { left, top, scale }, box: { x, y, w: r - x, h: b - y }, dpr, sky: shown.sky, unit: shown.unit })
      return true
    }

    /** Everything for second `t`; after the last frame, the last frame. */
    const draw = (at: number) => {
      const t = Math.min(at, AT.settled)
      const heat = heatAt(t)
      const broken = brokenAt(t)
      // Up out of the dark as it sets off, fire or not.
      put(el, '--dark', (1 - smooth(AT.open, AT.opened, t)).toFixed(3))
      fire?.draw({ t, heat, flow: flowAt(t), speed: speedAt(t), broken, white: 0.5 * flare(t, AT.break, 4), drift: driftAt(t) })
      // The cabin: dark, then lit by the fire, flickering; then the cool light of the sky.
      const flicker = 0.78 + 0.22 * (wobble(t * 9, 4) * 0.6 + wobble(t * 23, 8) * 0.4)
      put(dim.current, 'opacity', (0.55 * (1 - heat) * (1 - broken) + 0.08).toFixed(3))
      put(firelit.current, 'opacity', clamp(heat * flicker * 1.1).toFixed(3))
      put(daylit.current, 'opacity', (0.75 * broken).toFixed(3))
      put(flash.current, 'opacity', clamp(0.9 * flare(t, AT.break - 0.02, 2.6)).toFixed(3))
      // "fast.", forged in the fire at its height, glowing and slammed in, then cooling as it breaks.
      put(word, 'opacity', smooth(AT.peak + 0.1, AT.peak + 0.4, t).toFixed(3))
      put(word, '--cool', smooth(AT.break, AT.broken + 0.7, t).toFixed(3))
      put(word, '--punch', (1 - smooth(AT.peak + 0.1, AT.peak + 0.55, t)).toFixed(3))
      say(velocity.current, READ.velocity(t))
      say(altitude.current, READ.altitude(t))
      direct(t, heat, broken)
    }

    /*
     * The camera, strapped in: drawing back from the window as the cabin comes
     * up, swaying a little, shaking with the heat, harder and faster the
     * hotter, pressed down as the capsule slows; thrown as the fire breaks,
     * then coming to rest under the sky.
     */
    const direct = (t: number, heat: number, broken: number) => {
      const shake = shakeAt(t) * 9
      const sway = swayAt(t)
      const x = wobble(t * 0.3, 3) * 4 * sway + (wobble(t * 23, 1) * 0.6 + wobble(t * 41, 2) * 0.4) * shake + 12 * ring(t, AT.break, 8, 2.4)
      const y =
        wobble(t * 0.25, 7) * 3 * sway +
        (wobble(t * 29, 4) * 0.6 + wobble(t * 47, 5) * 0.4) * shake +
        6 * heat -
        7 * ring(t, AT.break, 6.6, 2.4)
      const turn = wobble(t * 0.2, 9) * 0.25 * sway + wobble(t * 19, 6) * 0.04 * shake + 0.3 * ring(t, AT.break, 5.6, 2.4)
      const zoom = 1 + 0.06 * (1 - inOut(t / 2.6)) + 0.035 * heat * (1 - broken) - 0.03 * flare(t, AT.break, 2.2)
      put(
        camera.current,
        'transform',
        t >= AT.settled
          ? 'none'
          : `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${turn.toFixed(3)}deg) scale(${zoom.toFixed(4)})`,
      )
    }

    let frame = 0
    let start = performance.now()
    let pausedAt: number | null = null
    let seen = true
    let runs: Animation[] = []
    let begun = false
    let settled = false
    const now = () => (performance.now() - start) / 1000
    /*
     * Once at rest, the graphics card stops: its last frame is the sky picture
     * just as the page's own copy of it shows it, so that takes its place
     * (data-settled), and the canvas and its memory are let go. From then on
     * what moves is the browser's to move: the sky easing, the camera floating
     * and now and then an ember (Hero.module.css).
     */
    const rest = () => {
      el.dataset.settled = ''
      fire?.dispose()
      fire = null
    }
    const settle = () => {
      settled = true
      cancelAnimationFrame(frame)
      draw(AT.settled)
      rest()
    }
    const tick = () => {
      const t = now()
      if (t >= AT.settled) return settle()
      draw(t)
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
        if (held >= AT.settled) {
          settled = true
          rest()
        }
      } else frame = requestAnimationFrame(tick)
    }
    const waited = window.setTimeout(begin, WAIT)
    void Promise.all([picture(skyUrl), picture(plasmaUrl)]).then(
      ([sky, plasma]) => {
        // Already at rest (the pictures came late, or it is held there, as with reduced motion), there is nothing for the graphics card to do.
        if (!live || settled || (held !== null && held >= AT.settled)) return begin()
        // If the graphics card takes the canvas back, the window shows the sky instead.
        fire = makeFire(cv, sky, plasma, () => {
          fire = null
          setDrawn(false)
        })
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

    // Off screen it stops, and takes up where it left off when it's back; at rest, the browser's motion stops with it (data-away).
    const io = new IntersectionObserver(([e]) => {
      const was = seen
      seen = e?.isIntersecting ?? true
      if (seen) delete el.dataset.away
      else el.dataset.away = ''
      if (held !== null || !begun || settled) return
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
        if (place()) draw(held ?? (settled ? AT.settled : now()))
      }, 120)
    })
    ro.observe(el)

    return () => {
      live = false
      delete el.dataset.begun
      delete el.dataset.settled
      delete el.dataset.away
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      clearTimeout(waited)
      io.disconnect()
      ro.disconnect()
      runs.forEach((run) => run.cancel())
      fire?.dispose()
    }
  }, [])

  return (
    <div ref={root} className={s.hero} data-ready={hydrated || undefined} data-drawn={drawn || undefined}>
      {/* Dark under the nav: it turns to smoked glass over the scene. */}
      <LightUnder tone="ink" className={s.under} />
      {/* What the camera sees: the fire and the sky, the light, and the cabin and the words in it. */}
      <div ref={camera} className={s.camera}>
        <canvas ref={canvas} className={s.fire} aria-hidden="true" />
        <div className={s.stage} style={STAGE}>
          {/* Until the fire is drawn, and without the graphics card or scripts, the sky through the glass. */}
          <div className={s.sky} style={{ backgroundImage: `url(${skyUrl})` }} aria-hidden="true" />
          {/* Now and then, at rest, an ember of the fire streaks past the glass. */}
          <div className={s.embers} aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <div ref={plate} className={s.plate} aria-hidden="true">
            {/* The tall photograph on a phone, the wide one otherwise: a browser fetches only the one it shows. */}
            <picture>
              <source media={PHONE} srcSet={TALL.src} width={TALL.width} height={TALL.height} />
              <img
                className={s.photo}
                src={WIDE.src}
                alt=""
                width={WIDE.width}
                height={WIDE.height}
                decoding="async"
                fetchPriority="high"
              />
            </picture>
            <div ref={dim} className={s.dim} />
            <div ref={firelit} className={s.firelit} />
            <div ref={daylit} className={s.daylit} />
          </div>
          <div ref={flash} className={s.flash} aria-hidden="true" />
          <div className={s.curtain} aria-hidden="true" />
          <div ref={grain} className={s.grain} aria-hidden="true" />
          <div className={s.vignette} aria-hidden="true" />
          <div className={s.words}>
            <h1 className={s.h1}>
              <span className={s.line}>
                <Words text={HERO.title} />
              </span>{' '}
              <span ref={fast} className={s.fast}>
                {HERO.last}
              </span>
            </h1>
            {/* The flight deck's readouts, at rest until the clock runs them. */}
            <div className={s.hud} aria-hidden="true">
              <span>
                <i>{HERO.velocity}</i>
                <b ref={velocity}>{READ.velocity(AT.settled)}</b>
              </span>
              <span>
                <i>{HERO.altitude}</i>
                <b ref={altitude}>{READ.altitude(AT.settled)}</b>
              </span>
            </div>
          </div>
        </div>
      </div>
      {/* In front of the camera, so its shaking leaves them be: the lead, and the console under it. */}
      <footer className={s.deck}>
        <p className={s.lead} data-arrive={0}>
          {HERO.lead}
        </p>
        <div className={s.console} data-arrive={120}>
          <div className={s.cell}>
            <span className={s.label}>{HERO.agents}</span>
            <Agents />
          </div>
          <div className={cx(s.cell, s.install)}>
            <span className={s.label}>{HERO.install}</span>
            <div className={s.command}>
              <code>
                <span aria-hidden="true">$ </span>
                {INSTALL.brew}
              </code>
              {/* The kit's button, under the kit's own reset. */}
              <span className="ch-root">
                <CopyButton value={INSTALL.brew} tone="onDark" ghost />
              </span>
            </div>
          </div>
          <div className={cx(s.cell, s.ways)}>
            <Get tone="blue" />
          </div>
        </div>
      </footer>
      {nav}
    </div>
  )
}
