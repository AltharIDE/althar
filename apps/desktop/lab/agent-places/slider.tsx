import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from 'react'
import { Icon, LinkButton, SettingRow } from '@althar/ui'

import k from '../../../../packages/ui/src/setup/Preferences/Preferences.module.css'
import type { Places } from './data'
import { words } from './words'
import s from './slider.module.css'

/*
 * Agents at once, as the kit draws it (`AgentsAtOnce`, with its own styles):
 * the default's mark, the thumb clicking into it, the warmth past it. What the
 * lab adds: the number lowered for now, marked on the track (its ink stops
 * there, the track runs bare to the person's own); and, where a take asks,
 * each agent at work as a cobalt dot on its step, from the first.
 */

export interface LiveAtOnceProps {
  places: Places
  most: number
  onChange: (count: number | null) => void
  compact?: boolean
  /** The agents at work, on the track, and a line of what works and waits. */
  work?: { readonly waiting: number } | null
  /** Without the row's glyph, where room is short, as in a popover. */
  bare?: boolean
}

export function LiveAtOnce({ places, most, onChange, compact = false, work = null, bare = false }: LiveAtOnceProps) {
  const { machine, configured: count } = places
  const [held, setHeld] = useState<number | null>(null)
  const track = useRef<HTMLDivElement>(null)
  const n = held ?? count
  const own = n !== machine.count
  const heat = Math.max(0, Math.min(1, (n - machine.count) / Math.max(1, most - machine.count)))
  const at = (v: number) => `${((v - 1) / Math.max(1, most - 1)) * 100}%`
  const clamp = (v: number) => Math.max(1, Math.min(most, v))
  const send = (next: number) => {
    if (next !== count) onChange(next === machine.count ? null : next)
  }
  const from = (x: number) => {
    const box = track.current?.getBoundingClientRect()
    if (box === undefined || box.width === 0) return n
    const raw = 1 + ((x - box.left) / box.width) * (most - 1)
    if (Math.abs(raw - machine.count) < 0.6) return machine.count
    return clamp(Math.round(raw))
  }
  const heatStyle = { '--heat': heat } as CSSProperties
  // Lowered for now, below the number on the thumb: while it is held, as the number it would be.
  const lowered = places.atOnce < n
  const reason = compact ? words.forNow(places) : words.lowered(places)
  const reset = (
    <>
      {own && held === null && (
        <>
          {' '}
          <LinkButton className={k.reset} onClick={() => onChange(null)}>
            Use the default
          </LinkButton>
        </>
      )}
    </>
  )
  const plain: ReactNode = compact
    ? 'The rest wait their turn'
    : n === machine.count
      ? `Default for ${machine.memory} GB and ${machine.cores} cores`
      : n < machine.count
        ? 'Below the default'
        : n <= machine.count + 2
          ? 'Tests may slow down'
          : 'May run hot'
  const note =
    work === null ? (
      <>
        {lowered && reason !== null ? <span className={s.reason}>{reason}</span> : plain}
        {reset}
      </>
    ) : (
      <span className={s.lines}>
        <span className={s.work}>
          <i className={s.key} aria-hidden="true" />
          {words.sliderWork(places, work.waiting)}
        </span>
        <span>
          {lowered && reason !== null ? <span className={s.reason}>{reason}</span> : plain}
          {reset}
        </span>
      </span>
    )
  const busy = Math.min(places.agents.length, most)
  return (
    <SettingRow
      title={words.atOnce}
      className={[compact ? k.compact : '', bare ? s.bare : ''].join(' ')}
      note={note}
      {...(bare
        ? {}
        : {
            glyph: (
              <span className={k.breathe} style={{ ...heatStyle, '--speed': `${2.8 - heat * 2.1}s` } as CSSProperties}>
                <Icon name="agents" size={15} />
              </span>
            ),
          })}
      under={
        <div className={k.slider} style={heatStyle}>
          <div
            ref={track}
            className={k.track}
            role="slider"
            tabIndex={0}
            aria-label={words.atOnce}
            aria-valuemin={1}
            aria-valuemax={most}
            aria-valuenow={n}
            onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
              e.currentTarget.setPointerCapture?.(e.pointerId)
              setHeld(from(e.clientX))
            }}
            onPointerMove={(e: PointerEvent<HTMLDivElement>) => {
              if (held !== null) setHeld(from(e.clientX))
            }}
            onPointerUp={() => {
              if (held === null) return
              setHeld(null)
              send(held)
            }}
            onPointerCancel={() => setHeld(null)}
            onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
              const steps: Record<string, number> = {
                ArrowRight: n + 1,
                ArrowUp: n + 1,
                ArrowLeft: n - 1,
                ArrowDown: n - 1,
                Home: 1,
                End: most,
              }
              const next = steps[e.key]
              if (next === undefined) return
              e.preventDefault()
              send(clamp(next))
            }}
          >
            <div className={k.rail}>
              <div className={k.fill} style={{ width: at(n) }} />
            </div>
            {/* lowered for now: the track from it to the person's number closed, its end marked */}
            {lowered && (
              <>
                <span className={s.closed} style={{ left: at(places.atOnce), width: `calc(${at(n)} - ${at(places.atOnce)})` }} />
                <span className={s.forNow} style={{ left: at(places.atOnce) }} />
              </>
            )}
            {compact && (
              <span className={k.steps} aria-hidden="true">
                {Array.from({ length: most }, (_, i) => i + 1).map((step) => (
                  <i key={step} className={`${k.step} ${step <= n ? k.stepIn : ''}`} style={{ left: at(step) }} />
                ))}
              </span>
            )}
            {work !== null && (
              <span className={k.steps} aria-hidden="true">
                {Array.from({ length: busy }, (_, i) => i + 1).map((step) => (
                  <i key={step} className={s.agent} style={{ left: at(step) }} />
                ))}
              </span>
            )}
            <span className={k.atDefault} style={{ left: at(machine.count) }} />
            <span className={`${k.thumb} ${held !== null ? k.held : ''}`} style={{ left: at(n) }} />
          </div>
          {!compact && (
            <div className={k.scale} aria-hidden="true">
              <span>{machine.count === 1 ? '' : 1}</span>
              <span className={k.mark} style={{ left: at(machine.count) }}>
                {`${machine.count} · this Mac`}
              </span>
              <span>{machine.count === most ? '' : most}</span>
            </div>
          )}
        </div>
      }
    >
      {() => (
        <span className={k.value} style={heatStyle} aria-hidden="true">
          {n}
        </span>
      )}
    </SettingRow>
  )
}
