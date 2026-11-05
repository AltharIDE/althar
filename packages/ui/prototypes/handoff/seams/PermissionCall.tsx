// Scrappy: in every take, what the rules keep for the person is drawn with what else needs them, so the thread's end doesn't draw it again.
import type { ComponentProps } from 'react'

import { PermissionCalls as Built } from '../../../../../apps/desktop/src/renderer/features/task/PermissionCall'
import { useProto } from '../state'

export * from '../../../../../apps/desktop/src/renderer/features/task/PermissionCall'

export function PermissionCalls(props: ComponentProps<typeof Built>) {
  const { direction } = useProto()
  return direction === 'Today' ? <Built {...props} /> : null
}
