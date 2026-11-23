import { socketCanCall } from '@althar/contracts'

import { useServices } from '../../data/services'
import { device } from '../../shared/device'
import { useHomeState } from './useHomes'

/*
 * The home this window is on, as the screens that read its computer name it:
 * This Mac in this computer's own window, or a home of its own by its name
 * (studio), whose load, agents and workers are that home's. What a window on
 * it may do differs too: adding, changing and removing workers is for the
 * home's own operator (a window over SSH, which reaches it as its operator)
 * or this computer's own window, as pairing a device is; a window on a device
 * paired over the network may not.
 */

export interface WindowHomeName {
  /** As the person knows it: This Mac, or studio. */
  readonly name: string
  /** A home of its own, set up there with althar-host, rather than the home in this app. */
  readonly standalone: boolean
  /** Whether this window may add the home's workers, pick their projects and take them out: one on a paired device may not. */
  readonly canManageWorkers: boolean
  /** It may not because the home runs an older Althar, which lets no window over SSH manage its workers. */
  readonly olderHome: boolean
}

export const useWindowHome = (): WindowHomeName => {
  const { client, host } = useServices()
  const here = useHomeState(host.homes)
  // Over SSH, as its operator, where the home lets a socket manage workers: an older one doesn't, and its window says so.
  const connection = client.connection
  const canManageWorkers =
    connection?.identity.role !== 'socket' ||
    (here?.current.kind === 'ssh' && (connection.calls?.includes('RemoveWorker') ?? socketCanCall('RemoveWorker')))
  const olderHome = connection?.identity.role === 'socket' && here?.current.kind === 'ssh' && !canManageWorkers
  if (here !== null && here.current.kind !== 'local') return { name: here.current.home.name, standalone: true, canManageWorkers, olderHome }
  if (client.connection === undefined) return { name: device.This, standalone: false, canManageWorkers, olderHome }
  // On another home before main says which: never This Mac.
  return { name: text.thisHome, standalone: true, canManageWorkers, olderHome }
}

const text = { thisHome: 'This home' }
