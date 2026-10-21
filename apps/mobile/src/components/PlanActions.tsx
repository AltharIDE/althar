import type { TaskCard } from '@althar/contracts'
import { View } from 'react-native'

import { useCommand, useConnection } from '../client/react'
import { tapDone } from '../lib/device'
import { space } from '../theme/tokens'
import { Button, Text } from './ui'

/*
 * A plan waiting to start, as the coordinator made it: why it chose the
 * lead, and Hold or Start now. A plan starts on its own when its countdown
 * ends; holding stops the countdown, and it starts when the person says.
 */
export function PlanActions({ task, inset = 52 }: { readonly task: Pick<TaskCard, 'plan' | 'inLine' | 'phase'>; readonly inset?: number }) {
  const reachable = useConnection().state === 'online'
  const start = useCommand((client, planId: string) => client.startPlan(planId))
  const hold = useCommand((client, planId: string) => client.holdPlan(planId))
  const plan = task.plan
  if (plan === null || task.inLine === true || task.phase !== 'planned') return null
  return (
    <View style={{ gap: space.sm, paddingLeft: inset, paddingRight: space.lg, paddingBottom: space.md }}>
      {plan.reason === null ? null : (
        <Text kind="sub" ink="t3">
          {plan.reason}
        </Text>
      )}
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {plan.startsAt === null ? null : (
          <Button
            label="Hold"
            tone="plain"
            small
            grow
            disabled={!reachable}
            busy={hold.isPending}
            onPress={() => hold.mutate(plan.id, { onSuccess: tapDone })}
          />
        )}
        <Button
          label="Start now"
          tone="ink"
          small
          grow
          disabled={!reachable}
          busy={start.isPending}
          onPress={() => start.mutate(plan.id, { onSuccess: tapDone })}
        />
      </View>
    </View>
  )
}
