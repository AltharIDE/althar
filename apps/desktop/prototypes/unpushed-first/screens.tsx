import { useEffect } from 'react'

import { TaskView } from '../../src/renderer/features/task/TaskView'
import type { PushStage } from './scenario'
import { modelAt, Services } from './stage'

/*
 * One window, as the query says: which direction (today for the app as it
 * is), at which stage, on which face of the task.
 */

export function Screen({ query }: { query: URLSearchParams }) {
  const direction = query.get('d') ?? 'today'
  const stage = (query.get('s') ?? 'ahead') as PushStage
  const face = query.get('f') ?? 'out'
  // The task opens on its outputs when it is ready; c switches to the conversation, as in the app.
  useEffect(() => {
    if (face === 'talk') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' }))
  }, [face])
  return (
    <Services>
      {direction === 'today' ? <TaskView model={modelAt(stage)} onBack={() => {}} /> : <p>Unknown direction {direction}</p>}
    </Services>
  )
}
