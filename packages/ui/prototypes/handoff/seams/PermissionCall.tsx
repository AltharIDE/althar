// Scrappy: in A and C, what the rules keep for the person is drawn with the handoff, so the thread's end doesn't draw it again.
import type { ComponentProps } from 'react'

import { PermissionCalls as Built } from '../../../../../apps/desktop/src/renderer/features/task/PermissionCall'
import { useProto } from '../state'

export * from '../../../../../apps/desktop/src/renderer/features/task/PermissionCall'

export function PermissionCalls(props: ComponentProps<typeof Built>) {
  const { direction } = useProto()
  return direction === 'A' || direction === 'C' ? null : <Built {...props} />
}
