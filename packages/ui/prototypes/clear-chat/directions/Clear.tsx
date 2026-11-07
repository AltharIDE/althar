// Scrappy: the one clear, wherever it is put: a question with both kinds, the wipe the destructive one.
import { useState } from 'react'

import { contextRingText } from '../../../src/composer/ContextRing/ContextRing'
import { ActionButton } from '../../../src/primitives/ActionButton/ActionButton'
import { Button } from '../../../src/primitives/Button/Button'
import { Choices } from '../../../src/primitives/Choices/Choices'
import { Dialog } from '../../../src/primitives/Dialog/Dialog'
import { LinkButton } from '../../../src/primitives/LinkButton/LinkButton'
import { canClearView, hasConversation, proto, type Talk, useProto } from '../state'
import s from './directions.module.css'

export type ClearKind = 'view' | 'forget'

export const clearText = {
  /** The control, in the composer and the thread's head. */
  trigger: 'Clear',
  /** The control in the context ring, where it follows the numbers. */
  ringTrigger: 'Clear chat…',
  title: 'Clear the conversation',
  aboutView: 'The thread starts empty. The coordinator keeps what it knows.',
  aboutForget: 'The coordinator forgets this conversation. Its notes, tasks and errands stay.',
  view: 'Keep what the coordinator knows',
  viewNote: 'The earlier conversation stays here, a press away.',
  viewClear: 'The view is already clear.',
  forget: 'Forget it too',
  forgetNote: 'Can’t be undone.',
  cancel: 'Cancel',
  viewAction: 'Clear the view',
  forgetAction: 'Clear and forget',
}
const t = clearText

/** The question both kinds are asked in: the light clear chosen, the wipe one press away and red. Opened from the ring it starts on the wipe. */
export function ClearDialog({ talk, startOn = 'view', onClose }: { talk: Talk; startOn?: ClearKind; onClose: () => void }) {
  const view = canClearView(talk)
  const [kind, setKind] = useState<ClearKind>(view ? startOn : 'forget')
  const forget = kind === 'forget'
  return (
    <Dialog
      title={t.title}
      description={forget ? t.aboutForget : t.aboutView}
      onClose={onClose}
      width={460}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button
            variant={forget ? 'danger' : 'default'}
            onClick={() => {
              onClose()
              if (forget) proto.forget()
              else proto.clearView()
            }}
          >
            {forget ? t.forgetAction : t.viewAction}
          </Button>
        </>
      }
    >
      <Choices<ClearKind>
        label="What goes"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'view', title: t.view, note: view ? t.viewNote : t.viewClear, disabled: !view },
          { value: 'forget', title: t.forget, note: t.forgetNote },
        ]}
      />
    </Dialog>
  )
}

/** A: the control in the composer's lower row, after the model; the dialog belongs to the composer's frame. */
export function ComposerClear({ onAsk }: { onAsk: () => void }) {
  const talk = useProto().talks.A
  return (
    <LinkButton className={s.composerClear} disabled={!hasConversation(talk)} onClick={onAsk}>
      {t.trigger}
    </LinkButton>
  )
}

/** C: the ring's foot, the session's two actions on one line: clear the chat, or compact it. */
export function RingActions({ onCompact, compacting }: { onCompact?: (() => void) | undefined; compacting?: boolean | undefined }) {
  const [asking, setAsking] = useState(false)
  const talk = useProto().talks.C
  return (
    <>
      <span className={s.ringFoot}>
        <ActionButton size="small" flush="start" disabled={!hasConversation(talk)} onClick={() => setAsking(true)}>
          {t.ringTrigger}
        </ActionButton>
        {onCompact !== undefined && (
          <ActionButton size="small" flush="end" onClick={onCompact} disabled={compacting === true}>
            {compacting === true ? contextRingText.compacting : contextRingText.compact}
          </ActionButton>
        )}
      </span>
      {asking && <ClearDialog talk={talk} startOn="forget" onClose={() => setAsking(false)} />}
    </>
  )
}
