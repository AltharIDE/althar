import { CopyButton } from '@althar/ui'
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'

import { AGENTS } from '../content/agents'
import { INSTALL } from '../content/facts'
import { BRAND, HERO } from '../content/home'
import { askedSecond, useHydrated, useMedia } from '../lib/browser'
import { cx } from '../lib/cx'
import { Get, OtherMac } from '../shared/Close'
import { useGrain } from '../shared/grain'
import { LightUnder } from '../shared/lightUnder'
import { addDisplay } from './display'
import s from './Hero.module.css'
import { useClock } from './hero/clock'
import { Orrery } from './hero/Orrery'
import { type Plate, plate } from './hero/plate'

/*
 * The developer page's first screen, an orrery: Althar at the middle of the
 * deep night sky as the system's sun, the mark floating there as a solid
 * (hero/Sun.tsx), a small warm light rising from it as the altar's does in
 * the footer, and the agents you already pay for each riding an orbit round
 * it, in fine line, as an astronomical plate draws them. The words in a band
 * along the foot, under a hairline rule and the figure's caption: the
 * headline at the left, the lead and the ways to get it at the right.
 *
 * The drawing is worked out for the frame (hero/plate.ts) before the first
 * paint, and again only when the frame or the band changes size. The system
 * turns (hero/system.ts): each agent rides its orbit, the inner ones faster,
 * passing behind the sun and in front of it, its name set aside where there
 * is room and fading where there isn't. One clock moves it and the sun
 * (hero/clock.ts), only while it is on screen; with reduced motion it holds
 * as composed, and `?t=` holds it that many seconds on.
 *
 * The prerender has the sky, the words and the agents' names; the drawing
 * fades up out of the dark once the page's script has measured the frame,
 * and the nav comes in after it (Nav's `opening`).
 */

addDisplay()

/** The width at which the frame is a phone's (Hero.module.css). */
const PHONE = 760
/** Where the picture may start: under the nav. */
const TOP = { wide: 104, phone: 96 }

/** "Building software / has never felt so / fast.": the line in two, the last word its own. */
const WORDS = HERO.title.split(' ')
const LINES = [WORDS.slice(0, 2).join(' '), WORDS.slice(2).join(' ')] as const

export function Hero({ nav }: { nav?: ReactNode }) {
  const root = useRef<HTMLDivElement>(null)
  const band = useRef<HTMLDivElement>(null)
  const grain = useRef<HTMLDivElement>(null)
  const [p, setP] = useState<Plate | null>(null)
  // Held still with reduced motion, followed as it changes, or for a look at one frame (`?t=`); neither while the page hydrates.
  const reduced = useMedia('(prefers-reduced-motion: reduce)')
  const frame = useHydrated() && askedSecond() !== null
  const still = reduced || frame
  const clock = useClock(root, !still)

  useGrain(grain, 11)

  // Worked out before the first paint, and again only when the frame or the band changes size.
  useLayoutEffect(() => {
    const el = root.current
    const words = band.current
    if (!el || !words) return
    let last = ''
    const measure = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      const foot = words.offsetTop
      const key = `${w}x${h}:${foot}`
      if (key === last || w < 10) return
      last = key
      const phone = w <= PHONE
      setP(plate({ w, h, foot, phone, top: phone ? TOP.phone : TOP.wide }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    ro.observe(words)
    return () => ro.disconnect()
  }, [])

  return (
    <div
      ref={root}
      className={s.hero}
      data-drawn={p ? '' : undefined}
      data-still={still ? '' : undefined}
      data-frame={frame ? '' : undefined}
    >
      {/* The nav's room, in the flow at the top. */}
      {nav}
      {/* Dark under the nav: it turns to smoked glass over the sky. */}
      <LightUnder tone="ink" className={s.under} />
      <div className={s.sky} aria-hidden="true" />
      <div ref={grain} className={s.grain} aria-hidden="true" />
      <Orrery p={p} clock={clock} still={still} className={s.drawing} />
      <div ref={band} className={s.band}>
        <p className={s.caption} aria-hidden="true">
          <b>Fig. 1</b>
          <span>{BRAND}</span>
          <i className={s.rule} />
          <span>
            {HERO.agents} <b>{AGENTS.length}</b>
          </span>
        </p>
        <h1 className={s.h1}>
          <span className={s.line}>{LINES[0]}</span> <span className={s.line}>{LINES[1]}</span>{' '}
          <span className={cx(s.line, s.fast)}>{HERO.last}</span>
        </h1>
        <div className={s.side}>
          <p className={s.lead}>{HERO.lead}</p>
          <div className={s.ways}>
            <Get tone="blue" />
            <OtherMac tone="blue" />
          </div>
          <div className={s.install}>
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
        </div>
      </div>
    </div>
  )
}
