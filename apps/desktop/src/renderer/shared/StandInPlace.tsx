import { Tooltip } from '@althar/ui'

import { clock } from './time'
import s from './StandInPlace.module.css'

/** How a lead standing in for the one a usage limit stopped is said, beside its model in the composer. */
export const standInText = {
  place: (given: string) => `For ${given}`,
  why: (given: string, when: string) =>
    `${given} ran out of usage and leads again${when === '' ? ' once it’s back' : ` at ${when}`}. Press to put it back now.`,
}

/**
 * Beside the lead's model in the composer's foot, where a usage limit handed the task to it: whose place it holds, and,
 * on pointing, until when. Pressed, the lead the task was given is picked again, as the picker picks it: it takes over
 * with what the person says next.
 */
export function StandInPlace({ given, until, onPutBack }: { given: string; until: string; onPutBack: () => void }) {
  return (
    <Tooltip label={standInText.why(given, clock(until))} placement="above">
      <button type="button" className={s.place} onClick={onPutBack}>
        {standInText.place(given)}
      </button>
    </Tooltip>
  )
}
