// Scrappy: the project's settings as its front page sees them here: the real button and panel in Today; in A to D none, as Settings is a view in the bar.
import { useEffect } from 'react'

import {
  ProjectSettings as Real,
  type ProjectSettingsProps,
} from '../../../../../apps/desktop/src/renderer/features/project/ProjectSettings'
import { useProto } from '../state'

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
  return useProto().direction === 'Today' ? <Today {...props} /> : null
}
