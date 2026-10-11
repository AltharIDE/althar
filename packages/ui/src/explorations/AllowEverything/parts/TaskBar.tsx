import { useState, type ReactNode } from 'react'

import { BackCrumb } from '../../../chrome/BackCrumb/BackCrumb'
import { ChromeButton } from '../../../chrome/ChromeButton/ChromeButton'
import { TaskHeader } from '../../../chrome/TaskHeader/TaskHeader'
import { TitleBar } from '../../../chrome/TitleBar/TitleBar'
import { TASK } from '../fixtures'

/*
 * Task 418's bar, as the window has it: the way back and its title, then
 * its header. A path puts its mark first among the header's buttons, where
 * it is seen with where the task stands, and its menu last.
 */

type Face = 'talk' | 'out'
const FACES = [
  { value: 'talk' as const, label: 'Conversation', kbd: 'c' },
  { value: 'out' as const, label: 'Outputs', kbd: 'o' },
]

export function TaskBar({ mark, menu, onBack = () => {} }: { mark?: ReactNode; menu?: ReactNode; onBack?: () => void }) {
  const [face, setFace] = useState<Face>('talk')
  const [graph, setGraph] = useState(false)
  return (
    <TitleBar
      lights="none"
      end={
        <TaskHeader
          {...TASK}
          faces={FACES}
          face={face}
          onFace={setFace}
          actions={
            <>
              {mark}
              <ChromeButton icon="branch" label="Graph" kbd="g" expanded={graph} onClick={() => setGraph(!graph)} />
              {menu}
            </>
          }
        />
      }
    >
      <BackCrumb to="meridian" kbd="esc" title={TASK.title} titleLevel={1} onBack={onBack} />
    </TitleBar>
  )
}
