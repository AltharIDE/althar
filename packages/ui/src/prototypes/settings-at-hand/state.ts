// Scrappy: what the seams share across the real screens, for one direction's page.
import { createContext, useContext, useSyncExternalStore } from 'react'

import type { ProjectSummary } from './deps'

export type Direction = 'A' | 'B' | 'C' | 'D'

export interface Proto {
  readonly direction: Direction
  /** B: what the one panel shows. */
  readonly scope: 'project' | 'althar'
  /** B: where the project's part of the one panel is drawn, while it shows it. */
  readonly slot: HTMLElement | null
  /** B: a project's settings are there to show (on a project's tab). */
  readonly project: boolean
  /** C: the project is on its Settings view. */
  readonly settingsView: boolean
}

let state: Proto = { direction: 'A', scope: 'althar', slot: null, project: false, settingsView: false }
const listeners = new Set<() => void>()

export const proto = {
  get: () => state,
  set: (next: Partial<Proto>) => {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export const useProto = () => useSyncExternalStore(proto.subscribe, proto.get)

/** The project whose tab has the window, on its screen or one of its tasks; null on the home. */
export const CurrentProject = createContext<ProjectSummary | null>(null)
export const useCurrentProject = () => useContext(CurrentProject)

/** Whether a project's settings are drawn from a task's screen rather than the project's own. */
export const OnTask = createContext(false)
