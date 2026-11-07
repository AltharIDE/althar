// Scrappy: the project's notes as built; in C, forgetting the conversation at their foot, set apart in the danger colour.
import { type ComponentProps, useState } from 'react'

import { NotesSection as RealNotesSection } from '../../../../../apps/desktop/src/renderer/features/projectSettings/NotesSection'
import { ago } from '../../../../../apps/desktop/src/renderer/shared/time'
import { Button } from '../../../src/primitives/Button/Button'
import { SettingGroup, SettingList, SettingRow } from '../../../src/setup/Preferences/Preferences'
import { ForgetDialog } from '../directions/Forget'
import { useProto } from '../state'

export * from '../../../../../apps/desktop/src/renderer/features/projectSettings/NotesSection'

export const forgetText = {
  part: 'Conversation',
  title: 'Forget everything',
  note: 'The coordinator forgets this conversation and what it learned from it. Tasks and errands stay.',
  forgotten: (when: string) => `Forgotten ${when}.`,
  button: 'Forget…',
}
const t = forgetText

export function NotesSection(props: ComponentProps<typeof RealNotesSection>) {
  const p = useProto()
  const [asking, setAsking] = useState(false)
  if (p.direction !== 'C') return <RealNotesSection {...props} />
  const talk = p.talks.C
  const done = talk.wiped && !talk.saidSince && talk.forgotten !== null
  return (
    <>
      <RealNotesSection {...props} />
      <SettingGroup title={t.part} headingLevel={3}>
        <SettingList>
          <SettingRow title={t.title} note={done ? t.forgotten(ago(talk.forgotten!)) : t.note}>
            {() => (
              <Button variant="danger" size="small" disabled={done} onClick={() => setAsking(true)}>
                {t.button}
              </Button>
            )}
          </SettingRow>
        </SettingList>
      </SettingGroup>
      {asking && <ForgetDialog onClose={() => setAsking(false)} />}
    </>
  )
}
