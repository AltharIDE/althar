import { useState } from 'react'

import type { AgentStatus } from '@althar/contracts'
import { MoveTaskDialog } from '@althar/ui'

import { ModelChoice } from '../../shared/ModelChoice'
import type { Choice, PickOn } from '../../shared/models'

/*
 * Moving a task where its lead's model isn't offered (ADR-103): the kit's dialog, with the window's picker kept to the
 * lead's own agent's models the place offers, which the lead starts on there.
 */

export interface MovePickProps {
  /** Where it moves, and the model it can't run there, by name. */
  readonly place: string
  readonly model: string
  /** The home's agents: the lead's own is the one offered. */
  readonly agents: ReadonlyArray<AgentStatus>
  /** The lead's agent, on the first model the place offers, where it said; none picked where it didn't. */
  readonly start: Choice
  /** The worker it moves to; none for the home, whose models the picker offers as they are. */
  readonly worker?: PickOn | undefined
  readonly projectId: string
  readonly onMove: (choice: Choice) => void
  readonly onClose: () => void
}

export function MovePick({ place, model, agents, start, worker, projectId, onMove, onClose }: MovePickProps) {
  const [pick, setPick] = useState<Choice>(start)
  return (
    <MoveTaskDialog
      place={place}
      model={model}
      canMove={pick.model !== null}
      onMove={() => onMove(pick)}
      onClose={onClose}
      picker={
        <ModelChoice
          owner="Lead"
          agents={agents.filter((agent) => agent.id === start.agentId)}
          value={pick}
          onChange={setPick}
          projectId={projectId}
          worker={worker}
          variant="field"
          placement="below"
        />
      }
    />
  )
}
