// Scrappy: a task's Run button as built, drawn only for A as built; the directions draw their own beside the menu.
import type { ComponentProps } from 'react'

import { Runs as Built } from '../../../../../apps/desktop/src/renderer/features/runs/Runs'
import { useProto } from '../state'

export function Runs(props: ComponentProps<typeof Built>) {
  const { direction } = useProto()
  return direction === 'Today' ? <Built {...props} /> : null
}
