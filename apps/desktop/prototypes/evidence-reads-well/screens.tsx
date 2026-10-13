import { useEffect } from 'react'

import { TaskView } from '../../src/renderer/features/task/TaskView'
import { type Direction, DirectionContext, ScenarioContext } from './direction'
import { scenarioOf } from './scenario'
import { modelOf, Services } from './stage'

/*
 * One window, as the query says: which direction (today for the app as it
 * is), which task, and which face: the thread, where evidence sits under
 * the step's report, or Outputs. The app's own task view, unchanged.
 */

export function Screen({ query }: { query: URLSearchParams }) {
  const direction = (query.get('d') ?? 'today') as Direction
  const scenario = scenarioOf(query.get('s') ?? 'ui')
  const face = query.get('f') ?? 'thread'
  // A ready task opens on its outputs, as in the app; c switches to the conversation.
  useEffect(() => {
    if (face === 'thread') setTimeout(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' })), 50)
  }, [face])
  return (
    <Services>
      <DirectionContext value={direction}>
        <ScenarioContext value={scenario}>
          <TaskView model={modelOf(scenario)} onBack={() => {}} />
        </ScenarioContext>
      </DirectionContext>
    </Services>
  )
}
