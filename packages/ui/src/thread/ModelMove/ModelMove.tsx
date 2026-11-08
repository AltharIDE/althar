import { AltharLine } from '../AltharLine/AltharLine'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'

/*
 * Auto moving a task's lead to a lighter model, in its thread (README
 * section 7): from and to which model, how much of the plan is used and when
 * it resets, and the way back for this task. Its words after the line are the
 * new model's; once the person keeps the heavier one, one line says so, with
 * Undo.
 */

export interface ModelMoveText {
  moved: (to: string, percent: number, plan: string, window: string, until: string) => string
  keep: (from: string) => string
  back: (from: string) => string
  undo: string
}

export const modelMoveText: ModelMoveText = {
  moved: (to, percent, plan, window, until) =>
    `Moved to ${to}: your ${plan} plan is at ${percent}% for ${window}${until === '' ? '' : `, until ${until}`}.`,
  keep: (from) => `Keep ${from}`,
  back: (from) => `Back on ${from} for this task.`,
  undo: 'Undo',
}

/** When a plan resets, as the line says it: the weekday where it is within the week, else the day and month. */
export const resetDay = (iso: string | null, now: Date = new Date()): string => {
  if (iso === null || Number.isNaN(new Date(iso).getTime())) return ''
  const at = new Date(iso)
  const soon = at.getTime() - now.getTime() < 6 * 24 * 60 * 60 * 1000
  return at.toLocaleDateString(undefined, soon ? { weekday: 'long' } : { day: 'numeric', month: 'long' })
}

export interface ModelMoveProps {
  /** The model it moved from, and to, as people know them: Opus 5.5, Sonnet 5.5. */
  from: string
  to: string
  /** The plan's own name, as the line says it: Claude. */
  plan: string
  /** The share of the plan used, 0 to 100. */
  percent: number
  /** The window it is used over: the week. */
  window: string
  /** When it resets, as an ISO time; null where the plan doesn't say. */
  resetsAt: string | null
  /** The person kept the heavier model for this task. */
  kept: boolean
  onKeep?: () => void
  onUndo?: () => void
  busy?: boolean
  text?: Partial<ModelMoveText>
}

/** Auto's line: the move, why, and the way back; or, kept, one line and Undo. */
export function ModelMove({ from, to, plan, percent, window, resetsAt, kept, onKeep, onUndo, busy = false, text }: ModelMoveProps) {
  const t = { ...modelMoveText, ...text }
  if (kept)
    return (
      <AltharLine>
        {t.back(from)}{' '}
        {onUndo !== undefined && (
          <LinkButton disabled={busy} onClick={onUndo}>
            {t.undo}
          </LinkButton>
        )}
      </AltharLine>
    )
  return (
    <AltharLine>
      {t.moved(to, percent, plan, window, resetDay(resetsAt))}{' '}
      {onKeep !== undefined && (
        <LinkButton disabled={busy} onClick={onKeep}>
          {t.keep(from)}
        </LinkButton>
      )}
    </AltharLine>
  )
}
