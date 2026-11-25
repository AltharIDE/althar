import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { IconButton } from '../../primitives/IconButton/IconButton'
import s from './Canvas.module.css'

/*
 * A canvas beside a conversation (ADR-104): what it is, floating on it, as a
 * design tool's controls do, never in the conversation's own header. Its
 * name opens the artifact itself, where it is saved, downloaded and its
 * versions stepped through; then, where it takes them, a comment on the
 * whole of it; and its close. A canvas of boards and a page draw it in their
 * own view, beside their other controls; the window draws it over the rest.
 */

export const canvasChipText = {
  open: (title: string) => `Open ${title}`,
  comment: 'Comment',
  close: 'Close',
}

export interface CanvasChipProps {
  title: string
  /** Opens the artifact itself. */
  onOpen?: () => void
  onClose: () => void
  /** A comment on the whole of it, where it takes one here: pressed while one is being written. */
  comment?: { readonly pressed: boolean; readonly onPress: () => void }
  /** Inside a cluster of controls that floats already, rather than floating on its own. */
  bare?: boolean
  className?: string
  text?: Partial<typeof canvasChipText>
}

export function CanvasChip({ title, onOpen, onClose, comment, bare = false, className, text }: CanvasChipProps) {
  const t = { ...canvasChipText, ...text }
  return (
    <span className={cx(bare ? s.chipBare : s.chip, className)}>
      {onOpen === undefined ? (
        <span className={s.chipName} title={title}>
          <Icon name="canvas" size={14} />
          <span className={s.chipWords}>{title}</span>
        </span>
      ) : (
        <button type="button" className={s.chipName} aria-label={t.open(title)} title={t.open(title)} onClick={onOpen}>
          <Icon name="canvas" size={14} />
          <span className={s.chipWords}>{title}</span>
          <Icon name="expand" size={12} />
        </button>
      )}
      {comment !== undefined && (
        <IconButton
          icon="comment"
          label={t.comment}
          tooltip="below"
          size="small"
          aria-pressed={comment.pressed}
          onClick={comment.onPress}
        />
      )}
      <IconButton icon="close" label={t.close} tooltip="below" tooltipAlign="end" size="small" onClick={onClose} />
    </span>
  )
}
