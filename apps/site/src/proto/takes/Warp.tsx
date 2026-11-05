import { type CSSProperties, useEffect, useRef } from 'react'

import { cx } from '../../lib/cx'
import { Footer } from '../../shared/footer/Footer'
import { LightUnder } from '../../shared/lightUnder'
import { CHAPTERS } from '../chapters'
import { Arrival } from '../End'
import { clamp, inCubic, outCubic, smooth, useScrub } from '../scrub'
import s from './Warp.module.css'

/*
 * PROTOTYPE. A: Warp. The first screen ends on "fast.", and then the reader's
 * own scrolling is the throttle: the stage pins, the stars stream past as
 * fast as they scroll (still when they stop, streaking when they fling it),
 * and each claim's picture comes up out of the vanishing point, small and
 * far, grows into place and holds there, working, while its words stand
 * over it; scroll on and it rushes past and the next is already coming.
 * Scrolling back flies back. After the last, the stage lets go and the page
 * drops out of warp over the planet's lit edge, where the rest of it is:
 * what keeps you in flow, and the console to download from.
 */

const STATIONS = (['independent', 'coordinator', 'review', 'edge'] as const).map((id) => CHAPTERS.find((c) => c.id === id)!)
/** Each picture's shape, so it is as large as the stage lets it be. */
const AR: Record<string, number> = { independent: 1440 / 780, coordinator: 1, review: 1.6, edge: 1.5 }

/** How deep a picture waits before it comes, and how near it passes, in px against the stage's perspective. */
const FAR = 3400
const NEAR = 960
/** How long each picture holds still, as a share of the way from one to the next, at either side. */
const HOLD = 0.17
/** Where the stage starts and ends, in stations: the first already coming as it pins, the last gone as it lets go. */
const FROM = -0.62
const TO = STATIONS.length - 1 + 0.7

/** A picture's place, `t` stations after it: null when it is out of sight. */
const place = (t: number) => {
  if (t <= -1 || t >= 0.62) return null
  if (t < -HOLD) {
    const a = (t + 1) / (1 - HOLD)
    // It shows once the one before has mostly gone by.
    return { z: -FAR * (1 - outCubic(a)), o: smooth(0.32, 0.7, a) }
  }
  if (t <= HOLD) return { z: 0, o: 1 }
  const b = (t - HOLD) / (0.62 - HOLD)
  return { z: NEAR * inCubic(b), o: 1 - smooth(0.05, 0.75, b) }
}

/** A seeded random, so the sky is the same each time. */
const seeded = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647
  return (seed - 1) / 2147483646
}

const DEPTH = 4200

/** The stars, in depth, drawn from where the camera is; their streaks as long as it is fast. */
function starfield(cv: HTMLCanvasElement) {
  const ctx = cv.getContext('2d')
  if (!ctx) return null
  const rand = seeded(11)
  const stars = Array.from({ length: 1200 }, () => ({
    x: (rand() * 2 - 1) * 2400,
    y: (rand() * 2 - 1) * 1500,
    z: rand() * DEPTH,
    tint: rand(),
  }))
  let w = 0
  let h = 0
  const size = () => {
    w = cv.clientWidth
    h = cv.clientHeight
    const dpr = Math.min(1.5, window.devicePixelRatio || 1)
    cv.width = Math.round(w * dpr)
    cv.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  size()
  return {
    size,
    draw(cam: number, v: number, cy: number) {
      ctx.clearRect(0, 0, w, h)
      const cx = w / 2
      const f = Math.max(w, h) * 0.55
      const speed = clamp(Math.abs(v) / 2.2)
      // The way ahead glows as it goes faster.
      if (speed > 0.01) {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.55)
        g.addColorStop(0, `rgba(70, 86, 255, ${0.26 * speed})`)
        g.addColorStop(0.4, `rgba(90, 60, 240, ${0.08 * speed})`)
        g.addColorStop(1, 'rgba(60, 76, 255, 0)')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
      }
      const trail = clamp(Math.abs(v) * 1100, 0, 3000) * Math.sign(v)
      ctx.lineCap = 'round'
      for (const st of stars) {
        const d = ((((st.z - cam) % DEPTH) + DEPTH) % DEPTH) + 30
        const sx = cx + (st.x * f) / d
        const sy = cy + (st.y * f) / d
        if (sx < -80 || sx > w + 80 || sy < -80 || sy > h + 80) continue
        const d2 = clamp(d + trail, 30, DEPTH)
        const tx = cx + (st.x * f) / d2
        const ty = cy + (st.y * f) / d2
        const near = 1 - d / DEPTH
        const a = near * near * (0.6 + 0.4 * speed)
        ctx.strokeStyle =
          st.tint > 0.82 ? `rgba(174, 182, 255, ${a})` : st.tint > 0.7 ? `rgba(255, 214, 172, ${a * 0.9})` : `rgba(255, 255, 255, ${a})`
        ctx.lineWidth = 0.5 + near * 1.7
        ctx.beginPath()
        ctx.moveTo(tx, ty)
        ctx.lineTo(sx + 0.01, sy)
        ctx.stroke()
      }
    },
  }
}

const say = (el: HTMLElement | null, text: string) => {
  if (el && el.textContent !== text) el.textContent = text
}

export function Warp() {
  const track = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const cards = useRef<(HTMLDivElement | null)[]>([])
  const heads = useRef<(HTMLDivElement | null)[]>([])
  const velocity = useRef<HTMLElement>(null)
  const station = useRef<HTMLElement>(null)
  const sky = useRef<ReturnType<typeof starfield>>(null)
  const at = useRef({ q: FROM, cam: 0, v: 0, on: -2 })

  useEffect(() => {
    const cv = canvas.current
    if (!cv) return
    sky.current = starfield(cv)
    const ro = new ResizeObserver(() => sky.current?.size())
    ro.observe(cv)
    return () => ro.disconnect()
  }, [])

  useScrub(track, (p, dt) => {
    const st = at.current
    const q = FROM + p * (TO - FROM)
    const dq = q - st.q
    st.q = q
    // How fast the reader is going, in stations a second, eased so a flick swells and settles.
    const v = dt > 0 ? dq / dt : 0
    st.v += (v - st.v) * Math.min(1, dt * (Math.abs(v) > Math.abs(st.v) ? 10 : 3))
    st.cam += dq * 2600 + dt * 70
    const el = stage.current
    const top = el ? parseFloat(getComputedStyle(el).getPropertyValue('--top')) || 0 : 0
    const h = el?.clientHeight ?? 0
    sky.current?.draw(st.cam, st.v, top + (h - top - 56) / 2)

    let current = -1
    STATIONS.forEach((_, i) => {
      const card = cards.current[i]
      if (!card) return
      const where = place(q - i)
      if (!where) {
        if (card.style.display !== 'none') card.style.display = 'none'
        return
      }
      if (card.style.display) card.style.display = ''
      card.style.transform = `translate3d(0, 0, ${where.z.toFixed(1)}px)`
      card.style.opacity = where.o.toFixed(3)
      if (Math.abs(q - i) < 0.3) current = i
    })
    if (current !== st.on) {
      st.on = current
      heads.current.forEach((head, i) => head?.toggleAttribute('data-on', i === current))
      say(station.current, current < 0 ? '—' : `${String(current + 1).padStart(2, '0')} / ${String(STATIONS.length).padStart(2, '0')}`)
    }
    say(velocity.current, `${(Math.abs(st.v) * 0.297 + 0.0004 * (1 + Math.sin(st.cam / 400))).toFixed(3)} c`)
  })

  return (
    <main id="main" tabIndex={-1} className={s.warp}>
      <div ref={track} className={s.track} style={{ '--stations': TO - FROM } as CSSProperties}>
        <div ref={stage} className={s.stage}>
          <LightUnder tone="ink" className={s.under} />
          <canvas ref={canvas} className={s.stars} aria-hidden="true" />
          <div className={s.space}>
            {STATIONS.map((c, i) => (
              <div
                key={c.id}
                ref={(el) => {
                  cards.current[i] = el
                }}
                className={cx(s.card, s[c.id])}
                style={{ '--ar': AR[c.id], display: 'none' } as CSSProperties}
              >
                <c.Picture />
              </div>
            ))}
          </div>
          {STATIONS.map((c, i) => (
            <div
              key={c.id}
              ref={(el) => {
                heads.current[i] = el
              }}
              id={c.id}
              className={s.head}
            >
              <p className={s.mark}>
                <span>{String(i + 1).padStart(2, '0')}</span>
                {c.name}
              </p>
              <h2 className={s.headline}>{c.title}</h2>
              <p className={s.lead}>{c.lead}</p>
            </div>
          ))}
          <div className={s.deck} aria-hidden="true">
            <span>
              <i>Velocity</i>
              <b ref={velocity}>0.000 c</b>
            </span>
            <span className={s.end}>
              <i>Station</i>
              <b ref={station}>—</b>
            </span>
          </div>
        </div>
      </div>
      <Arrival />
      <Footer />
    </main>
  )
}
