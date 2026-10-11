import { useEffect, useState, type ReactNode } from 'react'

import { Agent } from '../content/agents'
import { AgentMark } from '../shared/AgentMark'
import { Glow } from '../shared/Glow'
import { cx } from '../lib/cx'
import { type Beat, DAY, DAY_END, doneAt, LINE, PR, stateAt, type Step, THREAD, WORDS } from './fixtures'
import s from './Feel.module.css'

/*
 * Scrappy prototype: directions for "Never has building software felt so
 * good." Dev-only routes under /feel. Throwaway.
 */

/** Seconds since mount, looping every `period`; `?t=` holds it at one frame. */
function useClock(period: number) {
  const held = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('t')
  const [t, setT] = useState(held ? Number(held) : 0)
  useEffect(() => {
    if (held) return
    const start = performance.now()
    let raf = 0
    const tick = () => {
      setT(((performance.now() - start) / 1000) % period)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [period, held])
  return t
}

const AGENT_NAME: Partial<Record<Agent, string>> = { [Agent.Claude]: 'Claude Code', [Agent.Codex]: 'Codex' }

function You({ children }: { children: ReactNode }) {
  return <div className={s.you}>{children}</div>
}

function Althar({ children }: { children: ReactNode }) {
  return (
    <div className={s.althar}>
      <span className={s.altharDot} />
      {children}
    </div>
  )
}

function Card({
  title,
  agent,
  step,
  note,
  progress,
}: {
  title: string
  agent: Agent
  step: Step | 'Said'
  note?: string
  progress?: number
}) {
  return (
    <div className={s.card} data-step={step}>
      <div className={s.cardTop}>
        <AgentMark agent={agent} size={14} />
        <span className={s.cardAgent}>{AGENT_NAME[agent]}</span>
        <span className={s.pill} data-step={step}>
          {step === 'Said' ? 'Starting' : step}
        </span>
      </div>
      <div className={s.cardTitle}>{title}</div>
      {progress !== undefined && (
        <div className={s.track}>
          <div className={s.trackFill} style={{ transform: `scaleX(${progress})` }} />
        </div>
      )}
      {note && <div className={s.cardNote}>{note}</div>}
    </div>
  )
}

function BeatView({ beat }: { beat: Beat }) {
  if (beat.kind === 'you') return <You>{beat.text}</You>
  if (beat.kind === 'althar') return <Althar>{beat.text}</Althar>
  return <Card title={beat.title} agent={beat.agent} step={beat.step} note={beat.note} />
}

function Back() {
  return (
    <a className={s.back} href="/feel">
      ← directions
    </a>
  )
}

/* 1. One quiet line ------------------------------------------------------ */

function QuietHero() {
  return (
    <section className={s.quiet}>
      <h1 className={s.line}>
        Never has building software
        <br />
        felt <em>so good.</em>
      </h1>
      <p className={s.sub}>Say what you want. Watch it land. Decide.</p>
      <div className={s.drift} aria-hidden="true">
        <div className={s.driftInner}>
          {[0, 1].map((copy) => (
            <div key={copy} className={s.thread}>
              {THREAD.map((beat, i) => (
                <BeatView key={i} beat={beat} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function Quiet() {
  return (
    <main className={s.page}>
      <Back />
      <QuietHero />
    </main>
  )
}

/* 2. Your day, replayed -------------------------------------------------- */

function DayBoard() {
  const t = useClock(DAY_END + 6)
  const said = DAY.filter((task) => t >= task.at)
  const ready = DAY.filter((task) => t >= doneAt(task))
  const changes = ready.reduce((sum, task) => sum + task.changes, 0)
  const ended = t >= DAY_END
  const clock = new Date(2026, 9, 11, 13, 0 + Math.floor(t * 7.5))
  return (
    <section className={s.day}>
      <div className={s.dayHead}>
        <span className={s.mono}>Your afternoon · {clock.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
        <span className={s.mono}>
          {ready.length} ready · {said.length - ready.length} running · {changes} changes
        </span>
      </div>
      <div className={s.dayGrid}>
        <div className={s.dayYou}>
          <div className={s.colHead}>You said</div>
          {said.map((task) => (
            <div key={task.title} className={s.enter}>
              <You>{task.said}</You>
            </div>
          ))}
        </div>
        <div className={s.dayBoard}>
          <div className={s.colHead}>It became</div>
          <div className={s.cards}>
            {said.map((task) => {
              const state = stateAt(task, t)!
              return (
                <div key={task.title} className={cx(s.enter, state.step === 'Ready' && s.settled)}>
                  <Card
                    title={task.title}
                    agent={task.agent}
                    step={state.step}
                    progress={state.progress}
                    note={
                      state.step === 'Reviewing'
                        ? `${AGENT_NAME[task.reviewer]} reviewing`
                        : state.step === 'Ready'
                          ? `${task.changes} changes · ready for you`
                          : undefined
                    }
                  />
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <div className={cx(s.dayEnd, ended && s.dayEndOn)}>
        <p>
          14 changes. You wrote none of them.
          <br />
          <strong>You decided all of them.</strong>
        </p>
      </div>
    </section>
  )
}

export function Day() {
  return (
    <main className={s.page}>
      <Back />
      <DayBoard />
    </main>
  )
}

/* 3. Before / after, same afternoon -------------------------------------- */

const TERMINAL = [
  '$ bun install',
  'resolving dependencies…',
  'error: peer dependency conflict: react@19 ← @types/react@18',
  '$ bun install --force',
  'resolving dependencies…',
  '$ bun test',
  'running 412 tests…',
]

export function Split() {
  const t = useClock(40)
  const minutes = Math.floor(t * 3)
  const lines = TERMINAL.slice(0, Math.min(TERMINAL.length, 1 + Math.floor(t / 2.2)))
  const beats = THREAD.slice(0, Math.min(THREAD.length, 1 + Math.floor(t / 2.6)))
  return (
    <main className={s.page}>
      <Back />
      <section className={s.split}>
        <h1 className={s.splitHead}>
          Same afternoon. <em>Two very different feelings.</em>
        </h1>
        <div className={s.splitGrid}>
          <div className={s.alone}>
            <div className={s.splitLabel}>
              <span>Alone</span>
              <span>2:14 pm + {minutes} min</span>
            </div>
            <pre className={s.term}>
              {lines.join('\n')}
              {'\n'}
              <span className={s.spin}>{'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'[Math.floor(t * 10) % 10]}</span> waiting… {minutes} min
            </pre>
            <p className={s.splitFoot}>One thing at a time. Most of it waiting.</p>
          </div>
          <div className={s.withA}>
            <div className={s.splitLabel}>
              <span>With Althar</span>
              <span>2:14 pm + {minutes} min</span>
            </div>
            <div className={s.splitThread}>
              {beats.map((beat, i) => (
                <div key={i} className={s.enter}>
                  <BeatView beat={beat} />
                </div>
              ))}
            </div>
            <p className={s.splitFoot}>You talk. It moves. You decide.</p>
          </div>
        </div>
      </section>
    </main>
  )
}

/* 4. The flow meter ------------------------------------------------------ */

export function Meter() {
  const t = useClock(60)
  const ideas = DAY.filter((task) => t * 0.8 >= task.at).length + Math.floor(t / 9)
  const running = Math.min(3, Math.max(1, Math.round(2 + Math.sin(t / 3))))
  const landed = Math.floor(t / 4.3)
  const flow = Math.min(100, 62 + t * 0.8)
  return (
    <main className={s.page}>
      <Back />
      <section className={s.meter}>
        <p className={s.mono}>Measuring you, not the machine</p>
        <h1 className={s.meterHead}>Never has building software felt so good.</h1>
        <div className={s.dials}>
          <Dial label="Ideas said" value={ideas} />
          <Dial label="Tasks running" value={running} />
          <Dial label="Changes landed" value={landed} />
          <Dial label="Minutes waited" value="≈0" accent />
        </div>
        <div className={s.flow}>
          <div className={s.flowLabel}>
            <span>Flow</span>
            <span>{flow >= 99.5 ? 'unbroken' : `${flow.toFixed(0)}%`}</span>
          </div>
          <div className={s.flowBar}>
            <div className={s.flowFill} style={{ transform: `scaleX(${flow / 100})` }} />
          </div>
        </div>
        <div className={s.meterFeed}>
          {DAY.filter((task) => t * 0.8 >= task.at)
            .slice(-3)
            .map((task) => (
              <div key={task.title} className={s.enter}>
                <You>{task.said}</You>
              </div>
            ))}
        </div>
      </section>
    </main>
  )
}

function Dial({ label, value, accent }: { label: string; value: ReactNode; accent?: boolean }) {
  return (
    <div className={cx(s.dial, accent && s.dialAccent)}>
      <div className={s.dialValue}>{value}</div>
      <div className={s.dialLabel}>{label}</div>
    </div>
  )
}

/* 5. In your words ------------------------------------------------------- */

export function Words() {
  return (
    <main className={s.page}>
      <Back />
      <section className={s.words}>
        <h1 className={s.wordsHead}>
          Never has building software felt so good.
          <span>Althar is built with Althar. Here's how that sounds.</span>
        </h1>
        <div className={s.quotes}>
          {WORDS.map((w) => (
            <a key={w.pr} className={s.quote} href={PR(w.pr)} target="_blank" rel="noreferrer">
              <q>{w.said}</q>
              <span className={s.became}>
                became <b>#{w.pr}</b> {w.title}
              </span>
            </a>
          ))}
        </div>
      </section>
    </main>
  )
}

/* 6. Small words, big type (my own) -------------------------------------- */

const SMALL = ['push pls', 'yes, do the setup path', 'approval card. all trackers.', 'nice. ship it']

export function Small() {
  const t = useClock(SMALL.length * 4)
  const i = Math.floor(t / 4)
  const phase = t % 4
  const said = SMALL[i]!
  const typed = said.slice(0, Math.ceil(Math.min(1, phase / 1.2) * said.length))
  const task = DAY[i % DAY.length]!
  return (
    <main className={s.page}>
      <Back />
      <section className={s.small}>
        <div className={s.glowWrap}>
          <Glow heart={0.35} />
        </div>
        <p className={s.mono}>Everything you typed today</p>
        <div className={s.smallSaid}>
          {typed}
          <span className={s.caret} />
        </div>
        <div className={cx(s.smallCard, phase > 1.6 && s.smallCardOn)}>
          <Card
            title={task.title}
            agent={task.agent}
            step={phase > 3.1 ? 'Ready' : 'Implementing'}
            progress={Math.min(1, Math.max(0, (phase - 1.6) / 1.5))}
          />
        </div>
        <h1 className={s.smallLine}>{LINE}</h1>
      </section>
    </main>
  )
}

/* 7. Quiet line + your day (the coordinator's lean) ---------------------- */

export function Combo() {
  return (
    <main className={s.page}>
      <Back />
      <QuietHero />
      <DayBoard />
    </main>
  )
}

/* Index ------------------------------------------------------------------ */

const DIRECTIONS = [
  ['/feel/quiet', '1 · One quiet line', 'The sentence alone, the thread drifting by underneath. Calm control, not speed.'],
  ['/feel/day', '2 · Your day, replayed', 'Sentences become cards, three tasks move at once, ending on "you decided all of them".'],
  ['/feel/split', '3 · Before / after', 'Same afternoon: a stuck terminal vs. a thread that keeps landing.'],
  ['/feel/meter', '4 · The flow meter', 'A playful readout of you: ideas said, tasks running, minutes waited ≈0.'],
  ['/feel/words', '5 · In your words', 'Real-sounding one-liners, each linked to the Althar PR it became.'],
  ['/feel/small', '6 · Small words, big type', 'Your three-word messages set huge, each turning into a card. The headline is the person.'],
  ['/feel/combo', '7 · Quiet line + your day', 'The coordinator’s lean: 1 as the hero, 2 straight under it.'],
] as const

export function Index() {
  return (
    <main className={s.page}>
      <section className={s.index}>
        <p className={s.mono}>Scrappy prototype · althar.ai</p>
        <h1 className={s.indexHead}>{LINE}</h1>
        <p className={s.sub}>Directions that lead with the feeling, not the feature list.</p>
        <ul className={s.list}>
          {DIRECTIONS.map(([href, name, what]) => (
            <li key={href}>
              <a href={href}>
                <b>{name}</b>
                <span>{what}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}

export const FEEL_PAGES = {
  '/feel': Index,
  '/feel/quiet': Quiet,
  '/feel/day': Day,
  '/feel/split': Split,
  '/feel/meter': Meter,
  '/feel/words': Words,
  '/feel/small': Small,
  '/feel/combo': Combo,
}
