import type { ReactNode } from 'react'

import s from './States.module.css'

/*
 * A row of one component in each of its states, labelled. Hover, focus and
 * pressed are forced with storybook-addon-pseudo-states: a story that uses
 * this grid passes `statesParameters` so the cells named hover, focus and
 * pressed show those states without a pointer. The state lands on the
 * first element in the cell, so a cell holds the component itself, not a
 * wrapper around it.
 */

export type Forced = 'hover' | 'focus' | 'pressed'

const FORCED: readonly string[] = ['hover', 'focus', 'pressed']
const isForced = (x: string): x is Forced => FORCED.includes(x)

export interface StateCell {
  /** The cell's label. A cell named hover, focus or pressed forces that state. */
  state: string
  node: ReactNode
  /** Force a pointer or focus state on a cell with another name: "checked, hover". */
  force?: Forced
  /** Stage the component on an ink surface, for tones meant for one. */
  dark?: boolean
}

/** How wide a cell is: compact for a control, wide for a row of them, thread for a part that reads at the thread's width. */
export type StatesSize = 'compact' | 'wide' | 'thread'

export function States({ cells, size = 'compact' }: { cells: StateCell[]; size?: StatesSize }) {
  return (
    <div data-states="" className={s[size]}>
      {cells.map((c) => (
        <div key={c.state} className={s.cell}>
          <span className={s.label}>{c.state}</span>
          <div data-force={c.force ?? (isForced(c.state) ? c.state : undefined)} className={c.dark ? `${s.stage} ${s.dark}` : s.stage}>
            {c.node}
          </div>
        </div>
      ))}
    </div>
  )
}

/* The component itself, or, when it wraps its button in an anchor (a
   popover, a menu), the button inside. */
export const target = (force: Forced) => [
  `[data-force='${force}'] > :first-child:is(button, a, input, textarea)`,
  `[data-force='${force}'] > :first-child > button:first-child`,
]

export const statesParameters = {
  pseudo: {
    hover: target('hover'),
    focusVisible: target('focus'),
    focus: target('focus'),
    active: target('pressed'),
  },
}

/** For a component whose state lands on a part inside it, like one radio of a group: a selector for the part, per state. */
export const statesOn = (part: Record<Forced, string>) => ({
  pseudo: {
    hover: [`[data-force='hover'] ${part.hover}`],
    focusVisible: [`[data-force='focus'] ${part.focus}`],
    focus: [`[data-force='focus'] ${part.focus}`],
    active: [`[data-force='pressed'] ${part.pressed}`],
  },
})
