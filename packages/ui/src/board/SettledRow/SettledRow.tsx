import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { Outcome, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Button } from '../../primitives/Button/Button'
import b from '../Board/Board.module.css'
import { CardTitle } from '../Board/CardTitle'
import s from './SettledRow.module.css'

/*
 * Settled work is a ledger, not a pile of cards: what each piece of work
 * came to, and when. Merged is green, as merges are; the rest is ink, and
 * what was abandoned is quieter. What it left to put right, such as a pull
 * request still open on its host, is one quiet button under it, above the
 * row's own; what went wrong pressing it is said under that.
 */

const glyph = (outcome: Outcome): IconName => {
  switch (outcome) {
    case Outcome.Merged:
    case Outcome.Done:
      return 'check'
    case Outcome.Answered:
      return 'answer'
    case Outcome.Artifact:
      return 'artifact'
    case Outcome.Knowledge:
      return 'knowledge'
    case Outcome.Abandoned:
      return 'stop'
    default:
      return unreachable(outcome)
  }
}

export interface SettledRowText {
  outcome: Record<Outcome, string>
  task: (task: string) => string
}

export const settledRowText: SettledRowText = {
  outcome: {
    [Outcome.Merged]: 'Merged',
    [Outcome.Done]: 'Done',
    [Outcome.Answered]: 'Answered',
    [Outcome.Artifact]: 'Artifact',
    [Outcome.Knowledge]: 'Knowledge',
    [Outcome.Abandoned]: 'Abandoned',
  },
  task: (task) => `Task ${task}`,
}

export type SettledRowProps = RootProps<
  'article',
  {
    outcome: Outcome
    task: string
    kind?: string
    title: string
    /** What it left, in a line: PR 1184 · 2 review cycles. */
    meta?: string
    /** When it settled. */
    at: string
    current?: boolean
    onOpen?: () => void
    /** What it left to put right, as one button: Close PR #145. */
    action?: { readonly label: string; readonly onAction: () => void; readonly busy?: boolean }
    /** What went wrong doing it, in words. */
    error?: string
    text?: Partial<SettledRowText>
  }
>

/** One row of the settled ledger. Put it in a BoardList. */
export function SettledRow({
  outcome,
  task,
  kind,
  title,
  meta,
  at,
  current,
  onOpen,
  action,
  error,
  text,
  className,
  ...rest
}: SettledRowProps) {
  const t = { ...settledRowText, ...text }
  return (
    <article className={cx(b.row, s[outcome], className)} aria-current={current || undefined} {...rest}>
      <div className={b.top}>
        <span className={s.outcome}>
          <Icon name={glyph(outcome)} size={11} />
          {t.outcome[outcome]}
        </span>
        <span className={b.ref}>{t.task(task)}</span>
        <span className={b.at}>{at}</span>
      </div>
      <CardTitle className={s.title} onOpen={onOpen}>
        {title}
      </CardTitle>
      {(kind || meta) && (
        <p className={s.meta}>
          {kind && <span className={s.kind}>{kind}</span>}
          {meta}
        </p>
      )}
      {action && (
        <div className={s.action}>
          <Button variant="quiet" size="small" busy={action.busy ?? false} onClick={action.onAction}>
            {action.label}
          </Button>
        </div>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </article>
  )
}
