import { Tooltip } from '@althar/ui'

import { clock } from './time'
import s from './StandInPlace.module.css'

/** How a lead standing in for the one a usage limit stopped is said, beside its model in the composer. */
export const standInText = {
  place: (given: string) => `For ${given}`,
  why: (given: string, when: string, why: 'limit' | 'low' | 'stall' = 'limit') =>
    why === 'stall'
      ? `${given} ended its step without a report and leads again once the step is done. Press to put it back now.`
      : `${given} ${why === 'low' ? 'was nearly out of usage' : 'ran out of usage'} and leads again${when === '' ? ' once it’s back' : ` at ${when}`}. Press to put it back now.`,
}

/**
 * Beside the lead's model in the composer's foot, where a usage limit handed the task to it: whose place it holds, and,
 * on pointing, until when. Pressed, the lead the task was given is picked again, as the picker picks it: it takes over
 * with what the person says next.
 */
export function StandInPlace({
  given,
  until,
  why,
  onPutBack,
}: {
  given: string
  until: string | null
  why?: 'limit' | 'low' | 'stall' | undefined
  onPutBack: () => void
}) {
  return (
    <Tooltip label={standInText.why(given, until === null ? '' : clock(until), why)} placement="above">
      <button type="button" className={s.place} onClick={onPutBack}>
        {standInText.place(given)}
      </button>
    </Tooltip>
  )
}
