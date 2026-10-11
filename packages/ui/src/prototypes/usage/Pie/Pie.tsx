import { cx } from '../../../lib/cx'
import { HoverCard } from '../../../primitives/HoverCard/HoverCard'
import { UsageFigures, usageText, type UsageText } from '../UsageDetail/UsageDetail'
import { useOverlayScheme } from '../scheme'
import { percent, steps, strainOf, type Usage, type UsageShare } from '../usage'
import s from './Pie.module.css'

/*
 * Direction C. A small pie in a task's composer, beside the context ring:
 * how hard the Mac works while you write to this task. This task's agents
 * are its cobalt slice, the rest of the Mac's load the ink after it, in
 * fifths, so the question it answers is whether this task is the one
 * spinning the fans. Filled, where the context ring is drawn in a line, so
 * the two read apart. Drafts in twelve ticks and in five pieces of a ring
 * both read as a spinner.
 */

export interface PieText extends UsageText {
  /** The pie's name, with its numbers; `task` is null where no task is given. */
  label: (cpu: number, task: number | null) => string
  thisTask: string
  /** This task's share, in a line. */
  taskLine: (cpu: string, memory: string, processes: string) => string
  /** Where the rest of the load comes from. */
  rest: string
}

export const pieText: PieText = {
  ...usageText,
  label: (cpu, task) => (task === null ? `This Mac: CPU ${cpu}%` : `This Mac: CPU ${cpu}%, this task ${task}%`),
  thisTask: 'This task',
  taskLine: (cpu, memory, processes) => `${cpu} of the CPU · ${memory} · ${processes}`,
  rest: 'The rest is other tasks and other apps.',
}

/** How many slices the pie is cut in. */
export const SLICES = 5
const R = 6.5

/* A slice from one fifth to another, clockwise from the top. */
function slice(from: number, to: number) {
  const at = (n: number) => {
    const a = (n / SLICES) * 2 * Math.PI - Math.PI / 2
    return `${(8 + Math.cos(a) * R).toFixed(2)} ${(8 + Math.sin(a) * R).toFixed(2)}`
  }
  /* a whole pie is a circle: an arc can't end where it starts */
  if (to - from >= SLICES) return `M8 ${8 - R}A${R} ${R} 0 1 1 7.99 ${8 - R}Z`
  return `M8 8L${at(from)}A${R} ${R} 0 ${(to - from) / SLICES > 0.5 ? 1 : 0} 1 ${at(to)}Z`
}

/** The pie, drawn: this task's slice first, from the top, then the rest of the Mac. */
export function PieGlyph({ cpu, task }: { cpu: number; task: number }) {
  const lit = steps(cpu, SLICES)
  const mine = Math.min(lit, steps(task, SLICES))
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className={s.glyph} aria-hidden="true">
      <circle cx="8" cy="8" r={R} className={s.disc} />
      {lit > mine && <path d={slice(mine, lit)} className={s.rest} />}
      {mine > 0 && <path d={slice(0, mine)} className={s.ours} />}
    </svg>
  )
}

export interface PieProps {
  usage: Usage
  /** This task's share. Without it, the pie is the Mac's alone, in ink. */
  task?: UsageShare
  /** Whether the detail shows, when the consumer holds it. */
  open?: boolean
  /** Show the detail from the start, as for a screenshot. */
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  text?: Partial<PieText>
}

export function Pie({ usage, task, open, defaultOpen, onOpenChange, text }: PieProps) {
  const t = { ...pieText, ...text }
  const strain = strainOf(usage)
  const scheme = useOverlayScheme()
  return (
    <HoverCard
      placement="above"
      align="end"
      width={248}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      className={scheme}
      card={
        <>
          <span className={s.title}>{t.machine}</span>
          <UsageFigures usage={usage} text={t} />
          {task !== undefined && (
            <span className={s.task}>
              <span className={s.taskHead}>
                <i className={s.key} aria-hidden="true" />
                {t.thisTask}
              </span>
              <span className={s.taskLine}>{t.taskLine(t.percent(percent(task.cpu)), task.memory, t.processes(task.processes))}</span>
              <span className={s.restNote}>{t.rest}</span>
            </span>
          )}
        </>
      }
    >
      <button
        type="button"
        className={cx(s.pie, strain !== null && s.strained)}
        aria-label={t.label(percent(usage.cpu), task === undefined ? null : percent(task.cpu))}
      >
        <PieGlyph cpu={usage.cpu} task={task?.cpu ?? 0} />
      </button>
    </HoverCard>
  )
}
