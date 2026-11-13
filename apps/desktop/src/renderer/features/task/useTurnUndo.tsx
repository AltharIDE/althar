import { ApiError } from '@althar/contracts'
import { UndoTurnDialog } from '@althar/ui'
import { Option, Schema } from 'effect'
import { useState, type ReactNode } from 'react'

import { messageOf } from '../../data/client'
import type { Attachments } from '../../shared/useAttachments'
import type { TaskModel } from './useTask'
import type { ChangesModel } from './useChanges'

export const turnUndoText = { restored: 'Files and conversation restored.' }
const fileNames = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.String)))
interface Refusal {
  readonly message: string
  readonly files: ReadonlyArray<string>
  readonly kind?: 'edited' | 'staged'
}

/** Host wiring: keep drafts and attachments, show a refusal in the question, and leave the new agent idle. */
export function useTurnUndo(
  model: TaskModel,
  attachments: Attachments,
  restoreDraft: (prompt: string) => void,
  returnFocus: () => HTMLElement | null,
  changes: Pick<ChangesModel, 'open' | 'show'>,
): {
  ask: (itemId: string) => void
  dialog: ReactNode
  notice: ReactNode
  dismiss: () => void
  reviewFiles: ReadonlyArray<string>
} {
  const [selected, select] = useState<{ id: string; prompt: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Refusal | null>(null)
  const [restored, setRestored] = useState(false)
  const [reviewFiles, setReviewFiles] = useState<ReadonlyArray<string>>([])
  const fits = (itemId: string) => {
    const items = model.snapshot?.items ?? []
    const target = items.find((item) => item.id === itemId)
    if (target === undefined) return false
    const messages = items.filter((item) => item.kind === 'user_message' && item.sequence >= target.sequence)
    return attachments.fits({
      pictures: messages.flatMap((item) => (item.kind === 'user_message' ? item.content.pictures : [])),
      files: messages.flatMap((item) => (item.kind === 'user_message' ? item.content.files : [])),
    })
  }
  const undo = async () => {
    if (selected === null || busy) return
    if (!fits(selected.id)) {
      setError({ message: 'Make room in the draft for the messages’ attachments, then try again.', files: [] })
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await model.undoTurn(selected.id)
      restoreDraft(result.prompt)
      attachments.restore({
        pictures: result.messages.flatMap((message) => message.pictures),
        files: result.messages.flatMap((message) => message.files),
      })
      select(null)
      setRestored(true)
    } catch (failure) {
      const refused = failure instanceof ApiError && failure.reason === 'UndoRefused' ? failure : null
      setError({
        message: messageOf(failure),
        files: Option.getOrElse(fileNames(refused?.detail), () => []),
        ...(refused?.why === 'edited' || refused?.why === 'staged' ? { kind: refused.why } : {}),
      })
    } finally {
      setBusy(false)
    }
  }
  return {
    ask: (itemId) => {
      const item = model.snapshot?.items.find((item) => item.id === itemId)
      if (item?.kind !== 'user_message') return
      if (!fits(itemId)) return
      setError(null)
      setReviewFiles([])
      select({ id: itemId, prompt: item.content.text })
    },
    dialog:
      selected === null || changes.open ? null : (
        <UndoTurnDialog
          prompt={selected.prompt}
          busy={busy}
          error={error?.message}
          errorFiles={error?.files}
          errorKind={error?.kind}
          {...(error !== null && error.files.length > 0
            ? {
                onReviewEdits: () => {
                  // Keep the selected turn and draft while its real diff opens. Returning allows a fresh preflight.
                  setError(null)
                  setReviewFiles(error.files)
                  changes.show(error.files[0])
                },
              }
            : {})}
          returnFocus={returnFocus}
          onUndo={() => void undo()}
          onClose={() => select(null)}
        />
      ),
    notice: restored ? <output>{turnUndoText.restored}</output> : null,
    dismiss: () => setRestored(false),
    reviewFiles: selected === null ? [] : reviewFiles,
  }
}
