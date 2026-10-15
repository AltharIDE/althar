// Scrappy: a task's menu, with the direction's runnables before it in the task's bar.
import { TaskMenu as RealTaskMenu, type TaskMenuProps } from '../../../src/chrome/TaskMenu/TaskMenu'
import { CONTROLS } from '../directions'
import { ScreenContext, TASK, useProto } from '../state'

const ON_TASK = { place: 'task', task: TASK } as const

export function TaskMenu(props: TaskMenuProps) {
  const { direction } = useProto()
  if (direction === 'Today') return <RealTaskMenu {...props} />
  const Control = CONTROLS[direction]
  return (
    <ScreenContext.Provider value={ON_TASK}>
      <Control />
      <RealTaskMenu {...props} />
    </ScreenContext.Provider>
  )
}
