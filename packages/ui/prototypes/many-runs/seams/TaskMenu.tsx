// Scrappy: a task's menu, without its Run item: the direction's runnables sit before it in the task's bar.
import { TaskMenu as RealTaskMenu, type TaskMenuProps } from '../../../src/chrome/TaskMenu/TaskMenu'
import { CONTROLS } from '../directions'
import { ScreenContext, TASK, useProto } from '../state'

const ON_TASK = { place: 'task', task: TASK } as const

export function TaskMenu(props: TaskMenuProps) {
  const { direction } = useProto()
  if (direction === 'Today') return <RealTaskMenu {...props} />
  const { run: _today, ...rest } = props
  const Control = CONTROLS[direction]
  return (
    <ScreenContext.Provider value={ON_TASK}>
      <Control />
      <RealTaskMenu {...rest} />
    </ScreenContext.Provider>
  )
}
