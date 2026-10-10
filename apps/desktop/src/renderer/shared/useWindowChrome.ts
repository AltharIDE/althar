import type { TitleBarWindow } from '@althar/ui'
import { useEffect, useState } from 'react'

import { type Host, useServices } from '../data/services'

/*
 * What a screen with no tabs above it needs where the system draws none: the
 * window's own buttons, wired to the host, and whether the window is
 * maximized, so the third says maximize or restore. On macOS the system
 * draws its traffic lights instead, and only their room is kept.
 */

export interface WindowChrome {
  readonly lights: 'space' | 'drawn'
  readonly window?: TitleBarWindow
}

/** Whether the window is maximized, read once and kept current as the window changes. */
export const useMaximized = (host: Pick<Host, 'maximized' | 'onMaximized'>): boolean => {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    let live = true
    void host
      .maximized()
      .then((now) => {
        if (live) setMaximized(now)
      })
      .catch(() => undefined)
    const off = host.onMaximized(setMaximized)
    return () => {
      live = false
      off()
    }
  }, [host])
  return maximized
}

export const useWindowChrome = (): WindowChrome => {
  const { host } = useServices()
  const maximized = useMaximized(host)
  if (host.platform === 'darwin') return { lights: 'space' }
  return {
    lights: 'drawn',
    window: {
      onClose: () => host.window('close'),
      onMinimize: () => host.window('minimize'),
      onToggleMaximize: () => host.window('toggle-maximize'),
      maximized,
    },
  }
}
