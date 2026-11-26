import { useQuery } from '@tanstack/react-query'

import { canCall } from '../../data/client'
import { useServices } from '../../data/services'
import { device } from '../../shared/device'
import { useHomeName } from '../homes/useHomes'

/*
 * Whose settings a section changes, in a window on another computer's home:
 * the home's (its agents, MCP servers, skills, code hosts, how its tasks go,
 * its pull requests, its computers), under its name and what it runs; or this
 * computer's own (how Althar works on it, notifications, appearance, the
 * editor and the pages beside conversations), under This Mac. In this
 * computer's own window the home is this computer, and nothing is split.
 */

export interface SettingsHome {
  /** Another computer's home, rather than this computer's own. */
  readonly remote: boolean
  /** As the person knows it: runner-1; this Mac in this computer's own window. */
  readonly name: string
  /** What it runs, as it names itself (Ubuntu 24.04.1 LTS): another computer's home's, once read; else null. */
  readonly system: string | null
}

export const useSettingsHome = (): SettingsHome => {
  const { client } = useServices()
  const { remote, name } = useHomeName()
  const machine = useQuery({
    queryKey: ['machine'],
    queryFn: () => client.getMachine(),
    staleTime: 60_000,
    enabled: remote && canCall(client, 'GetMachine'),
  }).data
  return { remote, name: remote ? name : device.this, system: remote ? (machine?.system ?? null) : null }
}

/** Whether the window's home takes a change from it: any, on this computer's own; on another's, what it says it takes. */
export const useHomeTakes = (tag: string): boolean => canCall(useServices().client, tag)
