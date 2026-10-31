import { ChromeButton, Room, RoomSwitch, WorkStatus } from '@althar/ui'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { askedSecond } from '../../../lib/browser'
import { BoardAtWork, Tabs } from '../kit/app'
import { useNarrow } from '../kit/Narrow'
import { useInView } from '../kit/seen'
import { type Region, Shot } from '../kit/Shot'
import app from '../kit/app.module.css'
import s from './AtWork.module.css'

/*
 * Tally's board, in Althar's light on the dark of the panel: four tasks
 * running at once, each led by another lab. While it is watched the work
 * goes on: a beat every couple of seconds, a minute on each task's clock
 * and, at its own pace, a step on. Still with motion reduced or a moment
 * held (`?t=`). On a phone, the lanes side by side, a lane to a screen:
 * it opens on the running one, the lanes either side peeking in at the
 * edges, and swipes from lane to lane.
 */

const none = () => {}

/** How long a beat is, in ms. */
const BEAT = 2400

const LABEL =
  'Tally’s board: four tasks running at once, led by Opus, Codex, Gemini and Qwen, beside what is next, what needs you and what has settled'

/** The board's design size, in px. */
const W = 1440
const H = 780
/** On a phone, how much of the screen's width a lane takes: the rest is its neighbours' edges. */
const SHARE = 0.84
/** On a phone, the lanes from under the window's tabs, this tall. */
const TOP = 56
const TALL = 640

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
        <Lanes>{board}</Lanes>
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

/** The board on a phone: a strip of its lanes as wide as the panel, scrolling from one to the next. */
function Lanes({ children }: { children: ReactNode }) {
  const strip = useRef<HTMLDivElement>(null)
  // The strip's width, and where the lanes are in the board's design px, each time the strip changes size; first before it is painted.
  const [{ view, lanes }, setRoom] = useState<{ view: number; lanes: Lane[] }>({ view: 0, lanes: [] })
  useLayoutEffect(() => {
    const el = strip.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const stage = el.querySelector<HTMLElement>('[data-picture]')
      if (stage) setRoom({ view: el.clientWidth, lanes: lanesOf(stage) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const first = lanes[0]
  const last = lanes.at(-1)
  const ready = first !== undefined && last !== undefined && view > 0
  // A lane takes SHARE of the screen; the room either side lets the first and the last come to the middle too.
  const scale = ready ? (view * SHARE) / first.width : 0
  const side = ready ? (view * (1 - SHARE)) / 2 / scale : 0
  const region: Region = ready
    ? { x: first.left - side, y: TOP, w: last.left + last.width - first.left + 2 * side, h: TALL }
    : { x: 0, y: TOP, w: W, h: TALL }
  // It opens on Running, the second lane, with Up next and Needs you at its edges.
  const opened = useRef(false)
  const running = lanes[1]
  useLayoutEffect(() => {
    const el = strip.current
    if (!el || !ready || !running || opened.current) return
    opened.current = true
    el.scrollLeft = (running.left - region.x) * scale - (view * (1 - SHARE)) / 2
  })
  return (
    <div ref={strip} className={s.strip}>
      <div className={s.track} style={ready ? { width: region.w * scale } : undefined}>
        <Shot w={W} h={H} phone={region} maxScale={4} label={LABEL} frame={s.lanes}>
          {children}
        </Shot>
        {ready &&
          lanes.map((lane) => (
            <span key={lane.left} className={s.snap} style={{ left: (lane.left - region.x) * scale, width: lane.width * scale }} />
          ))}
      </div>
    </div>
  )
}
