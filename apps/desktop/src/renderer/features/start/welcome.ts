import { useSyncExternalStore } from 'react'

/*
 * Two things the welcome keeps. Whether it is on show: from the first screen
 * of a first run until its last step opens the project, so the project made
 * on its way there doesn't swap it for the home. It lives as long as the
 * window: a window opened again with a project goes to the home, where the
 * project's own card asks for what the welcome didn't connect. And whether
 * its tour has been seen on this computer, so a first screen shown again,
 * once every project is gone, starts at the agents.
 */

const TOURED = 'althar.toured'

let showing = false
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const set = (next: boolean) => {
  if (showing === next) return
  showing = next
  listeners.forEach((listener) => listener())
}

export const welcome = {
  /** The first screen of a first run is on show. */
  begin: () => set(true),
  /** The welcome opened its project, or was left. */
  end: () => set(false),
  isShowing: () => showing,
}

/** Whether the welcome is on show, so the window keeps it over a project made on its way. */
export const useWelcoming = () => useSyncExternalStore(subscribe, () => showing)

/** Whether the tour has been seen on this computer. Storage that can't be read counts it unseen. */
export const toured = (): boolean => {
  try {
    return window.localStorage.getItem(TOURED) === '1'
  } catch {
    return false
  }
}

/** The tour is over, finished or skipped: it is left out from now on. Storage that can't be written shows it once more. */
export const markToured = () => {
  try {
    window.localStorage.setItem(TOURED, '1')
  } catch {
    // Shown again next time.
  }
}
