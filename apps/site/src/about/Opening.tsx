import { springEasing } from '@althar/ui/opening'
import { type CSSProperties, useEffect, useRef, useState } from 'react'

import { ABOUT_HEAD } from '../content/about'
import { addDisplay } from '../home/display'
import { cx } from '../lib/cx'
import { Glow } from '../shared/Glow'
import { NavSpace } from '../shared/Nav'
import s from './Opening.module.css'
import { still, useSteps } from './parts'
import { PANES, type Pane } from './wall'

/*
 * The about page's first screen. It opens on what working with agents looks
 * like today: a dozen terminals all talking at once, asking, failing,
 * hitting limits. Then they fall quiet one by one, the ink lifts off the
 * paper, Althar's light rises off the floor and the words come up in it,
 * white, in the display cut. With reduced motion, or `?t`, the light is
 * standing and the words are there.
 */

addDisplay()

/** When the wall falls quiet, the ink lifts, the light rises and the words come, in ms after opening. */
const STEPS = [2600, 3900, 4000, 4600] as const
/** How many lines a pane shows: its newest. */
const LINES = 13
/** How far apart the panes fall quiet, in the order below. */
const QUIET_STEP = 95

/** The order the panes fall quiet in: fixed, so the quiet crosses the wall the same way each time. */
const QUIET_ORDER = PANES.map((_, i) => ({ i, k: Math.sin(i * 91.7 + 3.1) }))
  .sort((a, b) => a.k - b.k)
  .map((x) => x.i)

/** One terminal, printing its lines as its tool would, the newest at the foot. One that asks waits on its question. */
function Term({ pane, count, quiet, at }: { pane: Pane; count: number; quiet: boolean; at: number }) {
  const len = pane.lines.length
  const from = Math.max(0, count - LINES)
  const shown = Array.from({ length: count - from }, (_, k) => pane.lines[(from + k) % len]!)
  const waiting = pane.waits === true && count >= len
  return (
    <div className={cx(s.pane, quiet && s.paneQuiet)} style={{ '--q': `${at * QUIET_STEP}ms` } as CSSProperties}>
      <p className={s.paneTitle}>
        <i />
        <i />
        <i />
        <span>{pane.title}</span>
      </p>
      <div className={s.paneBody}>
        {shown.map((line, k) => (
          <p key={from + k} className={s.line} data-tone={line.tone}>
            {line.text}
          </p>
        ))}
        <p className={s.line}>
          <span className={cx(s.cursor, waiting && s.cursorWaits)} />
        </p>
      </div>
    </div>
  )
}

/** The wall: every pane printing on a beat of its own until `quiet`, full from the first frame. */
function Wall({ quiet, gone }: { quiet: boolean; gone: boolean }) {
  const [counts, setCounts] = useState(() => PANES.map((p, i) => (p.waits ? p.lines.length - 3 - (i % 2) : p.lines.length + 4 + (i % 5))))
  useEffect(() => {
    if (quiet || still()) return
    const timer = window.setInterval(() => {
      setCounts((now) =>
        now.map((c, i) => {
          const pane = PANES[i]!
          if (pane.waits && c >= pane.lines.length) return c
          return Math.random() < 0.16 + (i % 3) * 0.07 ? c + 1 : c
        }),
      )
    }, 90)
    return () => window.clearInterval(timer)
  }, [quiet])
  return (
    <div className={cx(s.wall, gone && s.wallGone)} aria-hidden="true">
      {PANES.map((pane, i) => (
        <Term key={pane.title} pane={pane} count={counts[i]!} quiet={quiet} at={QUIET_ORDER.indexOf(i)} />
      ))}
    </div>
  )
}

export function Opening() {
  const step = useSteps(STEPS)
  const words = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = words.current
    if (!el || step < STEPS.length) return
    const rise = springEasing(0.7, 0.82)
    el.querySelectorAll<HTMLElement>('[data-word]').forEach((w, i) => {
      if (still()) return void (w.style.opacity = '1')
      w.animate(
        [
          { opacity: 0, transform: 'translateY(0.4em)', filter: 'blur(8px)' },
          { opacity: 1, transform: 'none', filter: 'blur(0)' },
        ],
        { duration: rise.duration + 300, easing: rise.easing, delay: i * 70, fill: 'both' },
      )
    })
  }, [step])
  return (
    <header className={s.opening}>
      <div className={cx(s.light, step >= 3 && s.lightUp)}>
        <Glow heart={typeof window !== 'undefined' && window.innerWidth < 700 ? 0.8 : 0.5} className={s.glow} />
      </div>
      <Wall quiet={step >= 1} gone={step >= 2} />
      <NavSpace />
      <div ref={words} className={s.words}>
        <p className={s.kicker} data-word>
          <i aria-hidden="true" />
          {ABOUT_HEAD.kicker}
        </p>
        <h1 className={s.title}>
          {ABOUT_HEAD.title.map((line, l) => (
            <span key={line} className={cx(s.titleLine, l === 1 && s.heavy)}>
              {line.split(' ').map((w, i) => (
                <span key={i}>
                  <span className={s.word} data-word>
                    {w}
                  </span>{' '}
                </span>
              ))}
            </span>
          ))}
        </h1>
        <p className={s.lead} data-word>
          {ABOUT_HEAD.lead}
        </p>
      </div>
    </header>
  )
}
