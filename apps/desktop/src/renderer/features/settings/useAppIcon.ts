import { useEffect, useRef, useState } from 'react'

import { useServices } from '../../data/services'
import { type AppIcon, isAppIcon } from '../../shared/appIcons'

/*
 * The app's icon, as Settings shows and changes it. A new choice shows at
 * once. If the main process can't keep it, and it is still the latest, the
 * last icon that was kept comes back and the view says so; a choice already
 * replaced fails quietly. Where there is no Dock, there is no icon to choose.
 */

export interface AppIconModel {
  /** The icon chosen, or null until the main process says, and where there is no Dock. */
  readonly icon: AppIcon | null
  /** The last choice couldn't be kept. */
  readonly failed: boolean
  readonly choose: (icon: AppIcon) => void
}

export const useAppIcon = (): AppIconModel => {
  const { host } = useServices()
  const [icon, setIcon] = useState<AppIcon | null>(null)
  const [failed, setFailed] = useState(false)
  // Choices in the order they were made, and the newest of them that was kept: the Dock shows that one.
  const made = useRef(0)
  const kept = useRef<{ readonly icon: AppIcon | null; readonly at: number }>({ icon: null, at: 0 })

  useEffect(() => {
    let live = true
    const read = (next: AppIcon) => {
      if (!live) return
      kept.current = { icon: next, at: 0 }
      setIcon(next)
    }
    void host.appIcon().then(
      (answer) => answer !== null && read(isAppIcon(answer) ? answer : 'cobalt'),
      () => read('cobalt'),
    )
    return () => {
      live = false
    }
  }, [host])

  const choose = (next: AppIcon) => {
    const at = ++made.current
    setIcon(next)
    setFailed(false)
    host.setAppIcon(next).then(
      () => {
        if (at > kept.current.at) kept.current = { icon: next, at }
      },
      () => {
        if (at !== made.current) return
        setIcon(kept.current.icon)
        setFailed(true)
      },
    )
  }

  return { icon, failed, choose }
}
