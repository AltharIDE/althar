import { useCallback, useSyncExternalStore } from 'react'

/*
 * What only the browser knows: the window's width, the address, reduced
 * motion, the reader's system and day. Built pages arrive prerendered
 * (scripts/prerender.ts), and hydrating them needs the browser's first render
 * to match the build's, so these hooks answer as the build did while the page
 * hydrates, then draw again with what the browser knows.
 */

const never = () => () => {}

/** False in the prerender and while the page hydrates; true from the render after, and from the first in development. */
export const useHydrated = () =>
  useSyncExternalStore(
    never,
    () => true,
    () => false,
  )

/** Whether a media query matches, following it as it changes. False in the prerender and while the page hydrates. */
export function useMedia(query: string) {
  const subscribe = useCallback(
    (on: () => void) => {
      const q = window.matchMedia(query)
      q.addEventListener('change', on)
      return () => q.removeEventListener('change', on)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** Today, YYYY-MM-DD in UTC: the day the site was built in the prerender and while the page hydrates, then the reader's. */
export const useToday = () =>
  useSyncExternalStore(
    never,
    () => new Date().toISOString().slice(0, 10),
    () => import.meta.env.BUILT_ON,
  )

const onHashChange = (on: () => void) => {
  window.addEventListener('hashchange', on)
  return () => window.removeEventListener('hashchange', on)
}

/** The address's #fragment, following it as it changes. Empty in the prerender and while the page hydrates: it isn't sent to the server. */
export const useHash = () =>
  useSyncExternalStore(
    onHashChange,
    () => window.location.hash,
    () => '',
  )

/** Whether motion should hold still: reduced motion, or `?t=` in the address to look at one frame. False where there is no window. */
export const still = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia('(prefers-reduced-motion: reduce)').matches || new URLSearchParams(window.location.search).has('t'))

/** `still()` for a render: false in the prerender and while the page hydrates. */
export const useStill = () => useHydrated() && still()
