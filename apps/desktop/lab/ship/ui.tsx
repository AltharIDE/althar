import { ChangeSet as Real, type ChangeSetProps, ChangeState } from '@althar/ui'

import { DIRECTIONS, useLab } from './directions'
import { useOnto } from './onto'

/*
 * The kit as the task's Outputs see it in the lab (vite.config.ts points
 * Outputs.tsx's import of @althar/ui here): all of it, with the Change card
 * of the task's pull request taking the chosen direction's buttons and lines.
 * Today, and every other card, is the kit's own, untouched.
 */

export * from '@althar/ui'

export function ChangeSet(props: ChangeSetProps) {
  const lab = useLab()
  // B′ keeps its route along the path: the card follows it.
  useOnto()
  const direction = DIRECTIONS.find((one) => one.key === lab?.direction)
  if (lab === null || direction?.cardOf === undefined || props.state === ChangeState.Branch) return <Real {...props} />
  const { actions, ...card } = direction.cardOf(lab.moment, props, lab.hover)
  const { actions: _real, ...rest } = props
  return <Real {...rest} {...card} {...(actions.length === 0 ? {} : { actions })} />
}
