import { useEffect, useState } from 'react'
import type { HomeState, HomesHost } from '../../../homes'

export const homeProblem = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
    : 'The home connection could not be changed. Try again.'

/** A slower initial read must never replace a newer connection event. */
export const useHomeState = (homes: HomesHost | undefined) => {
  const [state, setState] = useState<HomeState | null>(null)
  useEffect(() => {
    if (homes === undefined) return
    let live = true
    let events = 0
    const off = homes.onState((state) => {
      events++
      if (live) setState(state)
    })
    const readAt = events
    void homes
      .state()
      .then((state) => {
        if (live && events === readAt) setState(state)
      })
      .catch(() => undefined)
    return () => {
      live = false
      off()
    }
  }, [homes])
  return state
}

export const showHomes = () => window.dispatchEvent(new Event('althar:show-homes'))
