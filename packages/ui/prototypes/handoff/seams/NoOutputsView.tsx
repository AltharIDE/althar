// Scrappy: a task with nothing to show in its outputs as built; in B, where it stands, alone.
import type { ComponentProps } from 'react'

import { NoOutputsView as Built } from '../../../../../apps/desktop/src/renderer/features/task/NoOutputsView'
import { Standing } from '../directions/B'
import { useProto } from '../state'

export * from '../../../../../apps/desktop/src/renderer/features/task/NoOutputsView'

export function NoOutputsView(props: ComponentProps<typeof Built>) {
  const { direction } = useProto()
  return direction === 'B' ? <Standing snapshot={props.snapshot} alone /> : <Built {...props} />
}
