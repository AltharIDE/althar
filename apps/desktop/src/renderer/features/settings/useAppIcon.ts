import { useEffect, useState } from 'react'

import { useServices } from '../../data/services'
import { type AppIcon, isAppIcon } from '../../shared/appIcons'

/*
 * The app's icon, as Settings shows and changes it. A new choice shows at
 * once; if the main process can't keep it, the one before comes back and
 * the view says so.
 */

export interface AppIconModel {
  /** The icon chosen, or null until the main process says. */
  readonly icon: AppIcon | null
  /** The last choice couldn't be kept. */
  readonly failed: boolean
  readonly choose: (icon: AppIcon) => void
}

export const useAppIcon = (): AppIconModel => {
  const { host } = useServices()
  const [icon, setIcon] = useState<AppIcon | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    void host.appIcon().then(
      (read) => live && setIcon(isAppIcon(read) ? read : 'cobalt'),
      () => live && setIcon('cobalt'),
    )
    return () => {
      live = false
    }
  }, [host])

  const choose = (next: AppIcon) => {
    const before = icon
    setIcon(next)
    setFailed(false)
    host.setAppIcon(next).catch(() => {
      setIcon(before)
      setFailed(true)
    })
  }

  return { icon, failed, choose }
}
