// Scrappy: Settings › Browser: where links from threads open, and how long pages' cookies are kept. Each task's pages have a
// session of their own; this is how long any of them keeps what sites set.
import { useState } from 'react'

import { Icon } from '../../../src/foundations/Icon/Icon'
import { Button } from '../../../src/primitives/Button/Button'
import { Segmented } from '../../../src/primitives/Segmented/Segmented'
import { Select } from '../../../src/primitives/Select/Select'
import { SettingList, SettingRow } from '../../../src/setup/Preferences/Preferences'
import { type Keep, KEEPS, proto, useProto } from '../state'
import { glyph } from './icons'

export function BrowserSettings() {
  const p = useProto()
  const [cleared, setCleared] = useState(false)
  return (
    <SettingList>
      <SettingRow
        title="Links from threads"
        note="A task’s run opens beside its conversation either way."
        glyph={<Icon name="globe" size={15} />}
      >
        {() => (
          <Segmented<'beside' | 'browser'>
            label="Links from threads"
            value={p.links}
            onChange={(links) => proto.set({ links })}
            options={[
              { value: 'beside', label: 'Beside the conversation' },
              { value: 'browser', label: 'In your browser' },
            ]}
          />
        )}
      </SettingRow>
      <SettingRow
        title="Keep cookies"
        note="Each task’s pages keep their own, apart from your browser’s and other tasks’."
        glyph={<Icon name={glyph('cookie')} size={15} />}
      >
        {() => (
          <Select<Keep> label="Keep cookies" width={230} options={KEEPS} value={p.cookies} onChange={(cookies) => proto.set({ cookies })} />
        )}
      </SettingRow>
      <SettingRow
        title="Cookies and storage"
        note={cleared ? 'None kept.' : 'Kept for 3 tasks and the project.'}
        glyph={<Icon name="remove" size={15} />}
      >
        {() => (
          <Button size="small" disabled={cleared} onClick={() => setCleared(true)}>
            Clear all
          </Button>
        )}
      </SettingRow>
    </SettingList>
  )
}
