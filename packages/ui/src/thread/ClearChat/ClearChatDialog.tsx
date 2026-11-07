import { useState } from 'react'

import { Button } from '../../primitives/Button/Button'
import { Choices } from '../../primitives/Choices/Choices'
import { Dialog } from '../../primitives/Dialog/Dialog'

/** What clearing the chat takes: only the view, or the conversation the coordinator holds with it. */
export type ClearKind = 'view' | 'forget'

export interface ClearChatText {
  title: string
  /** What choosing to clear the view does, under the title. */
  aboutView: string
  /** What choosing to forget does. */
  aboutForget: string
  /** What is chosen. */
  choice: string
  view: string
  viewNote: string
  /** The view has nothing in it to clear. */
  viewClear: string
  forget: string
  forgetNote: string
  cancel: string
  clearView: string
  clearForget: string
}

export const clearChatText: ClearChatText = {
  title: 'Clear chat',
  aboutView: 'Only the view is cleared. The coordinator keeps the conversation.',
  aboutForget: 'The coordinator forgets this conversation. Its notes, tasks and errands stay.',
  choice: 'What goes',
  view: 'Clear only the view',
  viewNote: 'The conversation stays here, a press away.',
  viewClear: 'The view is already clear.',
  forget: 'Forget the conversation too',
  forgetNote: 'Can’t be undone.',
  cancel: 'Cancel',
  clearView: 'Clear the view',
  clearForget: 'Clear and forget',
}

export interface ClearChatDialogProps {
  /** The kind it opens on: the view, or, from the session's own controls, the conversation, so it reads as the warning it is. */
  startOn?: ClearKind
  /** The view has something in it to clear; without, only forgetting can be chosen. */
  clearable: boolean
  /** The person chose a kind and pressed its button. The dialog closes after. */
  onClear: (kind: ClearKind) => void
  /** Escape, a click outside, or Cancel. */
  onClose: () => void
  /** Where focus goes on closing when the control that opened it is gone by then, as the context ring's is. */
  returnFocus?: () => HTMLElement | null
  text?: Partial<ClearChatText>
}

/**
 * The question both ways of clearing the coordinator's chat are asked in. The
 * kind to forget is red, and nothing in it is the default: it is chosen with
 * the choices and done with its own button, so it can't happen in passing.
 */
export function ClearChatDialog({ startOn = 'view', clearable, onClear, onClose, returnFocus, text }: ClearChatDialogProps) {
  const t = { ...clearChatText, ...text }
  const [chosen, setChosen] = useState<ClearKind>(clearable ? startOn : 'forget')
  const forget = chosen === 'forget'
  return (
    <Dialog
      title={t.title}
      description={forget ? t.aboutForget : t.aboutView}
      onClose={onClose}
      {...(returnFocus === undefined ? {} : { returnFocus })}
      width={460}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button
            variant={forget ? 'danger' : 'default'}
            onClick={() => {
              onClear(chosen)
              onClose()
            }}
          >
            {forget ? t.clearForget : t.clearView}
          </Button>
        </>
      }
    >
      <Choices<ClearKind>
        label={t.choice}
        value={chosen}
        onChange={setChosen}
        options={[
          { value: 'view', title: t.view, note: clearable ? t.viewNote : t.viewClear, disabled: !clearable },
          { value: 'forget', title: t.forget, note: t.forgetNote },
        ]}
      />
    </Dialog>
  )
}
