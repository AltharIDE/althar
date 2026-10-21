import { useSyncExternalStore } from 'react'

/*
 * Which theme the window shows, as its root element says it (`data-theme`).
 * The tokens follow it by themselves; what draws on a canvas reads them
 * once, so it draws again when this changes.
 */

export type Theme = 'light' | 'dark'

const read = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

const subscribe = (changed: () => void) => {
  const observer = new MutationObserver(changed)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

/** The theme showing: a dependency for an effect that reads the tokens, and what it draws by. */
export const useTheme = (): Theme => useSyncExternalStore(subscribe, read, () => 'light')
