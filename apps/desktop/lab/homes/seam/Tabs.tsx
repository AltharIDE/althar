import { ProjectTabs as Real, type ProjectTabsProps } from '@althar/ui'

import { PARTS } from '../directions'
import { useLab } from '../state'

/** The window's tabs: the direction's, where it changes them. */
export function ProjectTabs(props: ProjectTabsProps) {
  const { d } = useLab()
  const { Tabs } = PARTS[d]
  return Tabs === undefined ? <Real {...props} /> : <Tabs {...props} Real={Real} />
}
