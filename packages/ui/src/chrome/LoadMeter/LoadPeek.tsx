import { useId } from 'react'

import { device } from '../../foundations/device'
import { BrandMark } from '../../foundations/Marks/Marks'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { below, Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { Switch } from '../../primitives/Switch/Switch'
import { type LoadGlance, type LoadPoint, type LoadRow, percent } from './load'
import s from './LoadPeek.module.css'

/*
 * What the load meter opens to: how hard this computer works, at more
 * length. The last two minutes of CPU as a line, with Althar's work's part
 * under it; CPU and memory as figures, each with Althar's part; what macOS
 * says of memory; each piece of Althar's work, most first, across every
 * project, and what the rest of the computer's apps use; and a switch that
 * takes the meter out of the bar. Cobalt is always Althar's work, as it is
 * wherever work in motion shows; the rest is ink.
 */

export interface LoadPeekText {
  /** The computer, as the peek titles it. */
  machine: string
  cpu: string
  memory: string
  percent: (percent: number) => string
  memoryFigure: (used: string, total: string) => string
  /** Althar's work's part, under a bar. */
  work: (percent: number) => string
  running: string
  processes: (n: number) => string
  otherApps: string
  nothingRuns: string
  /** The ends of the trace. */
  ago: string
  now: string
  show: string
  showNote: string
}

export const loadPeekText: LoadPeekText = {
  machine: device.This,
  cpu: 'CPU',
  memory: 'Memory',
  percent: (p) => `${p}%`,
  memoryFigure: (used, total) => `${used} of ${total}`,
  work: (p) => `Althar’s work ${p}%`,
  running: 'Running',
  processes: (n) => (n === 1 ? '1 process' : `${n} processes`),
  otherApps: 'Other apps',
  nothingRuns: 'Nothing Althar started is running.',
  ago: '2 min ago',
  now: 'now',
  show: 'Show in the bar',
  showNote: 'Settings brings it back.',
}

const clamp = (n: number) => Math.min(1, Math.max(0, n))

/** A share of the whole as a bar: Althar's part in cobalt, the rest in ink. Decoration: the words beside it say the numbers. */
function SplitBar({ total, ours }: { total: number; ours: number }) {
  const all = clamp(total)
  const mine = Math.min(all, clamp(ours))
  return (
    <span className={s.bar} aria-hidden="true">
      <i className={s.ours} style={{ width: `${mine * 100}%` }} />
      <i className={s.rest} style={{ width: `${(all - mine) * 100}%` }} />
    </span>
  )
}

/** The CPU over the last readings, right to left from now: all of it as a line, Althar's part as cobalt under it. */
function Trace({ points, slots, width, height }: { points: readonly LoadPoint[]; slots: number; width: number; height: number }) {
  const pad = 1.5
  // The readings fill the room from the right, at now; fewer than it has room for start part way.
  const from = Math.max(0, slots - points.length)
  const x = (i: number) => (((from + i) / Math.max(1, slots - 1)) * width).toFixed(1)
  const y = (v: number) => (pad + (1 - clamp(v)) * (height - pad * 2)).toFixed(1)
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)} ${y(p.cpu)}`).join('')
  const area = `M${x(0)} ${y(0)}${points.map((p, i) => `L${x(i)} ${y(p.work)}`).join('')}L${x(points.length - 1)} ${y(0)}Z`
  return (
    <svg className={s.spark} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {points.length > 1 && (
        <>
          <path d={area} className={s.sparkOurs} />
          <path d={line} className={s.sparkLine} />
        </>
      )}
    </svg>
  )
}

function Figure({ name, figure, total, ours, work }: { name: string; figure: string; total: number; ours: number | null; work: string }) {
  return (
    <div className={s.row}>
      <span className={s.name}>{name}</span>
      <span className={s.figure}>{figure}</span>
      <SplitBar total={total} ours={ours ?? 0} />
      {ours !== null && ours > 0 && (
        <span className={s.work}>
          <i className={s.key} aria-hidden="true" />
          {work}
        </span>
      )}
    </div>
  )
}

function Row({ row, t }: { row: LoadRow; t: LoadPeekText }) {
  return (
    <>
      {row.mark !== undefined && <BrandMark brand={row.mark} size={13} className={s.mark} />}
      <span className={s.words}>
        <span className={s.title}>{row.title}</span>
        <span className={s.meta}>
          {[row.project, row.agent, t.processes(row.processes)].filter((part) => part !== undefined).join(' · ')}
        </span>
      </span>
      <span className={s.figures}>
        <span className={s.figure}>{t.percent(percent(row.cpu))}</span>
        <span className={s.held}>{row.memory}</span>
      </span>
    </>
  )
}

export type LoadPeekProps = RootProps<
  'div',
  {
    load: LoadGlance
    /** Opens a piece of work from its row, by its id. Without it, the rows say, but aren't ways in. */
    onOpen?: (id: string) => void
    /** Takes the meter out of the bar. Without it, there is no switch. */
    onHide?: () => void
    /** How many readings the trace has room for; it fills from the right, at now. As many as there are, unless given. */
    slots?: number
    headingLevel?: HeadingLevel
    text?: Partial<LoadPeekText>
  }
>

/** How hard this computer works, at length: the trace, the figures, each piece of Althar's work, and the switch. */
export function LoadPeek({ load, onOpen, onHide, slots, headingLevel = 2, text, className, ...rest }: LoadPeekProps) {
  const t = { ...loadPeekText, ...text }
  const id = useId()
  const { rows } = load
  return (
    <div className={cx(s.peek, className)} {...rest}>
      <span className={s.head}>
        <Heading level={headingLevel} className={s.heading}>
          {t.machine}
        </Heading>
      </span>
      <div className={s.trace}>
        <Trace points={load.history} slots={slots ?? load.history.length} width={276} height={40} />
        <span className={s.axis} aria-hidden="true">
          <span>{t.ago}</span>
          <span>{t.now}</span>
        </span>
      </div>
      <div className={s.machine}>
        <Figure
          name={t.cpu}
          figure={t.percent(percent(load.cpu))}
          total={load.cpu}
          ours={load.work}
          work={t.work(percent(load.work ?? 0))}
        />
        <Figure
          name={t.memory}
          figure={t.memoryFigure(load.memoryUsed, load.memoryTotal)}
          total={load.memory}
          ours={load.workMemory}
          work={t.work(percent(load.workMemory ?? 0))}
        />
      </div>
      {rows !== null && (
        <section className={s.rows}>
          <span className={s.rowsHead}>
            <Heading level={below(headingLevel)} className={s.eyebrow}>
              {t.running}
            </Heading>
            <span className={s.eyebrow}>{t.cpu}</span>
          </span>
          {rows.length === 0 ? (
            <p className={s.none}>{t.nothingRuns}</p>
          ) : (
            <ul className={s.list}>
              {rows.map((row) => (
                <li key={row.id}>
                  {onOpen === undefined || row.opens === false ? (
                    <div className={s.share}>
                      <Row row={row} t={t} />
                    </div>
                  ) : (
                    <button type="button" className={cx(s.share, s.way)} onClick={() => onOpen(row.id)}>
                      <Row row={row} t={t} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <span className={s.other}>
            <span>{t.otherApps}</span>
            <span className={s.figure}>{t.percent(percent(load.cpu - (load.work ?? 0)))}</span>
          </span>
        </section>
      )}
      {onHide !== undefined && (
        <div className={s.foot}>
          <span className={s.footWords}>
            <span id={`${id}-show`} className={s.footTitle}>
              {t.show}
            </span>
            <span id={`${id}-note`} className={s.footNote}>
              {t.showNote}
            </span>
          </span>
          <Switch
            checked
            onChange={(on) => {
              if (!on) onHide()
            }}
            labelledBy={`${id}-show`}
            describedBy={`${id}-note`}
          />
        </div>
      )}
    </div>
  )
}
