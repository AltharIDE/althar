import { drawGrain } from '@althar/ui/opening'
import { type CSSProperties, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

import { useHydrated } from '../lib/browser'
import { addDisplay, DISPLAY } from '../home/display'
import { type BigWord, bakeWord, drawWord, wordMoving } from './bigword'
import { AT, distanceAt, lurchAt, pace, speedAt } from './journey'
import { LOOKS, type LookName } from './looks'
import { flare, inOut, knocked, release, ring, wobble } from './motion'
import { drawPasser, PASSER, passAt } from './passer'
import { clamp, seeded, smooth } from './paint'
import { type Pane, PLATE } from './plate'
import s from './TrainHero.module.css'
import { type Box, bakeWorld, drawWorld, lightAt, PICTURES, type Pictures, type World } from './world'

/*
 * The first screen, seen from a train: the carriage comes up out of the
 * dark with the train already rolling, slowly, a man and a child looking
 * out, and a readout in the window giving its speed. The headline comes in
 * quickly, then the train pulls, gathers speed over a few seconds and is
 * flying, the near ground gone to streaks, and the headline's last word
 * shoots in on the speed: "fast."
 *
 * The carriage is a photograph with its windows keyed out (plate.ts), laid
 * over the page to cover it, as an image would be with `object-fit: cover`
 * but keeping the window's upper middle in view. Behind it, one canvas draws
 * what's outside (world.ts), slid along by the journey's clock
 * (journey.ts), painted once for the size, so each frame only lays it down.
 * The words are the page's own, set in the middle window by the same
 * measure the photograph is set by.
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

/** How the carriage rides: rocking slowly and knocking over the rail joints when slow, a fine hum when fast. In CSS px. */
function rideAt(t: number, metres: number, k: number) {
  const p = pace(t)
  const slow = 1 - smooth(0, 0.6, p)
  // Two knocks a rail, 25 m apart, front and back bogie.
  const joint = (metres % 25) / 25
  const knock = (at: number) => Math.exp(-((((joint - at) * 25) / 0.9) ** 2))
  const knocks = (knock(0.1) + knock(0.18) * 0.8) * slow * 1.4
  const rock = Math.sin(t * 2.1) * 0.9 * slow + Math.sin(t * 1.3 + 1) * 0.6
  const fine = smooth(0.5, 1, p)
  const hum = (Math.sin(t * 61) * 0.5 + Math.sin(t * 89 + 2) * 0.35) * fine
  return {
    /** How far the world outside sits from where it rests. */
    bob: (knocks + rock + hum) * k,
    /** The carriage itself: thrown back as it pulls, then trembling a little when flying. */
    x: lurchAt(t) * 4 * k + Math.sin(t * 47) * 0.35 * fine * k,
    y: Math.sin(t * 71 + 1) * 0.4 * fine * k + knocks * 0.25 * k,
  }
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

/** How long the train waits for its landscape before setting off without it. */
const WAIT = 2500

/** The plate's measure, for the stylesheet: its size, the point it keeps in view, and the middle window. */
const STAGE = {
  '--pw': PLATE.width,
  '--ph': PLATE.height,
  '--fx-wide': PLATE.focus.x,
  '--fy': PLATE.focus.y,
  '--fx-phone': PLATE.phone.x,
  '--wx': PLATE.windows[0].x,
  '--wy': PLATE.windows[0].y,
  '--ww': PLATE.windows[0].w,
  '--wh': PLATE.windows[0].h,
  '--wr': PLATE.windows[0].r,
} as CSSProperties

/** The first screen from the train, its words set in one of the looks (looks.tsx). */
export function TrainHero({ nav, look = 'title' }: { nav?: ReactNode; look?: LookName } = {}) {
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const nearCanvas = useRef<HTMLCanvasElement>(null)
  const plate = useRef<HTMLDivElement>(null)
  const dim = useRef<HTMLDivElement>(null)
  const camera = useRef<HTMLDivElement>(null)
  const flash = useRef<HTMLDivElement>(null)
  const windBlur = useRef<SVGFEGaussianBlurElement>(null)
  // For the wind filter's id: React's own ids carry characters a url(#…) would need escaped.
  const windId = `wind${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
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
    const box = plate.current
    const ctx = cv?.getContext('2d')
    const near = nearCanvas.current
    const nctx = near?.getContext('2d')
    if (!el || !cv || !box || !ctx || !near || !nctx) return
    const held = heldAt()
    const style = LOOKS[look]
    // Before the train sets off, "fast." is as it is at the start: not there yet.
    style.frame(el, 0, null)
    let live = true
    let pictures: Pictures | null = null
    let world: World | null = null
    // The word a look paints into the scene, once its face is in.
    let word: BigWord | null = null
    let typed = !style.sceneWord
    // The near layer's box on the screen, its pixels, and what it last drew.
    let nearBox: Box = { x: 0, y: 0, w: 0, h: 0 }
    let nearDpr = 1
    let nearDrawn = ''
    let panes: Pane[] = []
    let size = ''
    let dpr = 1
    let k = 1
    // What follows the train: every speed figure the look shows, and its pace as --pace, written only when they change.
    const readouts = [...el.querySelectorAll<HTMLElement>('[data-kmh]')]
    let lastPace = -1

    const bake = () => {
      if (!pictures) return false
      const w = el.clientWidth
      const h = el.clientHeight
      // Where the photograph stands, by its layout box: its trembling is a transform, which this ignores.
      const scale = box.offsetWidth / PLATE.width
      const left = box.offsetLeft
      const top = box.offsetTop
      const next = `${w}x${h}@${left},${top},${scale.toFixed(4)}`
      if (next === size || w < 10 || h < 10 || scale <= 0) return false
      size = next
      dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(MOST_PIXELS / (w * h)))
      cv.width = Math.round(w * dpr)
      cv.height = Math.round(h * dpr)
      panes = PLATE.windows.map((p) => ({ x: left + p.x * scale, y: top + p.y * scale, w: p.w * scale, h: p.h * scale, r: p.r * scale }))
      const win = panes[0]!
      // The horizon a little over halfway down the window, as the eye sits when looking out level.
      const view = { w, h, dpr, win, horizon: win.y + win.h * 0.6 }
      k = clamp(win.h / 640, 0.5, 1.4)
      world = bakeWorld(view, pictures)
      // The near layer: over the glass, as much of it as is on the screen, at the screen's own pixels.
      const x = Math.max(0, Math.floor(win.x - 12))
      const y = Math.max(0, Math.floor(win.y - 12))
      nearBox = { x, y, w: Math.min(w, Math.ceil(win.x + win.w + 12)) - x, h: Math.min(h, Math.ceil(win.y + win.h + 12)) - y }
      nearDpr = Math.min(window.devicePixelRatio || 1, 2)
      near.width = Math.round(nearBox.w * nearDpr)
      near.height = Math.round(nearBox.h * nearDpr)
      Object.assign(near.style, { left: `${x}px`, top: `${y}px`, width: `${nearBox.w}px`, height: `${nearBox.h}px` })
      nearDrawn = ''
      word = style.sceneWord && typed ? bakeWord(style.sceneWord, win, w, nearDpr) : null
      return true
    }

    const draw = (t: number) => {
      if (!world) {
        style.frame(el, t, null)
        direct(t, 0)
        return
      }
      const { w, h } = world.view
      const metres = distanceAt(t)
      const speed = speedAt(t)
      const ride = rideAt(t, metres, k)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      // Outside, only where the glass is (and a little round it, for the carriage's trembling).
      ctx.save()
      ctx.beginPath()
      for (const p of panes) ctx.rect(p.x - 12, p.y - 12, p.w + 24, p.h + 24)
      ctx.clip()
      drawWorld(ctx, world, { metres, speed, pace: pace(t), t, bob: ride.bob })
      const win = panes[0]!
      // A faint sheen on the glass, falling from the top left.
      for (const p of panes) {
        const sheen = ctx.createLinearGradient(p.x, p.y, p.x + p.w * 0.6, p.y + p.h)
        sheen.addColorStop(0, 'rgba(255, 255, 255, 0.08)')
        sheen.addColorStop(0.35, 'rgba(255, 255, 255, 0.015)')
        sheen.addColorStop(0.36, 'rgba(255, 255, 255, 0.04)')
        sheen.addColorStop(0.46, 'rgba(255, 255, 255, 0)')
        ctx.fillStyle = sheen
        ctx.fillRect(p.x, p.y, p.w, p.h)
      }
      ctx.restore()
      drawNear(t, win)
      box.style.transform = `translate3d(${ride.x.toFixed(2)}px, ${ride.y.toFixed(2)}px, 0) scale(1.012)`
      // The carriage darkens a little as poles and trees take the light, and comes up out of the dark at the start.
      const dark = 1 - smooth(AT.open, AT.opened, t)
      // The other train takes the sun as it goes by.
      const passer = style.passer ? (passAt(win, t)?.cover ?? 0) : 0
      const shade = passer * 0.32
      if (dim.current) dim.current.style.opacity = String(clamp((1 - lightAt(world, metres)) * 1.4 + shade))
      el.style.setProperty('--dark', dark.toFixed(3))
      const reading = String(Math.round(speed * 3.6))
      for (const r of readouts) if (r.textContent !== reading) r.textContent = reading
      const p = Math.round(pace(t) * 400) / 400
      if (p !== lastPace) {
        lastPace = p
        el.style.setProperty('--pace', String(p))
      }
      // "fast.", on the train's own time.
      style.frame(el, t, { win, painted: word !== null })
      direct(t, passer)
    }

    /*
     * The near layer, over the landscape and under the glass: the other train,
     * and behind it the look's word, drawn together so the train covers and
     * uncovers the word in the same frame. Sharp, as the eye is on them, and
     * drawn only while something on it moves.
     */
    const drawNear = (t: number, win: Box) => {
      if (!style.passer && !word) return
      const moving = passAt(win, t) !== null || (word !== null && wordMoving(word, win, t))
      const state = moving ? String(t) : t < PASSER.at ? 'before' : 'after'
      if (state === nearDrawn) return
      nearDrawn = state
      nctx.setTransform(nearDpr, 0, 0, nearDpr, -nearBox.x * nearDpr, -nearBox.y * nearDpr)
      nctx.clearRect(nearBox.x, nearBox.y, nearBox.w, nearBox.h)
      if (style.passer) drawPasser(nctx, win, t)
      if (word) drawWord(nctx, word, win, t)
    }

    /*
     * The camera, the light and the wind on the headline, for second `t`.
     * The camera comes in tight on the window and draws back to show the
     * passengers as the carriage comes up out of the dark; it is thrown by
     * the train's lurch as it pulls; it creeps in as the speed builds,
     * trembling more the faster it goes; and the look's beats knock it, the
     * hardest when "fast." lands, when it springs back out. The view is too
     * bright at first, as eyes find it, and flashes on the beats. The speed
     * smears and leans the headline more and more until "fast." lands, when
     * it snaps back sharp, overshooting a touch.
     */
    const { climax, knocks, flashes, wind } = style.beats
    const winds = [...el.querySelectorAll<HTMLElement>('[data-wind]')]
    const direct = (t: number, passer: number) => {
      const fast = pace(t)
      const dolly = 0.085 * (1 - inOut(t / 2.6))
      const push = t < climax ? 0.035 * smooth(AT.pull, climax, t) : 0.035 * release(t, climax, 9, 4.2)
      const tremble = 0.15 + 1.3 * fast ** 1.6 + passer * 2.4
      const base = {
        x: wobble(t * 0.6, 3) * 3 + (wobble(t * 31, 1) * 0.6 + wobble(t * 53, 2) * 0.4) * tremble,
        y: wobble(t * 0.45, 7) * 2 + (wobble(t * 37, 4) * 0.6 + wobble(t * 61, 5) * 0.4) * tremble,
        turn: wobble(t * 0.35, 9) * 0.12,
        zoom: 1 + dolly + push,
      }
      // The lurch as the brakes come off: thrown back, and recovering.
      const cam = knocked(t, base, [{ at: AT.pull, x: 9, y: -2.5, zoom: -0.012, freq: 13, decay: 3.4 }, ...knocks])
      if (camera.current)
        camera.current.style.transform = `translate3d(${cam.x.toFixed(2)}px, ${cam.y.toFixed(2)}px, 0) rotate(${cam.turn.toFixed(3)}deg) scale(${cam.zoom.toFixed(4)})`
      // The light: too bright as the carriage comes up, then the beats.
      let light = 0.7 * flare(t, 0, 1.6)
      for (const f of flashes) light += f.strength * flare(t, f.at, f.decay)
      if (flash.current) flash.current.style.opacity = Math.min(1, light).toFixed(3)
      // The wind on the headline, and its snap.
      const k = (t < climax ? smooth(AT.pull + 0.7, climax - 0.02, t) ** 1.4 : release(t, climax, 24, 7.5)) * wind
      const lag = ring(t, AT.pull, 15, 4.2)
      const blur = Math.max(0, k) * 2.6
      windBlur.current?.setAttribute('stdDeviation', `${blur.toFixed(2)} 0`)
      const lean = `translateX(${(0.05 * lag - 0.05 * k).toFixed(4)}em) skewX(${(-7 * k).toFixed(2)}deg)`
      const still = Math.abs(k) < 0.004 && Math.abs(lag) < 0.01
      for (const w of winds) {
        const transform = still ? '' : lean
        if (w.style.transform !== transform) w.style.transform = transform
        const filter = blur > 0.2 ? `url(#${windId})` : ''
        if (w.style.filter !== filter) w.style.filter = filter
      }
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

    // The train sets off once the landscape is in, or after a moment without it; the words come with it, or are there at once when held still.
    const begin = () => {
      if (begun || !live) return
      begun = true
      el.dataset.begun = ''
      start = performance.now()
      if (held !== null) {
        // Held at one second: the words where their animations have them then, and the scene.
        runs = style.arrive(el)
        for (const run of runs) {
          run.pause()
          run.currentTime = held * 1000
        }
        draw(held)
      } else {
        runs = style.arrive(el)
        frame = requestAnimationFrame(tick)
      }
    }
    const waited = window.setTimeout(begin, WAIT)
    // The display face, for a word painted into the scene: a canvas draws with whatever face is in when it draws.
    const face = style.sceneWord
      ? document.fonts.load(`800 100px "${DISPLAY}"`).then(
          () => (typed = true),
          () => (typed = true),
        )
      : null
    void Promise.all([picture(PICTURES.far), picture(PICTURES.fields), picture(PICTURES.grass), face]).then(
      ([far, fields, grass]) => {
        if (!live) return
        pictures = { far, fields, grass }
        bake()
        setDrawn(true)
        begin()
        if (held !== null) draw(held)
      },
      () => begin(),
    )

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
        if (bake()) draw(held ?? now())
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
  }, [look, windId])

  const Words = LOOKS[look].Words
  return (
    <div ref={root} className={s.hero} data-ready={hydrated || undefined} data-drawn={drawn || undefined}>
      {/* What the camera sees: the view, its light, and the carriage and the words in it. */}
      <div ref={camera} className={s.camera}>
        <canvas ref={canvas} className={s.scene} aria-hidden="true" />
        <canvas ref={nearCanvas} className={s.near} aria-hidden="true" />
        <div ref={flash} className={s.flash} aria-hidden="true" />
        <div className={s.stage} style={STAGE}>
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
          </div>
          <div className={s.curtain} aria-hidden="true" />
          {/* The film's grain and the lens's dark corners: over the photograph, under the words. */}
          <div ref={grain} className={s.grain} aria-hidden="true" />
          <div className={s.vignette} aria-hidden="true" />
          {/* Until the landscape is drawn, and without scripts, a plain sky in the window. */}
          <div className={s.glass} aria-hidden="true" />
          <div className={s.words}>
            <Words />
          </div>
        </div>
      </div>
      {/* The blur the speed puts along the headline. */}
      <svg className={s.defs} aria-hidden="true">
        <defs>
          <filter id={windId} x="-30%" y="-10%" width="160%" height="120%">
            <feGaussianBlur ref={windBlur} stdDeviation="0 0" />
          </filter>
        </defs>
      </svg>
      {nav}
    </div>
  )
}
