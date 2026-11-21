import { type ReactNode, useState } from 'react'
import { BrandMark, ChromeButton, Gauge, type LoadGlance, type LoadPoint, type LoadRow, PlanGauge, Popover } from '@althar/ui'

import { heldSteps, percent, STEPS, strained } from '../../../../packages/ui/src/chrome/LoadMeter/load'
import m from '../../../../packages/ui/src/chrome/LoadMeter/LoadMeter.module.css'
import lp from '../../../../packages/ui/src/chrome/LoadMeter/LoadPeek.module.css'
import { CLAUDE_PLENTY, CODEX_PLENTY } from '../../../../packages/ui/src/fixtures/plan'
import { closedOf, type Places } from './data'
import type { Ctx } from './takes/types'
import { words } from './words'
import s from './parts.module.css'

/*
 * What the takes share: the bar (Homes as it is, the meter, plan usage as it
 * is), the meter's CPU and MEM gauges as the kit draws them, this computer's
 * agents as cells, and the kit's own peek's trace, figures and rows, which it
 * keeps to itself.
 */

/** How many steps a share lights, held still near a step's edge, as the kit's meter holds its own. */
const useSteps = (share: number) => {
  const [held, setHeld] = useState(() => heldSteps(share, STEPS, null))
  const steps = heldSteps(share, STEPS, held)
  if (steps !== held) setHeld(steps)
  return steps
}

/** This computer's CPU and memory, as the kit's meter draws them. */
export function LoadGauges({ load }: { load: LoadGlance }) {
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

/**
 * This computer's agents, a cell each up to its number: at work in cobalt, free bare, closed for now faded. Small, a
 * gauge's steps; large, a popover's.
 */
export function Cells({ places, size = 'small' }: { places: Places; size?: 'small' | 'large' }) {
  const busy = Math.min(places.agents.length, places.configured)
  const closedFrom = places.configured - closedOf(places)
  return (
    <span className={size === 'small' ? m.steps : s.cells} aria-hidden="true">
      {Array.from({ length: places.configured }, (_, i) => (
        <i key={i} data-lit={i < busy ? 'ours' : undefined} className={i >= closedFrom ? s.closed : undefined} />
      ))}
    </span>
  )
}

/** The meter in the bar: its button opens what the take puts in it. */
export function Meter({
  ctx,
  label,
  width,
  trigger,
  children,
}: {
  ctx: Ctx
  label: string
  width: number
  trigger: ReactNode
  children: ReactNode
}) {
  return (
    <span className={m.meter}>
      <Popover
        label={label}
        placement="below"
        align="end"
        width={width}
        padded={false}
        initialFocus="panel"
        open={ctx.peek.open}
        onOpenChange={ctx.peek.set}
        trigger={
          <button type="button" className={`${m.button} ${s.button}`} aria-label={label}>
            {trigger}
          </button>
        }
      >
        {children}
      </Popover>
    </span>
  )
}

/** The bar between Homes and the gear: Homes as it is, then the meter, then plan usage as it is. */
export function Bar({ ctx, children }: { ctx: Ctx; children: ReactNode }) {
  return (
    <>
      <ChromeButton icon="plug" label="Homes" compact onClick={() => ctx.say('Opens the homes menu, as it is')} />
      {children}
      <PlanGauge agents={[CLAUDE_PLENTY, CODEX_PLENTY]} />
    </>
  )
}

const clamp = (n: number) => Math.min(1, Math.max(0, n))

/** The CPU over the last two minutes, as the kit's peek draws it. */
export function Trace({ points, width = 276, height = 40 }: { points: readonly LoadPoint[]; width?: number; height?: number }) {
  const pad = 1.5
  const x = (i: number) => ((i / Math.max(1, points.length - 1)) * width).toFixed(1)
  const y = (v: number) => (pad + (1 - clamp(v)) * (height - pad * 2)).toFixed(1)
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)} ${y(p.cpu)}`).join('')
  const area = `M${x(0)} ${y(0)}${points.map((p, i) => `L${x(i)} ${y(p.work)}`).join('')}L${x(points.length - 1)} ${y(0)}Z`
  return (
    <div className={lp.trace}>
      <svg className={lp.spark} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <path d={area} className={lp.sparkOurs} />
        <path d={line} className={lp.sparkLine} />
      </svg>
      <span className={lp.axis} aria-hidden="true">
        <span>2 min ago</span>
        <span>now</span>
      </span>
    </div>
  )
}

/** CPU and memory as figures, each with Althar's part, as the kit's peek has them. */
export function Figures({ load }: { load: LoadGlance }) {
  const figure = (name: string, figure: string, total: number, ours: number) => (
    <div className={lp.row}>
      <span className={lp.name}>{name}</span>
      <span className={lp.figure}>{figure}</span>
      <span className={lp.bar} aria-hidden="true">
        <i className={lp.ours} style={{ width: `${Math.min(total, ours) * 100}%` }} />
        <i className={lp.rest} style={{ width: `${(total - Math.min(total, ours)) * 100}%` }} />
      </span>
      {ours > 0 && (
        <span className={lp.work}>
          <i className={lp.key} aria-hidden="true" />
          Althar’s work {percent(ours)}%
        </span>
      )}
    </div>
  )
  return (
    <div className={lp.machine}>
      {figure('CPU', `${percent(load.cpu)}%`, load.cpu, load.work ?? 0)}
      {figure('Memory', `${load.memoryUsed} of ${load.memoryTotal}`, load.memory, load.workMemory ?? 0)}
    </div>
  )
}

/** A piece of Althar's work as the kit's peek has it, its agents' parts in place of its processes where it has agents. */
export function WorkRow({ row, places, onOpen }: { row: LoadRow; places: Places; onOpen: (id: string) => void }) {
  const agents = places.agents.filter((one) => one.taskId === row.id)
  const meta =
    agents.length > 0
      ? `${row.project} · ${words.roles(
          agents.map((one) => one.role),
          agents.some((one) => one.doing === 'starting') ? 'starting' : agents[0]!.doing,
        )}`
      : [row.project, row.agent].filter(Boolean).join(' · ')
  const inner = (
    <>
      {row.mark === undefined ? <span /> : <BrandMark brand={row.mark} size={13} className={lp.mark} />}
      <span className={lp.words}>
        <span className={lp.title}>{row.title}</span>
        <span className={lp.meta}>{meta}</span>
      </span>
      <span className={lp.figures}>
        <span className={lp.figure}>{percent(row.cpu)}%</span>
        <span className={lp.held}>{row.memory}</span>
      </span>
    </>
  )
  return row.opens === false ? (
    <div className={lp.share}>{inner}</div>
  ) : (
    <button type="button" className={`${lp.share} ${lp.way}`} onClick={() => onOpen(row.id)}>
      {inner}
    </button>
  )
}

/** Althar's work on this computer, most CPU first, then the other apps, as the kit's peek has them. */
export function Running({ ctx, rows, head = words.running }: { ctx: Ctx; rows: readonly LoadRow[]; head?: string }) {
  return (
    <section className={lp.rows}>
      <span className={lp.rowsHead}>
        <h3 className={lp.eyebrow}>{head}</h3>
        <span className={lp.eyebrow}>CPU</span>
      </span>
      <ul className={lp.list}>
        {rows.map((row) => (
          <li key={row.id}>
            <WorkRow row={row} places={ctx.places} onOpen={ctx.onOpen} />
          </li>
        ))}
      </ul>
      <span className={lp.other}>
        <span>{words.otherApps}</span>
        <span className={lp.figure}>{percent(ctx.load.cpu - (ctx.load.work ?? 0))}%</span>
      </span>
    </section>
  )
}
