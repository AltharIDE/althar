import { createContext, useContext, type ReactNode } from 'react'
import { Platform, useColorScheme } from 'react-native'

import { dark, light, type Palette } from './tokens'

const Theme = createContext<Palette>(light)

/**
 * The palette for the system's appearance. On the web, `?theme=dark` or
 * `?theme=light` overrides it, so a screenshot can shoot either.
 */
const asked = (): 'light' | 'dark' | null => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null
  const theme = new URLSearchParams(window.location.search).get('theme')
  return theme === 'dark' || theme === 'light' ? theme : null
}

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const system = useColorScheme()
  const scheme = asked() ?? (system === 'dark' ? 'dark' : 'light')
  return <Theme.Provider value={scheme === 'dark' ? dark : light}>{children}</Theme.Provider>
}

export const useTheme = (): Palette => useContext(Theme)
