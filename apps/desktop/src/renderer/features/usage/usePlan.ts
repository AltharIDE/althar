import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import type { PlanUsage } from '@althar/contracts'

import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { useNow } from '../../shared/time'
import { planOf } from './plan'

/** What the window has of plan usage: null before it is first read, or if that failed. The feed keeps it whole as it changes. */
export const usePlanUsage = (): PlanUsage | null => {
  const { client } = useServices()
  return useQuery(reads(client).planUsage()).data ?? null
}

/** Every agent read, least room first, as the bar's gauge shows them. */
export const usePlan = () => {
  const usage = usePlanUsage()
  // The reset times say today's time or a day's, and the ages minutes: written again each minute.
  const now = useNow(true, 60_000)
  return useMemo(() => planOf(usage, new Date(now)), [usage, now])
}
