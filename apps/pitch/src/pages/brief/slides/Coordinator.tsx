import { useEffect, useRef, useState, type RefObject } from 'react'

import { cx } from '../../../lib/cx'
import { vars } from '../../../lib/vars'
import { STEPS, TASK, type Step } from '../model/data'
import { edgePath, NODE_H, NODE_W, nodeX, nodeY, parentOf, stepTitle } from '../model/geometry'
import { pad2, stepAt } from '../model/lib'
import { CAMERA, FACT_TOTAL, FACTS, HUB, MEMORY_FROM, MEMORY_STEPS, PEOPLE, PEOPLE_AT, RECORD_OUT, spoke, type Fact } from '../model/memory'
import { labOf, MarkAt } from '../Mark'
import { Pin } from '../Slide'
import ui from '../ui.module.css'
import s from './Coordinator.module.css'

type Box = readonly [number, number, number, number]
const LAST = STEPS.length - 1

/** The graph after step `i` (0-based): every step so far, and a placeholder for the next. */
export function Dag({ i }: { i: number }) {
  const next = STEPS[i + 1]
  return (
    <g className={s.dag}>
      {STEPS.map((st, j) =>
        j === 0 || j > i ? null : (
          <path
            key={`e${j}`}
            className={cx(s.e, st.add && s.app, st.human && s.human, j === i && s.new)}
            d={edgePath(parentOf(st, j), st)}
            pathLength={1}
          />
        ),
      )}
      {STEPS.map((st, j) => {
        const also = st.also === undefined ? undefined : STEPS[st.also]
        if (!also || j > i) return null
        return <path key={`a${j}`} className={cx(s.e, also.human && s.human, j === i && s.new)} d={edgePath(also, st)} pathLength={1} />
      })}
      {STEPS.map((st, j) => {
        if (j > i) return null
        const x = nodeX(st)
        const y = nodeY(st)
        return (
          <g
            key={`n${j}`}
            data-node=""
            className={cx(s.n, st.coord && s.coord, st.add && s.app, st.human && s.human, j === i ? s.cur : s.past)}
          >
            <rect x={x} y={y} width={NODE_W} height={NODE_H} rx={10} />
            <text className={s.nk} x={x + 14} y={y + 32}>
              {st.k}
            </text>
            <text className={s.nw} x={x + 14} y={y + 54}>
              {st.w}
            </text>
            <MarkAt lab={labOf(st.w)} x={x + NODE_W - 30} y={y + 41} size={16} />
          </g>
        )
      })}
      {next && (
        <g className={s.ghost}>
          <rect x={nodeX(next)} y={nodeY(next)} width={NODE_W} height={NODE_H} rx={10} />
          <text x={nodeX(next) + NODE_W / 2} y={nodeY(next) + NODE_H / 2 + 6} textAnchor="middle">
            ?
          </text>
        </g>
      )}
    </g>
  )
}

function FactNode({ f }: { f: Fact }) {
  const x = HUB.x + f.x
  const y = HUB.y + f.y
  const left = f.x < 0
  const tx = left ? x - 16 : x + 16
  return (
    <g data-fact="" className={cx(s.fact, s[f.status], f.fresh && s.fresh)}>
      <circle cx={x} cy={y} r={7} />
      <text className={s.fk} x={tx} y={y + 6} textAnchor={left ? 'end' : 'start'}>
        {f.text}
      </text>
      <text className={s.fs} x={tx} y={y + 27} textAnchor={left ? 'end' : 'start'}>
        {f.src}
      </text>
    </g>
  )
}

/**
 * Project memory at panel step `i`: nothing until the task graph is finished,
 * then Record's hand-off, the rest of the graph, and the people who share it.
 */
export function Memory({ i }: { i: number }) {
  if (i < MEMORY_FROM) return null
  const facts = FACTS.filter((f) => f.at <= i)
  const byId = new Map(FACTS.map((f) => [f.id, f]))
  const fifteen = byId.get('fifteen')
  const five = byId.get('five')
  return (
    <g className={s.mem}>
      <path className={cx(s.link, i === MEMORY_FROM && s.new)} d={`M${RECORD_OUT.x} ${RECORD_OUT.y} H${HUB.x}`} pathLength={1} />
      {facts.map((f) => (
        <path key={`s-${f.id}`} className={cx(s.spoke, f.fresh && s.freshSpoke, f.at === i && s.new)} d={spoke(f)} pathLength={1} />
      ))}
      {fifteen && five && fifteen.at <= i && (
        <path
          className={s.dispute}
          d={`M${HUB.x + fifteen.x} ${HUB.y + fifteen.y + 7} C${HUB.x - 40} ${HUB.y - 140}, ${HUB.x - 110} ${HUB.y - 120}, ${HUB.x + five.x + 7} ${HUB.y + five.y}`}
        />
      )}
      {facts.map((f) => (
        <FactNode key={f.id} f={f} />
      ))}
      {i >= PEOPLE_AT &&
        PEOPLE.map((p, j) => {
          const owned = byId.get(p.owns)
          return (
            <g key={p.id} className={s.person} style={vars({ '--d': `${j * -1.3}s` })}>
              {owned && <line x1={HUB.x + p.x} y1={HUB.y + p.y} x2={HUB.x + owned.x} y2={HUB.y + owned.y} />}
              <circle cx={HUB.x + p.x} cy={HUB.y + p.y} r={22} />
              <text x={HUB.x + p.x} y={HUB.y + p.y + 5} textAnchor="middle">
                {p.initials}
              </text>
            </g>
          )
        })}
      <g className={s.hub}>
        <circle cx={HUB.x} cy={HUB.y} r={15} />
        <text x={HUB.x} y={HUB.y + 42} textAnchor="middle">
          payments-service
        </text>
      </g>
    </g>
  )
}

/** Moves the view box between two framings, easing over `ms`. Jumps when motion is reduced or the figure is off-screen. */
function useCamera(ref: RefObject<SVGSVGElement | null>, to: Box, ms = 900): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const set = (b: readonly number[]): void => el.setAttribute('viewBox', b.map((v) => v.toFixed(1)).join(' '))
    const from = (el.getAttribute('viewBox') ?? '').split(' ').map(Number)
    const r = el.getBoundingClientRect()
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches || r.bottom <= 0 || r.top >= window.innerHeight
    if (still || from.length !== 4) {
      set(to)
      return
    }
    const start = performance.now()
    let frame = 0
    const tick = (): void => {
      const t = Math.min(1, (performance.now() - start) / ms)
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
      set(to.map((v, k) => (from[k] ?? v) + (v - (from[k] ?? v)) * e))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [ref, to, ms])
}

function Why({ st }: { st: Step }) {
  if (st.add) {
    const reason = st.add.charAt(0).toLowerCase() + st.add.slice(1)
    return (
      <span className={cx(s.why, st.human && s.human)}>
        Not in the plan. Added because <b>{reason}</b>.
      </span>
    )
  }
  return <span className={s.why}>{st.why}</span>
}

/** The caption under the graph: the step being told. */
export function Card({ i }: { i: number }) {
  const st = STEPS[i]!
  return (
    <div className={cx(s.card, s.cardTask)} aria-hidden="true">
      <p className={s.fcN}>
        <b>{pad2(i + 1)}</b>/ {STEPS.length}
      </p>
      <div>
        <p className={s.fcH}>{stepTitle(st)}</p>
        <p className={cx(s.fcW, st.human && s.human)}>{st.full}</p>
      </div>
      <p className={s.fcP}>
        {st.t}
        <Why st={st} />
      </p>
    </div>
  )
}

const MEMORY_CARDS = [
  {
    n: '+3',
    unit: 'facts written back',
    h: 'Record',
    w: 'into project memory',
    t: 'The task started from six facts and leaves three more: a convention, your decision, and the open question about the refresh window. The fact it proved wrong is retired, not deleted.',
    why: 'The next task inherits all of it, whichever agent runs it.',
  },
  {
    n: String(FACT_TOTAL),
    unit: 'facts, each with a status and a source',
    h: 'A graph, not a docs folder',
    w: 'settled · seen once · proposed · no longer true',
    t: 'Agents are told how sure the project is of each fact, and where it came from: a task, an agent’s record, a policy or a person.',
    why: 'When two facts disagree, both stay until a person decides.',
  },
  {
    n: String(PEOPLE.length),
    unit: 'people, one record',
    h: 'Shared by the team',
    w: 'next · with Althar for teams',
    t: 'Everyone on the project reads and writes the same memory, with authors and history. A call Priya made in March briefs the agents of someone who joined last week.',
    why: 'The project remembers, so no one person has to.',
  },
] as const

/** The caption once the camera has moved to project memory. */
export function MemoryCard({ i }: { i: number }) {
  const c = MEMORY_CARDS[Math.max(0, Math.min(MEMORY_CARDS.length - 1, i - MEMORY_FROM))]!
  return (
    <div className={cx(s.card, s.cardMem)} aria-hidden="true">
      <p className={s.fcN}>
        <b>{c.n}</b>
        <span>{c.unit}</span>
      </p>
      <div>
        <p className={s.fcH}>{c.h}</p>
        <p className={cx(s.fcW, s.memW)}>{c.w}</p>
      </div>
      <p className={s.fcP}>
        {c.t}
        <span className={s.why}>
          <b>{c.why}</b>
        </span>
      </p>
    </div>
  )
}

/** Every step as a list: the graph's text on small screens and for screen readers. */
export function FlowList() {
  return (
    <ol className={s.list} aria-label="Task 418, step by step">
      {STEPS.map((st, j) => (
        <li key={st.k}>
          <span className={s.ln}>{pad2(j + 1)}</span>
          {st.add && <span className={cx(s.la, st.human && s.human)}>Added · {st.tag}</span>}
          <b>{stepTitle(st)}</b>
          <span className={cx(s.lw, st.human && s.human)}>{st.full}</span>
          <p>{st.t}</p>
        </li>
      ))}
    </ol>
  )
}

const STATUS: Record<Fact['status'], string> = {
  settled: 'Settled',
  seen: 'Seen once',
  proposed: 'Proposed',
  retired: 'No longer true',
}

/** Project memory as text: the figure on small screens, and for screen readers everywhere. */
export function MemoryList() {
  return (
    <section className={s.memList} aria-labelledby="memory-h">
      <p className={cx(ui.kicker, s.kicker)}>The answer · Project memory</p>
      <h3 id="memory-h">Every task leaves the project knowing more.</h3>
      <p className={s.memLead}>
        Task 418 started from six facts and wrote three back. They join the {FACT_TOTAL} facts payments-service already holds, each with a
        status and a source. When two disagree, both stay until a person decides.
      </p>
      <ul aria-label="Some of what payments-service knows">
        {FACTS.map((f) => (
          <li key={f.id} className={cx(s[f.status], f.fresh && s.fresh)}>
            <span className={s.mlS}>
              {f.fresh ? 'New · ' : ''}
              {STATUS[f.status]}
              {f.disputed ? ' · disputed' : ''}
            </span>
            <b>{f.text}</b>
            <span className={s.mlSrc}>{f.src}</span>
          </li>
        ))}
      </ul>
      <p className={s.memLead}>
        <b>Next, with Althar for teams:</b> {PEOPLE.length} people on one record. A call Priya made in March briefs the agents of someone
        who joined last week.
      </p>
    </section>
  )
}

export function Coordinator() {
  const cam = useRef<SVGSVGElement>(null)
  const [live, setLive] = useState(false)
  const [step, setStep] = useState(LAST + MEMORY_STEPS)
  const memory = live && step >= MEMORY_FROM
  useCamera(cam, memory ? CAMERA.memory : CAMERA.task)
  return (
    <Pin
      id="flow"
      tone="dark"
      name="The coordinator"
      className={s.flow}
      stickClassName={s.stick}
      steps={STEPS.length + MEMORY_STEPS}
      onProgress={(p, l) => {
        setLive(l)
        setStep(stepAt(p, STEPS.length + MEMORY_STEPS))
      }}
      after={
        <div className={s.after}>
          <FlowList />
          <MemoryList />
        </div>
      }
    >
      {(i) => {
        const task = Math.min(i, LAST)
        return (
          <div className={cx(ui.wrap, s.stage)} data-phase={memory ? 'memory' : 'task'}>
            <div className={s.heads}>
              <div className={s.head}>
                <p className={cx(ui.kicker, s.kicker)}>The answer · The coordinator</p>
                <h2>The graph isn’t drawn in advance. Each result decides the next step.</h2>
                <p className={s.task}>
                  <span>Task {TASK.id}</span>
                  {TASK.text}
                </p>
              </div>
              <div className={cx(s.head, s.headMem)} aria-hidden="true">
                <p className={cx(ui.kicker, s.kicker)}>The answer · Project memory</p>
                <p className={s.h2}>Every task leaves the project knowing more.</p>
                <p className={s.task}>
                  <span>payments-service</span>What the project knows, and how sure it is of each thing.
                </p>
              </div>
            </div>
            <svg ref={cam} className={s.cam} viewBox={CAMERA.task.join(' ')} preserveAspectRatio="xMinYMid meet" aria-hidden="true">
              <Dag i={task} />
              <Memory i={i} />
            </svg>
            <div className={s.cards}>
              <Card i={task} />
              <MemoryCard i={i} />
            </div>
          </div>
        )
      }}
    </Pin>
  )
}
