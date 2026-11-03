// Scrappy: the project's header, with the direction's runnables where its one Run button was.
import { ProjectHeader as RealProjectHeader, type ProjectHeaderProps } from '../../../src/chrome/ProjectHeader/ProjectHeader'
import { CONTROLS } from '../directions'
import { ScreenContext, useProto } from '../state'

const PROJECT = { place: 'main', task: null } as const

export function ProjectHeader(props: ProjectHeaderProps) {
  const { direction } = useProto()
  if (direction === 'Today') return <RealProjectHeader {...props} />
  const { run: _today, ...rest } = props
  const Control = CONTROLS[direction]
  return (
    <ScreenContext.Provider value={PROJECT}>
      <RealProjectHeader {...rest} run={<Control />} />
    </ScreenContext.Provider>
  )
}
