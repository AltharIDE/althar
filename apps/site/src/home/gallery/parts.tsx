import { Icon } from '@althar/ui'
import { type KeyboardEvent, type ReactNode, type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { cx } from '../../lib/cx'
import c from '../bodies/desktop/DesktopBody.module.css'
import t from '../bodies/kit/type.module.css'
import { useInView, usePageShown } from '../bodies/kit/seen'
import g from './gallery.module.css'
import type { Shot } from './shots'

/*
 * What the gallery's directions share: the station they stand in on the
 * cabin's wall (its stamp on the rail, its head), the rail of named stops
 * that plays through them, and the screen opened whole over the page.
 */

export type Place = 'top' | 'end'

const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** The gallery's station: its stamp on the rail, 00 above the first station or 07 under the last, its head, and what it shows. */
export function GalleryStation({
  place,
  name,
  title,
  lead,
  children,
}: {
  place: Place
  name: string
  title: ReactNode
  lead: ReactNode
  children: ReactNode
}) {
  return (
    <section id="gallery" className={cx(c.station, g.station)} data-place={place} data-station="" aria-labelledby="gallery-h">
      <p className={c.stamp} aria-hidden="true">
        <span className={c.node} />
        <b>{place === 'top' ? '00' : '07'}</b>
        <span>{name}</span>
        <span className={c.rule} />
        <span className={c.alt}>
          Alt <b>{place === 'top' ? '45.0' : '0.5'}</b> km
        </span>
      </p>
      <div className={c.head}>
        <h2 id="gallery-h" className={cx(t.title, c.title)}>
          {title}
        </h2>
        <p className={cx(t.lead, c.lead)}>{lead}</p>
      </div>
      {children}
    </section>
  )
}

/**
 * Playing through `n` stops: on by itself while it is on screen, in a shown
 * tab, not pointed at, and with motion allowed. `tabs`: picking one holds it
 * there (the person has taken over) and Play goes on from it; `film`:
 * picking one plays on from it, and Pause holds the stop where it is.
 */
export function usePlay(ref: RefObject<HTMLElement | null>, n: number, kind: 'tabs' | 'film') {
  const [at, setAt] = useState(0)
  const [auto, setAuto] = useState(true)
  const [moves, setMoves] = useState(true)
  const [round, setRound] = useState(0)
  const [over, setOver] = useState(false)
  const seen = useInView(ref, 0.45)
  const shown = usePageShown()
  useEffect(() => {
    if (reduced()) {
      setMoves(false)
      setAuto(false)
    }
  }, [])
  const running = moves && auto && !over && seen && shown
  const next = useCallback(() => {
    setAt((a) => (a + 1) % n)
    setRound((r) => r + 1)
  }, [n])
  const pick = (k: number) => {
    setAt(k)
    setRound((r) => r + 1)
    if (kind === 'tabs') setAuto(false)
  }
  const toggle = () => {
    if (!moves) return
    setAuto((a) => !a)
    if (kind === 'tabs') setRound((r) => r + 1)
  }
  return {
    at,
    auto,
    running,
    round,
    /** Whether the stop's line fills as it plays: always in a film (held where it is when paused), in tabs only while they play. */
    filling: moves && (kind === 'film' || auto),
    moves,
    next,
    pick,
    toggle,
    hover: { onPointerEnter: () => setOver(true), onPointerLeave: () => setOver(false) },
  }
}

export type Play = ReturnType<typeof usePlay>

/** The stops, named, each with its line that fills as it plays; in a film each as long as it plays, those played lit. Then Play or Pause. */
export function Rail({
  play,
  stops,
  panel,
  label,
  film = false,
}: {
  play: Play
  stops: readonly { label: string; ms: number }[]
  panel: string
  label: string
  film?: boolean
}) {
  const row = useRef<HTMLDivElement>(null)
  const go = (k: number) => {
    const to = (k + stops.length) % stops.length
    play.pick(to)
    row.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[to]?.focus()
  }
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') go(play.at + 1)
    else if (e.key === 'ArrowLeft') go(play.at - 1)
    else return
    e.preventDefault()
  }
  // On a narrow screen the stops scroll sideways: the one playing stays in sight, without moving the page.
  useEffect(() => {
    const el = row.current
    const on = el?.querySelectorAll<HTMLElement>('[role="tab"]')[play.at]
    if (!el || !on || el.scrollWidth <= el.clientWidth) return
    const left = on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2
    el.scrollTo({ left, behavior: reduced() ? 'auto' : 'smooth' })
  }, [play.at])
  return (
    <div className={g.railRow} data-film={film || undefined}>
      <div ref={row} className={g.rail} role="tablist" aria-label={label} onKeyDown={keys}>
        {stops.map((stop, k) => {
          const on = k === play.at
          return (
            <button
              key={stop.label}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls={panel}
              tabIndex={on ? 0 : -1}
              className={g.stop}
              data-on={on || undefined}
              data-played={(film && k < play.at) || undefined}
              style={film ? { flexGrow: stop.ms } : undefined}
              onClick={() => play.pick(k)}
            >
              <span className={g.track}>
                {on && (
                  <i
                    key={play.round}
                    className={g.fill}
                    data-filling={play.filling || undefined}
                    style={{ animationDuration: `${stop.ms}ms`, animationPlayState: play.running ? 'running' : 'paused' }}
                    onAnimationEnd={play.next}
                  />
                )}
              </span>
              <span className={g.stopName}>{stop.label}</span>
            </button>
          )
        })}
      </div>
      {play.moves && (
        <button type="button" className={g.toggle} onClick={play.toggle} aria-label={play.auto ? 'Pause' : 'Play'}>
          <Icon name={play.auto ? 'pause' : 'play'} size={12} />
        </button>
      )}
    </div>
  )
}

/** A screen as a picture on the wall: the framed screenshot, its place kept before it loads. */
export function Picture({ shot, className, eager = false }: { shot: Shot; className?: string; eager?: boolean }) {
  return (
    <img
      className={className}
      src={shot.src}
      width={shot.w}
      height={shot.h}
      alt={shot.alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
    />
  )
}

/**
 * A screen opened whole, over the page: grown from the picture it was opened
 * from, with a fade; the others a key or a press away; Escape, the cross or
 * the dark round it closes it, back to that picture.
 */
export function Lightbox({ shots, at, from, onClose }: { shots: readonly Shot[]; at: number; from: HTMLElement; onClose: () => void }) {
  const [i, setI] = useState(at)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const figure = useRef<HTMLElement>(null)
  const shot = shots[i] ?? shots[0]!
  const close = useCallback(() => {
    setOpen(false)
    window.setTimeout(
      () => {
        onClose()
        from.focus({ preventScroll: true })
      },
      reduced() ? 0 : 140,
    )
  }, [from, onClose])
  // It grows from the picture it was opened from: that picture's middle, in the figure's own box.
  useLayoutEffect(() => {
    const fig = figure.current
    if (!fig) return
    const a = from.getBoundingClientRect()
    const b = fig.getBoundingClientRect()
    fig.style.transformOrigin = `${a.left + a.width / 2 - b.left}px ${a.top + a.height / 2 - b.top}px`
    box.current?.focus({ preventScroll: true })
    const frame = requestAnimationFrame(() => setOpen(true))
    const html = document.documentElement
    const was = html.style.overflow
    html.style.overflow = 'hidden'
    return () => {
      cancelAnimationFrame(frame)
      html.style.overflow = was
    }
  }, [from])
  const step = (by: number) => setI((k) => (k + by + shots.length) % shots.length)
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
    else if (e.key === 'ArrowRight') step(1)
    else if (e.key === 'ArrowLeft') step(-1)
    else return
    e.preventDefault()
  }
  return createPortal(
    <div
      ref={box}
      className={g.lightbox}
      data-open={open || undefined}
      role="dialog"
      aria-modal="true"
      aria-label={shot.name}
      tabIndex={-1}
      onKeyDown={keys}
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <figure ref={figure} className={g.lbFigure}>
        <img className={g.lbPicture} src={shot.window.src} width={shot.window.w} height={shot.window.h} alt={shot.alt} draggable={false} />
        <figcaption className={g.lbCaption}>
          <b>{shot.name}</b> {shot.line}
        </figcaption>
      </figure>
      <button type="button" className={cx(g.round, g.lbPrev)} onClick={() => step(-1)} aria-label="Previous screen">
        <Icon name="chevronL" size={16} />
      </button>
      <button type="button" className={cx(g.round, g.lbNext)} onClick={() => step(1)} aria-label="Next screen">
        <Icon name="chevron" size={16} />
      </button>
      <button type="button" className={cx(g.round, g.lbClose)} onClick={close} aria-label="Close">
        <Icon name="close" size={16} />
      </button>
    </div>,
    document.body,
  )
}
