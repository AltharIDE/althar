import { useId, useState } from 'react'

import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import s from './Goal.module.css'

const goalStatus = {
  active: 'Active',
  paused: 'Paused',
  blocked: 'Blocked',
  complete: 'Complete',
  limited: 'Limit reached',
}

interface GoalView {
  readonly objective: string
  readonly status: keyof typeof goalStatus
  readonly rounds: number
  readonly roundLimit: number
  readonly progress: string | null
  readonly detail: string | null
  readonly waiting: boolean
}

export function Goal({
  goal,
  objectiveLimit,
  expanded,
  onExpand,
  onPause,
  onResume,
  onEdit,
  onClear,
}: {
  readonly goal: GoalView
  readonly objectiveLimit: number
  readonly expanded: boolean
  readonly onExpand: (expanded: boolean) => void
  readonly onPause: () => void
  readonly onResume: () => void
  readonly onEdit: (objective: string) => void
  readonly onClear: () => void
}) {
  const detailsId = useId()
  const [edit, setEdit] = useState<string | null>(null)
  const status = goal.waiting ? 'Waiting' : goalStatus[goal.status]
  const update = goal.detail ?? goal.progress
  return (
    <section aria-label="Goal" className={s.goal}>
      <div className={s.line}>
        <button
          type="button"
          className={s.summary}
          aria-expanded={expanded}
          aria-controls={detailsId}
          title={goal.objective}
          onClick={() => onExpand(!expanded)}
        >
          <span className={s.label}>Goal</span>
          <span className={s.objective}>{expanded ? null : goal.objective}</span>
          <output className={s.status}>{status}</output>
        </button>
        {goal.status === 'active' ? (
          <LinkButton onClick={onPause}>Pause</LinkButton>
        ) : goal.status !== 'complete' ? (
          <LinkButton onClick={onResume}>Resume</LinkButton>
        ) : null}
      </div>
      <div id={detailsId} hidden={!expanded} className={s.details}>
        {edit === null ? (
          <>
            <p>{goal.objective}</p>
            {update !== null && <p className={s.detail}>{update}</p>}
            <p className={s.detail}>
              {goal.rounds} of {goal.roundLimit} automatic turns used
            </p>
            <div className={s.actions}>
              <LinkButton onClick={() => setEdit(goal.objective)}>Edit</LinkButton>
              <LinkButton onClick={onClear}>Clear</LinkButton>
            </div>
          </>
        ) : (
          <>
            <label htmlFor={detailsId + '-edit'}>Objective</label>
            <textarea
              id={detailsId + '-edit'}
              maxLength={objectiveLimit}
              rows={3}
              value={edit}
              onChange={(event) => setEdit(event.target.value)}
            />
            <div className={s.actions}>
              <LinkButton onClick={() => setEdit(null)}>Cancel</LinkButton>
              <LinkButton
                disabled={edit.trim() === ''}
                onClick={() => {
                  setEdit(null)
                  onEdit(edit)
                }}
              >
                Save
              </LinkButton>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
