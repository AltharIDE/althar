import { Light } from '@althar/ui'
import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { cx } from '../../../lib/cx'
import { TwoLabReview } from '../kit/app'
import { Shot } from '../kit/Shot'
import t from '../kit/type.module.css'
import { Handoff } from './Handoff'
import { Plans } from './Plans'
import s from './Trio.module.css'

/*
 * Your plans, out of usage, and review: three moments of the same idea, on
 * one stage in Althar's light. The stage stays while you scroll; each piece
 * floats in from below, slightly turned, stands, and floats away up as the
 * next comes in, its title changing over it. The steps down the side say
 * where you are and take you to one. On a phone the three stand one under
 * the other in the same light, without the stage.
 */

interface Step {
  id: string
  label: string
  kicker: string
  title: ReactNode
  lead: string
  /** How wide the piece is laid out, in px, before it is scaled to fit the stage. */
  width: number
  piece: (on: boolean) => ReactNode
}

const STEPS: Step[] = [
  {
    id: 'plans',
    label: 'Your plans',
    kicker: 'Your plans',
    title: (
      <>
        Every plan you pay for. <b>All at once.</b>
      </>
    ),
    lead: 'Sign in to each agent as many times as you have plans: work and personal, Max and Pro, a key for OpenCode. Althar uses them all, in the order you set.',
    width: 1060,
    piece: (on) => <Plans play={on} />,
  },
  {
    id: 'limits',
    label: 'Limits',
    kicker: 'Limits',
    title: (
      <>
        Out of usage? <b>It carries on.</b>
      </>
    ),
    lead: 'A plan runs out halfway through a task. The task doesn’t stop: the next agent you’re signed in to picks it up where it was.',
    width: 1060,
    piece: (on) => <Handoff play={on} />,
  },
  {
    id: 'review',
    label: 'Review',
    kicker: 'Review',
    title: (
      <>
        Written by one lab. <b>Reviewed by another.</b>
      </>
    ),
    lead: 'Sonnet and Gemini read what Opus wrote. The lead fixes what they find and sends it round again. Only what they can’t settle comes to you.',
    width: 760,
    piece: () => (
      <div className={s.reviewCard}>
        <Shot
          w={740}
          phoneW={460}
          maxScale={1}
          label="A review by Sonnet 5 and Gemini 3 Pro: three findings, two fixed by the lead, one waiting for your call"
        >
          <TwoLabReview />
        </Shot>
      </div>
    ),
  },
]

const still = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(prefers-reduced-motion: reduce)').matches || new URLSearchParams(window.location.search).has('t'))

/** Whether the page is a phone's width: the three then stand one under the other. */
function useNarrow() {
  const query = '(max-width: 900px)'
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const q = window.matchMedia(query)
    const on = () => setNarrow(q.matches)
    q.addEventListener('change', on)
    return () => q.removeEventListener('change', on)
  }, [])
  return narrow
}

/** A piece laid out at `width` and scaled down, never up, to fit the box it is given. */
function Fit({ width, children }: { width: number; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useLayoutEffect(() => {
    const outer = box.current
    const el = inner.current
    if (!outer || !el) return
    const measure = () => {
      const k = Math.min(1, outer.clientWidth / width, outer.clientHeight / Math.max(1, el.offsetHeight))
      setScale((was) => (Math.abs(was - k) < 0.002 ? was : k))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(outer)
    ro.observe(el)
    return () => ro.disconnect()
  }, [width])
  return (
    <div ref={box} className={s.fit}>
      <div ref={inner} className={s.fitInner} style={{ width, transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  )
}

export function Trio() {
  const narrow = useNarrow()
  const section = useRef<HTMLElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState(0)
  const [inView, setInView] = useState(false)

  // Which step the scroll is on: the section's length split in three.
  useEffect(() => {
    if (narrow) return
    const el = section.current
    if (!el) return
    let frame = 0
    const read = () => {
      frame = 0
      const r = el.getBoundingClientRect()
      const run = Math.max(1, r.height - window.innerHeight)
      const p = Math.min(0.999, Math.max(0, -r.top / run))
      setAt(Math.floor(p * STEPS.length))
      setInView(r.top < window.innerHeight * 0.6 && r.bottom > window.innerHeight * 0.4)
    }
    const on = () => {
      if (!frame) frame = requestAnimationFrame(read)
    }
    read()
    window.addEventListener('scroll', on, { passive: true })
    window.addEventListener('resize', on)
    return () => {
      window.removeEventListener('scroll', on)
      window.removeEventListener('resize', on)
      cancelAnimationFrame(frame)
    }
  }, [narrow])

  // The standing piece leans a little toward the pointer.
  useEffect(() => {
    const el = stage.current
    if (!el || narrow || !window.matchMedia('(hover: hover) and (prefers-reduced-motion: no-preference)').matches) return
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      el.style.setProperty('--tx', (((e.clientX - r.left) / r.width - 0.5) * 2).toFixed(3))
      el.style.setProperty('--ty', (((e.clientY - r.top) / r.height - 0.5) * 2).toFixed(3))
    }
    const leave = () => {
      el.style.removeProperty('--tx')
      el.style.removeProperty('--ty')
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', leave)
    return () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', leave)
    }
  }, [narrow])

  /** Scrolls to the place in the section where step `i` stands. */
  const goTo = (i: number) => {
    const el = section.current
    if (!el) return
    const top = el.getBoundingClientRect().top + window.scrollY
    const run = el.offsetHeight - window.innerHeight
    window.scrollTo({ top: top + run * ((i + 0.5) / STEPS.length), behavior: still() ? 'auto' : 'smooth' })
  }

  if (narrow)
    return (
      <section className={cx(s.trio, s.stacked)} aria-label="Your plans, limits and review">
        <div className={s.light} aria-hidden="true">
          <Light height={0.4} />
        </div>
        {STEPS.map((step) => (
          <div key={step.id} id={step.id} className={s.stackedStep}>
            <div className={s.head}>
              <p className={t.kicker}>
                <i aria-hidden="true" />
                {step.kicker}
              </p>
              <h2 className={cx(t.title, s.title)}>{step.title}</h2>
              <p className={t.lead}>{step.lead}</p>
            </div>
            <div className={s.stackedPiece}>{step.piece(true)}</div>
          </div>
        ))}
      </section>
    )

  return (
    <section ref={section} className={s.trio} style={{ '--n': STEPS.length } as CSSProperties} aria-label="Your plans, limits and review">
      {/* Where each step stands, for the nav's links. */}
      {STEPS.map((step, i) => (
        <span key={step.id} id={step.id} className={s.anchor} style={{ top: `${(i / STEPS.length) * 100}%` }} />
      ))}
      <div className={s.sticky}>
        <div className={s.panel}>
          <div className={s.light} aria-hidden="true">
            <Light height={0.72} />
          </div>
          <div ref={stage} className={s.steps}>
            {STEPS.map((step, i) => (
              <div key={step.id} className={cx(s.step, i < at && s.past, i === at && s.now, i > at && s.next)} aria-hidden={i !== at}>
                <div className={s.head}>
                  <p className={t.kicker}>
                    <i aria-hidden="true" />
                    {step.kicker}
                  </p>
                  <h2 className={cx(t.title, s.title)}>{step.title}</h2>
                  <p className={cx(t.lead, s.lead)}>{step.lead}</p>
                </div>
                <div className={s.stage}>
                  <Fit width={step.width}>
                    <div className={s.tilt}>{step.piece(i === at && inView)}</div>
                  </Fit>
                </div>
              </div>
            ))}
          </div>
          <ol className={s.index} aria-label="In this part">
            {STEPS.map((step, i) => (
              <li key={step.id}>
                <button
                  type="button"
                  className={cx(s.indexItem, i === at && s.indexOn)}
                  aria-current={i === at ? 'step' : undefined}
                  onClick={() => goTo(i)}
                >
                  <span>{String(i + 1).padStart(2, '0')}</span>
                  {step.label}
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  )
}
