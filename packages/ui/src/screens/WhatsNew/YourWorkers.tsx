import { type CSSProperties, type ReactNode, useId, useRef } from 'react'

import { Brand } from '../../foundations/brands/brands'
import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { type Timeline, useBeat } from '../../lib/useBeat'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import w from './YourWorkers.module.css'

/*
 * 0.10.0's lead, drawn in two acts: one worker, then many.
 *
 * First this computer hands a task to runner-1, a Linux worker of yours, a
 * current reaching along the wire; runner-1 runs its agent, the setup and
 * the tests, and its current turns back with the commits, and the task is
 * finished on this computer. Then runner-1 folds into a row and more workers
 * join it, a wire fanning out from this computer to each, every one running
 * a task of its own. It holds there, and clears. It plays only on screen,
 * and with motion reduced it rests on the many.
 */

const WHERE: Timeline = { beats: [0, 1600, 3000, 4400, 6000, 7600, 10400, 13200], loop: 14000, rest: 6 }

/** The beat the one worker becomes many. */
const MANY = 4

/** Where this computer's wires leave it, and where the workers' rows start, in the picture's own pixels. */
const FROM = { x: 262, y: 104 }
const TO = 540

const wire = (y: number) => `M${FROM.x} ${FROM.y} C 401 ${FROM.y}, 401 ${y}, ${TO} ${y}`
const back = (y: number) => `M${TO} ${y} C 401 ${y}, 401 ${FROM.y}, ${FROM.x} ${FROM.y}`

/** The workers, once there are many: a row each, the first runner-1, each at work on a task. */
const ROW = { height: 32, step: 40 }
const MANY_WORKERS = [
  { name: 'runner-1', task: 'Payout export', brand: Brand.ClaudeCode },
  { name: 'runner-2', task: 'Webhook retries', brand: Brand.Codex },
  { name: 'runner-3', task: 'Search index', brand: Brand.ClaudeCode },
  { name: 'runner-4', task: 'Invoice PDFs', brand: Brand.Codex },
  { name: 'runner-5', task: 'Flaky checkout test', brand: Brand.ClaudeCode },
  { name: 'runner-6', task: 'Dark mode', brand: Brand.Codex },
] as const
const middle = (i: number) => i * ROW.step + ROW.height / 2

/** What runner-1 runs for the first task: commands typed, what comes back not, and the beat each comes on. */
const RUN = [
  { at: 1, line: 'Partial refunds · Claude Code', typed: false },
  { at: 1, line: 'bun install', typed: true },
  { at: 1, line: 'Setup done in 4.2 s', typed: false },
  { at: 2, line: 'bun test src/refunds', typed: true },
  { at: 2, line: '✓ 23 passed', typed: false },
  { at: 3, line: '2 commits back to This Mac', typed: false },
] as const

/** States in one place, the shown one faded in: the widest holds the room, so nothing beside them moves. */
function Swap({ on, children }: { on: number; children: readonly ReactNode[] }) {
  return (
    <span className={w.swap}>
      {children.map((child, i) => (
        <span key={i} data-on={i === on} aria-hidden={i !== on}>
          {child}
        </span>
      ))}
    </span>
  )
}

/**
 * A wire at work: its current reaches along it from where the work leaves to
 * where it lands, then keeps flowing that way; off, it fades, and is gone.
 */
function Current({ along, on, style }: { along: string; on: boolean; style?: CSSProperties }) {
  const id = `reach-${useId().replace(/[^\w-]/g, '')}`
  return (
    <g className={w.current} data-on={on} style={style}>
      <mask id={id} maskUnits="userSpaceOnUse" x={0} y={-20} width={912} height={276}>
        <path d={along} pathLength={1} className={w.reach} />
      </mask>
      <path d={along} className={w.flow} mask={`url(#${id})`} />
    </g>
  )
}

/** A worker's own place in the fan-out: the later it joins, the later its row and wire come. */
const joins = (i: number) => ({ '--i': i }) as CSSProperties

/** What runner-1 says, by the beat: free, running, sent back, then its next task. */
function OneState({ beat }: { beat: number }) {
  const first = MANY_WORKERS[0]
  return (
    <Swap on={beat >= MANY ? 3 : beat === 3 ? 2 : beat >= 0 && beat < MANY ? 1 : 0}>
      {[
        'Free',
        <>
          <LiveDot ping />
          Running
        </>,
        <>
          <Icon name="check" size={11} />
          Sent back
        </>,
        <>
          <BrandMark brand={first.brand} size={11} />
          {first.task}
          <LiveDot ping />
        </>,
      ]}
    </Swap>
  )
}

export interface YourWorkersText {
  /** What the picture shows, for whoever can't see it. */
  label: string
  computer: { name: string; what: string }
  workers: { name: string; what: string }
}

export const yourWorkersText: YourWorkersText = {
  label:
    'This Mac hands a task to runner-1, a Linux worker of yours, which runs the task’s agent, its setup and its tests, and sends its commits back. Then five more workers join it, each wired to This Mac and running a task of its own.',
  computer: { name: 'This computer', what: 'Where you talk to your tasks. It stays free while they run.' },
  workers: {
    name: 'Your workers',
    what: 'Start with one Linux machine of yours, and add more as your work grows. Each runs a task’s agent, setup, tests and dev servers.',
  },
}

export type YourWorkersProps = RootProps<'figure', { text?: Partial<YourWorkersText> }>

/** 0.10.0's flagship drawn: this computer and one worker of yours, then many, the work going between them. */
export function YourWorkers({ text, className, ...rest }: YourWorkersProps) {
  const t = { ...yourWorkersText, ...text }
  const ref = useRef<HTMLElement>(null)
  const beat = useBeat(ref, WHERE)
  const out = beat === WHERE.beats.length - 1
  const at = (from: number, to = 6) => !out && beat >= from && beat <= to
  const many = at(MANY)
  const finished = at(3, 3)
  return (
    <figure ref={ref} className={cx(w.figure, className)} aria-label={t.label} {...rest}>
      <div className={w.scene} aria-hidden="true">
        <svg className={w.wires} viewBox="0 0 912 236" width={912} height={236}>
          {/* One worker: one wire, the work out along it and its commits back. */}
          <g className={w.act} data-gone={many}>
            <path d={wire(FROM.y)} className={w.wire} />
            <Current along={wire(FROM.y)} on={at(0, 2)} />
            <Current along={back(FROM.y)} on={at(3, 3)} />
          </g>
          {/* Many: a wire to each, at work. */}
          {MANY_WORKERS.map((one, i) => (
            <g key={one.name} className={w.fan} data-shown={many} style={joins(i)}>
              <path d={wire(middle(i))} className={w.wire} />
              <Current along={wire(middle(i))} on={many} style={joins(i)} />
            </g>
          ))}
        </svg>
        <span className={w.via} data-gone={many}>
          Runs on
        </span>

        <div className={w.laptop}>
          <div className={w.lid}>
            <div className={w.screen}>
              <div className={w.appBar}>
                <i />
                <i />
                <i />
                <code>This Mac</code>
              </div>
              <div className={w.appTask}>
                <b>Partial refunds</b>
                <code>althar/partial-refunds</code>
              </div>
              <p className={w.appSaid}>Let a refund be for part of a payment.</p>
              <div className={w.appState} data-finished={finished}>
                <Swap on={many ? 3 : finished ? 2 : at(1) ? 1 : 0}>
                  {[
                    'Starting on runner-1',
                    <>
                      <LiveDot ping />
                      On runner-1
                    </>,
                    <>
                      <Icon name="check" size={12} />
                      Finished <ins>+31</ins> <del>−3</del>
                    </>,
                    <>
                      <LiveDot ping />
                      {MANY_WORKERS.length} tasks on your workers
                    </>,
                  ]}
                </Swap>
              </div>
            </div>
          </div>
          <div className={w.base} />
        </div>

        {/* runner-1: a worker shown whole, then a row among many. */}
        <div className={cx(w.worker, w.one)} data-busy={at(0, 3) || many} data-many={many}>
          <div className={w.head}>
            <Icon name="terminal" size={13} />
            <code className={w.name}>runner-1</code>
            <OneState beat={out ? -1 : beat} />
          </div>
          <ol className={w.log}>
            {RUN.map((one) => (
              <li key={one.line} data-shown={at(one.at, MANY - 1)} data-typed={one.typed}>
                {one.line}
              </li>
            ))}
          </ol>
        </div>

        {MANY_WORKERS.slice(1).map((one, n) => {
          const i = n + 1
          return (
            <div
              key={one.name}
              className={cx(w.worker, w.row)}
              data-busy={many}
              data-shown={many}
              style={{ ...joins(i), top: i * ROW.step }}
            >
              <div className={w.head}>
                <Icon name="terminal" size={13} />
                <code className={w.name}>{one.name}</code>
                <span className={w.task}>
                  <BrandMark brand={one.brand} size={11} />
                  {one.task}
                  <LiveDot ping />
                </span>
              </div>
            </div>
          )
        })}
      </div>

      <figcaption className={w.captions}>
        {[t.computer, t.workers].map((one) => (
          <span key={one.name}>
            <b>{one.name}</b> {one.what}
          </span>
        ))}
      </figcaption>
    </figure>
  )
}
