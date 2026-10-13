import { useEffect, useState } from 'react'

import { TaskView as TaskToday } from '../../src/renderer/features/task/TaskView'
import { type Direction, DirectionContext } from './direction'
import type { PushStage } from './scenario'
import { modelAt, Services } from './stage'
import { Surfaces } from './Surfaces'
import { TaskView } from './TaskView'

/*
 * One window, as the query says: which direction (today for the app as it
 * is), at which stage, on which face. With `live`, Push does what it would:
 * pushing for a moment, then pushed, the count gone at once; Reset from the
 * page starts over.
 */

/** The face each direction is mostly about, where the query doesn't say. */
const faceOf: Record<Direction, string> = { today: 'out', a: 'out', b: 'talk', c: 'board', d: 'out', e: 'talk' }

export function Screen({ query }: { query: URLSearchParams }) {
  const direction = (query.get('d') ?? 'today') as Direction
  const face = query.get('f') ?? faceOf[direction]
  const live = query.has('live')
  const [stage, setStage] = useState<PushStage>((query.get('s') ?? 'ahead') as PushStage)
  const push = async () => {
    if (!live || stage !== 'ahead') return
    setStage('pushing')
    await new Promise((done) => setTimeout(done, 1400))
    setStage('pushed')
  }
  // The task opens on its outputs when it is ready; c switches to the conversation, as in the app.
  useEffect(() => {
    if (face === 'talk') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' }))
  }, [face])
  const model = modelAt(stage, { push })
  return (
    <Services>
      <DirectionContext value={direction}>
        {face === 'board' ? (
          <Surfaces stage={stage} onPush={() => void push()} />
        ) : direction === 'today' ? (
          <TaskToday model={model} onBack={() => {}} />
        ) : (
          <TaskView model={model} onBack={() => {}} />
        )}
      </DirectionContext>
    </Services>
  )
}
