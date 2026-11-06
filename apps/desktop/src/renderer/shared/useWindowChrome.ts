import type { TitleBarWindow } from '@althar/ui'
import { useEffect, useState } from 'react'

import { type Host, useServices } from '../data/services'

/** macOS overlays its system controls; other systems draw their native title bar above the page. */
export interface WindowChrome {
  readonly lights: 'space' | 'none'
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
  return { lights: host.platform === 'darwin' ? 'space' : 'none' }
}
