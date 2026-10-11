import { useEffect, useRef, useState } from 'react'

import type { EdgeSpot } from '@althar/ui'

import { useServices } from '../../data/services'
import { type EdgePlace, type EdgeRoom, edgeSpotOf, isEdgePlace } from '../../shared/edge'

/*
 * Where Althar shows while the person is in another app, as Settings shows
 * and changes it. It shows somewhere on every system: the main process says
 * which system this is and whether it has a notch and a tray, once as
 * Settings comes and again each time it opens, since a screen with a notch
 * comes and goes. Only with a notch is there a choice. A new choice shows at
 * once; if the main process can't keep it, and it is still the latest, the
 * last one kept comes back and the view says so.
 */

export interface EdgePlaceModel {
  /** Where it shows on this computer, or null until the main process says. */
  readonly spot: EdgeSpot | null
  /** The place chosen, where a notch leaves a choice; null until the main process says, and where there is nothing to choose between. */
  readonly place: EdgePlace | null
  readonly failed: boolean
  readonly choose: (place: EdgePlace) => void
}

export const useEdgePlace = (open = true): EdgePlaceModel => {
  const { host } = useServices()
  const [room, setRoom] = useState<EdgeRoom | null>(null)
  const [place, setPlace] = useState<EdgePlace>('island')
  const [failed, setFailed] = useState(false)
  const made = useRef(0)
  const kept = useRef<EdgePlace>('island')
  const asked = useRef(false)

  // Asked as Settings comes, and again each time it opens.
  useEffect(() => {
    if (!open && asked.current) return
    asked.current = true
    let live = true
    const at = made.current
    void host.edge().then(
      (answer) => {
        if (!live || answer === null) return
        setRoom({ platform: answer.platform, notch: answer.notch, tray: answer.tray })
        // A choice made while this was asked stands.
        if (at !== made.current) return
        const read = isEdgePlace(answer.place) ? answer.place : 'island'
        kept.current = read
        setPlace(read)
      },
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [host, open])

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

  return {
    spot: room === null ? null : edgeSpotOf(room, place),
    place: room?.platform === 'darwin' && room.notch ? place : null,
    failed,
    choose,
  }
}
