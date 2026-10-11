import { BrandMark } from '../../../foundations/Marks/Marks'
import { cx } from '../../../lib/cx'
import { Heading, type HeadingLevel } from '../../../primitives/Heading/Heading'
import { percent, strainOf, usageWords, type Usage, type UsagePoint, type UsageShare, type UsageWords } from '../usage'
import s from './UsageDetail.module.css'

/*
 * The parts every direction draws its detail from, so the numbers read the
 * same whichever one is picked: a bar split into the agents' part and the
 * rest, the machine's figures, each task's share, and a trace of the last
 * minutes. Cobalt is always the agents' part, as it is everywhere the
 * work Althar runs shows; everything else is ink.
 */

export interface UsageText extends UsageWords {
  /** The machine, as a detail titles it. */
  machine: string
  cpu: string
  memory: string
  percent: (percent: number) => string
  memoryFigure: (used: string, total: string) => string
  /** The agents' part, under a bar. */
  agents: (percent: number) => string
  tasks: string
  processes: (n: number) => string
  otherApps: string
  noTasks: string
  /** The ends of a trace. */
  ago: string
  now: string
}

export const usageText: UsageText = {
  ...usageWords,
  machine: 'This Mac',
  cpu: 'CPU',
  memory: 'Memory',
  percent: (p) => `${p}%`,
  memoryFigure: (used, total) => `${used} of ${total}`,
  agents: (p) => `Agents ${p}%`,
  tasks: 'Tasks',
  processes: (n) => (n === 1 ? '1 process' : `${n} processes`),
  otherApps: 'Other apps',
  noTasks: 'No task is running.',
  ago: '2 min ago',
  now: 'now',
}

const clamp = (n: number) => Math.min(1, Math.max(0, n))

/** A share of the whole as a bar: the agents' part in cobalt, the rest in ink. Decoration: the words beside it say the numbers. */
export function SplitBar({ total, ours, className }: { total: number; ours: number; className?: string }) {
  const all = clamp(total)
  const mine = Math.min(all, clamp(ours))
  return (
    <span className={cx(s.bar, className)} aria-hidden="true">
      <i className={s.ours} style={{ width: `${mine * 100}%` }} />
      <i className={s.rest} style={{ width: `${(all - mine) * 100}%` }} />
    </span>
  )
}

/** CPU over the last minutes: the whole Mac as a line, the agents' part as cobalt under it. */
export function Sparkline({
  points,
  width,
  height,
  strained = false,
  className,
}: {
  points: readonly UsagePoint[]
  width: number
  height: number
  /** Drawn in the strongest ink, as everything is under strain. */
  strained?: boolean
  className?: string
}) {
  const pad = 1.5
  const last = Math.max(1, points.length - 1)
  const x = (i: number) => ((i / last) * width).toFixed(1)
  const y = (v: number) => (pad + (1 - clamp(v)) * (height - pad * 2)).toFixed(1)
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)} ${y(p.cpu)}`).join('')
  const area = `M0 ${y(0)}${points.map((p, i) => `L${x(i)} ${y(p.althar)}`).join('')}L${width} ${y(0)}Z`
  return (
    <svg
      className={cx(s.spark, strained && s.strained, className)}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <path d={area} className={s.sparkOurs} />
      <path d={line} className={s.sparkLine} />
    </svg>
  )
}

/** A trace wide enough to read, with when its ends are. */
export function UsageTrace({
  usage,
  width,
  height = 40,
  text,
}: {
  usage: Usage
  width: number
  height?: number
  text?: Partial<UsageText>
}) {
  const t = { ...usageText, ...text }
  return (
    <div className={s.trace}>
      <Sparkline points={usage.history} width={width} height={height} strained={strainOf(usage) !== null} />
      <span className={s.axis} aria-hidden="true">
        <span>{t.ago}</span>
        <span>{t.now}</span>
      </span>
    </div>
  )
}

function Figure({ name, figure, total, ours, agents }: { name: string; figure: string; total: number; ours: number; agents: string }) {
  return (
    <div className={s.row}>
      <span className={s.name}>{name}</span>
      <span className={s.figure}>{figure}</span>
      <SplitBar total={total} ours={ours} className={s.rowBar} />
      {ours > 0 && (
        <span className={s.agents}>
          <i className={s.key} aria-hidden="true" />
          {agents}
        </span>
      )}
    </div>
  )
}

/** The machine's figures: CPU and memory, the agents' part of each, and what holds it back, if anything. */
export function UsageFigures({ usage, text }: { usage: Usage; text?: Partial<UsageText> }) {
  const t = { ...usageText, ...text }
  const strain = strainOf(usage)
  return (
    <div className={s.figures}>
      <Figure
        name={t.cpu}
        figure={t.percent(percent(usage.cpu))}
        total={usage.cpu}
        ours={usage.althar}
        agents={t.agents(percent(usage.althar))}
      />
      <Figure
        name={t.memory}
        figure={t.memoryFigure(usage.memoryUsed, usage.memoryTotal)}
        total={usage.memory}
        ours={usage.altharMemory}
        agents={t.agents(percent(usage.altharMemory))}
      />
      {strain === null ? (
        <span className={s.state}>{`${t.pressure[usage.pressure]} · ${t.thermal[usage.thermal]}`}</span>
      ) : (
        <span className={cx(s.state, s.strainedState)}>
          <b>{t.strain[strain]}.</b> {t.strainNote[strain]}
        </span>
      )}
    </div>
  )
}

function ShareRow({ share, t }: { share: UsageShare; t: UsageText }) {
  return (
    <>
      {share.mark !== undefined && <BrandMark brand={share.mark} size={13} className={s.mark} />}
      <span className={s.taskWords}>
        <span className={s.taskTitle}>{share.title}</span>
        <span className={s.taskMeta}>{[share.project, share.agent, t.processes(share.processes)].join(' · ')}</span>
      </span>
      <span className={s.taskFigures}>
        <span className={s.figure}>{t.percent(percent(share.cpu))}</span>
        <span className={s.taskMemory}>{share.memory}</span>
      </span>
    </>
  )
}

export interface UsageSharesProps {
  shares: readonly UsageShare[]
  /** The CPU the rest of the Mac uses, 0 to 1. */
  other: number
  /** Open a task. Without it, the rows say, but aren't ways in. */
  onOpen?: (id: string) => void
  headingLevel?: HeadingLevel
  text?: Partial<UsageText>
}

/** Each running task's share of the CPU, most first, and what the rest of the Mac uses. */
export function UsageShares({ shares, other, onOpen, headingLevel = 3, text }: UsageSharesProps) {
  const t = { ...usageText, ...text }
  return (
    <section className={s.shares}>
      <span className={s.sharesHead}>
        <Heading level={headingLevel} className={s.eyebrow}>
          {t.tasks}
        </Heading>
        <span className={s.eyebrow}>{t.cpu}</span>
      </span>
      {shares.length === 0 ? (
        <p className={s.none}>{t.noTasks}</p>
      ) : (
        <ul className={s.list}>
          {shares.map((share) => (
            <li key={share.id}>
              {onOpen === undefined ? (
                <div className={s.task}>
                  <ShareRow share={share} t={t} />
                </div>
              ) : (
                <button type="button" className={cx(s.task, s.way)} onClick={() => onOpen(share.id)}>
                  <ShareRow share={share} t={t} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <span className={s.other}>
        <span>{t.otherApps}</span>
        <span className={s.figure}>{t.percent(percent(other))}</span>
      </span>
    </section>
  )
}
