import { useEffect, useEffectEvent, useSyncExternalStore } from 'react'

/*
 * A project's coordinator asked for, words having been put in its composer:
 * its view goes to its conversation, the coordinator's own over any aside,
 * even where the address already asks for that conversation and so changes
 * nothing. Kept until that project's view takes it, a cold load included.
 */

let wanted: { readonly projectId: string } | null = null
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
const current = () => wanted

/** Asks a project's view for its coordinator's conversation. */
export const openCoordinator = (projectId: string) => {
  wanted = { projectId }
  listeners.forEach((one) => one())
}

/** A project's view takes the ask for its coordinator, once. */
export const useCoordinatorWanted = (projectId: string | null, show: () => void) => {
  const asked = useSyncExternalStore(subscribe, current)
  const open = useEffectEvent(show)
  useEffect(() => {
    if (asked === null || projectId === null || asked.projectId !== projectId) return
    wanted = null
    listeners.forEach((one) => one())
    open()
  }, [asked, projectId])
}
