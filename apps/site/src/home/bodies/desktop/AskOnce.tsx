import { Brand, Composer, IssueDraft, IssueDraftState, Turn, WorkedFor, You } from '@althar/ui'
import { useEffect, useRef, useState } from 'react'

import { PLAN_432 } from '../../../../../../packages/ui/src/fixtures/coordinator'
import { Growing, Launch } from '../kit/app'
import { useNarrow } from '../kit/Narrow'
import { useInView } from '../kit/seen'
import { Shot } from '../kit/Shot'
import s from './AskOnce.module.css'

/*
 * The coordinator, asked once. Your ask is typed into Meridian's
 * conversation and sent; the coordinator works on it, drafts the issue on
 * Linear, which is filed, says what it will do, and puts the plan together
 * under it a step at a time, from that issue. While it is watched it plays,
 * and plays again after a pause; with motion reduced or a moment held
 * (`?t=`) it is its last frame. On a phone, the conversation as a narrow
 * window lays it out.
 */

const none = () => {}

const ASK = 'Backfill idempotency keys on the refunds made before PR 1184.'

const ISSUE = {
  title: 'Backfill idempotency keys on refunds created before PR 1184',
  body: 'Refunds made before PR 1184 have no idempotency key, so a retried refund webhook can pay out twice. Backfill keys for them, and check none collide with the ones issued since.',
  labels: ['refunds', 'payments'],
}

/** When each thing happens, in ms from the start of a play. */
const TYPE_FROM = 600
const TYPE = 32
const SENT = TYPE_FROM + ASK.length * TYPE + 450
const WORK = SENT + 500
const DRAFTED = WORK + 2200
const FILING = DRAFTED + 1500
const FILED = FILING + 800
const SAID = FILED + 600
const PLAN = SAID + 700
const STEP = 520
const PLAY = PLAN + PLAN_432.length * STEP + 6000

/** What shows at `ms` into a play. */
const frameAt = (ms: number) => ({
  typed: Math.min(ASK.length, Math.max(0, Math.floor((ms - TYPE_FROM) / TYPE))),
  sent: ms >= SENT,
  working: ms >= WORK && ms < DRAFTED,
  worked: ms >= DRAFTED,
  took: Math.max(1, Math.ceil((Math.min(ms, DRAFTED) - WORK) / 1000) * 3),
  issue: ms < FILING ? IssueDraftState.Pending : ms < FILED ? IssueDraftState.Filing : IssueDraftState.Filed,
  said: ms >= SAID,
  steps: ms < PLAN ? 0 : Math.min(PLAN_432.length, Math.floor((ms - PLAN) / STEP) + 1),
})
type Frame = ReturnType<typeof frameAt>
const LAST = frameAt(PLAY - 1)
const same = (a: Frame, b: Frame) => (Object.keys(a) as (keyof Frame)[]).every((k) => a[k] === b[k])

/** The frame to show: playing while `watched`, from the start each time it comes back; the last one when held still. */
function usePlay(watched: boolean) {
  const [frame, setFrame] = useState(LAST)
  useEffect(() => {
    // Held still, it stays on its last frame, where it starts.
    if (!watched || window.matchMedia('(prefers-reduced-motion: reduce)').matches || new URLSearchParams(window.location.search).has('t'))
      return
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

export function AskOnce() {
  const box = useRef<HTMLDivElement>(null)
  const f = usePlay(useInView(box, 0.3))
  const narrow = useNarrow()
  return (
    <div ref={box} className={s.wrap}>
      <Shot
        w={760}
        h={720}
        phoneW={400}
        maxScale={1.15}
        label={`Meridian’s coordinator: you ask “${ASK}” It reads the repositories and the project’s rules, files MER-231 on Linear, and answers with task 432’s plan, its team step by step`}
        frame={s.frame}
      >
        <div className={s.talk}>
          <div className={s.thread}>
            {f.sent && <You at="11:01">{ASK}</You>}
            {(f.working || f.worked) && (
              <Turn voice="Meridian’s coordinator" at="11:01">
                <WorkedFor
                  took={`${f.took}s`}
                  live={f.working}
                  summary={f.working ? 'Reading src/refunds and PR 1184' : 'Read meridian-api, PR 1184 and Meridian’s rules'}
                >
                  <p className={s.said}>Read 2 repositories, PR 1184 and the project’s rules.</p>
                </WorkedFor>
                {f.worked && (
                  <IssueDraft
                    mark={Brand.Linear}
                    source="Linear"
                    container="Meridian"
                    title={ISSUE.title}
                    body={ISSUE.body}
                    labels={ISSUE.labels}
                    state={f.issue}
                    issue={{ key: 'MER-231', href: 'https://linear.app' }}
                    onFile={none}
                    onDiscard={none}
                    onChange={none}
                    headingLevel={4}
                  />
                )}
                {f.said && (
                  <p className={s.said}>One task. It writes to money records, so your security review applies, and a second lab reviews.</p>
                )}
              </Turn>
            )}
            {f.steps > 0 && (
              <Growing whole={<Launch narrow={narrow} />}>
                <Launch steps={PLAN_432.slice(0, f.steps)} narrow={narrow} />
              </Growing>
            )}
          </div>
          <div className={s.composer}>
            <Composer
              value={f.sent ? '' : ASK.slice(0, f.typed)}
              onChange={none}
              onSubmit={none}
              placeholder="Tell Meridian what you want done"
            />
          </div>
        </div>
      </Shot>
    </div>
  )
}
