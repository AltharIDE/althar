// Scrappy: what still asks in a task, as each direction draws it; Today, as the app does.
import type { ComponentProps } from 'react'

import { PermissionCalls as Built } from '../../../../../apps/desktop/src/renderer/features/task/PermissionCall'
import { ASKS, IrreversibleAsk } from '../directions/rules/Ask'
import { useProto } from '../state'
import s from '../directions/rules/rules.module.css'

export * from '../../../../../apps/desktop/src/renderer/features/task/PermissionCall'

export function PermissionCalls(props: ComponentProps<typeof Built>) {
  const p = useProto()
  if (p.surface !== 'rules' || p.direction === 'Today' || props.requests.length === 0) return <Built {...props} />
  return (
    <div className={s.stack}>
      {props.requests.map((request) => {
        const ask = ASKS.find((one) => one.id === request.id)
        return ask === undefined ? null : <IrreversibleAsk key={ask.id} ask={ask} layout="A" />
      })}
    </div>
  )
}
