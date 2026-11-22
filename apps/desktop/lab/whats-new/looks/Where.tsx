import { type ReactNode, useRef } from 'react'

import { Brand, BrandMark, Icon, LiveDot } from '@althar/ui'

import { type Timeline, useBeat } from './site/LogPictures'
import w from './where.module.css'

/*
 * Where the work runs now, as one picture rather than three cards: this
 * computer, a home on your own server, and two workers of yours, drawn as
 * the machines they are, the work going between them along the wires.
 *
 * The beats: a task leaves the window for the home, and the home hands its
 * lead to runner-1; the laptop closes, and the work goes on: the home hands
 * another task to runner-2, runner-1 runs the setup and the tests and sends
 * its commits back; the laptop opens again on the finished task. It holds,
 * and clears. It plays only on screen, and with motion reduced it rests on
 * the laptop open on the finished task.
 */

const WHERE: Timeline = { beats: [0, 1700, 3400, 5000, 6600, 8200, 10000, 12800], loop: 13600, rest: 6 }

/** The wires, in the picture's own pixels: the window to the home, the home to each worker, and back. */
const WIRE = {
  toHome: 'M222 104 C 281 104, 281 112, 340 112',
  fromHome: 'M340 112 C 281 112, 281 104, 222 104',
  toOne: 'M572 112 C 626 112, 626 72, 680 72',
  fromOne: 'M680 72 C 626 72, 626 112, 572 112',
  toTwo: 'M572 112 C 626 112, 626 194, 680 194',
} as const

/** What runner-1 runs for the task: commands typed, what comes back not, and the beat each comes on. */
const RUN = [
  { at: 1, line: 'Lead for Partial refunds · Claude Code', typed: false },
  { at: 2, line: 'bun install', typed: true },
  { at: 2, line: 'Setup done in 4.2 s', typed: false },
  { at: 3, line: 'bun test src/refunds', typed: true },
  { at: 3, line: '✓ 23 passed', typed: false },
  { at: 4, line: '2 commits back to build-01', typed: false },
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

/** The work, going along a wire: a spark with its trail, once. */
const Spark = ({ along }: { along: string }) => <i className={w.spark} style={{ offsetPath: `path('${along}')` }} />

export function Where() {
  const ref = useRef<HTMLDivElement>(null)
  const beat = useBeat(ref, WHERE)
  const out = beat === WHERE.beats.length - 1
  const at = (from: number, to = 6) => !out && beat >= from && beat <= to
  const closed = beat >= 2 && beat <= 4
  const finished = at(4)
  const back = at(5)
  return (
    <figure
      ref={ref}
      className={w.figure}
      aria-label="This computer hands a task to your home, build-01, which runs its lead on runner-1. The laptop closes and the work goes on: runner-2 takes another task, runner-1 runs the setup and the tests and sends its commits back. The laptop opens on the finished task."
    >
      <div className={w.scene} aria-hidden="true">
        <svg className={w.wires} viewBox="0 0 912 236" width={912} height={236}>
          {[WIRE.toHome, WIRE.toOne, WIRE.toTwo].map((d) => (
            <path key={d} d={d} className={w.wire} />
          ))}
          <path d={WIRE.toHome} className={w.flow} data-on={!closed && !out} />
          <path d={WIRE.toOne} className={w.flow} data-on={at(1, 4)} />
          <path d={WIRE.toTwo} className={w.flow} data-on={at(2)} />
        </svg>
        <span className={w.via}>
          <Swap on={closed ? 1 : 0}>{['SSH', 'Window closed']}</Swap>
        </span>

        {beat === 0 && <Spark key="0" along={WIRE.toHome} />}
        {beat === 1 && <Spark key="1" along={WIRE.toOne} />}
        {beat === 2 && <Spark key="2" along={WIRE.toTwo} />}
        {beat === 4 && <Spark key="4" along={WIRE.fromOne} />}
        {beat === 5 && <Spark key="5" along={WIRE.fromHome} />}

        <div className={w.laptop} data-closed={closed}>
          <div className={w.lid}>
            <div className={w.screen}>
              <div className={w.appBar}>
                <i />
                <i />
                <i />
                <code>build-01</code>
              </div>
              <div className={w.appTask}>
                <b>Partial refunds</b>
                <code>althar/partial-refunds</code>
              </div>
              <p className={w.appSaid}>Let a refund be for part of a payment.</p>
              <div className={w.appState}>
                <Swap on={back ? 1 : 0}>
                  {[
                    <>
                      <LiveDot ping />
                      On runner-1
                    </>,
                    <>
                      <Icon name="check" size={12} />
                      Finished <ins>+31</ins> <del>−3</del>
                    </>,
                  ]}
                </Swap>
              </div>
            </div>
          </div>
          <div className={w.base} />
        </div>

        <div className={w.server} data-busy={at(0, 5)}>
          <div className={w.head}>
            <span className={w.leds}>
              <i />
              <i />
              <i />
            </span>
            <code className={w.name}>build-01</code>
            <span className={w.kind}>Your server</span>
          </div>
          <ul className={w.tasks}>
            <li data-shown={at(0)}>
              <BrandMark brand={Brand.ClaudeCode} size={12} />
              <span className={w.task}>Partial refunds</span>
              <Swap on={finished ? 2 : at(1) ? 1 : 0}>
                {[
                  'Starting',
                  <>
                    <LiveDot ping />
                    On runner-1
                  </>,
                  <>
                    <Icon name="check" size={11} />
                    Finished
                  </>,
                ]}
              </Swap>
            </li>
            <li data-shown>
              <BrandMark brand={Brand.Codex} size={12} />
              <span className={w.task}>Webhook retries</span>
              <Swap on={at(2) ? 1 : 0}>
                {[
                  'Queued',
                  <>
                    <LiveDot ping />
                    On runner-2
                  </>,
                ]}
              </Swap>
            </li>
          </ul>
        </div>

        <div className={`${w.worker} ${w.one}`} data-busy={at(1, 4)}>
          <div className={w.head}>
            <Icon name="terminal" size={13} />
            <code className={w.name}>runner-1</code>
            <Swap on={finished ? 2 : at(1, 3) ? 1 : 0}>
              {[
                'Free',
                <>
                  <LiveDot ping />
                  Running a lead
                </>,
                <>
                  <Icon name="check" size={11} />
                  Sent back
                </>,
              ]}
            </Swap>
          </div>
          <ol className={w.log}>
            {RUN.map((one) => (
              <li key={one.line} data-shown={at(one.at)} data-typed={one.typed}>
                {one.line}
              </li>
            ))}
          </ol>
        </div>

        <div className={`${w.worker} ${w.two}`} data-busy={at(2)}>
          <div className={w.head}>
            <Icon name="terminal" size={13} />
            <code className={w.name}>runner-2</code>
            <Swap on={at(2) ? 1 : 0}>
              {[
                'Free',
                <>
                  <LiveDot ping />
                  Running a lead
                </>,
              ]}
            </Swap>
          </div>
        </div>
      </div>

      <figcaption className={w.captions}>
        <span>
          <b>This computer</b> Where you talk to tasks. Close it; the work goes on.
        </span>
        <span>
          <b>Your home</b> Projects, their tasks, and each agent’s asks and tools.
        </span>
        <span>
          <b>Your workers</b> A task’s lead, its setup and its Run.
        </span>
      </figcaption>
    </figure>
  )
}
