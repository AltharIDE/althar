// Scrappy: the project's settings as its front page sees them here: the real ones in Today, else the direction's.
import { useEffect } from 'react'

import {
  ProjectSettings as Real,
  type ProjectSettingsProps,
} from '../../../../../apps/desktop/src/renderer/features/project/ProjectSettings'
import { A } from '../directions/A'
import { CButton } from '../directions/C'
import { DMore } from '../directions/D'
import { useThings } from '../parts'
import { proto, useProto } from '../state'

export { inkOf, text } from '../../../../../apps/desktop/src/renderer/features/project/ProjectSettings'

/** Today's panel, opened as the picker says: pressed open, and its Notes pressed. */
function Today(props: ProjectSettingsProps) {
  const p = useProto()
  useEffect(() => {
    if (p.showing === 'closed') return
    const press = (find: () => HTMLElement | undefined) => find()?.click()
    const buttons = () => [...document.querySelectorAll<HTMLElement>('header button')]
    press(() => buttons().find((one) => one.textContent?.trim() === 'Settings'))
    if (p.showing === 'notes')
      setTimeout(
        () =>
          press(() =>
            [...document.querySelectorAll<HTMLElement>('[role=dialog] button')].find((one) => one.textContent?.startsWith('Notes')),
          ),
        250,
      )
  }, [p.showing])
  return <Real {...props} />
}

export function ProjectSettings(props: ProjectSettingsProps) {
  const p = useProto()
  const things = useThings()
  switch (p.direction) {
    case 'Today':
      return <Today {...props} />
    case 'A':
      return <A key={p.showing} things={things} />
    case 'C':
      return <CButton open={p.showing !== 'closed'} onOpen={(open) => proto.set({ showing: open ? 'open' : 'closed' })} />
    case 'D':
      return <DMore key={p.showing} things={things} />
    default:
      // B: Settings is one of the project's views, in the bar. E: the gear at the bar's end.
      return null
  }
}
