import { type CSSProperties, type RefObject, useEffect, useRef, useState } from 'react'

import skyUrl from '../../home/hero/plate/sky.webp'
import t from '../../home/bodies/kit/type.module.css'
import { cx } from '../../lib/cx'
import { Get, OtherMac } from '../../shared/Close'
import { Footer } from '../../shared/footer/Footer'
import { LightUnder } from '../../shared/lightUnder'
import { CHAPTERS, END } from '../chapters'
import s from './Descent.module.css'

/*
 * PROTOTYPE. A: Descent. The first screen ends in orbit, and the page goes
 * on falling from there: one sky, no panels, darkest at the top and turning
 * to night blue as it drops, each claim at its own altitude, an altimeter at
 * the edge reading the fall. At the foot it breaks through the cloud (the
 * first screen's own photograph) and lands on the paper of the footer's
 * engraving, with the download.
 */

/** The sky at each chapter's top, and at the cloud. */
const SKY = ['#050302', '#05050a', '#070915', '#090d20', '#0b112b', '#0e1636']
/** The altitude each chapter is read at, in km. */
const AT_KM = [32, 24, 16, 9, 3]

/** An altitude, as the flight deck reads it: km above one, m under it. */
const read = (km: number) => (km >= 1 ? `${km.toFixed(2)} km` : `${Math.round(km * 1000)} m`)

/** The altimeter, at the edge: how far down the sky the reader is, and the chapter they are in. */
function Altimeter({ sky }: { sky: RefObject<HTMLDivElement | null> }) {
  const [state, setState] = useState({ km: 38, on: false, at: -1 })
  useEffect(() => {
    let frame = 0
    const measure = () => {
      frame = 0
      const el = sky.current
      if (!el) return
      const box = el.getBoundingClientRect()
      const mid = window.innerHeight * 0.5
      const p = Math.min(1, Math.max(0, (mid - box.top) / box.height))
      // Faster high up, slowing towards the ground, as the first screen's capsule does.
      const km = 38 * (1 - p) ** 1.5
      const marks = [...el.querySelectorAll<HTMLElement>('[data-chapter]')]
      let at = -1
      marks.forEach((m, i) => {
        if (m.getBoundingClientRect().top < mid) at = i
      })
      const on = box.top < window.innerHeight * 0.6 && box.bottom > window.innerHeight * 0.3
      setState((was) => (was.on === on && was.at === at && Math.abs(was.km - km) < 0.005 ? was : { km, on, at }))
    }
    const ask = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', ask, { passive: true })
    window.addEventListener('resize', ask)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', ask)
      window.removeEventListener('resize', ask)
    }
  }, [sky])
  return (
    <div className={s.altimeter} data-on={state.on || undefined} aria-hidden="true">
      <i>Altitude</i>
      <b>{read(state.km)}</b>
      <ol className={s.scale}>
        {CHAPTERS.map((c, i) => (
          <li key={c.id} data-here={i === state.at || undefined} data-past={i < state.at || undefined}>
            {c.name}
          </li>
        ))}
        <li>Ground</li>
      </ol>
    </div>
  )
}

export function Descent() {
  const sky = useRef<HTMLDivElement>(null)
  return (
    <main id="main" tabIndex={-1} className={s.descent}>
      <div ref={sky} className={s.sky}>
        {/* Dark all the way down: the nav stays smoked glass over it. */}
        <LightUnder tone="ink" className={s.under} />
        {CHAPTERS.map((c, i) => (
          <section
            key={c.id}
            id={c.id}
            className={cx(s.chapter, s[c.id])}
            style={{ '--from': SKY[i], '--to': SKY[i + 1] } as CSSProperties}
            aria-labelledby={`${c.id}-h`}
          >
            <div className={s.head} data-chapter>
              <p className={s.mark}>
                <span>{read(AT_KM[i] ?? 0)}</span>
                {c.name}
              </p>
              <h2 id={`${c.id}-h`} className={cx(t.title, s.title)}>
                {c.title}
              </h2>
              <p className={cx(t.lead, s.lead)}>{c.lead}</p>
            </div>
            <c.Picture />
          </section>
        ))}
      </div>
      {/* Through the cloud, and down onto the ground. */}
      <section className={s.landing} aria-label="Download Althar">
        <div className={s.cloud} style={{ backgroundImage: `url(${skyUrl})` }} aria-hidden="true" />
        <div className={s.ground}>
          <p className={s.mark}>
            <span>0 m</span>
            Ground
          </p>
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
      <Altimeter sky={sky} />
    </main>
  )
}
