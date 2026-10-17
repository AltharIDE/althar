// Scrappy: the project's front page, with the direction's runnables where its one Run button was.
import { ProjectFront as RealProjectFront, type ProjectFrontProps } from '../../../src/chrome/ProjectFront/ProjectFront'
import { CONTROLS } from '../directions'
import { ScreenContext, useProto } from '../state'

const PROJECT = { place: 'main', task: null } as const

export function ProjectFront(props: ProjectFrontProps) {
  const { direction } = useProto()
  if (direction === 'Today') return <RealProjectFront {...props} />
  const { run: _today, settings, ...rest } = props
  const Control = CONTROLS[direction]
  return (
    <ScreenContext.Provider value={PROJECT}>
      <RealProjectFront
        {...rest}
        settings={
          <>
            <Control />
            {settings}
          </>
        }
      />
    </ScreenContext.Provider>
  )
}
