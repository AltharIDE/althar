import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

import type { PlanUsage } from '@althar/contracts'
import type { ModelInfo, ModelRoom } from '@althar/ui'

import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { choiceOf } from '../../shared/models'
import { useNow } from '../../shared/time'
import { planOf, roomOf } from './plan'

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

/** How many steps each model ended without its report this week, once reminded, for a picker: none where it didn't. */
export const useMissedReports = (): ((info: Pick<ModelInfo, 'id'>) => number | undefined) => {
  const { client } = useServices()
  const missed = useQuery(reads(client).missedReports()).data
  return useCallback(
    (info) => {
      const { agentId, model } = choiceOf(info.id)
      return missed?.find((one) => one.agentId === agentId && one.model === model)?.count
    },
    [missed],
  )
}

/** Each model's room for a picker, in the project where given: what `roomOf` says of it. */
export const useModelRooms = (projectId?: string): ((info: Pick<ModelInfo, 'id'>) => ModelRoom | null | undefined) => {
  const { client } = useServices()
  const usage = usePlanUsage()
  const rooms = useQuery(reads(client).modelRooms(projectId ?? null)).data
  const now = useNow(true, 60_000)
  return useCallback((info) => roomOf(info, rooms ?? [], usage, new Date(now)), [rooms, usage, now])
}
