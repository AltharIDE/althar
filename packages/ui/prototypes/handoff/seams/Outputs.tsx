// Scrappy: a task's outputs as built; in B, its left column is where the task stands, which reads the task from here.
import { type ComponentProps, createContext } from 'react'

import type { ThreadSnapshot } from '../../../../contracts/src/index'
import { Outputs as Built } from '../../../../../apps/desktop/src/renderer/features/task/Outputs'

export * from '../../../../../apps/desktop/src/renderer/features/task/Outputs'

/** The task Outputs is drawn for, for the column B puts in place of what it made. */
export const OutputsOf = createContext<ThreadSnapshot | null>(null)

export function Outputs(props: ComponentProps<typeof Built>) {
  return (
    <OutputsOf.Provider value={props.snapshot}>
      <Built {...props} />
    </OutputsOf.Provider>
  )
}
