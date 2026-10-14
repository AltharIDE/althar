// Scrappy, D: the panel stays, wider: the two switches on top, then a tab for each section across it, one at a time.
import { useState } from 'react'

import { ControlCenter, IconButton, Segmented } from '../../index'
import { SectionPanel } from './frame'
import { useModels } from './models'
import { QuickToggles, SECTIONS, type SectionId } from './sections'

import { type SettingsPanelProps, text } from '../../../../../apps/desktop/src/renderer/features/settings/SettingsPanel'

export function DirectionD({ start, open, onOpenChange, glance }: SettingsPanelProps) {
  const m = useModels(start, open, glance)
  const [tab, setTab] = useState<SectionId>('agents')
  return (
    <ControlCenter
      trigger={<IconButton icon="gear" label={text.title} kbd={text.kbd} size="small" />}
      open={open}
      onOpenChange={onOpenChange}
      width={tab === 'hosts' || tab === 'agents' ? 860 : 760}
      holding={m.accounts.signingIn !== null}
      text={{ label: text.title }}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <div style={{ width: 'calc(50% + 5px)' }}>
          <QuickToggles m={m} onOpen={setTab} />
        </div>
        <div style={{ display: 'flex' }}>
          <Segmented
            label="Settings"
            value={tab}
            onChange={setTab}
            options={SECTIONS.map((section) => ({ value: section.id, label: section.short }))}
          />
        </div>
        <SectionPanel key={tab} id={tab} m={m} headingLevel={3} />
      </div>
    </ControlCenter>
  )
}
