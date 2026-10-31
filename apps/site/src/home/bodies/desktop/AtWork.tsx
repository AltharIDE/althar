import { AcceptCard, BoardLane, ChromeButton, NextRow, Outcome, Room, RoomSwitch, SettledRow, Wait, WorkCard, WorkStatus } from '@althar/ui'
import { type CSSProperties, type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { askedSecond, useStill } from '../../../lib/browser'
import { cx } from '../../../lib/cx'
import { BoardAtWork, type BoardStory, Tabs } from '../kit/app'
import { useNarrow } from '../kit/Narrow'
import { useInView } from '../kit/seen'
import { Shot } from '../kit/Shot'
import app from '../kit/app.module.css'
import { GEMINI_PRO, NEXT, OPUS, READY_TWO_REPOS, SONNET } from '../kit/world'
import s from './AtWork.module.css'

/*
 * Tally's board, in Althar's light on the dark of the panel: four tasks
 * running at once, each led by another lab. While it is watched the work
 * goes on: a beat every couple of seconds, a minute on each task's clock
 * and, at its own pace, a step on.
 *
 * On a phone, a lane at a time, and the board follows one task all the way
 * through, as a motion graphic: the backfill waiting in Up next starts, and
 * flies into Running; it goes through its steps, and flies on to Needs you,
 * ready to accept; it is accepted, and flies on to Settled, merged. The view
 * follows it from lane to lane, the cards where it lands slide down to make
 * room, and at the end it fades back to Up next and goes round again. Still,
 * on the task running, with motion reduced or a moment held (`?t=`).
 */

const none = () => {}

/** How long a beat is, in ms. */
const BEAT = 2400

const LABEL =
  'Tally’s board: four tasks running at once, led by Opus, Codex, Gemini and Qwen, beside what is next, what needs you and what has settled'

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
      {phone ? (
        <Flow beat={beat} watched={watched} />
      ) : (
        <Shot w={W} h={H} label={LABEL} frame={s.frame}>
          <Window beat={beat} />
        </Shot>
      )}
    </div>
  )
}

function Window({ beat, story }: { beat: number; story?: BoardStory }) {
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
        <BoardAtWork beat={beat} {...(story ? { story } : {})} />
      </div>
    </div>
  )
}

/* ---- on a phone: one task's way through the board ---- */

/** The task it follows: the backfill waiting for an agent to be free, the one the coordinator plans further down. */
const WAITING = NEXT.find((x) => x.wait === Wait.Workers) ?? NEXT[0]!
const HERO = { task: WAITING.task, title: WAITING.title, ...(WAITING.kind ? { kind: WAITING.kind } : {}) }
const STEPS = ['Implement', 'Review', 'Security review']
const PR = { repo: 'tally-api', number: 1192, add: 84, del: 9 }

const LANES = [BoardLane.Next, BoardLane.Running, BoardLane.Yours, BoardLane.Settled] as const

/** The task as each lane draws it. */
function heroIn(lane: BoardLane, at = 0): ReactNode {
  switch (lane) {
    case BoardLane.Next:
      return <NextRow {...WAITING} place={NEXT.indexOf(WAITING) + 1} />
    case BoardLane.Running:
      return (
        <WorkCard
          {...HERO}
          steps={STEPS}
          at={at}
          elapsed={`${4 + at * 7}m`}
          lead={OPUS}
          {...(at === 1 ? { onStep: [SONNET, GEMINI_PRO] } : {})}
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
const TO_YOURS = TO_RUNNING + TRAVEL + STEPS.length * STEP
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
    at: Math.min(STEPS.length - 1, Math.max(0, Math.floor((ms - TO_RUNNING - TRAVEL) / STEP))),
    pressed: ms >= PRESS && ms < TO_SETTLED,
    fading: ms >= FADE,
    // Just round again: back at Up next at once, with no glide across.
    cut: ms < TURN,
  }
}
type Frame = ReturnType<typeof frameAt>
const same = (a: Frame, b: Frame) => (Object.keys(a) as (keyof Frame)[]).every((k) => a[k] === b[k])
/** Still: the task running, on its second step. */
const STILL = frameAt(TO_RUNNING + TRAVEL + STEP)
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

function Flow({ beat, watched }: { beat: number; watched: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const still = useStill()
  const round = useRound(watched && !still)
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
    card: heroIn(lane, frame.at),
    arriving: frame.flying,
    className: cx(s.hero, frame.pressed && s.pressed),
  }
  const view = lanes[frame.lane] ?? { left: 22 + frame.lane * 356, width: 346 }
  return (
    <div
      ref={box}
      className={cx(s.lanes, frame.fading && s.fading, (frame.cut || lanes.length === 0) && s.cut)}
      style={{ '--glide': `${GLIDE}ms`, '--follow': `${FOLLOW}ms`, '--turn': `${TURN}ms` } as CSSProperties}
    >
      <Shot w={W} h={H} phone={{ x: view.left - SIDE, y: TOP, w: view.width + 2 * SIDE, h: TALL }} label={LABEL} frame={s.lane}>
        <Window beat={beat} story={story} />
        {frame.flying && (
          <Flight
            key={frame.lane}
            lane={frame.lane}
            stood={stood}
            leaving={heroIn(LANES[frame.lane - 1]!, STEPS.length - 1)}
            arriving={heroIn(lane, 0)}
          />
        )}
      </Shot>
    </div>
  )
}

/**
 * The task on its way to `lane`, drawn over the board: it lifts from where
 * it `stood` in the lane before, flies to the place held for it, turning
 * from what it was there into what it is here, and lands. Without where it
 * stood, it is there already.
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
      ...[...el.children].map((layer, i) =>
        layer.animate(
          i === 0
            ? [{ opacity: 1 }, { opacity: 1, offset: 0.35 }, { opacity: 0, offset: 0.7 }]
            : [{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1, offset: 0.7 }],
          { duration: whole, fill: 'both' },
        ),
      ),
    ]
    return () => runs.forEach((one) => one.cancel())
  }, [lane, stood])
  return (
    <div ref={ref} className={s.flight} aria-hidden="true">
      <div>{leaving}</div>
      <div>{arriving}</div>
    </div>
  )
}
