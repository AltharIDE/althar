import { type PlaceId, PLACES } from '@althar/contracts'

/*
 * What of About › Storage needs Electron (DEV-147): opening a place in the
 * system's file manager. Measuring them is the runtime's (StorageSizes.ts).
 */

export const isPlace = (value: unknown): value is PlaceId => PLACES.some((place) => place === value)

/** Opens a place in the system's file manager; fails with what the system said where it couldn't. */
export const showPlace = async (places: Readonly<Record<PlaceId, string>>, place: PlaceId, openPath: (path: string) => Promise<string>) => {
  const failed = await openPath(places[place])
  if (failed !== '') throw new Error(failed)
}
