import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { PlanGauge } from '@althar/ui'

import { keys } from '../../data/reads'
import { useServices } from '../../data/services'
import { usePlan } from './usePlan'

/**
 * Plan usage in the window's bar, after CPU and memory, once any agent's
 * plan has been read: the gauge, and its peek, opened by a click or by ⌘U
 * (Control-U off a Mac), which the bar holds. Opening it reads every account
 * again, each at most once a minute, as the runtime keeps to.
 */
export function PlanBar({ open, onOpenChange }: { readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const { client } = useServices()
  const cache = useQueryClient()
  const { agents, silent } = usePlan()
  useEffect(() => {
    if (!open) return
    client.getPlanUsage({ refresh: true }).then(
      (fresh) => void cache.setQueryData(keys.planUsage, fresh),
      // As kept: the peek shows what was last read, and each account says how old it is.
      () => undefined,
    )
  }, [open, client, cache])
  // With nothing read, there is no gauge, and nothing for ⌘U to open.
  const none = agents.length === 0
  useEffect(() => {
    if (none && open) onOpenChange(false)
  }, [none, open, onOpenChange])
  if (none) return null
  return <PlanGauge agents={agents} silent={silent} open={open} onOpenChange={onOpenChange} />
}
