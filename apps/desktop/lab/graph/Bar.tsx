import { useEffect } from 'react'

import { Icon } from '@althar/ui'

import {
  clock,
  DIRECTIONS,
  direction,
  endNow,
  LINES,
  moves,
  NAMES,
  narrow,
  playing,
  SCENARIO_KEYS,
  SCENARIO_NAMES,
  said,
  scenarioKey,
  SPEEDS,
  speed,
  useStore,
} from './state'
import s from './lab.module.css'

/*
 * The lab's own bar, under the app: where the graph is drawn (1–4), which
 * request plays (n), the clock (space plays and pauses, the arrow keys step
 * a minute, 0 starts again, the slider scrubs), its speed, and the window's
 * width (w). A line over it says what an action would have done.
 */

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.closest('input:not([type="range"]), textarea, select, [role="textbox"], [role="dialog"], [role="menu"]') !== null)

const minutes = (m: number) => {
  const whole = Math.floor(m)
  return whole < 60 ? `${whole}m` : `${Math.floor(whole / 60)}h ${String(whole % 60).padStart(2, '0')}m`
}

export function Bar() {
  const picked = useStore(direction)
  const request = useStore(scenarioKey)
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
      const digit = /^Digit([1-9])$/.exec(event.code)?.[1]
      const next = digit === undefined ? undefined : DIRECTIONS[Number(digit) - 1]
      const take = () => {
        event.preventDefault()
        event.stopPropagation()
      }
      if (next !== undefined) {
        take()
        direction.set(next)
      } else if (event.key === 'n') {
        take()
        scenarioKey.set((was) => SCENARIO_KEYS[(SCENARIO_KEYS.indexOf(was) + 1) % SCENARIO_KEYS.length] ?? 'six')
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
        moves.set([])
        clock.set(0)
        playing.set(true)
      } else if (event.key === 'w') {
        take()
        narrow.set((was) => !was)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  const keep = (event: { preventDefault: () => void }) => event.preventDefault()
  return (
    <>
      {line !== null && <output className={s.said}>{line}</output>}
      <nav className={s.bar} aria-label="Directions" data-lab-bar="" onPointerDown={(event) => event.stopPropagation()}>
        <div className={s.group}>
          {DIRECTIONS.map((one, n) => (
            <button
              key={one}
              type="button"
              tabIndex={-1}
              aria-pressed={picked === one}
              onMouseDown={keep}
              onClick={() => direction.set(one)}
              title={LINES[one]}
            >
              <kbd>{n + 1}</kbd> {one.toUpperCase()} · {NAMES[one]}
            </button>
          ))}
        </div>
        <span className={s.rule} aria-hidden="true" />
        <div className={s.group} title="n plays the next one">
          {SCENARIO_KEYS.map((one) => (
            <button
              key={one}
              type="button"
              tabIndex={-1}
              aria-pressed={request === one}
              onMouseDown={keep}
              onClick={() => scenarioKey.set(one)}
            >
              {SCENARIO_NAMES[one]}
            </button>
          ))}
        </div>
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
          <button
            type="button"
            tabIndex={-1}
            title="0"
            onMouseDown={keep}
            onClick={() => {
              moves.set([])
              clock.set(0)
              playing.set(true)
            }}
          >
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
