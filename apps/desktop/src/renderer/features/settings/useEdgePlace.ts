import { useEffect, useRef, useState } from 'react'

import { useServices } from '../../data/services'
import { type EdgePlace, isEdgePlace } from '../../shared/edge'

/*
 * Where Althar shows while the person is in another app, as Settings shows
 * and changes it. There is a choice only on a Mac whose screen has a notch:
 * elsewhere it is the menu bar, and Settings says nothing of it. A new choice
 * shows at once; if the main process can't keep it, and it is still the
 * latest, the last one kept comes back and the view says so.
 */

export interface EdgePlaceModel {
  /** The place chosen, or null until the main process says, and where there is nothing to choose between. */
  readonly place: EdgePlace | null
  readonly failed: boolean
  readonly choose: (place: EdgePlace) => void
}

export const useEdgePlace = (): EdgePlaceModel => {
  const { host } = useServices()
  const [place, setPlace] = useState<EdgePlace | null>(null)
  const [failed, setFailed] = useState(false)
  const made = useRef(0)
  const kept = useRef<EdgePlace | null>(null)

  useEffect(() => {
    let live = true
    void host.edge().then(
      (answer) => {
        if (!live || answer === null || !answer.notch) return
        const read = isEdgePlace(answer.place) ? answer.place : 'island'
        kept.current = read
        setPlace(read)
      },
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [host])

  const choose = (next: EdgePlace) => {
    const at = ++made.current
    setPlace(next)
    setFailed(false)
    host.setEdge(next).then(
      () => {
        if (at === made.current) kept.current = next
      },
      () => {
        if (at !== made.current) return
        setPlace(kept.current)
        setFailed(true)
      },
    )
  }

  return { place, failed, choose }
}
