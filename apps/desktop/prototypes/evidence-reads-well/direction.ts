import { createContext, useContext } from 'react'

import { type Scenario, scenarios } from './scenario'

/* Which direction a window draws, and which task it shows: the swapped Evidence reads both. */

export type Direction = 'today' | 'a' | 'b' | 'c' | 'd' | 'e'

export const directions: ReadonlyArray<{ readonly key: Exclude<Direction, 'today'>; readonly name: string; readonly gist: string }> = [
  {
    key: 'a',
    name: 'A · Proof checklist',
    gist: 'Each claim of what was built, with its proof inline: a thumbnail, a test count, a command and its exit. What couldn’t be shown sits in the same list as open circles, violet, for the person to check. Under a step, the same list, one row per piece.',
  },
  {
    key: 'b',
    name: 'B · Gallery first',
    gist: 'Screenshots large, numbered in order, grouped and captioned in full, all visible; each opens the lightbox with the set in that order. Commands and test runs collapse beneath as small receipts. Under a step, the same gallery at thumbnail size.',
  },
  {
    key: 'c',
    name: 'C · Before and after',
    gist: 'Where the lead showed the old and the new, they sit side by side, or overlaid with a slider to drag. Test runs pair the same way: failing before the fix, passing after. The rest as B shows it.',
  },
  {
    key: 'd',
    name: 'D · One line under a step',
    gist: 'In the thread, one line under each step’s report: “8 screenshots · 2 commands passed · 3 to check”, opening in place to the gallery. The full layout only on Outputs.',
  },
  {
    key: 'e',
    name: 'E · A short write-up',
    gist: 'Outputs reads like a short pull request description: what was built, then a section per area of change with its pictures as figures, its runs as receipts and what’s still to check in that area. Under a step, the areas in a line each, pointing to Outputs.',
  },
]

export const DirectionContext = createContext<Direction>('today')
export const ScenarioContext = createContext<Scenario>(scenarios[0] as Scenario)

export const useDirection = () => useContext(DirectionContext)
export const useScenario = () => useContext(ScenarioContext)
