// Scrappy: a task's thread as TaskView draws it, then the direction's sign of life where the lead's reply will start.
import { TaskThread as Drawn, type TaskThreadProps } from '../../../src/renderer/features/task/TaskThread'
import { SignOfLife } from '../life/Life'
import { useProto } from '../store'
import { adjust } from './adjust'

export * from '../../../src/renderer/features/task/TaskThread'

export function TaskThread(props: TaskThreadProps) {
  const st = useProto()
  return (
    <>
      <Drawn {...props} rounds={adjust(props.rounds, st, 'task')} />
      <SignOfLife screen="task" />
    </>
  )
}
