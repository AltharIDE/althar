import { useLayoutEffect, useMemo, useRef, useState } from 'react'

import { DEVICES } from '../../../src/main/browser/devices'
import type { Artifact, BoardDef } from '../artifacts'
import { boardKey, boardsOf, useLive } from '../live'
import { Board, drawnWidth, type Frames } from './Board'
import s from './parts.module.css'

/*
 * An artifact as a gallery card draws it: a little of its canvas, its first
 * boards side by side on the dotted ground, live, at their own sizes, so a
 * card reads as boards rather than a screenshot. Never pointed at. Building
 * it for real, these are stills made when a version is published.
 */

const PAD = 16
const GAP = 10

/** A board's own width and the height it is seen at. */
const shapeOf = (def: BoardDef) =>
  def.draw === undefined
    ? { width: DEVICES[def.size ?? 'laptop'].width, height: DEVICES[def.size ?? 'laptop'].height }
    : { width: drawnWidth(def), height: Math.round(drawnWidth(def) * 0.62) }

export function Sheet({ artifact, most = 3, className }: { artifact: Artifact; most?: number; className?: string }) {
  const world = useLive()
  const place = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState({ width: 0, height: 0 })
  const frames = useMemo<Frames>(() => new Map(), [])
  useLayoutEffect(() => {
    const box = place.current
    if (box === null) return
    const observer = new ResizeObserver(() => setRoom({ width: box.clientWidth, height: box.clientHeight }))
    observer.observe(box)
    return () => observer.disconnect()
  }, [])
  const page = artifact.pages[0]?.id ?? ''
  const boards = boardsOf(world, artifact, page).slice(0, most)
  const shapes = boards.map(shapeOf)
  // As tall as the sheet allows, unless that runs them off its sides.
  const tall = room.height - PAD * 2
  const wide = shapes.reduce((sum, one) => sum + (one.width / one.height) * tall, 0) + GAP * (shapes.length - 1)
  const height =
    wide > room.width - PAD * 2 ? tall * ((room.width - PAD * 2 - GAP * (shapes.length - 1)) / (wide - GAP * (shapes.length - 1))) : tall
  return (
    <div ref={place} className={[s.sheet, className].filter(Boolean).join(' ')} aria-hidden>
      {room.width > 0 &&
        boards.map((def, i) => {
          const shape = shapes[i] ?? { width: 1280, height: 800 }
          const width = (shape.width / shape.height) * height
          const scale = width / shape.width
          const landed = world.landed[boardKey(artifact.id, def.id)] ?? []
          const look = Object.assign({}, def.look, ...landed.map((one) => one.look ?? {}))
          return (
            <div key={def.id} className={s.sheetBoard} data-drawn={def.draw !== undefined || undefined} style={{ width, height }}>
              <div className={s.thumbWorld} style={{ width: shape.width, height: height / scale, transform: `scale(${scale})` }}>
                <Board
                  id={`sheet/${artifact.id}/${def.id}`}
                  def={def}
                  width={shape.width}
                  look={look}
                  frames={frames}
                  onHeight={() => undefined}
                />
              </div>
            </div>
          )
        })}
    </div>
  )
}
