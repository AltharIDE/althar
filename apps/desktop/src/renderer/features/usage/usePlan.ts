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
  const memory: WindowMemory = new Map()
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(REMEMBERED) ?? '[]')
    if (!Array.isArray(raw)) return memory
    for (const entry of raw) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !Array.isArray(entry[1])) continue
      const windows = (entry[1] as unknown[]).filter(isWindow)
      if (windows.length > 0) memory.set(entry[0], windows)
    }
  } catch {
    // Unreadable: the next run knows only what it reads.
  }
  return memory
}

/** What a stored window must be to be shown: anything else, from an older build or a hand edit, is dropped. */
const isWindow = (value: unknown): value is UsageWindow => {
  if (typeof value !== 'object' || value === null) return false
  const w = value as Record<string, unknown>
  return (
    typeof w.kind === 'string' &&
    (w.label === null || typeof w.label === 'string') &&
    typeof w.usedPercent === 'number' &&
    (w.resetsAt === null || (typeof w.resetsAt === 'string' && !Number.isNaN(Date.parse(w.resetsAt))))
  )
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
  // What was read of each window, kept as readings arrive: made from the last kept memory and the reading, not changed in place.
  const committed = useRef<WindowMemory | null>(null)
  committed.current ??= kept()
  const memory = useMemo(() => {
    const next: WindowMemory = new Map(committed.current ?? [])
    remember(next, usage, new Date())
    return next
  }, [usage])
  useEffect(() => {
    committed.current = memory
    keep(memory)
  }, [memory])
  return useMemo(() => planOf(usage, new Date(now), memory), [usage, now, memory])
}

/** Each model's room for a picker, in the project where given: what `roomOf` says of it. */
export const useModelRooms = (projectId?: string): ((info: Pick<ModelInfo, 'id'>) => ModelRoom | null | undefined) => {
  const { client } = useServices()
  const usage = usePlanUsage()
  const rooms = useQuery(reads(client).modelRooms(projectId ?? null)).data
  const now = useNow(true, 60_000)
  return useCallback((info) => roomOf(info, rooms ?? [], usage, new Date(now)), [rooms, usage, now])
}
