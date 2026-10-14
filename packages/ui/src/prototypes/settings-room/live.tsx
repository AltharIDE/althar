// Scrappy: the live page. The real app, with a slim bar at the bottom that swaps the direction in place, keeping the screen and what is open.
// Its address says both: ?d=B&s=agents. 1 to 6, and ← →, switch too.
import { useEffect } from 'react'

import { Segmented } from '../../index'
import { boot } from './app'
import { ROUND3_CARDS } from './round3'
import { SECTIONS, type SectionId } from './sections'
import { type Direction, proto, useDirection } from './state'
import { settingsTab } from './tab'

/** A to E on 1 to 5, as they read; Today last, on 6, to compare against. */
const LIVE: ReadonlyArray<{ readonly d: string; readonly direction: Direction; readonly label: string; readonly what: string }> = [
  ...(['A3', 'B3', 'C3', 'D3', 'E3'] as const).map((direction) => ({
    d: direction.replace('3', ''),
    direction,
    label: `${direction.replace('3', '')} · ${ROUND3_CARDS[direction].name}`,
    what: ROUND3_CARDS[direction].what,
  })),
  { d: 'today', direction: 'today', label: 'Today', what: 'The Control Center as it is, on the home only; This Mac behind Keep awake.' },
]

/** Whether a key is for what has focus rather than for the switcher: typing, or arrows on a slider, a radio, a tab or a menu. */
const forSomethingElse = (event: KeyboardEvent) => {
  if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return true
  const target = event.target
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return true
  return target.closest('[role="slider"], [role="radio"], [role="tab"], [role="menu"], [role="listbox"], [role="combobox"]') !== null
}

function Switcher() {
  const direction = useDirection()
  const at = Math.max(
    0,
    LIVE.findIndex((one) => one.direction === direction),
  )
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (forSomethingElse(event)) return
      const n = Number(event.key)
      const next =
        Number.isInteger(n) && n >= 1 && n <= LIVE.length
          ? LIVE[n - 1]
          : event.key === 'ArrowRight'
            ? LIVE[(at + 1) % LIVE.length]
            : event.key === 'ArrowLeft'
              ? LIVE[(at - 1 + LIVE.length) % LIVE.length]
              : undefined
      if (next === undefined) return
      event.preventDefault()
      proto.set(next.direction)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [at])
  return (
    <div
      className="ch-root"
      // A press here isn't a press outside the open panel: it stays open, and keeps its focus, as the direction changes under it.
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onMouseDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 12,
        transform: 'translateX(-50%)',
        zIndex: 6,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        maxWidth: 'calc(100vw - 24px)',
        padding: '5px 14px 5px 6px',
        borderRadius: 12,
        background: 'var(--frost)',
        boxShadow: 'var(--lift-frost)',
        backdropFilter: 'var(--frost-blur)',
      }}
    >
      <Segmented
        label="Direction"
        value={direction}
        onChange={(next) => proto.set(next)}
        options={LIVE.map((one, i) => ({ value: one.direction, label: one.label, tooltip: { label: one.what, kbd: String(i + 1) } }))}
      />
      <span
        style={{ fontSize: 11.5, color: 'var(--t-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 380 }}
      >
        {LIVE[at]?.what}
      </span>
    </div>
  )
}

/* ——— Where the address says to start ——— */

const params = new URL(window.location.href).searchParams
const chosen = LIVE.find((one) => one.d.toLowerCase() === (params.get('d') ?? 'A').toLowerCase()) ?? LIVE[0]
const s = params.get('s') ?? 'home'
const section = SECTIONS.find((one) => one.id === s)?.id
if (section !== undefined) settingsTab.show(section as SectionId)
const board = s.startsWith('board')

boot(chosen?.direction ?? 'A3', '', { below: <Switcher />, hash: board ? '#/projects/p1?room=board' : '#/' })

// The quick panel opens as ⌘, opens it, once the screen is there.
if (s === 'quick' || s.endsWith('-quick'))
  window.setTimeout(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', code: 'Comma', metaKey: true })), 1500)
