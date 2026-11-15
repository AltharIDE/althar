import { useEffect, useSyncExternalStore } from 'react'

import { Icon } from '@althar/ui'

import { BOARD_OPTIONS } from './board/options'
import { CHAT_OPTIONS } from './chat/options'
import { NOUNS, noun, replan, SCENARIO_KEYS, SCENARIO_NAMES } from './plan'
import {
  activePart,
  clock,
  endNow,
  moves,
  narrow,
  type Option,
  option,
  type Part,
  PART_NAMES,
  playing,
  said,
  scenarioKey,
  SPEEDS,
  speed,
  stage,
  useStore,
} from './state'
import { TASK_OPTIONS } from './task/options'
import s from './lab.module.css'

/*
 * The lab's own bar, under the app. Three parts, each with its options:
 * Chat (where the plan is talked over), Board (how the board keeps the
 * running request in sight) and Task (how a task of it shows the whole).
 * 1–4 switch the options of the part picked (p picks the next; on a task's
 * page, Task). Then whether the plan is still being planned or launched (l),
 * which request (n), the clock (space plays and pauses, Shift and the arrows
 * step a minute, 0 starts again, the slider scrubs), its speed, what the
 * request-as-a-graph is called, and the window's width (w). A line over it
 * says what an action would have done.
 */

export const OPTIONS: Readonly<Record<Part, ReadonlyArray<Option>>> = { chat: CHAT_OPTIONS, board: BOARD_OPTIONS, task: TASK_OPTIONS }

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.closest('input:not([type="range"]), textarea, select, [role="textbox"], [role="dialog"], [role="menu"]') !== null)

const minutes = (m: number) => {
  const whole = Math.floor(m)
  return whole < 60 ? `${whole}m` : `${Math.floor(whole / 60)}h ${String(whole % 60).padStart(2, '0')}m`
}

/** Whether the window shows a task's page, where the number keys switch Task. */
const onTaskPage = () => window.location.hash.startsWith('#/threads/th_')
const subscribeHash = (listener: () => void) => {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}
const useOnTaskPage = () => useSyncExternalStore(subscribeHash, onTaskPage)

/** The part the number keys switch now. */
const keyed = (): Part => (onTaskPage() ? 'task' : activePart.get() === 'task' ? 'chat' : activePart.get())

function PartGroup({ part, active }: { part: Part; active: boolean }) {
  const picked = useStore(option[part])
  const options = OPTIONS[part]
  const chosen = options.find((one) => one.key === picked) ?? options[0]
  const keep = (event: { preventDefault: () => void }) => event.preventDefault()
  return (
    <div className={[s.part, active && s.active].filter(Boolean).join(' ')} title={chosen?.line}>
      <button type="button" tabIndex={-1} className={s.partName} onMouseDown={keep} onClick={() => activePart.set(part)}>
        {PART_NAMES[part]}
      </button>
      {options.map((one) => (
        <button
          key={one.key}
          type="button"
          tabIndex={-1}
          className={s.letter}
          aria-pressed={picked === one.key}
          aria-label={`${PART_NAMES[part]} ${one.key.toUpperCase()}: ${one.name}`}
          title={`${one.key.toUpperCase()} · ${one.name}: ${one.line}`}
          onMouseDown={keep}
          onClick={() => {
            option[part].set(one.key)
            if (part !== 'task') activePart.set(part)
          }}
        >
          {one.key.toUpperCase()}
        </button>
      ))}
      {active && <span className={s.optionName}>{chosen?.name}</span>}
    </div>
  )
}

export function Bar() {
  const request = useStore(scenarioKey)
  const isNarrow = useStore(narrow)
  const isPlaying = useStore(playing)
  const pace = useStore(speed)
  const now = useStore(clock)
  const at = useStore(stage)
  const called = useStore(noun)
  const active = useStore(activePart)
  const onTask = useOnTaskPage()
  useStore(moves)
  const line = useStore(said)
  const end = endNow() + 4
  const shownPart: Part = onTask ? 'task' : active === 'task' ? 'chat' : active
  useEffect(() => {
    document.documentElement.dataset.narrow = isNarrow ? '1' : '0'
  }, [isNarrow])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return
      const digit = /^Digit([1-4])$/.exec(event.code)?.[1]
      const take = () => {
        event.preventDefault()
        event.stopPropagation()
      }
      if (digit !== undefined && !event.shiftKey) {
        const part = keyed()
        const one = OPTIONS[part][Number(digit) - 1]
        if (one === undefined) return
        take()
        option[part].set(one.key)
      } else if (event.key === 'p') {
        take()
        activePart.set((was) => (was === 'board' ? 'chat' : 'board'))
      } else if (event.key === 'l') {
        take()
        stage.set((was) => (was === 'plan' ? 'run' : 'plan'))
      } else if (event.key === 'n') {
        take()
        scenarioKey.set((was) => SCENARIO_KEYS[(SCENARIO_KEYS.indexOf(was) + 1) % SCENARIO_KEYS.length] ?? 'cloud')
      } else if (event.key === ' ' && !(event.target instanceof HTMLButtonElement) && stage.get() === 'run') {
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
        if (stage.get() === 'plan') replan()
        moves.set([])
        clock.set(0)
        playing.set(stage.get() === 'run')
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
      <nav className={s.bar} aria-label="Options" data-lab-bar="" onPointerDown={(event) => event.stopPropagation()}>
        <PartGroup part="chat" active={shownPart === 'chat'} />
        <PartGroup part="board" active={shownPart === 'board'} />
        <PartGroup part="task" active={shownPart === 'task'} />
        <span className={s.rule} aria-hidden="true" />
        <div className={s.group} title="l">
          {(['plan', 'run'] as const).map((one) => (
            <button key={one} type="button" tabIndex={-1} aria-pressed={at === one} onMouseDown={keep} onClick={() => stage.set(one)}>
              {one === 'plan' ? 'Planning' : 'Launched'}
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
        <div className={[s.clock, at === 'plan' && s.still].filter(Boolean).join(' ')}>
          <button
            type="button"
            tabIndex={-1}
            className={s.play}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            title="Space"
            disabled={at === 'plan'}
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
            disabled={at === 'plan'}
            onChange={(event) => clock.set(Number(event.target.value))}
            style={{ '--at': `${(Math.min(now, end) / end) * 100}%` } as React.CSSProperties}
          />
          <span className={s.time}>{minutes(now)}</span>
          <button
            type="button"
            tabIndex={-1}
            title="Speed"
            onMouseDown={keep}
            onClick={() => speed.set((was) => SPEEDS[(SPEEDS.indexOf(was as 1 | 2 | 4) + 1) % SPEEDS.length] ?? 4)}
          >
            {pace}×
          </button>
          <button
            type="button"
            tabIndex={-1}
            title="0"
            onMouseDown={keep}
            onClick={() => {
              if (stage.get() === 'plan') replan()
              moves.set([])
              clock.set(0)
              playing.set(stage.get() === 'run')
            }}
          >
            Again
          </button>
        </div>
        <span className={s.grow} />
        <button
          type="button"
          tabIndex={-1}
          title="What a request run as a graph of tasks is called"
          onMouseDown={keep}
          onClick={() => noun.set((was) => NOUNS[(NOUNS.indexOf(was) + 1) % NOUNS.length] ?? 'Mission')}
        >
          “{called}”
        </button>
        <button type="button" tabIndex={-1} aria-pressed={isNarrow} onMouseDown={keep} onClick={() => narrow.set((was) => !was)}>
          <kbd>w</kbd> {isNarrow ? 'Narrow' : 'Wide'}
        </button>
      </nav>
    </>
  )
}
