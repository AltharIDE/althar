import { type ReactNode, useId, useState } from 'react'
import { BrandMark, ChromeButton, Gauge, type LoadPoint, type LoadRow, loadPeekText, PlanGauge, Popover, Switch } from '@althar/ui'

import { heldSteps, percent, STEPS, strained } from '../../../../packages/ui/src/chrome/LoadMeter/load'
import m from '../../../../packages/ui/src/chrome/LoadMeter/LoadMeter.module.css'
import lp from '../../../../packages/ui/src/chrome/LoadMeter/LoadPeek.module.css'
import { CLAUDE_PLENTY, CODEX_PLENTY } from '../../../../packages/ui/src/fixtures/plan'
import { SLOTS } from './data'
import type { Ctx } from './takes/types'
import s from './parts.module.css'

/*
 * The bar and This Mac as the kit draws them (`LoadMeter`, `LoadPeek`, their
 * own styles), with a place for what a take adds: a reading among CPU and
 * Memory, or something between them and Running. Nothing else differs.
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

/** The bar between Homes and the gear: Homes, the meter, plan usage, each as it is. */
export function Bar({ ctx, children }: { ctx: Ctx; children: ReactNode }) {
  const cpu = useSteps(ctx.load.cpu)
  const work = useSteps(ctx.load.work ?? 0)
  const memory = useSteps(ctx.load.memory)
  const workMemory = useSteps(ctx.load.workMemory ?? 0)
  return (
    <>
      <ChromeButton icon="plug" label="Homes" compact onClick={() => ctx.say('Opens the homes menu, as it is')} />
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
              <Gauge name="CPU" lit={cpu} ours={work} full={cpu === STEPS} />
              <Gauge name="MEM" lit={memory} ours={workMemory} full={strained(ctx.load.pressure)} />
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

/**
 * This Mac, as the kit's peek: the trace, CPU and Memory, what runs, the switch. `reading` goes after Memory, in the
 * same form; `after` between the readings and Running.
 */
export function MacPeek({ ctx, reading, after }: { ctx: Ctx; reading?: ReactNode; after?: ReactNode }) {
  const id = useId()
  const { load } = ctx
  const rows = load.rows ?? []
  return (
    <div className={`${lp.peek} ${s.scroll}`}>
      <span className={lp.head}>
        <h2 className={lp.heading}>{t.machine}</h2>
      </span>
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
        {reading}
      </div>
      {after}
      <section className={lp.rows}>
        <span className={lp.rowsHead}>
          <h3 className={lp.eyebrow}>{t.running}</h3>
          <span className={lp.eyebrow}>{t.cpu}</span>
        </span>
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
                    ctx.peek.set(false)
                    ctx.onOpen(row.id)
                  }}
                >
                  <Row row={row} />
                </button>
              )}
            </li>
          ))}
        </ul>
        <span className={lp.other}>
          <span>{t.otherApps}</span>
          <span className={lp.figure}>{t.percent(percent(load.cpu - (load.work ?? 0)))}</span>
        </span>
      </section>
      <div className={lp.foot}>
        <span className={lp.footWords}>
          <span id={`${id}-show`} className={lp.footTitle}>
            {t.show}
          </span>
          <span className={lp.footNote}>{t.showNote}</span>
        </span>
        <Switch checked onChange={() => ctx.say('Takes the meter out of the bar')} labelledBy={`${id}-show`} />
      </div>
    </div>
  )
}
