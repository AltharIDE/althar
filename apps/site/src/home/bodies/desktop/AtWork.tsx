import {
  AcceptCard,
  BoardLane,
  ChromeButton,
  NextRow,
  Outcome,
  Room,
  RoomSwitch,
  SettledRow,
  TaskStatus,
  Wait,
  WorkCard,
  WorkStatus,
} from '@althar/ui'
import { type CSSProperties, type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { askedSecond, useStill } from '../../../lib/browser'
import { cx } from '../../../lib/cx'
import { BoardAtWork, type BoardStory, OUT_OF_USAGE, Tabs, type UsageOut } from '../kit/app'
import { useNarrow } from '../kit/Narrow'
import { useInView, usePageShown } from '../kit/seen'
import { Shot } from '../kit/Shot'
import app from '../kit/app.module.css'
import { CODEX, GEMINI_PRO, NEXT, OPUS, QWEN, READY_TWO_REPOS } from '../kit/world'
import s from './AtWork.module.css'

/*
 * Tally's board, in Althar's light on the dark of the panel, under "Usage
 * gets cut. Models get pulled. Althar stays.": tasks running at once, each
 * led by another lab. While it is watched the work goes on: a beat every
 * couple of seconds, a minute on each task's clock and, at its own pace, a
 * step on.
 *
 * And it follows one task all the way through, as a motion graphic: the
 * backfill waiting in Up next starts, and flies into Running, on Opus.
 * Claude Code runs out of usage: the backfill and the other task on it
 * pause, then move on, as a project's rules can have them do, the backfill
 * to Codex and the other to Gemini, and carry on. The backfill goes through
 * its steps, flies on to Needs you, ready to accept; it is accepted, and
 * flies on to Settled, merged. The cards where it lands slide down to make
 * room, and at the end the picture fades back to the start and goes round
 * again. On a phone, a lane at a time, the view following it from lane to
 * lane. Still, on the backfill moved on and running, with motion reduced or
 * a moment held (`?t=`).
 */

const none = () => {}

/** How long a beat is, in ms. */
const BEAT = 2400

const LABEL =
  'Tally’s board, following one task through: it starts on Opus, moves on to Codex when Claude Code runs out of usage, then waits on you and is merged, while tasks led by Codex, Gemini and Qwen run beside it'

/** The board's design size, in px. */
const W = 1440
const H = 780

export function AtWork() {
  const box = useRef<HTMLDivElement>(null)
  const watched = useInView(box, 0.2)
  const [beat, setBeat] = useState(0)
  const phone = useNarrow()
  useEffect(() => {
    if (!watched) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || askedSecond() !== null) return
    const id = window.setInterval(() => setBeat((n) => n + 1), BEAT)
    return () => clearInterval(id)
  }, [watched])
  return (
    <div ref={box} className={s.wrap}>
      <Flow beat={beat} watched={watched} phone={phone} />
    </div>
  )
}

function Window({ beat, story, out }: { beat: number; story: BoardStory; out?: UsageOut }) {
  return (
    <div className={app.window}>
      <Tabs
        current="tally"
        end={
          <>
            <RoomSwitch value={Room.Board} onChange={none} text={{ key: () => '' }} />
            <WorkStatus yours={2} />
            <ChromeButton icon="plus" label="New task" />
          </>
        }
      />
      <div className={app.board}>
        <BoardAtWork beat={beat} story={story} {...(out ? { out } : {})} />
      </div>
    </div>
  )
}

/* ---- one task's way through the board ---- */

/** The task it follows: the backfill waiting for an agent to be free, the one the coordinator plans further down. */
const WAITING = NEXT.find((x) => x.wait === Wait.Workers) ?? NEXT[0]!
const HERO = { task: WAITING.task, title: WAITING.title, ...(WAITING.kind ? { kind: WAITING.kind } : {}) }
const STEPS = ['Implement', 'Review', 'Security review']
const PR = { repo: 'tally-api', number: 1192, add: 84, del: 9 }

const LANES = [BoardLane.Next, BoardLane.Running, BoardLane.Yours, BoardLane.Settled] as const

/** The task as each lane draws it: in Running, on Opus (`hand` 0), paused out of usage (1), moved on to Codex (2), and carrying on (3). */
function heroIn(lane: BoardLane, at = 0, hand = 0): ReactNode {
  switch (lane) {
    case BoardLane.Next:
      return <NextRow {...WAITING} place={NEXT.indexOf(WAITING) + 1} />
    case BoardLane.Running:
      return hand === 1 ? (
        <WorkCard {...HERO} status={TaskStatus.Paused} steps={STEPS} at={0} elapsed="4m" lead={OPUS} note={OUT_OF_USAGE} />
      ) : (
        <WorkCard
          {...HERO}
          steps={STEPS}
          at={at}
          elapsed={`${4 + at * 7 + (hand > 1 ? 1 : 0)}m`}
          lead={hand > 1 ? CODEX : OPUS}
          {...(at === 1 ? { onStep: [GEMINI_PRO, QWEN] } : {})}
          {...(hand === 2 ? { note: 'Moved to Codex' } : {})}
        />
      )
    case BoardLane.Yours:
      return <AcceptCard {...HERO} prs={[PR]} {...(READY_TWO_REPOS.host ? { host: READY_TWO_REPOS.host } : {})} checks={5} at="just now" />
    default:
      return <SettledRow {...HERO} outcome={Outcome.Merged} meta={`PR ${PR.number} · 1 review round`} at="just now" />
  }
}

/** How long it takes to fly to the next lane (a lift, then the flight), and the view to follow, setting out a moment after it, in ms. */
const LIFT = 160
const FLY = 950
const FOLLOW = 220
const GLIDE = 1150
const TRAVEL = FOLLOW + GLIDE
/** At the end, how long the picture takes to fade, and to come back. */
const TURN = 320

/** When each thing happens, in ms from the start of a round: in Up next a moment, then on its way. */
const TO_RUNNING = 1300
const STEP = 1250
/** How long it stands paused, out of usage, before it moves on. */
const OUT = 1700
const RUNS = TO_RUNNING + TRAVEL
const TO_YOURS = RUNS + OUT + (STEPS.length + 1) * STEP
const PRESS = TO_YOURS + TRAVEL + 1300
const TO_SETTLED = PRESS + 600
const FADE = TO_SETTLED + TRAVEL + 1500
const ROUND = FADE + TURN

/** Where it is at `ms` into a round. */
function frameAt(ms: number) {
  const lane = ms < TO_RUNNING ? 0 : ms < TO_YOURS ? 1 : ms < TO_SETTLED ? 2 : 3
  const since = ms - [0, TO_RUNNING, TO_YOURS, TO_SETTLED][lane]!
  return {
    lane,
    flying: lane > 0 && since < TRAVEL,
    // On Opus a step, paused, on Codex the rest of that step, then on through its steps.
    hand: ms - RUNS < STEP ? 0 : ms - RUNS < STEP + OUT ? 1 : ms - RUNS < 2 * STEP + OUT ? 2 : 3,
    at: ms - RUNS < 2 * STEP + OUT ? 0 : Math.min(STEPS.length - 1, Math.floor((ms - RUNS - OUT - STEP) / STEP)),
    pressed: ms >= PRESS && ms < TO_SETTLED,
    fading: ms >= FADE,
    // Just round again: back at Up next at once, with no glide across.
    cut: ms < TURN,
  }
}
type Frame = ReturnType<typeof frameAt>
const same = (a: Frame, b: Frame) => (Object.keys(a) as (keyof Frame)[]).every((k) => a[k] === b[k])
/** Still: the task moved on and running, on its second step. */
const STILL = frameAt(RUNS + OUT + 2 * STEP)
const FIRST = frameAt(TURN)

/** The round's frame while `on`, carrying on where it stopped when it comes back. */
function useRound(on: boolean) {
  const [frame, setFrame] = useState(FIRST)
  const ran = useRef(TURN)
  useEffect(() => {
    if (!on) return
    const start = performance.now() - ran.current
    const id = window.setInterval(() => {
      ran.current = (performance.now() - start) % ROUND
      const next = frameAt(ran.current)
      setFrame((was) => (same(was, next) ? was : next))
    }, 40)
    return () => clearInterval(id)
  }, [on])
  return frame
}

/** Where an element is in the board as designed, in its px: read from its layout, which the picture's scale doesn't touch. */
interface Place {
  left: number
  top: number
  width: number
}
function placeIn(stage: Element, el: HTMLElement): Place {
  let left = 0
  let top = 0
  for (let at: Element | null = el; at instanceof HTMLElement && at !== stage; at = at.offsetParent) {
    left += at.offsetLeft
    top += at.offsetTop
  }
  return { left, top, width: el.offsetWidth }
}

/** On a phone, a lane from its head under the window's tabs, this tall, with this much room either side. */
const TOP = 56
const TALL = 480
const SIDE = 8

/** The board following the task; on a `phone`, a lane at a time, the view gliding along with it. */
function Flow({ beat, watched, phone }: { beat: number; watched: boolean; phone: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const still = useStill()
  const shown = usePageShown()
  const round = useRound(watched && shown && !still)
  const frame = still ? STILL : round
  // Where the lanes are, read once laid out, before it is painted.
  const [lanes, setLanes] = useState<Place[]>([])
  useLayoutEffect(() => {
    const stage = box.current?.querySelector<HTMLElement>('[data-picture]')
    if (!stage) return
    const ro = new ResizeObserver(() => setLanes([...stage.querySelectorAll<HTMLElement>('[data-lane]')].map((el) => placeIn(stage, el))))
    ro.observe(stage)
    return () => ro.disconnect()
  }, [])
  // Where the task stood when last drawn: where its next flight sets out from.
  const stood = useRef<{ place: Place; lane: number } | null>(null)
  useLayoutEffect(() => {
    const stage = box.current?.querySelector<HTMLElement>('[data-picture]')
    const el = stage?.querySelector<HTMLElement>('[data-story=""]')
    if (stage && el) stood.current = { place: placeIn(stage, el), lane: frame.lane }
  })
  const lane = LANES[frame.lane]!
  const story: BoardStory = {
    task: HERO.task,
    lane,
    card: heroIn(lane, frame.at, frame.hand),
    arriving: frame.flying,
    className: cx(s.hero, frame.pressed && s.pressed, frame.hand === 1 && s.paused, frame.hand > 1 && s.moved),
  }
  const out: UsageOut | null = frame.hand === 1 ? 'paused' : frame.hand > 1 ? 'moved' : null
  const view = lanes[frame.lane] ?? { left: 22 + frame.lane * 356, width: 346 }
  return (
    <div
      ref={box}
      className={cx(s.lanes, frame.fading && s.fading, (frame.cut || lanes.length === 0) && s.cut)}
      style={{ '--glide': `${GLIDE}ms`, '--follow': `${FOLLOW}ms`, '--turn': `${TURN}ms` } as CSSProperties}
    >
      <Shot
        w={W}
        h={H}
        phone={{ x: view.left - SIDE, y: TOP, w: view.width + 2 * SIDE, h: TALL }}
        label={LABEL}
        frame={phone ? s.lane : s.frame}
      >
        <Window beat={beat} story={story} {...(out ? { out } : {})} />
        {frame.flying && (
          <Flight
            key={frame.lane}
            lane={frame.lane}
            stood={stood}
            leaving={heroIn(LANES[frame.lane - 1]!, STEPS.length - 1, 3)}
            arriving={heroIn(lane, 0, 0)}
          />
        )}
      </Shot>
    </div>
  )
}

/**
 * The task on its way to `lane`, drawn over the board: it lifts from where
 * it `stood` in the lane before, its shadow coming up under it, flies to the
 * place held for it, turning from what it was there into what it is here,
 * and lands, its shadow going, so it is the card held for it to the pixel
 * when that takes its place. Without where it stood, it is there already.
 */
function Flight({
  lane,
  stood,
  leaving,
  arriving,
}: {
  lane: number
  stood: RefObject<{ place: Place; lane: number } | null>
  leaving: ReactNode
  arriving: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    const stage = el?.closest('[data-picture]')
    const held = stage?.querySelector<HTMLElement>('[data-story="arriving"]')
    if (!el || !stage || !held) return
    const to = placeIn(stage, held)
    Object.assign(el.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, visibility: 'visible' })
    // Where it stood, in the lane it leaves, as last drawn: its place there is gone by now.
    const from = stood.current?.lane === lane - 1 ? stood.current.place : null
    if (!from || typeof el.animate !== 'function') return
    const whole = LIFT + FLY
    // The page's --ease: quick to start, and settling softly.
    const ease = 'cubic-bezier(0.22, 0.61, 0.24, 1)'
    const runs = [
      el.animate([{ translate: `${from.left - to.left}px ${from.top - to.top}px` }, { translate: '0px 0px' }], {
        duration: FLY,
        delay: LIFT,
        easing: ease,
        fill: 'backwards',
      }),
      el.animate([{ scale: '1' }, { scale: '1.04', offset: LIFT / whole }, { scale: '1.04', offset: 0.82 }, { scale: '1' }], {
        duration: whole,
        easing: 'ease-out',
      }),
      // What it was fades as what it becomes comes up, each held at its end: a keyframe list that stops short of the
      // end would go back to the layer's own opacity.
      ...[...el.children].flatMap((layer, i) => {
        const lift = layer.firstElementChild
        const leaving = i === 0
        return [
          layer.animate(
            leaving
              ? [{ opacity: 1 }, { opacity: 1, offset: 0.35 }, { opacity: 0, offset: 0.7 }, { opacity: 0 }]
              : [{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1, offset: 0.7 }, { opacity: 1 }],
            { duration: whole, fill: 'both' },
          ),
          ...(lift
            ? [
                lift.animate(
                  leaving
                    ? [{ opacity: 0 }, { opacity: 1, offset: LIFT / whole }, { opacity: 1 }]
                    : [{ opacity: 1 }, { opacity: 1, offset: 0.82 }, { opacity: 0 }],
                  { duration: whole, fill: 'both' },
                ),
              ]
            : []),
        ]
      }),
    ]
    return () => runs.forEach((one) => one.cancel())
  }, [lane, stood])
  return (
    <div ref={ref} className={s.flight} aria-hidden="true">
      <div>
        <i className={s.lift} />
        {leaving}
      </div>
      <div>
        <i className={s.lift} />
        {arriving}
      </div>
    </div>
  )
}
