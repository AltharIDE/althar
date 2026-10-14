// Scrappy: the app's settings, as this page's direction has them, on the home and (off today) every other screen; today's are the app's own, untouched.
import { useEffect } from 'react'

import { DirectionA } from '../a'
import { DirectionB } from '../b'
import { DirectionC } from '../c'
import { DirectionD } from '../d'
import { DirectionE } from '../e'
import { DirectionF } from '../f'
import { DirectionG } from '../g'
import { DirectionH } from '../h'
import { DirectionI } from '../i'
import { Direction3 } from '../round3'
import { useDirection } from '../state'
import { settingsTab } from '../tab'

import {
  SettingsPanel as Today,
  type SettingsPanelProps,
} from '../../../../../../apps/desktop/src/renderer/features/settings/SettingsPanel'

/** What a direction's settings are given: the app's own props, and the screen they open over, to go back to. */
export type ProtoSettingsProps = SettingsPanelProps & { where?: string }

export function SettingsPanel(props: ProtoSettingsProps) {
  const direction = useDirection()
  // The live page's address says whether the panel is open, whichever direction drew it.
  const { open } = props
  useEffect(() => settingsTab.set({ quick: open }), [open])
  switch (direction) {
    case 'today':
      return <Today {...props} />
    case 'A':
      return <DirectionA {...props} />
    case 'B':
      return <DirectionB {...props} />
    case 'C':
      return <DirectionC {...props} />
    case 'D':
      return <DirectionD {...props} />
    case 'E':
      return <DirectionE {...props} />
    case 'F':
      return <DirectionF {...props} />
    case 'G':
      return <DirectionG {...props} />
    case 'H':
      return <DirectionH {...props} />
    case 'I':
      return <DirectionI {...props} />
    case 'A3':
    case 'B3':
    case 'C3':
    case 'D3':
    case 'E3':
      return <Direction3 {...props} variant={direction} />
  }
}
