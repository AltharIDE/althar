// Scrappy, the third round: Settings as a tab of the window, beside Home; and whether the quick panel is open, for the live page's address.
import { useSyncExternalStore } from 'react'

import type { SectionId } from './sections'

export interface SettingsTab {
  /** The Settings tab is in the bar. */
  readonly open: boolean
  /** It has the window. */
  readonly current: boolean
  /** The section it shows. */
  readonly section: SectionId
  /** The quick panel is open, wherever it opened. */
  readonly quick: boolean
}

let state: SettingsTab = { open: false, current: false, section: 'agents', quick: false }
const listeners = new Set<() => void>()

export const settingsTab = {
  get: () => state,
  set: (next: Partial<SettingsTab>) => {
    const was = state
    state = { ...state, ...next }
    if (was.open === state.open && was.current === state.current && was.section === state.section && was.quick === state.quick) return
    for (const listener of listeners) listener()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  /** Opens the tab at a section, and gives it the window. */
  show: (section: SectionId) => settingsTab.set({ open: true, current: true, section }),
  /** Another tab has the window. */
  leave: () => settingsTab.set({ current: false }),
  close: () => settingsTab.set({ open: false, current: false }),
}

export const useSettingsTab = () => useSyncExternalStore(settingsTab.subscribe, settingsTab.get)
