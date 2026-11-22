import { useQuery } from '@tanstack/react-query'

import type { Places } from '@althar/contracts'

import { keys } from '../data/reads'
import { useServices } from '../data/services'

/*
 * The agents this computer runs at once, as they stand (`GetPlaces`): how
 * many are at work of the person's number, how many may work for now, fewer
 * while it is under load, and why, and how many tasks wait for one. The load
 * meter's popover shows them beside CPU and memory, and the Agents at once
 * slider says, at the number, when fewer may work for now. Read every three
 * seconds while one of them shows and the window is in view, and never
 * otherwise; each shares the one reading. Moving the slider changes the
 * number here at once (`placesAfter`), before the runtime says so.
 */

/** How often they are read again while they show. */
const EVERY = 3_000

/** Null while nothing shows them, before the first reading, or where the home can't say, as an older Althar can't. */
export const usePlaces = (shown: boolean): Places | null => {
  const { client } = useServices()
  const reading = useQuery({
    queryKey: keys.places,
    queryFn: () => client.getPlaces(),
    enabled: shown,
    refetchInterval: EVERY,
    refetchIntervalInBackground: false,
    staleTime: 0,
    retry: false,
  })
  return shown ? (reading.data ?? null) : null
}

/**
 * The places once the person's number is `count`, before the runtime says: as many may work as it says, unless fewer were
 * for now, which stay fewer while they are fewer than it.
 */
export const placesAfter = (was: Places, count: number): Places => {
  const lowered = was.atOnce < was.configured
  const atOnce = lowered ? Math.min(was.atOnce, count) : count
  return { ...was, configured: count, atOnce, why: atOnce < count ? was.why : null }
}
