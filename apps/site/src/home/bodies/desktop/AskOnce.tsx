import { Composer, IssueDraft, IssueDraftState, Turn, WorkedFor, You } from '@althar/ui'
import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { askedSecond } from '../../../lib/browser'
import { cx } from '../../../lib/cx'

import { Growing, Launch } from '../kit/app'
import { useNarrow } from '../kit/Narrow'
import { useInView } from '../kit/seen'
import { Shot } from '../kit/Shot'
import { DRAFT_LINEAR, PLAN_432 } from '../kit/world'
import s from './AskOnce.module.css'

/*
 * The coordinator, asked once. Your ask is typed into Tally's
 * conversation and sent; the coordinator works on it, says what it will do
 * with what you asked, and puts the team together under it a step at a
 * time. Then it mentions what else it found on the way, a separate piece
 * of work, and drafts an issue for that on Linear, which is filed. Each
 * thing fades up as it arrives and the thread glides up to make room. While
 * it is watched it plays, and fades and plays again after a pause; with
 * motion reduced or a moment held (`?t=`) it is its last frame. On a phone,
 * the conversation as a narrow window lays it out.
 */

const none = () => {}

const ASK = 'Backfill idempotency keys on the refunds made before PR 1184.'

/** What it found on the way, as it says it, and the issue it drafts for it. */
const FOUND =
  'One more thing I found in src/refunds: refund webhooks retry without honouring Retry-After. That’s a separate fix, so I drafted an issue for it.'
const FILED_AS = 'TAL-238'

/** When each thing happens, in ms from the start of a play. */
const TYPE_FROM = 600
const TYPE = 32
const SENT = TYPE_FROM + ASK.length * TYPE + 450
const WORK = SENT + 500
const WORKED = WORK + 2200
const SAID = WORKED + 600
const PLAN = SAID + 700
const STEP = 520
const FOUND_AT = PLAN + PLAN_432.length * STEP + 1100
const ISSUE = FOUND_AT + 900
const FILING = ISSUE + 1800
const FILED = FILING + 800
const PLAY = FILED + 6000
/** Before it plays again, the conversation fades, so it never empties in sight. */
const LEAVE = PLAY - 700

/** What shows at `ms` into a play. */
const frameAt = (ms: number) => ({
  typed: Math.min(ASK.length, Math.max(0, Math.floor((ms - TYPE_FROM) / TYPE))),
  sent: ms >= SENT,
  working: ms >= WORK && ms < WORKED,
  worked: ms >= WORKED,
  took: Math.max(1, Math.ceil((Math.min(ms, WORKED) - WORK) / 1000) * 3),
  said: ms >= SAID,
  steps: ms < PLAN ? 0 : Math.min(PLAN_432.length, Math.floor((ms - PLAN) / STEP) + 1),
  found: ms >= FOUND_AT,
  drafted: ms >= ISSUE,
  issue: ms < FILING ? IssueDraftState.Pending : ms < FILED ? IssueDraftState.Filing : IssueDraftState.Filed,
  leaving: ms >= LEAVE,
})
type Frame = ReturnType<typeof frameAt>
const LAST = frameAt(LEAVE - 1)
const same = (a: Frame, b: Frame) => (Object.keys(a) as (keyof Frame)[]).every((k) => a[k] === b[k])

/** The frame to show: playing while `watched`, from the start each time it comes back; the last one when held still. */
function usePlay(watched: boolean) {
  const [frame, setFrame] = useState(LAST)
  useEffect(() => {
    // Held still, it stays on its last frame, where it starts.
    if (!watched || window.matchMedia('(prefers-reduced-motion: reduce)').matches || askedSecond() !== null) return
    const start = performance.now()
    const tick = () => {
      const next = frameAt((performance.now() - start) % PLAY)
      // Only what changes is drawn again: a letter typed, or the next thing happening.
      setFrame((was) => (same(was, next) ? was : next))
    }
    tick()
    const id = window.setInterval(tick, 40)
    return () => clearInterval(id)
  }, [watched])
  return frame
}

/** How what arrives moves: quick to start, and settling softly. */
const ARRIVE = { duration: 560, easing: 'cubic-bezier(0.2, 0, 0, 1)' }

/**
 * The thread at the window's foot never jumps. As what it holds grows, it
 * glides up into place from where it stood, taking over from any glide
 * still under way; and whatever comes into it (a message, a line, the
 * issue's next state, the plan's next step) fades up as it arrives.
 */
function useArrivals(ref: RefObject<HTMLElement | null>, frame: Frame) {
  const was = useRef<number | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const height = el.offsetHeight
    const grew = was.current === null ? 0 : height - was.current
    was.current = height
    if (grew <= 0 || typeof el.animate !== 'function') return
    const from = new DOMMatrixReadOnly(getComputedStyle(el).transform).m42 + grew
    for (const run of el.getAnimations()) run.cancel()
    el.animate([{ transform: `translateY(${from}px)` }, { transform: 'none' }], ARRIVE)
  }, [ref, frame])
  useEffect(() => {
    const el = ref.current
    if (!el || typeof el.animate !== 'function') return
    const seen = new MutationObserver((changes) => {
      for (const change of changes)
        for (const node of change.addedNodes)
          if (node instanceof HTMLElement && !node.closest('[aria-hidden="true"]'))
            node.animate(
              [
                { opacity: 0, transform: 'translateY(6px)' },
                { opacity: 1, transform: 'none' },
              ],
              { ...ARRIVE, delay: 60, fill: 'backwards' },
            )
    })
    seen.observe(el, { childList: true, subtree: true })
    return () => seen.disconnect()
  }, [ref])
}

export function AskOnce() {
  const box = useRef<HTMLDivElement>(null)
  const flow = useRef<HTMLDivElement>(null)
  const f = usePlay(useInView(box, 0.3))
  useArrivals(flow, f)
  const narrow = useNarrow()
  return (
    <div ref={box} className={s.wrap}>
      <Shot
        w={760}
        h={720}
        phoneW={400}
        maxScale={1.15}
        label={`Tally’s coordinator: you ask “${ASK}” It reads the code and the project’s rules and answers with task 432’s plan for your ask, its team step by step; then it mentions that refund webhooks retry too fast, a separate fix, and files ${FILED_AS} on Linear for it`}
        frame={s.frame}
      >
        <div className={s.talk}>
          <div className={s.thread}>
            <div ref={flow} className={cx(s.flow, f.leaving && s.leaving)}>
              {f.sent && <You at="11:01">{ASK}</You>}
              {(f.working || f.worked) && (
                <Turn voice="Tally’s coordinator" at="11:01">
                  <WorkedFor
                    took={`${f.took}s`}
                    live={f.working}
                    summary={f.working ? 'Reading src/refunds and PR 1184' : 'Read tally-api, PR 1184 and Tally’s rules'}
                  >
                    <p className={s.said}>Read 2 repositories, PR 1184 and the project’s rules.</p>
                  </WorkedFor>
                  {f.said && (
                    <p className={s.said}>
                      The backfill is one task. It writes to money records, so your security review applies, and a second lab reviews.
                    </p>
                  )}
                </Turn>
              )}
              {f.steps > 0 && (
                <Growing whole={<Launch from={false} narrow={narrow} />}>
                  <Launch from={false} steps={PLAN_432.slice(0, f.steps)} narrow={narrow} />
                </Growing>
              )}
              {f.found && (
                <Turn voice="Tally’s coordinator" bare>
                  <p className={s.said}>{FOUND}</p>
                  {f.drafted && (
                    <IssueDraft
                      {...DRAFT_LINEAR}
                      state={f.issue}
                      issue={{ key: FILED_AS, href: 'https://linear.app' }}
                      onFile={none}
                      onDiscard={none}
                      onChange={none}
                      headingLevel={4}
                    />
                  )}
                </Turn>
              )}
            </div>
          </div>
          <div className={s.composer}>
            <Composer
              value={f.sent ? '' : ASK.slice(0, f.typed)}
              onChange={none}
              onSubmit={none}
              placeholder="Tell Tally what you want done"
            />
          </div>
        </div>
      </Shot>
    </div>
  )
}
