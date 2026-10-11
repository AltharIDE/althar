import { cx } from '../../../lib/cx'
import { HoverCard } from '../../../primitives/HoverCard/HoverCard'
import { UsageFigures, usageText, type UsageText } from '../UsageDetail/UsageDetail'
import { useOverlayScheme } from '../scheme'
import { percent, steps, strainOf, type Usage, type UsageShare } from '../usage'
import s from './Dial.module.css'

/*
 * Direction C. A dial of twelve ticks in a task's composer, beside the
 * context ring: how hard the Mac works while you write to this task. Its
 * ticks light in cobalt for this task's agents and in ink for the rest, so
 * the question it answers is whether this task is the one spinning the
 * fans. Ticks, not an arc, so it can't be read as a second context ring.
 */

export interface DialText extends UsageText {
  /** The dial's name, with its numbers; `task` is null where no task is given. */
  label: (cpu: number, task: number | null) => string
  thisTask: string
  /** This task's share, in a line. */
  taskLine: (cpu: string, memory: string, processes: string) => string
  /** Where the rest of the load comes from. */
  rest: string
}

export const dialText: DialText = {
  ...usageText,
  label: (cpu, task) => (task === null ? `This Mac: CPU ${cpu}%` : `This Mac: CPU ${cpu}%, this task ${task}%`),
  thisTask: 'This task',
  taskLine: (cpu, memory, processes) => `${cpu} of the CPU · ${memory} · ${processes}`,
  rest: 'The rest is other tasks and other apps.',
}

/** How many ticks the dial has. */
export const TICKS = 12

const tick = (i: number) => {
  const a = (i / TICKS) * 2 * Math.PI - Math.PI / 2
  const at = (r: number) => [8 + Math.cos(a) * r, 8 + Math.sin(a) * r].map((n) => n.toFixed(2))
  const [x1, y1] = at(4.4)
  const [x2, y2] = at(6.9)
  return { x1, y1, x2, y2 }
}

/** The ticks, drawn: this task's part first, from the top, then the rest of the Mac. */
export function DialGlyph({ cpu, task }: { cpu: number; task: number }) {
  const lit = steps(cpu, TICKS)
  const mine = Math.min(lit, steps(task, TICKS))
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className={s.glyph} aria-hidden="true">
      {Array.from({ length: TICKS }, (_, i) => (
        <line key={i} {...tick(i)} data-lit={i < mine ? 'ours' : i < lit ? 'rest' : undefined} />
      ))}
    </svg>
  )
}

export interface DialProps {
  usage: Usage
  /** This task's share. Without it, the dial is the Mac's alone, in ink. */
  task?: UsageShare
  /** Whether the detail shows, when the consumer holds it. */
  open?: boolean
  /** Show the detail from the start, as for a screenshot. */
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  text?: Partial<DialText>
}

export function Dial({ usage, task, open, defaultOpen, onOpenChange, text }: DialProps) {
  const t = { ...dialText, ...text }
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
              <span className={s.rest}>{t.rest}</span>
            </span>
          )}
        </>
      }
    >
      <button
        type="button"
        className={cx(s.dial, strain !== null && s.strained)}
        aria-label={t.label(percent(usage.cpu), task === undefined ? null : percent(task.cpu))}
      >
        <DialGlyph cpu={usage.cpu} task={task?.cpu ?? 0} />
      </button>
    </HoverCard>
  )
}
