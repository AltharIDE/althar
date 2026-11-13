import { useState } from 'react'

import { ModelMove, Problem } from '@althar/ui'

import { messageOf } from '../../data/client'
import { useServices } from '../../data/services'
import type { NameModel } from '../../shared/modelNames'
import type { ModelMoveContent } from '../../shared/thread'
import s from './FastLaneOf.module.css'

/*
 * Auto's line on moving a task's lead to a lighter model (README section 7):
 * Keep turns it back for this task, and Undo puts the move again. What couldn't
 * be done is said under it, in a line.
 */

export function ModelMoveOf({ move, itemId, named }: { move: ModelMoveContent; itemId: string; named: NameModel }) {
  const { client } = useServices()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const act = (work: () => Promise<void>) => {
    setError(null)
    setBusy(true)
    work().then(
      () => setBusy(false),
      (failure: unknown) => {
        setBusy(false)
        setError(messageOf(failure))
      },
    )
  }
  return (
    <>
      <ModelMove
        from={named(move.from.agentId, move.from.model).name}
        to={named(move.to.agentId, move.to.model).name}
        plan={move.why.plan}
        percent={move.why.percent}
        window={move.why.window}
        resetsAt={move.why.resetsAt}
        kept={move.kept}
        busy={busy}
        onKeep={() => act(() => client.keepTheModel(itemId))}
        onUndo={() => act(() => client.undoTheModelMove(itemId))}
      />
      {error !== null && <Problem className={s.failure}>That didn’t go through. {error}</Problem>}
    </>
  )
}
