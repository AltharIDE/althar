import type { ChangeSummary } from '@charrette/contracts'
import { type ChangeCheck, CheckState } from '@charrette/ui'

/** A check as the kit lists it: one that was skipped or said nothing counts as passed, with what it said. */
export const checkOf = (check: NonNullable<ChangeSummary['checks']>['list'][number], index: number): ChangeCheck => {
  const state = ((): CheckState => {
    switch (check.state) {
      case 'queued':
        return CheckState.Queued
      case 'running':
        return CheckState.Running
      case 'failed':
        return CheckState.Failed
      default:
        return CheckState.Passed
    }
  })()
  const said = check.state === 'skipped' || check.state === 'neutral' || check.state === 'cancelled' ? check.state : check.summary
  return { id: `${index}-${check.name}`, name: check.name, state, ...(said === null ? {} : { detail: said }) }
}
