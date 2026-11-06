// Scrappy: the project's notes as built; in B, forgetting the conversation at their foot, set apart in the danger colour.
import { type ComponentProps, useState } from 'react'

import { NotesSection as RealNotesSection } from '../../../../../apps/desktop/src/renderer/features/projectSettings/NotesSection'
import { ago } from '../../../../../apps/desktop/src/renderer/shared/time'
import { Button } from '../../../src/primitives/Button/Button'
import { Dialog } from '../../../src/primitives/Dialog/Dialog'
import { SettingGroup, SettingList, SettingRow } from '../../../src/setup/Preferences/Preferences'
import { proto, useProto } from '../state'

export * from '../../../../../apps/desktop/src/renderer/features/projectSettings/NotesSection'

export const forgetText = {
  part: 'Conversation',
  title: 'Forget the conversation',
  note: 'The coordinator starts fresh, with these notes. Tasks and cards waiting on you stay.',
  forgotten: (when: string) => `Forgotten ${when}. The coordinator starts fresh when you next write to it.`,
  button: 'Forget…',
  ask: 'Forget the conversation?',
  askAbout: 'The coordinator won’t remember any of it, and it can’t be read again.',
  cancel: 'Cancel',
  forget: 'Forget conversation',
}
const t = forgetText

export function NotesSection(props: ComponentProps<typeof RealNotesSection>) {
  const p = useProto()
  const [asking, setAsking] = useState(false)
  if (p.direction !== 'B') return <RealNotesSection {...props} />
  const talk = p.talks.B
  const said = talk.items.some((item) => item.kind === 'user_message')
  return (
    <>
      <RealNotesSection {...props} />
      <SettingGroup title={t.part} headingLevel={3}>
        <SettingList>
          <SettingRow title={t.title} note={talk.forgotten !== null && !said ? t.forgotten(ago(talk.forgotten)) : t.note}>
            {() => (
              <Button variant="danger" size="small" disabled={!said} onClick={() => setAsking(true)}>
                {t.button}
              </Button>
            )}
          </SettingRow>
        </SettingList>
      </SettingGroup>
      {asking && (
        <Dialog
          title={t.ask}
          description={t.askAbout}
          onClose={() => setAsking(false)}
          actions={
            <>
              <Button variant="quiet" onClick={() => setAsking(false)}>
                {t.cancel}
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  setAsking(false)
                  proto.forget(false)
                }}
              >
                {t.forget}
              </Button>
            </>
          }
        />
      )}
    </>
  )
}
