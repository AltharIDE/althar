import { ChromeButton, Room, RoomSwitch, WorkStatus } from '@althar/ui'
import { useEffect, useRef, useState } from 'react'

import { BoardAtWork, Tabs } from '../kit/app'
import { useInView } from '../kit/seen'
import { Shot } from '../kit/Shot'
import app from '../kit/app.module.css'
import s from './AtWork.module.css'

/*
 * Tally's board at night, four tasks running at once, each led by
 * another lab. While it is watched the work goes on: a beat every couple of
 * seconds, a minute on each task's clock and, at its own pace, a step on.
 * Still with motion reduced or a moment held (`?t=`); on a phone, the
 * running column alone.
 */

const none = () => {}

/** How long a beat is, in ms. */
const BEAT = 2400

export function AtWork() {
  const box = useRef<HTMLDivElement>(null)
  const watched = useInView(box, 0.2)
  const [beat, setBeat] = useState(0)
  useEffect(() => {
    if (!watched) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || new URLSearchParams(window.location.search).has('t')) return
    const id = window.setInterval(() => setBeat((n) => n + 1), BEAT)
    return () => clearInterval(id)
  }, [watched])
  return (
    <div ref={box} className={s.wrap}>
      <Shot
        w={1440}
        h={780}
        phone={{ x: 378, y: 56, w: 346, h: 620 }}
        label="Tally’s board: four tasks running at once, led by Opus, Codex, Gemini and Qwen, beside what is next, what needs you and what has settled"
        frame={s.frame}
      >
        <div className={`${app.window} ${s.window}`} data-theme="dark">
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
      </Shot>
    </div>
  )
}
