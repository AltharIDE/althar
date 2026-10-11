import { useEffect, useState } from 'react'

import type { UpdateReadyProps } from '@althar/ui'

import type { UpdateGlance } from '../../main/updates'
import { useServices } from '../data/services'

/*
 * An update ready to install, as the main process says (ADR-024), for the
 * quiet line in the window's bar and Settings' foot: the version, whether
 * Althar may restart into it now (not while work runs), and a restart the
 * person asked for. Nothing shows while one is looked for or downloads.
 */

/** What the main process said, checked: null for anything that isn't a glance. */
export const glanceOf = (value: unknown): UpdateGlance | null => {
  if (typeof value !== 'object' || value === null) return null
  const { ready, working, restarting, failed } = value as Record<string, unknown>
  if (!(ready === null || typeof ready === 'string')) return null
  if (typeof working !== 'boolean' || typeof restarting !== 'boolean') return null
  if (!(failed === null || typeof failed === 'string')) return null
  return { ready, working, restarting, failed }
}

export interface UpdateModel {
  /** Null where there is no update ready, or the app doesn't update. */
  readonly ready: Pick<UpdateReadyProps, 'version' | 'onRestart' | 'restarting' | 'error'> | null
}

export const useUpdate = (): UpdateModel => {
  const { host } = useServices()
  const [glance, setGlance] = useState<UpdateGlance | null>(null)

  useEffect(() => {
    const update = host.update
    if (update === undefined) return
    let heard = false
    let live = true
    const off = update.onChange((value) => {
      heard = true
      setGlance(glanceOf(value))
    })
    // What it is now, unless a change was heard first, which is newer.
    void update.glance().then((value) => {
      if (live && !heard) setGlance(glanceOf(value))
    })
    return () => {
      live = false
      off()
    }
  }, [host])

  const update = host.update
  if (glance === null || glance.ready === null || update === undefined) return { ready: null }
  return {
    ready: {
      version: glance.ready,
      restarting: glance.restarting,
      // While work runs there is no Restart: the update installs as Althar quits.
      ...(glance.working ? {} : { onRestart: () => void update.restart() }),
      ...(glance.failed === null ? {} : { error: glance.failed }),
    },
  }
}
