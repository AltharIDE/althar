// Scrappy: the project's settings as its front page sees them here: the real ones in Today, else the direction's way in.
import { useEffect } from 'react'

import {
  ProjectSettings as Real,
  type ProjectSettingsProps,
} from '../../../../../apps/desktop/src/renderer/features/project/ProjectSettings'
import { ProjectButton } from '../calm'
import { G } from '../directions/G'
import { H } from '../directions/H'
import { IButton } from '../directions/I'
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

const opening = () => proto.set({ showing: 'open' })
const closing = () => proto.set({ showing: 'closed' })

export function ProjectSettings(props: ProjectSettingsProps) {
  const p = useProto()
  const things = useThings()
  switch (p.direction) {
    case 'Today':
      return <Today {...props} />
    case 'F':
      return <ProjectButton onClick={opening} />
    case 'G':
      return (
        <>
          <ProjectButton onClick={opening} />
          {p.showing !== 'closed' && <G key={p.showing} things={things} onClose={closing} />}
        </>
      )
    case 'H':
      return <H key={p.showing} things={things} />
    case 'I':
      return <IButton />
    default:
      // J: the bar's one gear.
      return null
  }
}
