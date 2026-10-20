import { useSyncExternalStore } from 'react'

/*
 * Which theme the window shows, as its root element says it: `data-theme`
 * (light or dark) and `data-dark` (which dark). The tokens follow those by
 * themselves; what draws on a canvas reads them once, so it draws again
 * when this changes.
 */

const read = () => {
  const root = document.documentElement
  return `${root.dataset.theme ?? 'light'}${root.dataset.dark === undefined ? '' : `/${root.dataset.dark}`}`
}

const subscribe = (changed: () => void) => {
  const observer = new MutationObserver(changed)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-dark'] })
  return () => observer.disconnect()
}

/** The theme showing, as one word (`light`, `dark/warm`): a dependency for an effect that reads the tokens. */
export const useTheme = (): string => useSyncExternalStore(subscribe, read, () => 'light')
