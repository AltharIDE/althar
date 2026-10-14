// Scrappy, G: today's panel, pruned to what matters: the two switches, the agents and code hosts at a glance, agents at once; All settings is a page.
import { ControlCenter, IconButton } from '../../index'
import { useModels } from './models'
import { AtOnceSheet, Glances, QuickFoot, Toggles, usePage } from './quick'
import type { ProtoSettingsProps } from './seams/SettingsPanel'

import { text } from '../../../../../apps/desktop/src/renderer/features/settings/SettingsPanel'

export function DirectionG({ start, open, onOpenChange, glance, where }: ProtoSettingsProps) {
  const page = usePage(onOpenChange)
  const m = useModels(start, open || page.open, glance)
  return (
    <>
      <ControlCenter
        trigger={<IconButton icon="gear" label={text.title} kbd={text.kbd} size="small" />}
        open={open}
        onOpenChange={onOpenChange}
        text={{ label: text.title }}
      >
        <div style={{ display: 'grid', gap: 10 }}>
          <Toggles m={m} ids={['keepAwake', 'notify']} onOpen={page.show} />
          <Glances m={m} onOpen={page.show} />
          <AtOnceSheet m={m} />
        </div>
        <QuickFoot m={m} onAll={() => page.show('agents')} />
      </ControlCenter>
      {page.draw(m, where)}
    </>
  )
}
