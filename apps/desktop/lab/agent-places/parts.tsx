import { type ReactNode, useId, useState } from 'react'
import {
  AgentsAtOnce,
  agentsAtOnceText,
  BrandMark,
  ChromeButton,
  Gauge,
  type LoadGlance,
  type LoadPoint,
  type LoadRow,
  loadPeekText,
  PlanGauge,
  Popover,
  Switch,
} from '@althar/ui'

import { heldSteps, percent, STEPS, strained } from '../../../../packages/ui/src/chrome/LoadMeter/load'
import m from '../../../../packages/ui/src/chrome/LoadMeter/LoadMeter.module.css'
import lp from '../../../../packages/ui/src/chrome/LoadMeter/LoadPeek.module.css'
import { CLAUDE_PLENTY, CODEX_PLENTY } from '../../../../packages/ui/src/fixtures/plan'
import { SLOTS, type Worker } from './data'
import type { Ctx } from './takes/types'
import { words } from './words'
import s from './parts.module.css'

/*
 * The bar and This Mac as the kit draws them (`LoadMeter`, `LoadPeek`, their
 * own styles), drawn for any worker: its trace, CPU and Memory, its Agents in
 * their form, what runs on it, and a foot. Takes put the home's other workers
 * around it.
 */

const t = loadPeekText
const clamp = (n: number) => Math.min(1, Math.max(0, n))

/** How many steps a share lights, held still near a step's edge, as the kit's meter holds its own. */
const useSteps = (share: number) => {
  const [held, setHeld] = useState(() => heldSteps(share, STEPS, null))
  const steps = heldSteps(share, STEPS, held)
  if (steps !== held) setHeld(steps)
  return steps
}

/** A worker's CPU and MEM as the bar draws this Mac's: five steps each, Althar's part in cobalt, full in ink. */
export function Gauges({ load }: { load: LoadGlance }) {
  const cpu = useSteps(load.cpu)
  const work = useSteps(load.work ?? 0)
  const memory = useSteps(load.memory)
  const workMemory = useSteps(load.workMemory ?? 0)
  return (
    <>
      <Gauge name="CPU" lit={cpu} ours={work} full={cpu === STEPS} />
      <Gauge name="MEM" lit={memory} ours={workMemory} full={strained(load.pressure)} />
    </>
  )
}

/** The bar's end before the gear: Homes (or what a take puts there), the meter and what it opens, plan usage. */
export function Bar({ ctx, homes, children }: { ctx: Ctx; homes?: ReactNode; children: ReactNode }) {
  return (
    <>
      {homes ?? <ChromeButton icon="plug" label="Homes" compact onClick={() => ctx.say('Opens the homes menu, as it is')} />}
      <span className={m.meter}>
        <Popover
          label="This Mac’s load"
          placement="below"
          align="end"
          width={300}
          padded={false}
          initialFocus="panel"
          open={ctx.peek.open}
          onOpenChange={ctx.peek.set}
          trigger={
            <button type="button" className={m.button} aria-label={`CPU ${percent(ctx.load.cpu)}%, MEM ${percent(ctx.load.memory)}%`}>
              <Gauges load={ctx.load} />
            </button>
          }
        >
          {children}
        </Popover>
      </span>
      <PlanGauge agents={[CLAUDE_PLENTY, CODEX_PLENTY]} />
    </>
  )
}

/** A share of the whole as the kit's thin bar: Althar's part in cobalt, the rest in ink. */
export function SplitBar({ total, ours }: { total: number; ours: number }) {
  const all = clamp(total)
  const mine = Math.min(all, clamp(ours))
  return (
    <span className={lp.bar} aria-hidden="true">
      <i className={lp.ours} style={{ width: `${mine * 100}%` }} />
      <i className={lp.rest} style={{ width: `${(all - mine) * 100}%` }} />
    </span>
  )
}

function Trace({ points }: { points: readonly LoadPoint[] }) {
  const width = 276
  const height = 40
  const pad = 1.5
  const from = Math.max(0, SLOTS - points.length)
  const x = (i: number) => (((from + i) / Math.max(1, SLOTS - 1)) * width).toFixed(1)
  const y = (v: number) => (pad + (1 - clamp(v)) * (height - pad * 2)).toFixed(1)
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)} ${y(p.cpu)}`).join('')
  const area = `M${x(0)} ${y(0)}${points.map((p, i) => `L${x(i)} ${y(p.work)}`).join('')}L${x(points.length - 1)} ${y(0)}Z`
  return (
    <svg className={lp.spark} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={area} className={lp.sparkOurs} />
      <path d={line} className={lp.sparkLine} />
    </svg>
  )
}

function Figure({ name, figure, total, ours }: { name: string; figure: string; total: number; ours: number }) {
  return (
    <div className={lp.row}>
      <span className={lp.name}>{name}</span>
      <span className={lp.figure}>{figure}</span>
      <SplitBar total={total} ours={ours} />
      {ours > 0 && (
        <span className={lp.work}>
          <i className={lp.key} aria-hidden="true" />
          {t.work(percent(ours))}
        </span>
      )}
    </div>
  )
}

/** Agents beside CPU and Memory, in their form: how many work of the number, all of it Althar's; under it what is off. */
export function AgentsReading({ worker, waiting = 0 }: { worker: Worker; waiting?: number }) {
  const share = worker.agents.length / Math.max(1, worker.configured)
  const lowered = words.lowered(worker)
  return (
    <div className={lp.row}>
      <span className={lp.name}>{words.agents}</span>
      <span className={lp.figure}>{words.of(worker)}</span>
      <SplitBar total={share} ours={share} />
      {lowered !== null && <span className={lp.work}>{lowered}</span>}
      {waiting > 0 && <span className={lp.work}>{words.waiting(waiting)}</span>}
    </div>
  )
}

function Row({ row }: { row: LoadRow }) {
  return (
    <>
      {row.mark !== undefined && <BrandMark brand={row.mark} size={13} className={lp.mark} />}
      <span className={lp.words}>
        <span className={lp.title}>{row.title}</span>
        <span className={lp.meta}>
          {[row.project, row.agent, t.processes(row.processes)].filter((part) => part !== undefined).join(' · ')}
        </span>
      </span>
      <span className={lp.figures}>
        <span className={lp.figure}>{t.percent(percent(row.cpu))}</span>
        <span className={lp.held}>{row.memory}</span>
      </span>
    </>
  )
}

/** What runs on a worker, as This Mac lists it: each task, most CPU first, and what else the computer runs. */
function Running({ ctx, load, close, title }: { ctx: Ctx; load: LoadGlance; close: () => void; title: string }) {
  const rows = load.rows ?? []
  return (
    <section className={lp.rows}>
      <span className={lp.rowsHead}>
        <h3 className={lp.eyebrow}>{title}</h3>
        <span className={lp.eyebrow}>{t.cpu}</span>
      </span>
      {rows.length === 0 ? (
        <p className={lp.none}>{t.nothingRuns}</p>
      ) : (
        <ul className={lp.list}>
          {rows.map((row) => (
            <li key={row.id}>
              {row.opens === false ? (
                <div className={lp.share}>
                  <Row row={row} />
                </div>
              ) : (
                <button
                  type="button"
                  className={`${lp.share} ${lp.way}`}
                  onClick={() => {
                    close()
                    ctx.onOpen(row.id)
                  }}
                >
                  <Row row={row} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <span className={lp.other}>
        <span>{t.otherApps}</span>
        <span className={lp.figure}>{t.percent(percent(load.cpu - (load.work ?? 0)))}</span>
      </span>
    </section>
  )
}

/** This Mac's foot, as built: the switch that takes the meter out of the bar. */
export function ShowInBar({ ctx }: { ctx: Ctx }) {
  const id = useId()
  return (
    <div className={lp.foot}>
      <span className={lp.footWords}>
        <span id={`${id}-show`} className={lp.footTitle}>
          {t.show}
        </span>
        <span className={lp.footNote}>{t.showNote}</span>
      </span>
      <Switch checked onChange={() => ctx.say('Takes the meter out of the bar')} labelledBy={`${id}-show`} />
    </div>
  )
}

/**
 * A worker as This Mac's popover draws it: its name, the trace, CPU, Memory and Agents, what runs on it, and a foot.
 * `between` goes between the readings and what runs; `after` after it. Out of reach, a line says since when and what
 * waits for it, in the readings' place.
 */
export function Peek({
  ctx,
  worker,
  load,
  waiting = 0,
  side,
  between,
  after,
  foot,
  close,
  running = t.running,
}: {
  ctx: Ctx
  worker: Worker
  load: LoadGlance
  waiting?: number
  /** Quiet, at the heading's end. */
  side?: ReactNode
  between?: ReactNode
  after?: ReactNode
  foot?: ReactNode
  close: () => void
  /** What runs on it, as its list is headed. */
  running?: string
}) {
  return (
    <div className={`${lp.peek} ${s.scroll}`}>
      <span className={lp.head}>
        <h2 className={lp.heading}>{worker.name}</h2>
        {side !== undefined && <span className={s.side}>{side}</span>}
      </span>
      {worker.offline !== null ? (
        <p className={s.away}>
          <span className={s.danger}>{words.away(worker)}.</span> {words.holding(worker)} to come back.
        </p>
      ) : (
        <>
          <div className={lp.trace}>
            <Trace points={load.history} />
            <span className={lp.axis} aria-hidden="true">
              <span>{t.ago}</span>
              <span>{t.now}</span>
            </span>
          </div>
          <div className={lp.machine}>
            <Figure name={t.cpu} figure={t.percent(percent(load.cpu))} total={load.cpu} ours={load.work ?? 0} />
            <Figure
              name={t.memory}
              figure={t.memoryFigure(load.memoryUsed, load.memoryTotal)}
              total={load.memory}
              ours={load.workMemory ?? 0}
            />
            <AgentsReading worker={worker} waiting={waiting} />
          </div>
        </>
      )}
      {between}
      {worker.offline === null && <Running ctx={ctx} load={load} close={close} title={running} />}
      {after}
      {foot}
    </div>
  )
}

/** Agents at once, the kit's own, for a worker: its number and default; where the number is lowered for now, its note says so. */
export function Slider({
  ctx,
  worker,
  compact,
  title,
  note,
  short,
}: {
  ctx: Ctx
  worker: Worker
  compact: boolean
  title?: string
  /** In place of the note at the number: what is so now. */
  note?: string | null
  short?: string
}) {
  const lowered = words.lowered(worker)
  const said = note ?? lowered
  return (
    <AgentsAtOnce
      compact={compact}
      count={worker.configured}
      own={worker.configured !== worker.machine.count}
      machine={worker.machine}
      most={ctx.most}
      onChange={(n) => ctx.setCount(worker.id, n)}
      text={{
        ...(title === undefined ? {} : { title }),
        ...(worker.here ? {} : { mark: () => words.mark(worker), value: (n: number) => String(n) }),
        note: (n, machine) => (n === worker.configured && said !== null ? said : agentsAtOnceText.note(n, machine)),
        short: short ?? lowered ?? agentsAtOnceText.short,
      }}
    />
  )
}
