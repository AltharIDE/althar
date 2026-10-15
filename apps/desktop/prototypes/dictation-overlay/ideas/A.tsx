// Throwaway: A, a pill that floats just above the screen's composer, opens into a card with the words, and goes wherever it is dragged. Where the composer already has pills over it (Running, Listening), the switcher's place says where it goes among them.
import { type CSSProperties, type PointerEvent, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { Icon, IconButton } from '@althar/ui'

import { act } from '../voice'
import { After, Controls, Editor, Failed, Seen, Send, statusOf, tailOf, To, type View, Wave, Words, Writing } from './common'
import s from './A.module.css'
import { useAboveComposer, useEdges } from './place'

/** The pill itself: its voice, how long, who it goes to, and the last few words; E draws it too. Compact, it is as tall as the pills it sits among. */
export function Pill({
  view,
  onOpen,
  grip,
  compact = false,
}: {
  view: View
  onOpen?: () => void
  grip?: (event: PointerEvent<HTMLElement>) => void
  compact?: boolean
}) {
  const { session } = view
  const tail = tailOf(view, compact ? 3 : 8)
  const lingering = session.phase === 'sent' || session.phase === 'cancelled'
  return (
    <div className={compact ? `${s.pill} ${s.compact}` : s.pill} onPointerDown={grip}>
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
          <To address={view.to} className={s.to} short={compact} />
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

const GAP = 8

export function A({ view, area }: { view: View; area: HTMLElement | null }) {
  const aboveComposer = useAboveComposer(area)
  const edges = useEdges(area)
  const { session, live } = view
  const drag = useRef<{ x: number; y: number; left: number; bottom: number; moved: boolean } | null>(null)
  const [self, setSelf] = useState<HTMLDivElement | null>(null)
  const [own, setOwn] = useState(0)
  // How wide the pill is now, to know whether it still fits beside the others.
  useEffect(() => {
    if (self === null) return
    const observer = new ResizeObserver(() => setOwn(self.offsetWidth))
    observer.observe(self)
    return () => observer.disconnect()
  }, [self])
  if (!view.shown) return null
  const width = area?.clientWidth ?? window.innerWidth
  // Written, or not written, the person has something to do: it opens by itself.
  const open = live.open || session.phase === 'done' || session.phase === 'failed'
  const place = live.place
  const { composer, pills } = edges
  const compact = !open && live.pos === null && composer !== null && (place === 'right' || place === 'row')

  /* Where it goes: dragged, where it was put; with no composer on screen, bottom centre; otherwise by the place chosen. */
  const at = ((): CSSProperties => {
    if (live.pos !== null) return { left: live.pos.x, bottom: live.pos.y }
    if (composer === null || place === 'centre') return { left: width / 2, bottom: aboveComposer }
    const middle = (composer.left + composer.right) / 2
    const overPills = (pills?.top ?? composer.top) + GAP
    if (open) {
      // The card never covers the pills: it opens above them, from the side it sat on.
      if (place === 'right') return { right: width - composer.right, bottom: overPills, transform: 'none' }
      if (place === 'row') return { left: composer.left, bottom: overPills, transform: 'none' }
      return { left: middle, bottom: overPills }
    }
    if (place === 'above') return { left: middle, bottom: overPills }
    if (place === 'row') return { left: composer.left, bottom: composer.top + GAP, transform: 'none' }
    // The right end, on the pills' line, unless their lowest row reaches it: then a row up.
    const crowded = pills !== null && pills.rowEnd + GAP * 2 + own > composer.right
    return { right: width - composer.right, bottom: crowded ? overPills : composer.top + GAP, transform: 'none' }
  })()

  const grip = (event: PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button, textarea, [role="menu"]') !== null) return
    const box = event.currentTarget.getBoundingClientRect()
    const frame = area?.getBoundingClientRect()
    const left = live.pos?.x ?? box.left + box.width / 2 - (frame?.left ?? 0)
    const bottom = live.pos?.y ?? (frame?.bottom ?? window.innerHeight) - box.bottom
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

  const pill = <Pill view={view} onOpen={() => act.open(true)} grip={grip} compact={compact} />

  // In their row: one more of the pills over the composer, the first, so the rest move along and wrap above as they do.
  if (!open && live.pos === null && place === 'row' && pills !== null)
    return createPortal(
      <div className={s.inRow} data-overlay="" ref={setSelf}>
        {pill}
      </div>,
      pills.element,
    )

  return (
    <div className={s.float} style={at} data-overlay="" ref={setSelf}>
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
        pill
      )}
    </div>
  )
}
