import { useLayoutEffect, useMemo, useRef, useState } from 'react'

import { DEVICES } from '../../../src/main/browser/devices'
import type { Artifact } from '../artifacts'
import { Board, drawnWidth, type Frames } from './Board'
import s from './parts.module.css'

/*
 * A picture of an artifact: its first board, live, drawn as small as its
 * place, from the top, as a gallery or a menu shows it. Never pointed at.
 */

export function Thumb({ artifact, className }: { artifact: Artifact; className?: string }) {
  const def = artifact.pages[0]?.boards[0]
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
  if (def === undefined) return null
  const laid = def.draw === undefined ? DEVICES[def.size ?? 'laptop'].width : drawnWidth(def)
  const scale = room.width / laid
  return (
    <div ref={place} className={[s.thumb, className].filter(Boolean).join(' ')} aria-hidden data-phone={def.size === 'phone' || undefined}>
      {room.width > 0 && (
        <div className={s.thumbWorld} style={{ width: laid, height: room.height / scale, transform: `scale(${scale})` }}>
          <Board id={`thumb/${artifact.id}`} def={def} width={laid} look={def.look ?? {}} frames={frames} onHeight={() => undefined} />
        </div>
      )}
    </div>
  )
}
