// Scrappy: the one question before the conversation is forgotten, in every direction that offers it.
import { Button } from '../../../src/primitives/Button/Button'
import { Dialog } from '../../../src/primitives/Dialog/Dialog'
import { proto } from '../state'

export const forgetText = {
  title: 'Forget everything?',
  about: 'The coordinator forgets this conversation and what it learned from it. Its notes, tasks and errands stay.',
  cancel: 'Cancel',
  forget: 'Forget it',
}
const t = forgetText

export function ForgetDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      title={t.title}
      description={t.about}
      onClose={onClose}
      width={440}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              onClose()
              proto.forget()
            }}
          >
            {t.forget}
          </Button>
        </>
      }
    />
  )
}
