import { Goal as KitGoal } from '@althar/ui'
import type { ComponentProps } from 'react'

import { useGoalShown } from './commands'

/*
 * The kit, as TaskView takes it in the lab: its goal's line over the
 * composer steps aside while the composer itself shows the goal (B's mode,
 * D's panel), so it isn't said twice.
 */
export * from '@althar/ui'

export function Goal(props: ComponentProps<typeof KitGoal>) {
  return useGoalShown() ? null : <KitGoal {...props} />
}
