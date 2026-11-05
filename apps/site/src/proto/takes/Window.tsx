import { type CSSProperties, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import skyUrl from '../../home/hero/plate/sky.webp'
import h from '../../home/Hero.module.css'
import t from '../../home/bodies/kit/type.module.css'
import { Hero } from '../../home/Hero'
import { cx } from '../../lib/cx'
import { Get, OtherMac } from '../../shared/Close'
import { Footer } from '../../shared/footer/Footer'
import { NavSpace } from '../../shared/Nav'
import { CHAPTERS, END } from '../chapters'
import { clamp, smooth, useScrub } from '../scrub'
import s from './Window.module.css'

/*
 * PROTOTYPE. C: The window. The reader never leaves the capsule. The first
 * screen stays where it is while they scroll, and the camera leans in: the
 * headline and the console fade, and the window itself comes on as a
 * display, the sky dimming behind the glass, a line of light opening into
 * a picture. On it, Althar at work, a claim at a time, the two astronauts
 * watching, the cabin lit by it, the claim's words on the dark under the
 * window where the console was. Scroll on and it changes channel; after the
 * last it goes off, the sky comes back, and the capsule comes down through
 * the cloud onto the ground, where the rest of the page is.
 */

const SHOWN = (['independent', 'coordinator', 'review', 'edge'] as const).map((id) => CHAPTERS.find((c) => c.id === id)!)
const FLOW = CHAPTERS.find((c) => c.id === 'flow')!
/** Each picture's shape, so it fills the glass as far as it can. */
const AR: Record<string, number> = { independent: 1440 / 780, coordinator: 1, review: 1.6, edge: 1.5 }

/** The scroll, in steps: leaning in and the display coming on, each picture, then off. */
const ON = 0.7
const LAST = ON + SHOWN.length - 1 + 0.5
const STEPS = LAST + 0.9

const fade = (el: HTMLElement | null | undefined, o: number) => {
  if (!el) return
  const v = o.toFixed(3)
  if (el.style.opacity !== v) el.style.opacity = v
}

export function Window() {
  const track = useRef<HTMLDivElement>(null)
  const pin = useRef<HTMLDivElement>(null)
  const [hosts, setHosts] = useState<{ stage: HTMLElement; plate: HTMLElement } | null>(null)
  const parts = useRef<{ root?: HTMLElement; h1?: HTMLElement; hud?: HTMLElement; deck?: HTMLElement }>({})
  const display = useRef<HTMLDivElement>(null)
  const lit = useRef<HTMLDivElement>(null)
  const feeds = useRef<(HTMLDivElement | null)[]>([])
  const heads = useRef<(HTMLDivElement | null)[]>([])
  const on = useRef(-2)

  // The first screen's own stage and photograph, to set the display behind the glass and its light on the cabin.
  useLayoutEffect(() => {
    const root = pin.current
    const find = (c: string | undefined) => (c ? (root?.querySelector<HTMLElement>(`.${CSS.escape(c)}`) ?? undefined) : undefined)
    const stage = find(h.stage)
    const plate = find(h.plate)
    parts.current = { root: find(h.hero), h1: find(h.h1), hud: find(h.hud), deck: find(h.deck) }
    if (stage && plate) setHosts({ stage, plate })
  }, [])

  useScrub(track, (p) => {
    const q = p * STEPS
    const { root, h1, hud, deck } = parts.current
    // Leaning in: the words and the console go, the camera comes a little nearer the glass.
    const lean = smooth(0, ON, q) * (1 - smooth(LAST + 0.3, STEPS, q))
    fade(h1, 1 - smooth(0.04, 0.32, q) + smooth(LAST + 0.45, STEPS, q))
    fade(hud, 1 - smooth(0.04, 0.32, q) + smooth(LAST + 0.45, STEPS, q))
    fade(deck, 1 - smooth(0.02, 0.24, q))
    if (root) root.style.transform = lean > 0.001 ? `scale(${(1 + 0.05 * lean).toFixed(4)})` : ''
    // The display: a line of light opening into the picture, and closing again after the last.
    const power = smooth(0.28, ON, q) * (1 - smooth(LAST + 0.05, LAST + 0.45, q))
    const el = display.current
    if (el) {
      el.style.setProperty('--power', power.toFixed(4))
      el.style.visibility = power > 0.001 ? '' : 'hidden'
    }
    if (lit.current) lit.current.style.opacity = (0.9 * power).toFixed(3)
    // A picture at a time; between two, the channel changes.
    const at = q - ON
    let current = -1
    SHOWN.forEach((_, i) => {
      const feed = feeds.current[i]
      if (!feed) return
      const d = at - i
      const o = power < 0.02 ? 0 : clamp(1 - Math.max(0, Math.abs(d) - 0.36) / 0.14)
      if (o <= 0) {
        if (feed.style.display !== 'none') feed.style.display = 'none'
        return
      }
      if (feed.style.display) feed.style.display = ''
      fade(feed, o)
      feed.style.transform = `translate(-50%, -50%) scale(${(1 + (0.04 * Math.max(0, Math.abs(d) - 0.36)) / 0.14).toFixed(4)})`
      if (Math.abs(d) < 0.42 && power > 0.5) current = i
    })
    // The changing channel: a bright sweep, most as one picture gives way to the next.
    const between = SHOWN.slice(1).reduce((most, _, i) => Math.max(most, 1 - Math.min(1, Math.abs(at - (i + 0.5)) / 0.12)), 0)
    el?.style.setProperty('--sweep', (between * power).toFixed(3))
    el?.style.setProperty('--sweep-at', `${((at % 1) + 1) % 1}`)
    if (current !== on.current) {
      on.current = current
      heads.current.forEach((head, i) => head?.toggleAttribute('data-on', i === current))
    }
  })

  return (
    <main id="main" tabIndex={-1} className={s.window}>
      <div ref={track} className={s.track} style={{ '--steps': STEPS } as CSSProperties}>
        <div ref={pin} className={s.pin}>
          <Hero nav={<NavSpace />} />
          {SHOWN.map((c, i) => (
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
        </div>
      </div>
      {hosts &&
        createPortal(
          <div ref={display} className={s.display} style={{ visibility: 'hidden' } as CSSProperties} aria-hidden="true">
            {SHOWN.map((c, i) => (
              <div
                key={c.id}
                ref={(el) => {
                  feeds.current[i] = el
                }}
                className={cx(s.feed, s[c.id])}
                style={{ '--ar': AR[c.id], display: 'none' } as CSSProperties}
              >
                <c.Picture />
              </div>
            ))}
          </div>,
          hosts.stage,
        )}
      {hosts && createPortal(<div ref={lit} className={s.lit} aria-hidden="true" />, hosts.plate)}

      {/* Down through the cloud, onto the ground. */}
      <section className={s.landing} aria-labelledby="flow-h">
        <div className={s.through} aria-hidden="true">
          <div className={s.cloud} style={{ backgroundImage: `url(${skyUrl})` }} />
        </div>
        <div className={s.ground}>
          <h2 id="flow-h" className={cx(t.title, s.title)}>
            {FLOW.title}
          </h2>
          <p className={cx(t.lead, s.groundLead)}>{FLOW.lead}</p>
        </div>
        <FLOW.Picture />
        <div className={s.end}>
          <h2 className={cx(t.title, s.endTitle)}>
            {END.line} <b>{END.bold}</b>
          </h2>
          <div className={s.get}>
            <Get tone="paper" />
            <OtherMac tone="paper" />
          </div>
        </div>
      </section>
      <Footer />
    </main>
  )
}
