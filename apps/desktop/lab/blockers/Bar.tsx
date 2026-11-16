import { useEffect } from 'react'

import { Icon } from '@althar/ui'

import {
  clock,
  endNow,
  moves,
  narrow,
  onTaskPage,
  option,
  OPTIONS,
  type Part,
  PART_NAMES,
  pick,
  place,
  playing,
  said,
  SPEEDS,
  speed,
  useStore,
} from './state'
import { restart } from './talk'
import s from './lab.module.css'

/*
 * The lab's own bar, under the app: how a waiting task's page shows it (A–D)
 * and how the coordinator's plan card does (1–5), the number keys switching
 * the one on screen (Shift for the other); the clock (space plays and pauses, Shift and the arrows step a
 * minute, 0 starts the day again, the slider scrubs) and its speed, and the
 * window's width (w). A line over it says what an action would have done.
 */

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    // A form keeps its own keys: a question's 1–9 pick its options.
    target.closest('input:not([type="range"]), textarea, select, form, [role="textbox"], [role="dialog"], [role="menu"]') !== null)

const minutes = (m: number) => {
  const whole = Math.floor(m)
  return whole < 60 ? `${whole}m` : `${Math.floor(whole / 60)}h ${String(whole % 60).padStart(2, '0')}m`
}

const keep = (event: { preventDefault: () => void }) => event.preventDefault()

/** The part the number keys switch: the task's on a task's page, the plan card's elsewhere; Shift, the other. */
const keyed = (shift: boolean): Part => (((onTaskPage() ? 'task' : 'card') === 'task') !== shift ? 'task' : 'card')

function PartGroup({ part, active }: { part: Part; active: boolean }) {
  const picked = useStore(option[part])
  const chosen = OPTIONS[part].find((one) => one.key === picked)
  return (
    <div className={[s.part, active && s.active].filter(Boolean).join(' ')} title={chosen?.line}>
      <span className={s.partName}>{PART_NAMES[part]}</span>
      {OPTIONS[part].map((one, i) => (
        <button
          key={one.key}
          type="button"
          tabIndex={-1}
          className={s.letter}
          aria-pressed={picked === one.key}
          aria-label={`${PART_NAMES[part]} ${one.label}: ${one.name}`}
          title={`${i + 1} · ${one.name}: ${one.line}`}
          onMouseDown={keep}
          onClick={() => pick(part, one.key)}
        >
          {one.label}
        </button>
      ))}
      <span className={s.optionName}>{chosen?.name}</span>
    </div>
  )
}

export function Bar() {
  useStore(place)
  const isNarrow = useStore(narrow)
  const isPlaying = useStore(playing)
  const pace = useStore(speed)
  const now = useStore(clock)
  useStore(moves)
  const line = useStore(said)
  const end = endNow() + 4
  useEffect(() => {
    document.documentElement.dataset.narrow = isNarrow ? '1' : '0'
  }, [isNarrow])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return
      const digit = /^Digit([1-5])$/.exec(event.code)?.[1]
      const take = () => {
        event.preventDefault()
        event.stopPropagation()
      }
      if (digit !== undefined) {
        const part = keyed(event.shiftKey)
        const one = OPTIONS[part][Number(digit) - 1]
        if (one === undefined) return
        take()
        pick(part, one.key)
      } else if (event.key === ' ' && !(event.target instanceof HTMLButtonElement)) {
        take()
        playing.set((was) => !was)
      } else if (event.key === 'ArrowRight' && event.shiftKey) {
        take()
        clock.set((was) => Math.min(endNow() + 4, was + 1))
      } else if (event.key === 'ArrowLeft' && event.shiftKey) {
        take()
        clock.set((was) => Math.max(0, was - 1))
      } else if (event.key === '0') {
        take()
        restart()
      } else if (event.key === 'w') {
        take()
        narrow.set((was) => !was)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  const onTask = onTaskPage()
  return (
    <>
      {line !== null && <output className={s.said}>{line}</output>}
      <nav className={s.bar} aria-label="Directions" data-lab-bar="" onPointerDown={(event) => event.stopPropagation()}>
        <PartGroup part="task" active={onTask} />
        <PartGroup part="card" active={!onTask} />
        <span className={s.rule} aria-hidden="true" />
        <div className={s.clock}>
          <button
            type="button"
            tabIndex={-1}
            className={s.play}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            title="Space"
            onMouseDown={keep}
            onClick={() => playing.set((was) => !was)}
          >
            <Icon name={isPlaying ? 'pause' : 'play'} size={12} />
          </button>
          <input
            type="range"
            tabIndex={-1}
            min={0}
            max={end}
            step={0.25}
            value={Math.min(now, end)}
            aria-label="Time"
            onChange={(event) => clock.set(Number(event.target.value))}
            style={{ '--at': `${(Math.min(now, end) / end) * 100}%` } as React.CSSProperties}
          />
          <span className={s.time}>{minutes(now)}</span>
          <button
            type="button"
            tabIndex={-1}
            title="Speed"
            onMouseDown={keep}
            onClick={() => speed.set((was) => SPEEDS[(SPEEDS.indexOf(was as 1 | 2 | 4) + 1) % SPEEDS.length] ?? 2)}
          >
            {pace}×
          </button>
          <button type="button" tabIndex={-1} title="0: the day again, without what you did" onMouseDown={keep} onClick={restart}>
            Again
          </button>
        </div>
        <span className={s.grow} />
        <button type="button" tabIndex={-1} aria-pressed={isNarrow} onMouseDown={keep} onClick={() => narrow.set((was) => !was)}>
          <kbd>w</kbd> {isNarrow ? 'Narrow' : 'Wide'}
        </button>
      </nav>
    </>
  )
}
