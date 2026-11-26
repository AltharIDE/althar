import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Button } from '../../primitives/Button/Button'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import b from '../Board/Board.module.css'
import { CardTitle } from '../Board/CardTitle'
import s from './FoldedRow.module.css'

/*
 * A task stopped because its work went on in another: settled in all but
 * name, so one quiet row rather than a card waiting on the person. Its title,
 * when it stopped, and the task its work went on in, which opens that task.
 * Resume, quiet at its end, shows as the row is hovered or has the focus:
 * there if the person wants it back, never the loudest thing on it.
 */

export interface FoldedRowText {
  folded: string
  resume: string
}

export const foldedRowText: FoldedRowText = {
  folded: 'Folded into',
  resume: 'Resume',
}

export type FoldedRowProps = RootProps<
  'article',
  {
    title: string
    /** The task its work went on in, by its title. */
    into: string
    /** Opens that task: its title is then a link, apart from the row's own press. */
    onOpenInto?: () => void
    /** When it stopped: 5m ago. */
    at?: string
    current?: boolean
    onOpen?: () => void
    /** Carries it on; absent where it can't be from here. */
    onResume?: () => void
    /** Resume under way. */
    resuming?: boolean
    text?: Partial<FoldedRowText>
  }
>

/** One row of a task whose work went on in another. Put it in a BoardList. */
export function FoldedRow({
  title,
  into,
  onOpenInto,
  at,
  current,
  onOpen,
  onResume,
  resuming = false,
  text,
  className,
  ...rest
}: FoldedRowProps) {
  const t = { ...foldedRowText, ...text }
  return (
    <article className={cx(b.row, s.row, className)} aria-current={current || undefined} {...rest}>
      <CardTitle className={s.title} onOpen={onOpen}>
        {title}
      </CardTitle>
      {at !== undefined && at !== '' && <span className={s.at}>{at}</span>}
      <p className={s.into} title={`${t.folded} ${into}`}>
        <span className={s.lead}>{t.folded} </span>
        {onOpenInto === undefined ? (
          <span className={s.task}>{into}</span>
        ) : (
          <LinkButton className={s.task} onClick={onOpenInto}>
            {into}
          </LinkButton>
        )}
      </p>
      {onResume !== undefined && (
        <span className={cx(s.resume, resuming && s.busy)}>
          <Button variant="quiet" size="small" busy={resuming} onClick={onResume}>
            {t.resume}
          </Button>
        </span>
      )}
    </article>
  )
}
