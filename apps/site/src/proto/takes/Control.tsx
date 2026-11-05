import { useEffect, useRef } from 'react'

import { cx } from '../../lib/cx'
import { Footer } from '../../shared/footer/Footer'
import { LightUnder } from '../../shared/lightUnder'
import { CHAPTERS } from '../chapters'
import { Arrival } from '../End'
import { clamp, held, lerp, scrubTo, useScrub } from '../scrub'
import s from './Control.module.css'

/*
 * PROTOTYPE. B: Mission control. After the first screen, the whole product
 * at once: a wall of screens in the dark, each claim on one, every picture
 * of the app running on it at the same time, the claims large enough to
 * read from the back of the room. Scrolling is the camera: it flies into
 * the first screen until the picture is as large as the page, holds there
 * while it works, pulls back and swings to the next, down the tall one,
 * and at the end back out to the whole wall, before the page goes on to
 * the download. The channels fly to any screen. On a phone the
 * wall is a column and the camera goes down it.
 */

const ORDER = ['independent', 'coordinator', 'review', 'edge', 'flow'] as const
const SCREENS = ORDER.map((id) => CHAPTERS.find((c) => c.id === id)!)

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** The room around the stage's edges that the camera keeps clear: the nav at the top, the bar at the foot. */
const ROOM = { top: 132, bottom: 92, side: 36 }

export function Control() {
  const track = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const world = useRef<HTMLDivElement>(null)
  const screens = useRef<(HTMLDivElement | null)[]>([])
  const channels = useRef<(HTMLButtonElement | null)[]>([])
  /** Where the camera stops, in the world's px, and which screen each stop is on (-1 for the whole wall). */
  const stops = useRef<{ rect: Rect; on: number }[]>([])
  const view = useRef({ x: 0, y: 0, w: 1, h: 1 })
  const last = useRef({ key: '', on: -2, still: 0 })

  // The stops, measured from the wall as it is laid out (a transform doesn't change its layout).
  useEffect(() => {
    const st = stage.current
    const wd = world.current
    if (!st || !wd) return
    const measure = () => {
      const w = st.clientWidth
      const h = st.clientHeight
      const narrow = w < 700
      const room = narrow ? { top: 70, bottom: 64, side: 12 } : ROOM
      view.current = { x: room.side, y: room.top, w: w - 2 * room.side, h: h - room.top - room.bottom }
      const aspect = view.current.h / view.current.w
      const box = (el: HTMLElement): Rect => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight })
      const all = { x: 0, y: 0, w: wd.offsetWidth, h: wd.offsetHeight }
      const list: { rect: Rect; on: number }[] = narrow ? [] : [{ rect: all, on: -1 }]
      screens.current.forEach((el, i) => {
        if (!el) return
        const r = box(el)
        // A screen taller than the view, seen across its width: its top, then its foot.
        if (r.h / r.w > aspect * 1.12) {
          const tall = r.w * aspect
          list.push({ rect: { ...r, h: tall }, on: i })
          list.push({ rect: { ...r, y: r.y + r.h - tall, h: tall }, on: i })
        } else list.push({ rect: r, on: i })
      })
      if (!narrow) list.push({ rect: all, on: -1 })
      stops.current = list
      last.current.key = ''
      track.current?.style.setProperty('--stops', String(list.length - 1))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(st)
    ro.observe(wd)
    return () => ro.disconnect()
  }, [])

  const fit = (r: Rect) => Math.min(view.current.w / r.w, view.current.h / r.h)

  useScrub(track, (p, dt) => {
    const list = stops.current
    const wd = world.current
    if (list.length < 2 || !wd) return
    const q = p * (list.length - 1)
    const i = Math.min(list.length - 2, Math.floor(q))
    const e = held(q - i, 0.22)
    const a = list[i]!.rect
    const b = list[i + 1]!.rect
    const sa = fit(a)
    const sb = fit(b)
    const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }
    const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
    // Far apart for what is in view, it pulls back on the way, as a camera would.
    const seen = view.current.w / Math.max(sa, sb)
    const bump = clamp(Math.hypot(cb.x - ca.x, cb.y - ca.y) / seen - 0.35, 0, 1.4) * 0.75
    const scale = Math.exp(lerp(Math.log(sa), Math.log(sb), e) - bump * 4 * e * (1 - e))
    const cx = lerp(ca.x, cb.x, e)
    const cy = lerp(ca.y, cb.y, e)
    const v = view.current
    const tx = v.x + v.w / 2 - cx * scale
    const ty = v.y + v.h / 2 - cy * scale
    const key = `${tx.toFixed(1)},${ty.toFixed(1)},${scale.toFixed(4)}`
    const at = last.current
    if (key !== at.key) {
      at.key = key
      at.still = 0
      wd.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`
      // Moving, it is one layer; at rest it is drawn again at its size, sharp.
      if (wd.style.willChange !== 'transform') wd.style.willChange = 'transform'
    } else {
      at.still += dt
      if (at.still > 0.18 && wd.style.willChange) wd.style.willChange = ''
    }
    // The screen in front: the stop it is at, while it holds there.
    const near = e < 0.5 ? list[i]! : list[i + 1]!
    const on = Math.abs(e - Math.round(e)) < 0.08 ? near.on : -2
    if (on !== at.on) {
      at.on = on
      screens.current.forEach((el, k) => el?.toggleAttribute('data-on', on === k))
      wd.toggleAttribute('data-close', on >= 0)
      channels.current.forEach((el, k) => el?.toggleAttribute('data-on', on === k - 1))
    }
  })

  /** Flies to a screen: the first of its stops. */
  const go = (index: number) => {
    const el = track.current
    const list = stops.current
    const at = list.findIndex((x) => x.on === index)
    if (el && at >= 0) scrubTo(el, at / (list.length - 1))
  }

  return (
    <main id="main" tabIndex={-1} className={s.control}>
      <div ref={track} className={s.track}>
        <div ref={stage} className={s.stage}>
          <LightUnder tone="ink" className={s.under} />
          <div ref={world} className={s.world}>
            {SCREENS.map((c, i) => (
              <div
                key={c.id}
                ref={(el) => {
                  screens.current[i] = el
                }}
                id={c.id}
                className={cx(s.screen, s[c.id])}
              >
                <div className={s.bezel}>
                  <span className={s.no}>{String(i + 1).padStart(2, '0')}</span>
                  <span className={s.name}>{c.name}</span>
                  <span className={s.live}>Live</span>
                </div>
                <div className={s.glass}>
                  <div className={s.head}>
                    <h2 className={s.title}>{c.title}</h2>
                    <p className={s.lead}>{c.lead}</p>
                  </div>
                  <div className={s.feed}>
                    <c.Picture />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <nav className={s.channels} aria-label="Screens">
            <button
              type="button"
              ref={(el) => {
                channels.current[0] = el
              }}
              onClick={() => track.current && scrubTo(track.current, 0)}
            >
              All
            </button>
            {SCREENS.map((c, i) => (
              <button
                key={c.id}
                type="button"
                ref={(el) => {
                  channels.current[i + 1] = el
                }}
                onClick={() => go(i)}
              >
                <i>{String(i + 1).padStart(2, '0')}</i>
                {c.name}
              </button>
            ))}
          </nav>
        </div>
      </div>
      <Arrival flow={false} />
      <Footer />
    </main>
  )
}
