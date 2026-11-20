import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from 'react'
import { Icon, LinkButton, SettingRow } from '@althar/ui'

import k from '../../../../packages/ui/src/setup/Preferences/Preferences.module.css'
import type { Places } from './data'
import { cellsOf } from './parts'
import { words } from './words'
import s from './slider.module.css'

/*
 * Agents at once, as the kit draws it (`AgentsAtOnce`, with its own styles),
 * with what is in use now drawn on it. `cells`: a cell under each number up
 * to the person's, cobalt where an agent holds the place and an outline
 * where it is closed for now, so the number and what fills it read as one.
 * `limit`: only the number lowered for now, marked on the track. The rest is
 * the kit's: the default's mark, the thumb clicking into it, the warmth past it.
 */

export interface LiveAtOnceProps {
  places: Places
  /** The number as the person has it. */
  count: number
  most: number
  onChange: (count: number | null) => void
  compact?: boolean
  show: 'cells' | 'limit'
  title?: string
  /** In place of the kit's line. */
  note?: ReactNode
}

export function LiveAtOnce({ places, count, most, onChange, compact = false, show, title = words.title, note }: LiveAtOnceProps) {
  const { machine } = places
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
  // While held, the cells follow the thumb: as many as the number, the work in them where it is.
  const shown = { ...places, configured: n, atOnce: places.why === null ? n : Math.min(places.atOnce, n) }
  const lowered = places.why !== null && places.atOnce < n
  const line =
    note ??
    (compact
      ? 'The rest wait their turn'
      : n === machine.count
        ? `Default for ${machine.memory} GB and ${machine.cores} cores`
        : n < machine.count
          ? 'Below the default'
          : n <= machine.count + 2
            ? 'Tests may slow down'
            : 'May run hot')
  return (
    <SettingRow
      title={title}
      {...(compact ? { className: k.compact } : {})}
      note={
        <>
          {line}
          {own && held === null && (
            <>
              {' '}
              <LinkButton className={k.reset} onClick={() => onChange(null)}>
                Use the default
              </LinkButton>
            </>
          )}
        </>
      }
      glyph={
        <span className={k.breathe} style={{ ...heatStyle, '--speed': `${2.8 - heat * 2.1}s` } as CSSProperties}>
          <Icon name="agents" size={15} />
        </span>
      }
      under={
        <div className={k.slider} style={heatStyle}>
          <div
            ref={track}
            className={k.track}
            role="slider"
            tabIndex={0}
            aria-label={title}
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
            {/* the number lowered for now: the track from it to the person's number closed, its end marked */}
            {show === 'limit' && lowered && (
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
            <span className={k.atDefault} style={{ left: at(machine.count) }} />
            <span className={`${k.thumb} ${held !== null ? k.held : ''}`} style={{ left: at(n) }} />
          </div>
          {show === 'cells' && (
            <div className={s.cells} aria-hidden="true">
              {cellsOf(shown).map((cell, i) => (
                <i key={i} data-cell={cell} style={{ left: at(i + 1) }} />
              ))}
            </div>
          )}
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
