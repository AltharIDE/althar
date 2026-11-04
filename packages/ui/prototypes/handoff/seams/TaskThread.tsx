// Scrappy: the thread, as each direction draws it; Today, as the app does.
import { TaskThread as Built, type TaskThreadProps } from '../../../../../apps/desktop/src/renderer/features/task/TaskThread'
import { ThreadA } from '../directions/A'
import { ThreadB } from '../directions/B'
import { ThreadC } from '../directions/C'
import { useProto } from '../state'

export type { TaskThreadProps }

export function TaskThread(props: TaskThreadProps) {
  const { direction } = useProto()
  switch (direction) {
    case 'A':
      return <ThreadA {...props} />
    case 'B':
      return <ThreadB {...props} />
    case 'C':
      return <ThreadC {...props} />
    default:
      return <Built {...props} />
  }
}
