import { useState } from 'react'

import type { AgentStatus } from '@althar/contracts'
import { Button, Dialog } from '@althar/ui'

import { ModelChoice } from '../../shared/ModelChoice'
import type { Choice, PickOn } from '../../shared/models'
import s from './MovePick.module.css'

/*
 * Moving a task where its lead's model isn't offered (ADR-103): it says so, and the person picks one of the lead's own
 * agent's models that is, which the lead starts on there. The move goes once they say Move.
 */

export const movePickText = {
  title: (place: string) => `Move to ${place}`,
  says: (place: string, model: string) => `${place} doesn’t offer ${model}. Its lead carries on there on:`,
  owner: 'Lead',
  cancel: 'Cancel',
  move: 'Move',
}

export interface MovePickProps {
  /** Where it moves, by name, and the model it can't run there, by name. */
  readonly place: string
  readonly model: string
  /** The lead's own agent, of the home's: its models there are the ones offered. */
  readonly agents: ReadonlyArray<AgentStatus>
  /** The lead as it is: its agent, and the first model offered there to start from. */
  readonly start: Choice
  /** The worker it moves to; none for the home, whose models the picker offers as they are. */
  readonly worker?: PickOn | undefined
  readonly projectId: string
  readonly onMove: (choice: Choice) => void
  readonly onClose: () => void
}

export function MovePick({ place, model, agents, start, worker, projectId, onMove, onClose }: MovePickProps) {
  const [pick, setPick] = useState<Choice>(start)
  const t = movePickText
  return (
    <Dialog
      title={t.title(place)}
      onClose={onClose}
      width={420}
      actions={
        <>
          <Button onClick={onClose}>{t.cancel}</Button>
          <Button variant="signal" disabled={pick.model === null || pick.model === model} onClick={() => onMove(pick)}>
            {t.move}
          </Button>
        </>
      }
    >
      <div className={s.pick}>
        <p className={s.says}>{t.says(place, model)}</p>
        <ModelChoice
          owner={t.owner}
          agents={agents.filter((agent) => agent.id === start.agentId)}
          value={pick}
          onChange={setPick}
          projectId={projectId}
          worker={worker}
          variant="field"
          placement="below"
        />
      </div>
    </Dialog>
  )
}
