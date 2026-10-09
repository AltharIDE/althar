import { Turn, WorkedFor, You } from '@althar/ui'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { cx } from '../../../lib/cx'
import { DOCS_PLAN, Launch, ProjectWindow, useAssembling } from '../kit/app'
import { Desktop, MacWindow } from '../kit/Mac'
import { useSeen } from '../kit/seen'
import { Shot } from '../kit/Shot'
import { Slab } from '../kit/Slab'
import t from '../kit/type.module.css'
import s from './Lift.module.css'

/*
 * The coordinator, in two moments on one stage that stays while you scroll.
 * First the window: Meridian's coordinator, the conversation alone, where
 * you asked for two things and it answered with a plan for each. Then, as
 * you scroll on, the first plan comes out of the window: it lifts off the
 * screen, turns into the room, grows, and settles at the left, while the
 * window steps back to the right and the title above turns from the
 * coordinator to the team it put together. Scrolling back puts it back.
 * On a phone the two moments stand one under the other.
 */

/** How wide the plan is laid out, in px: as wide as it is in the window. */
const W = 712

const HEADS: ReadonlyArray<{ kicker: string; title: ReactNode; lead: string }> = [
  {
    kicker: 'The coordinator',
    title: (
      <>
        Every project has <b>a coordinator.</b>
      </>
    ),
    lead: 'One for each project. It knows the repositories and your rules, and it’s where you ask for things: in a sentence, or from an issue in your tracker.',
  },
  {
    kicker: 'The team',
    title: (
      <>
        It picks <b>a team for each task.</b>
      </>
    ),
    lead: 'It splits what you asked for into tasks and gives each step the model that suits it: Opus to write, Codex to dry-run, Sonnet and Gemini to review.',
  },
]

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x))
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2)
const lerp = (a: number, b: number, k: number) => a + (b - a) * k

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

function Head({ i, className, hidden }: { i: number; className?: string; hidden?: boolean }) {
  const head = HEADS[i]!
  return (
    <div className={cx(s.head, className)} aria-hidden={hidden || undefined}>
      <p className={t.kicker}>
        <i aria-hidden="true" />
        {head.kicker}
      </p>
      <h2 className={cx(t.title, s.title)}>{head.title}</h2>
      <p className={cx(t.lead, s.lead)}>{head.lead}</p>
    </div>
  )
}

/** The coordinator's conversation: your ask, what it read, its answer, and a plan for each task. `spot` holds the first plan. */
function Thread({
  steps,
  docs,
  spot,
}: {
  steps: ReturnType<typeof useAssembling>
  docs: ReturnType<typeof useAssembling>
  spot?: (el: HTMLDivElement | null) => void
}) {
  return (
    <>
      <You at="10:58">
        Backfill idempotency keys on the refunds made before PR 1184 (it’s MER-231), and fix the refunds docs while you’re there.
      </You>
      <Turn voice="Meridian’s coordinator" at="10:59">
        <WorkedFor took="14s" summary="Read meridian-api, meridian-web and Meridian’s rules">
          <p className={s.said}>Read 3 repositories, MER-231 and the project’s rules.</p>
        </WorkedFor>
        <p className={s.said}>
          Two tasks. The backfill writes to money records, so your security review applies and a second lab reviews it. The docs are small:
          Codex writes them, Sonnet reads them over. Change anyone before they start.
        </p>
      </Turn>
      <div ref={spot}>
        <Launch steps={steps} />
      </div>
      {docs.length > 0 && <Launch task="433" title="Fix the refunds docs" steps={docs} from={false} estimate="About 10 min" />}
    </>
  )
}

function Screen({
  children,
  label,
  phone,
}: {
  children: ReactNode
  label: string
  phone?: { x: number; y: number; w: number; h: number }
}) {
  return (
    <div className={s.bezel}>
      <Shot w={1440} h={900} phone={phone} label={label} frame={s.screenFrame}>
        <Desktop>
          <MacWindow style={{ left: 40, top: 24, width: 1360, height: 826 }}>{children}</MacWindow>
        </Desktop>
      </Shot>
    </div>
  )
}

export function Lift() {
  const narrow = useNarrow()
  const section = useRef<HTMLElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const screen = useRef<HTMLDivElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const spot = useRef<HTMLDivElement | null>(null)
  const seen = useSeen(stage, 0.3)
  const steps = useAssembling(seen)
  const docs = useAssembling(seen && steps.length >= 4, DOCS_PLAN)
  const [phase, setPhase] = useState(0)

  /* Where the plan starts, in the window, and where the window's box is, both in the stage's px, with the window unmoved. */
  const geometry = useRef<{ plan: DOMRect; box: DOMRect; stage: DOMRect } | null>(null)

  useLayoutEffect(() => {
    if (narrow) return
    const el = section.current
    const st = stage.current
    const sc = screen.current
    const cd = card.current
    if (!el || !st || !sc || !cd) return
    let frame = 0

    const measure = () => {
      const sp = spot.current
      if (!sp) return
      const was = sc.style.transform
      sc.style.transform = 'none'
      const stageRect = st.getBoundingClientRect()
      const at = (r: DOMRect) => new DOMRect(r.left - stageRect.left, r.top - stageRect.top, r.width, r.height)
      geometry.current = { plan: at(sp.getBoundingClientRect()), box: at(sc.getBoundingClientRect()), stage: stageRect }
      sc.style.transform = was
    }

    const draw = () => {
      frame = 0
      const g = geometry.current
      const r = el.getBoundingClientRect()
      const run = Math.max(1, r.height - window.innerHeight)
      const p = clamp(-r.top / run)
      setPhase(p < 0.42 ? 0 : 1)
      const k = ease(clamp((p - 0.24) / 0.36))
      const sp = spot.current
      if (!g || !sp) return
      const sw = g.stage.width
      const sh = g.stage.height
      // The window steps back and to the right.
      const sc2 = 1 - 0.12 * k
      const tx = sw * 0.17 * k
      sc.style.transform = `translateX(${tx.toFixed(1)}px) scale(${sc2.toFixed(4)})`
      sc.style.opacity = String(1 - 0.45 * k)
      // The plan, where it is in the moved window...
      const cx0 = g.box.left + g.box.width / 2
      const fromX = cx0 + (g.plan.left - cx0) * sc2 + tx
      const fromY = g.box.top + (g.plan.top - g.box.top) * sc2
      const fromS = (g.plan.width * sc2) / W
      // ...and where it settles: at the left, larger, turned into the room.
      const toS = Math.min(1.12, (sw * 0.54) / W)
      const toX = Math.max(24, sw * 0.03)
      const toY = Math.max(0, sh * 0.08)
      const x = lerp(fromX, toX, k)
      const y = lerp(fromY, toY, k)
      const scale = lerp(fromS, toS, k)
      const lifted = k > 0.002
      sp.style.visibility = lifted ? 'hidden' : 'visible'
      cd.style.visibility = lifted ? 'visible' : 'hidden'
      cd.style.setProperty('--k', k.toFixed(4))
      cd.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${scale.toFixed(4)}) perspective(1600px) rotateY(${(14 * k).toFixed(2)}deg) rotateX(${(6 * k).toFixed(2)}deg)`
    }

    const on = () => {
      if (!frame) frame = requestAnimationFrame(draw)
    }
    const remeasure = () => {
      measure()
      on()
    }
    remeasure()
    const late = window.setTimeout(remeasure, 600)
    void document.fonts.ready.then(remeasure)
    const ro = new ResizeObserver(remeasure)
    ro.observe(st)
    window.addEventListener('scroll', on, { passive: true })
    return () => {
      window.clearTimeout(late)
      ro.disconnect()
      window.removeEventListener('scroll', on)
      cancelAnimationFrame(frame)
    }
  }, [narrow])

  if (narrow)
    return (
      <section id="team" className={s.stacked} aria-label="The coordinator">
        <Head i={0} />
        <div className={s.stackedPicture}>
          <Screen
            label="Meridian's coordinator: you ask for two things, it reads the project and answers with a plan for each"
            phone={{ x: 330, y: 150, w: 780, h: 720 }}
          >
            <ProjectWindow centered meta="The coordinator · 3 repositories, your rules" thread={<Thread steps={steps} docs={docs} />} />
          </Screen>
        </div>
        <Head i={1} />
        <div ref={stage} className={s.stackedPicture}>
          <Slab w={W} phoneW={430} label="The plan for task 432: a model for each step" maxScale={1}>
            <Launch steps={steps} />
          </Slab>
        </div>
      </section>
    )

  return (
    <section ref={section} className={s.lift} aria-label="The coordinator">
      <span id="team" className={s.anchor} />
      <div className={s.sticky}>
        <div className={s.heads}>
          <Head i={0} className={phase === 0 ? s.headOn : s.headOff} hidden={phase !== 0} />
          <Head i={1} className={phase === 1 ? s.headOn : s.headNext} hidden={phase !== 1} />
        </div>
        <div ref={stage} className={s.stage}>
          <div ref={screen} className={s.screen}>
            <Screen label="Meridian's coordinator: you ask for two things, it reads the project and answers with a plan for each">
              <ProjectWindow
                centered
                meta="The coordinator · 3 repositories, your rules"
                thread={<Thread steps={steps} docs={docs} spot={(el) => void (spot.current = el)} />}
              />
            </Screen>
          </div>
          <div ref={card} className={s.card} aria-hidden="true">
            <div className={s.cardFace} style={{ width: W }}>
              <Shot w={W} maxScale={1} label="">
                <Launch steps={steps} />
              </Shot>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
