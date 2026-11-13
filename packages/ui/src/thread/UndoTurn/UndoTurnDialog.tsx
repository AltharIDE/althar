import { useId, useState } from 'react'

import { Button } from '../../primitives/Button/Button'
import { Dialog } from '../../primitives/Dialog/Dialog'
import { Disclosure, DisclosureTrigger, Fold } from '../../primitives/Fold/Fold'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Problem } from '../../primitives/Problem/Problem'
import s from './UndoTurnDialog.module.css'

export interface UndoTurnText {
  title: string
  description: string
  draft: string
  whatStays: string
  stays: string
  showFull: string
  showLess: string
  reviewEdits: string
  newerEdits: string
  stagedEdits: string
  keepEdits: string
  unstage: string
  cancel: string
  undo: string
}
export const undoTurnText: UndoTurnText = {
  title: 'Undo from here?',
  description: 'Restore files and remove this message and later replies.',
  draft: 'The prompt returns to your draft.',
  whatStays: 'What stays',
  stays: 'Other edits, Git history, and actions outside these files. Restored files become local changes.',
  showFull: 'Show full message',
  showLess: 'Show less',
  reviewEdits: 'Review edits',
  newerEdits: 'Newer edits in',
  stagedEdits: 'Staged changes in',
  keepEdits: 'Keep or move them before undoing.',
  unstage: 'Unstage them before undoing.',
  cancel: 'Cancel',
  undo: 'Undo from here',
}

export interface UndoTurnDialogProps {
  prompt: string
  busy?: boolean
  error?: string | null
  /** Files named by the refusal, kept separate from its words so they can be read as code. */
  errorFiles?: ReadonlyArray<string>
  errorKind?: 'edited' | 'staged'
  /** Opens the affected file's changes; returning lets the host recheck undo. */
  onReviewEdits?: () => void
  onUndo: () => void
  onClose: () => void
  returnFocus?: () => HTMLElement | null
  text?: Partial<UndoTurnText>
}

/** One explicit choice, with the original prompt and any refusal kept in place. */
export function UndoTurnDialog({
  prompt,
  busy = false,
  error,
  errorFiles = [],
  errorKind,
  onReviewEdits,
  onUndo,
  onClose,
  returnFocus,
  text,
}: UndoTurnDialogProps) {
  const t = { ...undoTurnText, ...text }
  const [expanded, setExpanded] = useState(false)
  const promptId = useId()
  const long = prompt.length > 120 || prompt.split('\n').length > 3
  const blocked = error != null && onReviewEdits !== undefined
  const files = errorFiles.map((path, index) => (
    <span key={path}>
      {index > 0 && ', '}
      <code>{path}</code>
    </span>
  ))
  return (
    <Dialog
      title={t.title}
      description={t.description}
      width={460}
      className={s.confirm}
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
          <Button variant="danger" busy={busy} disabled={blocked} onClick={onUndo}>
            {t.undo}
          </Button>
        </>
      }
    >
      <div className={s.selected}>
        <div className={s.well}>
          <blockquote id={promptId} className={s.prompt} data-expanded={expanded || undefined} title={expanded ? undefined : prompt}>
            {prompt}
          </blockquote>
        </div>
        {long && (
          <LinkButton className={s.expand} aria-expanded={expanded} aria-controls={promptId} onClick={() => setExpanded(!expanded)}>
            {expanded ? t.showLess : t.showFull}
          </LinkButton>
        )}
      </div>
      {error != null && (
        <Problem
          banner
          as="div"
          action={
            onReviewEdits === undefined ? undefined : (
              <LinkButton disabled={busy} onClick={onReviewEdits}>
                {t.reviewEdits}
              </LinkButton>
            )
          }
        >
          {errorKind !== undefined && errorFiles.length > 0 ? (
            <>
              <span className={s.problemTitle}>
                {errorKind === 'edited' ? t.newerEdits : t.stagedEdits} {files}.
              </span>
              <span className={s.problemHelp}>{errorKind === 'edited' ? t.keepEdits : t.unstage}</span>
            </>
          ) : (
            <>
              <span className={s.problemTitle}>{error}</span>
              {errorFiles.length > 0 && <span className={s.problemHelp}>{files}</span>}
            </>
          )}
        </Problem>
      )}
      <div className={s.meta}>
        <span>{t.draft}</span>
        <Disclosure className={s.details}>
          <DisclosureTrigger>
            <LinkButton className={s.detailsTrigger}>{t.whatStays}</LinkButton>
          </DisclosureTrigger>
          <Fold>
            <p className={s.fine}>{t.stays}</p>
          </Fold>
        </Disclosure>
      </div>
    </Dialog>
  )
}
