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
import { type Aim, Pointer } from '../kit/Pointer'
import { useInView, usePageShown } from '../kit/seen'
import { Shot } from '../kit/Shot'
import app from '../kit/app.module.css'
import v from '../kit/views.module.css'
import { CODEX, GEMINI_PRO, NEXT, OPUS, READY_TWO_REPOS, SONNET } from '../kit/world'
import s from './AtWork.module.css'
import { momentOf, Planning, pointerAt, type Running, STARTED } from './Planning'

/*
 * Tally's board, in Althar's light on the dark of the panel, under "Every
 * agent’s work. One board.": tasks running at once, each
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
 *
 * Given a `clock` (the home page's carousel), it is the project's home as
 * the app opens it, the coordinator's conversation beside the board, and the
 * story starts there: you ask for the backfill, the coordinator plans it, and
 * you start it (Planning.tsx); only then does it come into Up next, and the
 * board's story plays on from there, half as fast again. The round is not
 * timed by itself but follows the clock, in ms.
 */

const none = () => {}

/** How long a beat is, in ms. */
const BEAT = 2400

const LABEL =
  'Tally’s board, following one task through: it starts on Opus, moves on to Codex when Claude Code runs out of usage, then waits on you and is merged, while tasks led by Codex, Gemini and Qwen run beside it'

/** The board's design size, in px. */
const W = 1440
const H = 780

export function AtWork({ clock = null, active = true }: { clock?: (() => number) | null; active?: boolean } = {}) {
  const box = useRef<HTMLDivElement>(null)
  const seen = useInView(box, 0.2)
  const watched = seen && clock === null
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
      <Flow beat={beat} watched={watched} phone={phone} clock={clock} active={active} />
    </div>
  )
}

/** The person's pointer on the board, when the board is on a clock (the carousel). */
interface PointerOn {
  aim: Aim
  press: boolean
  ms: number
}

function Window({
  beat,
  story,
  out,
  pointer,
  talk,
}: {
  beat: number
  story: BoardStory
  out?: UsageOut
  pointer?: PointerOn | null
  /** The coordinator's conversation, beside the board: the project's home with both showing. */
  talk?: ReactNode
}) {
  const board = <BoardAtWork beat={beat} story={story} {...(out ? { out } : {})} />
  return (
    <div className={app.window}>
      <Tabs
        current="tally"
        end={
          <>
            <RoomSwitch value={talk ? Room.Both : Room.Board} onChange={none} text={{ key: () => '' }} />
            <WorkStatus yours={2} />
            <ChromeButton icon="plus" label="New task" />
          </>
        }
      />
      {/* What fades as its story starts over (kit/loop.ts): the conversation and the board, not the window's bar. */}
      {talk ? (
        <div className={cx(v.beside, v.besideBoard)} data-fade="">
          {talk}
          <div className={app.board}>{board}</div>
          {pointer && <Pointer aim={pointer.aim} press={pointer.press} rest={[0.84, 0.88]} ms={pointer.ms} />}
        </div>
      ) : (
        <div className={app.board} data-fade="">
          {board}
          {pointer && <Pointer aim={pointer.aim} press={pointer.press} rest={[0.82, 0.88]} ms={pointer.ms} />}
        </div>
      )}
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
          {...(at === 1 ? { onStep: [GEMINI_PRO] } : at === 2 ? { onStep: [SONNET] } : {})}
          {...(hand === 2 ? { note: 'Moved to Codex' } : {})}
        />
      )
    case BoardLane.Yours:
      return <AcceptCard {...HERO} prs={[PR]} {...(READY_TWO_REPOS.host ? { host: READY_TWO_REPOS.host } : {})} checks={5} at="just now" />
    default:
      return <SettledRow {...HERO} outcome={Outcome.Merged} meta={`PR ${PR.number} · 2 review rounds`} at="just now" />
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
const TO_RUNNING = 2100
const STEP = 1250
/** How long it stands paused, out of usage, before it moves on. */
const OUT = 1700
const RUNS = TO_RUNNING + TRAVEL
const TO_YOURS = RUNS + OUT + (STEPS.length + 1) * STEP
const PRESS = TO_YOURS + TRAVEL + 1300
const TO_SETTLED = PRESS + 600
const FADE = TO_SETTLED + TRAVEL + 1500
const ROUND = FADE + TURN
/** Just started, how long it takes to come into Up next. */
const LANDING = 700

/** Where your pointer presses on the task once it is yours: its card's accept. */
const ACCEPT = `[data-story=""] [class*='strip']:last-child`

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
    // Still being planned, on a clock: not on the board yet; then just started, coming into Up next.
    absent: false,
    landing: ms < LANDING,
  }
}
type Frame = ReturnType<typeof frameAt>
const same = (a: Frame, b: Frame) => (Object.keys(a) as (keyof Frame)[]).every((k) => a[k] === b[k])
/** Still: the task moved on and running, on its second step. */
const STILL = frameAt(RUNS + OUT + 2 * STEP)
const FIRST = frameAt(TURN)

/*
 * On a clock: the conversation first, the task planned and started
 * (Planning.tsx), then the board's story from the moment it is started,
 * played half as fast again; the clock is in ms, the board's story in its
 * own.
 */
const PACE = 1.5
/** The board's story, `ms` into the clock's: before it is started, none. */
const boardAt = (ms: number) => (ms - STARTED) * PACE
/** How long the whole story is, as far as the board's round goes before it fades; and where it stands still, on the task moved on and running. */
export const BOARD_STORY = STARTED + (FADE - 110) / PACE
export const BOARD_STILL = STARTED + (RUNS + OUT + 2 * STEP) / PACE
/** While it is planned: the board as it starts, without the task. */
const PLANNING: Frame = { ...frameAt(0), absent: true, landing: false }

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
/** On a tablet, how much of the window across it shows. */
const TABLET_W = 1100

/** The board following the task; on a `phone`, a lane at a time, the view gliding along with it. */
/** On a clock: its frame and beat, drawn again only when either changes, read on every frame the screen draws. */
function useClocked(clock: (() => number) | null) {
  const [now, setNow] = useState(() => ({ frame: PLANNING, beat: 0, moment: 0 }))
  useEffect(() => {
    if (!clock) return
    let id = 0
    const tick = () => {
      const ms = clock()
      const next = ms < STARTED ? PLANNING : frameAt(boardAt(ms))
      const moment = momentOf(ms)
      // On a clock the cards' own work ticks twice as often, so there is always something moving.
      const beat = Math.floor((ms * PACE) / (BEAT / 2))
      setNow((was) => (was.beat === beat && was.moment === moment && same(was.frame, next) ? was : { frame: next, beat, moment }))
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [clock])
  return now
}

function Flow({
  beat: ticked,
  watched,
  phone,
  clock,
  active,
}: {
  beat: number
  watched: boolean
  phone: boolean
  clock: (() => number) | null
  active: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  const still = useStill()
  const shown = usePageShown()
  const round = useRound(watched && shown && !still)
  const clocked = useClocked(clock)
  const frame = clock ? clocked.frame : still ? STILL : round
  const beat = clock ? clocked.beat : ticked
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
  // Where it last stood in each lane: scrubbed back, a flight sets out from the lane before, wherever the page came from.
  const placed = useRef<Record<number, Place>>({})
  useLayoutEffect(() => {
    const stage = box.current?.querySelector<HTMLElement>('[data-picture]')
    const el = stage?.querySelector<HTMLElement>('[data-story=""]')
    if (!stage || !el) return
    const place = placeIn(stage, el)
    if (!clock) stood.current = { place, lane: frame.lane }
    else if (!frame.flying) placed.current[frame.lane] = place
  })
  // Scrubbed with nothing stood yet in the lane before (the page opened further down): from that lane's top.
  const before = lanes[Math.max(0, frame.lane - 1)]
  const near = clock && before ? { left: before.left + 12, top: 120, width: before.width - 24 } : null
  const laneStart = [0, TO_RUNNING, TO_YOURS, TO_SETTLED][frame.lane]!
  const lane = LANES[frame.lane]!
  const story: BoardStory = {
    task: HERO.task,
    lane,
    card: heroIn(lane, frame.at, frame.hand),
    arriving: frame.flying,
    absent: frame.absent,
    landing: frame.landing && clock !== null,
    className: cx(s.hero, frame.pressed && s.pressed, frame.hand === 1 && s.paused, frame.hand > 1 && s.moved),
  }
  const out: UsageOut | null = frame.hand === 1 ? 'paused' : frame.hand > 1 ? 'moved' : null
  // On a clock, your pointer: in the conversation, asking, starting the plan and going on to something else; then, once the task has come to you, to its accept, pressed as it is pressed, and then at rest.
  const ms = clock ? clock() : 0
  const pointer: PointerOn | null = clock
    ? frame.lane < 2 || (frame.lane === 2 && frame.flying)
      ? { ...pointerAt(ms), ms: clocked.moment }
      : { aim: frame.lane === 2 ? ACCEPT : null, press: frame.pressed, ms: clocked.moment }
    : null
  // The task as the conversation has it, once it runs: its card keeps up with the board.
  const running: Running | null =
    clock === null || frame.absent || frame.lane === 0 || (frame.lane === 1 && frame.flying)
      ? null
      : {
          status:
            frame.lane === 1
              ? frame.hand === 1
                ? TaskStatus.Paused
                : TaskStatus.Running
              : frame.lane === 2
                ? TaskStatus.Yours
                : TaskStatus.Done,
          steps: STEPS,
          at: frame.lane === 1 ? frame.at : STEPS.length - 1,
          lead: frame.hand > 1 ? CODEX : OPUS,
        }
  const talk = clock ? <Planning ms={clocked.moment} read={clock} active={active} running={running} /> : undefined
  const view = lanes[frame.lane] ?? { left: 22 + frame.lane * 356, width: 346 }
  // On a phone or a tablet, filling the carousel's box: on a phone, the conversation's foot while the task is planned, then the lane the task is in; on a tablet, as much of the window as reads, its left first, then over to keep the task's lane in sight.
  const fill = clock
    ? {
        phone: frame.absent
          ? { x: 24, y: H, w: 456, h: 0, from: 'foot' as const }
          : { x: view.left - SIDE, y: TOP, w: view.width + 2 * SIDE },
        tablet: { x: frame.absent ? 0 : Math.min(W - TABLET_W, Math.max(0, view.left + view.width + 24 - TABLET_W)), y: 0, w: TABLET_W },
      }
    : undefined
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
        {...(fill ? { fill } : {})}
        label={LABEL}
        frame={phone && !clock ? s.lane : s.frame}
      >
        <Window beat={beat} story={story} {...(out ? { out } : {})} pointer={pointer} talk={talk} />
        {frame.flying && (
          <Flight
            key={frame.lane}
            lane={frame.lane}
            stood={stood}
            placed={clock ? placed : null}
            near={near}
            since={clock ? () => boardAt(clock()) - laneStart : null}
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
  placed,
  near,
  since,
  leaving,
  arriving,
}: {
  /** Scrubbed: where it last stood in each lane, so it can set out from the lane before whichever way the scroll came; and where to start without one. */
  placed: RefObject<Record<number, Place>> | null
  near: Place | null
  /** On a clock: how far into the flight it is, in ms, read on every frame; null, it flies by itself. */
  since: (() => number) | null
  lane: number
  stood: RefObject<{ place: Place; lane: number } | null>
  leaving: ReactNode
  arriving: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const scrubbed = since !== null
  const start = useRef(since)
  const fallback = useRef(near)
  useLayoutEffect(() => {
    start.current = since
    fallback.current = near
  })
  useLayoutEffect(() => {
    const el = ref.current
    const stage = el?.closest('[data-picture]')
    const held = stage?.querySelector<HTMLElement>('[data-story="arriving"]')
    if (!el || !stage || !held) return
    const to = placeIn(stage, held)
    Object.assign(el.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, visibility: 'visible' })
    // Where it stood, in the lane it leaves, as last drawn: its place there is gone by now.
    const from = placed ? (placed.current[lane - 1] ?? fallback.current) : stood.current?.lane === lane - 1 ? stood.current.place : null
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
    // On a clock, held and moved to where the clock says on every frame the screen draws.
    let id = 0
    if (scrubbed) {
      for (const run of runs) run.pause()
      const follow = () => {
        const t = Math.max(0, start.current?.() ?? 0)
        for (const run of runs) run.currentTime = t
        id = requestAnimationFrame(follow)
      }
      follow()
    }
    return () => {
      cancelAnimationFrame(id)
      runs.forEach((one) => one.cancel())
    }
  }, [lane, stood, placed, scrubbed])
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
