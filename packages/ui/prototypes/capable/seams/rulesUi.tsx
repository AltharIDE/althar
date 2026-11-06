// Scrappy: the kit as the project's Rules see it here: with everything going ahead, "Agents may" has nothing left to say.
import type { ComponentProps } from 'react'

import { SettingGroup as RealSettingGroup } from '../../../src/setup/Preferences/Preferences'
import { useProto } from '../state'

export * from '../../../src/index'

export function SettingGroup(props: ComponentProps<typeof RealSettingGroup>) {
  const p = useProto()
  if (p.surface === 'rules' && p.direction !== 'Today' && props.title === 'Agents may') return null
  return <RealSettingGroup {...props} />
}
