import { useQuery } from '@tanstack/react-query'

import { useServices } from '../data/services'

/*
 * The Mac's alert sounds a notification can play, read once for the window,
 * and playing one, as Settings offers them. None off a Mac.
 */
export const useSounds = (): { readonly list: ReadonlyArray<string>; readonly play: (sound: string) => void } => {
  const { host } = useServices()
  const list = useQuery({ queryKey: ['sounds'], queryFn: () => host.sounds(), staleTime: Number.POSITIVE_INFINITY }).data ?? []
  return { list, play: (sound) => void host.playSound(sound).catch(() => undefined) }
}
