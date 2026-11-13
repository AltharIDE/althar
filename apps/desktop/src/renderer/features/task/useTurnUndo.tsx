import { UndoTurnDialog } from '@althar/ui'
import { useState, type ReactNode } from 'react'

import { messageOf } from '../../data/client'
import type { Attachments } from '../../shared/useAttachments'
import type { TaskModel } from './useTask'

export const turnUndoText = { restored: 'Files and conversation restored.' }

/** Host wiring: keep drafts and attachments, show a refusal in the question, and leave the new agent idle. */
export function useTurnUndo(
  model: TaskModel,
  attachments: Attachments,
  restoreDraft: (prompt: string) => void,
  returnFocus: () => HTMLElement | null,
): {
  ask: (itemId: string) => void
  dialog: ReactNode
  notice: ReactNode
  dismiss: () => void
} {
  const [selected, select] = useState<{ id: string; prompt: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restored, setRestored] = useState(false)
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
      setError('Make room in the draft for the messages’ attachments, then try again.')
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
      setError(messageOf(failure))
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
      select({ id: itemId, prompt: item.content.text })
    },
    dialog:
      selected === null ? null : (
        <UndoTurnDialog
          prompt={selected.prompt}
          busy={busy}
          error={error}
          returnFocus={returnFocus}
          onUndo={() => void undo()}
          onClose={() => select(null)}
        />
      ),
    notice: restored ? <span role="status">{turnUndoText.restored}</span> : null,
    dismiss: () => setRestored(false),
  }
}
