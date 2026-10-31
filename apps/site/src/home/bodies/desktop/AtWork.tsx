import { ChromeButton, Room, RoomSwitch, WorkStatus } from '@althar/ui'
import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { askedSecond, useStill } from '../../../lib/browser'
import { cx } from '../../../lib/cx'
import { BoardAtWork, Tabs } from '../kit/app'
import { useNarrow } from '../kit/Narrow'
import { useInView } from '../kit/seen'
import { Shot } from '../kit/Shot'
import app from '../kit/app.module.css'
import s from './AtWork.module.css'

/*
 * Tally's board, in Althar's light on the dark of the panel: four tasks
 * running at once, each led by another lab. While it is watched the work
 * goes on: a beat every couple of seconds, a minute on each task's clock
 * and, at its own pace, a step on. On a phone, a lane at a time, its foot
 * fading out, and the view moving along the lanes as the work does, from
 * left to right: from Running to what needs you and what has settled,
 * then fading back to what is next. Still, on Running, with motion reduced
 * or a moment held (`?t=`).
 */

const none = () => {}

/** How long a beat is, in ms. */
const BEAT = 2400

const LABEL =
  'Tally’s board: four tasks running at once, led by Opus, Codex, Gemini and Qwen, beside what is next, what needs you and what has settled'

/** The board's design size, in px. */
const W = 1440
const H = 780
/** On a phone, a lane from its head under the window's tabs, this tall, with this much room either side. */
const TOP = 56
const TALL = 480
const SIDE = 8
/** On a phone, how long the view rests on a lane, how long it takes to glide to the next, and to fade at the last and come back at the first, in ms. */
const REST = 2800
const GLIDE = 900
const TURN = 320

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
  const board = (
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
        <BoardAtWork beat={beat} />
      </div>
    </div>
  )
  return (
    <div ref={box} className={s.wrap}>
      {phone ? (
        <Lanes watched={watched}>{board}</Lanes>
      ) : (
        <Shot w={W} h={H} label={LABEL} frame={s.frame}>
          {board}
        </Shot>
      )}
    </div>
  )
}

/** A lane's place in the board as designed, in its px. */
interface Lane {
  left: number
  width: number
}

/** Where the board's lanes are, read from its layout, which the picture's scale doesn't touch. */
function lanesOf(stage: HTMLElement): Lane[] {
  const leftOf = (el: HTMLElement) => {
    let left = 0
    for (let at: Element | null = el; at instanceof HTMLElement && at !== stage; at = at.offsetParent) left += at.offsetLeft
    return left
  }
  return [...stage.querySelectorAll<HTMLElement>('[data-lane]')].map((lane) => ({ left: leftOf(lane), width: lane.offsetWidth }))
}

/** The board on a phone: a lane at a time, the view moving on to the next while it is `watched`. */
function Lanes({ watched, children }: { watched: boolean; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [lanes, setLanes] = useState<Lane[]>([])
  useLayoutEffect(() => {
    const stage = box.current?.querySelector<HTMLElement>('[data-picture]')
    if (!stage) return
    // Read once it is laid out, before it is painted.
    const ro = new ResizeObserver(() => setLanes(lanesOf(stage)))
    ro.observe(stage)
    return () => ro.disconnect()
  }, [])
  const still = useStill()
  // Which lane is in view: Running, the second, to begin with and when still.
  const [at, setAt] = useState(1)
  // At the last lane it fades (turning), comes back to the first unseen (cut, with no glide), and fades in. It
  // starts cut too, so it doesn't glide from where it is drawn before the lanes are read.
  const [turning, setTurning] = useState(false)
  const [cut, setCut] = useState(true)
  const moving = watched && !still && lanes.length > 1
  useEffect(() => {
    if (!moving || turning) return
    const id = window.setTimeout(() => (at < lanes.length - 1 ? setAt(at + 1) : setTurning(true)), REST + GLIDE)
    return () => clearTimeout(id)
  }, [moving, turning, at, lanes.length])
  useEffect(() => {
    if (!turning) return
    const id = window.setTimeout(() => {
      setCut(true)
      setAt(0)
    }, TURN)
    return () => clearTimeout(id)
  }, [turning])
  useEffect(() => {
    if (!cut || lanes.length === 0) return
    // Once the lane is drawn without a glide, it glides again, and fades in.
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => {
        setCut(false)
        setTurning(false)
      })
    })
    return () => cancelAnimationFrame(id)
  }, [cut, lanes.length])
  const lane = lanes[still ? 1 : at] ?? { left: 378, width: 346 }
  return (
    <div
      ref={box}
      className={cx(s.lanes, turning && s.turning, cut && s.cut)}
      style={{ '--glide': `${GLIDE}ms`, '--turn': `${TURN}ms` } as CSSProperties}
    >
      <Shot w={W} h={H} phone={{ x: lane.left - SIDE, y: TOP, w: lane.width + 2 * SIDE, h: TALL }} label={LABEL} frame={s.lane}>
        {children}
      </Shot>
    </div>
  )
}
