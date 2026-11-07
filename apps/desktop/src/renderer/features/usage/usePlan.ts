import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import type { PlanUsage, UsageWindow } from '@althar/contracts'
import type { ModelInfo, ModelRoom } from '@althar/ui'

import { reads } from '../../data/reads'
import { useServices } from '../../data/services'
import { useNow } from '../../shared/time'
import { planOf, remember, roomOf, type WindowMemory } from './plan'

const REMEMBERED = 'althar.planWindows'

/** The windows last read, as the last run kept them: a restart doesn't forget what an account's reset windows were. */
const kept = (): WindowMemory => {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(REMEMBERED) ?? '[]')
    return new Map(Array.isArray(raw) ? (raw as Array<[string, ReadonlyArray<UsageWindow>]>) : [])
  } catch {
    return new Map()
  }
}

const keep = (memory: WindowMemory) => {
  try {
    const value = JSON.stringify([...memory])
    if (window.localStorage.getItem(REMEMBERED) !== value) window.localStorage.setItem(REMEMBERED, value)
  } catch {
    // Not kept: the next run knows only what it reads.
  }
}

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
  // The windows last read, for an account the runtime later sends none of because every one has reset.
  const memory = useRef<WindowMemory | null>(null)
  memory.current ??= kept()
  // Taken up as each reading arrives (idempotent, so safe to repeat); only saved, a side effect, in the effect below.
  const plan = useMemo(() => {
    remember(memory.current ?? new Map(), usage, new Date(now))
    return planOf(usage, new Date(now), memory.current ?? undefined)
  }, [usage, now])
  useEffect(() => {
    if (memory.current !== null) keep(memory.current)
  }, [usage])
  return plan
}

/** Each model's room for a picker, in the project where given: what `roomOf` says of it. */
export const useModelRooms = (projectId?: string): ((info: Pick<ModelInfo, 'id'>) => ModelRoom | null | undefined) => {
  const { client } = useServices()
  const usage = usePlanUsage()
  const rooms = useQuery(reads(client).modelRooms(projectId ?? null)).data
  const now = useNow(true, 60_000)
  return useCallback((info) => roomOf(info, rooms ?? [], usage, new Date(now)), [rooms, usage, now])
}
