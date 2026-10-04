import { BrandMark, LiveDot } from '@althar/ui'
import { useEffect, useRef } from 'react'

import { LINE } from '../content/facts'
import { cx } from '../lib/cx'
import { useCurrent } from '../lib/useCurrent'
import { clamp, playback } from '../lib/motion'
import { BRAND_OF, TASKS } from '../content/site'
import { Body, Follow } from './Body'
import { Masthead, PARTS } from '../shared/Masthead'
import s from './Home.module.css'
import { paint, paletteOf, type Anchor } from './scene/render'
import { stateAt, Sway, TOTAL } from './scene/timeline'

/*
 * The landing page. The site in 3D, seen from across the street at eye height
 * and set up as a two-point perspective drawing. One tower crane sets a
 * floor per task, a different agent's name on its plate each time, picking
 * each panel off the laydown and swinging it round the back of the mast.
 * Each floor's note is pinned to the building's edge. Then the scaffold
 * comes off and the crane is parked, turning in the wind, ready for the
 * next task. Below the site, the page: what it is, the agents, task 418 in
 * elevation and where it stands.
 */

const IDS = PARTS.map((p) => p.id)

export function EnterpriseHome() {
  const current = useCurrent(IDS)
  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const words = useRef<HTMLDivElement>(null)
  const chips = useRef<(HTMLDivElement | null)[]>([])
  const items = useRef<(HTMLLIElement | null)[]>([])
  const onCrane = useRef<HTMLSpanElement>(null)
  const replay = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const cv = canvas.current
    const box = stage.current
    const ctx = cv?.getContext('2d')
    if (!cv || !box || !ctx) return
    const pal = paletteOf(cv)
    const sway = new Sway()
    let W = 0
    let H = 0
    let last = 0
    let keepOut: DOMRect[] = []

    const place = (anchors: readonly Anchor[]) => {
      chips.current.forEach((el, k) => {
        if (!el) return
        const a = anchors.find((x) => x.k === k)
        if (!a) {
          el.style.visibility = 'hidden'
          return
        }
        const q = clamp((a.p - 0.42) / 0.4)
        el.style.visibility = 'visible'
        el.style.transform = `translate(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px) translate(${a.left ? '-100%' : '0'}, -50%)`
        el.style.opacity = String(Math.min(1, q * 1.6))
        const hide = `${((1 - q) * 100).toFixed(1)}%`
        el.style.clipPath = a.left ? `inset(-6px -6px -6px ${hide})` : `inset(-6px ${hide} -6px -6px)`
      })
    }

    const draw = (t: number) => {
      last = t
      const st = stateAt(t)
      const wide = W > 860
      place(paint(ctx, pal, { W, H, t, wide, keepOut }, st, sway.at(t)))
      items.current.forEach((li, k) => {
        if (li) li.style.opacity = String(0.3 + 0.7 * (st.floors[k] ?? 0))
      })
      if (onCrane.current) {
        const k = st.task ? TASKS.indexOf(st.task) : -1
        onCrane.current.textContent = st.task
          ? `On the crane: ${st.task.who} · ${st.task.task} · floor +${k + 1}`
          : st.parked
            ? 'Six floors, six notes. The crane is parked for the next task.'
            : 'Striking the scaffold'
      }
    }
    const measure = () => {
      const r = box.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      W = r.width
      H = r.height
      cv.width = Math.round(W * dpr)
      cv.height = Math.round(H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const parts = words.current ? Array.from(words.current.children) : []
      keepOut = parts.map((el) => {
        const e = el.getBoundingClientRect()
        return new DOMRect(e.x - r.x, e.y - r.y, e.width, e.height)
      })
    }
    measure()
    void document.fonts.ready.then(() => {
      measure()
      draw(last)
    })
    const ro = new ResizeObserver(() => {
      measure()
      draw(last)
    })
    ro.observe(box)
    const stop = playback({ total: TOTAL, draw, replay: replay.current, idle: true, watch: box })
    return () => {
      stop()
      ro.disconnect()
    }
  }, [])

  return (
    <div className={s.page}>
      <Masthead current={current} />

      <main id="main" tabIndex={-1}>
        <section id="site" className={s.hero} aria-labelledby="ps-h1">
          <div ref={stage} className={s.stage}>
            <canvas ref={canvas} className={s.canvas} aria-hidden="true" />
            <div className={s.notes} aria-hidden="true">
              {TASKS.map((task, k) => (
                <div
                  key={task.task}
                  ref={(el) => {
                    chips.current[k] = el
                  }}
                  className={cx(s.chip, task.you && s.you)}
                >
                  <b>{task.short}</b>
                  <span>
                    +{k + 1} · {task.task} · <BrandMark brand={BRAND_OF[task.who as keyof typeof BRAND_OF]} size={11} /> {task.who}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div ref={words} className={s.text}>
            <p className={s.kicker}>
              <span className="ch-root">
                <LiveDot ping />
              </span>
              Open source · very early · issued for comment
            </p>
            <h1 id="ps-h1" className={s.h1}>
              <span>{LINE.come}</span> <span className={s.blue}>{LINE.stay}</span>
            </h1>
            <p className={s.sub}>
              The agents are the cranes. Each one comes on site for a task and sets its floor. The building is the project, and every floor
              is something it now knows.
            </p>
            <Follow className={s.ctas} />
          </div>

          <Follow className={s.ctasNarrow} />

          <p className={s.cap}>
            <span>
              Perspective · two-point · <span ref={onCrane} className={s.onCrane} />
            </span>
            <button ref={replay} type="button" className={s.replay} hidden>
              Build it again
            </button>
          </p>
          <ol className={s.list} aria-label="What each floor keeps">
            {TASKS.map((task, k) => (
              <li
                key={task.task}
                ref={(el) => {
                  items.current[k] = el
                }}
                className={cx(task.you && s.you)}
              >
                <b>+{k + 1}</b>
                <span>{task.note}</span>
                <small>
                  {task.task} · {task.who} · {task.kind}
                </small>
              </li>
            ))}
          </ol>
        </section>

        <Body />
      </main>
    </div>
  )
}
