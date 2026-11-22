import { socketCanCall } from '@althar/contracts'

import { useServices } from '../../data/services'
import { device } from '../../shared/device'
import { useHomeState } from './useHomes'

/*
 * The home this window is on, as the screens that read its computer name it:
 * This Mac in this computer's own window, or a home of its own by its name
 * (studio), whose load, agents and workers are that home's. What a window on
 * it may do differs too: over SSH, it can't take workers out.
 */

export interface WindowHomeName {
  /** As the person knows it: This Mac, or studio. */
  readonly name: string
  /** A home of its own, set up there with althar-host, rather than the home in this app. */
  readonly standalone: boolean
  /** Whether this window may take the home's workers out: one over SSH may not. */
  readonly canRemoveWorkers: boolean
}

export const useWindowHome = (): WindowHomeName => {
  const { client, host } = useServices()
  const here = useHomeState(host.homes)
  const canRemoveWorkers = client.connection?.identity.role !== 'socket' || socketCanCall('RemoveWorker')
  if (here !== null && here.current.kind !== 'local') return { name: here.current.home.name, standalone: true, canRemoveWorkers }
  if (client.connection === undefined) return { name: device.This, standalone: false, canRemoveWorkers }
  // On another home before main says which: never This Mac.
  return { name: text.thisHome, standalone: true, canRemoveWorkers }
}

const text = { thisHome: 'This home' }
