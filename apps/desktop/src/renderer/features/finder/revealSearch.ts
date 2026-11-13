import { useEffect, useEffectEvent, useSyncExternalStore } from 'react'

interface Target {
  readonly threadId: string
  readonly itemId: string
}
let target: Target | null = null
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
const current = () => target

/** Kept until the destination mounts, including a cold route load. */
export const revealSearch = (threadId: string, itemId: string) => {
  target = { threadId, itemId }
  listeners.forEach((one) => one())
}
export const useSearchReveal = (threadId: string | undefined, show: (itemId: string) => void) => {
  const wanted = useSyncExternalStore(subscribe, current)
  const reveal = useEffectEvent(show)
  useEffect(() => {
    if (wanted === null || wanted.threadId !== threadId) return
    target = null
    listeners.forEach((one) => one())
    reveal(wanted.itemId)
  }, [wanted, threadId])
}
