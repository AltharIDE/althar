import { Button } from '../../primitives/Button/Button'
import { Dialog } from '../../primitives/Dialog/Dialog'
import s from './UndoTurnDialog.module.css'

export interface UndoTurnText {
  title: string
  description: string
  safety: string
  history: string
  cancel: string
  undo: string
}
export const undoTurnText: UndoTurnText = {
  title: 'Undo from here?',
  description: 'This message and everything after it leave the conversation. Files return to their state before this turn.',
  safety: 'Later edits to the same files stop undo, so you can keep or move them first. Other files stay as they are.',
  history: 'Existing commits stay in history; restored files appear as local changes. Actions outside these files stay as they are.',
  cancel: 'Cancel',
  undo: 'Undo files and conversation',
}

export interface UndoTurnDialogProps {
  prompt: string
  busy?: boolean
  error?: string | null
  onUndo: () => void
  onClose: () => void
  returnFocus?: () => HTMLElement | null
  text?: Partial<UndoTurnText>
}

/** One explicit choice, with the original prompt and any refusal kept in place. */
export function UndoTurnDialog({ prompt, busy = false, error, onUndo, onClose, returnFocus, text }: UndoTurnDialogProps) {
  const t = { ...undoTurnText, ...text }
  return (
    <Dialog
      title={t.title}
      description={t.description}
      width={520}
      holding={busy}
      onClose={() => {
        if (!busy) onClose()
      }}
      {...(returnFocus === undefined ? {} : { returnFocus })}
      actions={
        <>
          <Button variant="quiet" disabled={busy} onClick={onClose}>
            {t.cancel}
          </Button>
          <Button variant="danger" busy={busy} onClick={onUndo}>
            {t.undo}
          </Button>
        </>
      }
    >
      <blockquote className={s.prompt}>{prompt}</blockquote>
      <p className={s.note}>{t.safety}</p>
      <p className={s.note}>{t.history}</p>
      {error != null && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </Dialog>
  )
}
