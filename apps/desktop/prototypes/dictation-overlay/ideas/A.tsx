// Throwaway: A, a pill that floats just above the screen's composer, opens into a card with the words, and goes wherever it is dragged.
import { type PointerEvent, useRef } from 'react'

import { Icon, IconButton } from '@althar/ui'

import { act } from '../voice'
import { After, Controls, Editor, Failed, Seen, Send, statusOf, tailOf, To, type View, Wave, Words, Writing } from './common'
import s from './A.module.css'
import { useAboveComposer } from './place'

/** The pill itself: its voice, how long, who it goes to, and the last few words; E draws it too. */
export function Pill({ view, onOpen, grip }: { view: View; onOpen?: () => void; grip?: (event: PointerEvent<HTMLElement>) => void }) {
  const { session } = view
  const tail = tailOf(view, 8)
  const lingering = session.phase === 'sent' || session.phase === 'cancelled'
  return (
    <div className={s.pill} onPointerDown={grip}>
      {lingering ? (
        <After view={view} />
      ) : (
        <>
          {session.phase === 'writing' ? (
            <Writing view={view} />
          ) : session.phase === 'done' || session.phase === 'failed' ? (
            <span className={s.state}>
              <Icon name={session.phase === 'done' ? 'check' : 'stop'} size={12} />
              {statusOf(view)}
            </span>
          ) : (
            <span className={s.state}>
              <Wave levels={session.levels} className={s.wave} />
              {session.phase === 'paused' ? 'Paused' : view.elapsed}
            </span>
          )}
          <To address={view.to} className={s.to} />
          {(session.phase === 'listening' || session.phase === 'paused') && (
            <button type="button" className={s.tail} onClick={onOpen} aria-label="Show all of what you said">
              {tail.cut && '… '}
              {tail.text}
            </button>
          )}
          {session.phase === 'listening' && (
            <IconButton icon="square" size="small" label="Stop and write it down" kbd="⌘⇧D" onClick={act.stop} />
          )}
          {onOpen && <IconButton icon="up" size="small" label="Open" onClick={onOpen} className={s.open} />}
        </>
      )}
    </div>
  )
}

export function A({ view, area }: { view: View; area: HTMLElement | null }) {
  const above = useAboveComposer(area)
  const { session, live } = view
  const drag = useRef<{ x: number; y: number; left: number; bottom: number; moved: boolean } | null>(null)
  if (!view.shown) return null
  const width = area?.clientWidth ?? window.innerWidth
  const left = live.pos?.x ?? width / 2
  const bottom = live.pos?.y ?? above
  // Written, or not written, the person has something to do: it opens by itself.
  const open = live.open || session.phase === 'done' || session.phase === 'failed'

  const grip = (event: PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button, textarea, [role="menu"]') !== null) return
    drag.current = { x: event.clientX, y: event.clientY, left, bottom, moved: false }
    const element = event.currentTarget
    element.setPointerCapture(event.pointerId)
    const move = (next: globalThis.PointerEvent) => {
      const from = drag.current
      if (from === null) return
      const dx = next.clientX - from.x
      const dy = next.clientY - from.y
      if (!from.moved && Math.hypot(dx, dy) < 4) return
      from.moved = true
      act.drag({ x: Math.max(120, Math.min(width - 120, from.left + dx)), y: Math.max(8, from.bottom - dy) })
    }
    const up = () => {
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerup', up)
      drag.current = null
    }
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerup', up)
  }

  return (
    <div className={s.float} style={{ left, bottom }} data-overlay="">
      {open ? (
        <section className={s.card} aria-label="Dictation" onPointerDown={grip}>
          <header className={s.head}>
            <To address={view.to} />
            <span className={s.grow} />
            <span className={s.status}>{session.phase === 'writing' ? null : statusOf(view)}</span>
            <IconButton icon="chevronD" size="small" label="Make it small" onClick={() => act.open(false)} />
          </header>
          {session.phase === 'done' ? (
            <Editor view={view} rows={5} />
          ) : session.phase === 'failed' ? (
            <Failed view={view} />
          ) : session.phase === 'sent' || session.phase === 'cancelled' ? (
            <After view={view} />
          ) : (
            <Words view={view} className={s.words} />
          )}
          <Seen view={view} />
          {session.phase !== 'failed' && session.phase !== 'sent' && session.phase !== 'cancelled' && (
            <footer className={s.foot}>
              {session.phase === 'writing' ? (
                <Writing view={view} />
              ) : session.phase === 'done' ? null : (
                <Wave levels={session.levels} className={s.wave} />
              )}
              <span className={s.grow} />
              <Controls view={view} />
              <Send view={view} />
            </footer>
          )}
          <span className={s.grip} aria-hidden="true" title="Drag it anywhere">
            <i />
            <i />
            <i />
          </span>
        </section>
      ) : (
        <Pill view={view} onOpen={() => act.open(true)} grip={grip} />
      )}
    </div>
  )
}
