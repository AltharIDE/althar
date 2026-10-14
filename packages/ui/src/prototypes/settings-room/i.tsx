// Scrappy, I: the person chooses what the quick panel holds, from the panel itself; All settings is a page.
import { useState } from 'react'

import { CheckList, ControlCenter, ControlDetail, ControlSheet, IconButton, LinkButton, SettingList } from '../../index'
import { useModels } from './models'
import { AtOnceSheet, Glances, QuickFoot, type ToggleId, Toggles, usePage } from './quick'
import type { ProtoSettingsProps } from './seams/SettingsPanel'
import { ROWS } from './sections'

import s from '../../../../../apps/desktop/src/renderer/features/settings/Settings.module.css'
import { text } from '../../../../../apps/desktop/src/renderer/features/settings/SettingsPanel'

type QuickId = ToggleId | 'atOnce' | 'agents' | 'hosts' | 'sound' | 'editor'

/** What the panel may hold, in the order it holds them: switches first, then glances, then the rest. */
const CHOICES: ReadonlyArray<{ readonly id: QuickId; readonly label: string }> = [
  { id: 'keepAwake', label: 'Keep this Mac awake while work runs' },
  { id: 'notify', label: 'Notifications' },
  { id: 'postTeam', label: 'Post reviews of my team’s pull requests without asking' },
  { id: 'load', label: 'Show how hard this Mac works' },
  { id: 'coAuthor', label: 'Althar as co-author' },
  { id: 'agents', label: 'Agents and their accounts' },
  { id: 'hosts', label: 'Code hosts and trackers' },
  { id: 'atOnce', label: 'Agents at once' },
  { id: 'sound', label: 'Notification sound' },
  { id: 'editor', label: 'Open files in' },
]

const TOGGLES: ReadonlyArray<ToggleId> = ['keepAwake', 'notify', 'postTeam', 'load', 'coAuthor']

export function DirectionI({ start, open, onOpenChange, glance, where }: ProtoSettingsProps) {
  const page = usePage(onOpenChange)
  const m = useModels(start, open || page.open, glance)
  const [pins, setPins] = useState<ReadonlyArray<string>>(['keepAwake', 'notify', 'agents', 'atOnce'])
  const [editing, setEditing] = useState(false)
  const has = (id: QuickId) => pins.includes(id)
  return (
    <>
      <ControlCenter
        trigger={<IconButton icon="gear" label={text.title} kbd={text.kbd} size="small" />}
        open={open}
        onOpenChange={(next) => {
          if (next) setEditing(false)
          onOpenChange(next)
        }}
        onEscapeKeyDown={(event) => {
          if (event.defaultPrevented || !editing) return
          event.preventDefault()
          setEditing(false)
        }}
        text={{ label: text.title }}
      >
        {editing ? (
          <ControlDetail title="Quick settings" onBack={() => setEditing(false)} text={{ back: 'Back to quick settings' }}>
            <ControlSheet>
              <p className={s.quiet}>What this panel shows. Everything is in All settings as well.</p>
              <CheckList label="Quick settings" items={CHOICES} value={pins} onChange={setPins} />
            </ControlSheet>
          </ControlDetail>
        ) : (
          <>
            <div style={{ display: 'grid', gap: 10 }}>
              <Toggles m={m} ids={TOGGLES.filter((id) => has(id))} onOpen={page.show} />
              {(has('agents') || has('hosts')) && <Glances m={m} onOpen={page.show} agents={has('agents')} hosts={has('hosts')} />}
              {has('atOnce') && <AtOnceSheet m={m} />}
              {(has('sound') || has('editor')) && (
                <ControlSheet>
                  <SettingList>
                    {has('sound') && ROWS.sound(m)}
                    {has('editor') && ROWS.editor(m)}
                  </SettingList>
                </ControlSheet>
              )}
            </div>
            <QuickFoot m={m} onAll={() => page.show('agents')}>
              <LinkButton onClick={() => setEditing(true)}>Edit</LinkButton>
            </QuickFoot>
          </>
        )}
      </ControlCenter>
      {page.draw(m, where)}
    </>
  )
}
