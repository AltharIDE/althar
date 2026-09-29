import { createContext, type ReactNode, useContext, useEffect, useEffectEvent } from 'react'

import type { WatchEvent } from '@charrette/contracts'

import type { Client } from './client'

/*
 * What the view models reach through React: the runtime's client, and the
 * few things only the host can do, such as opening the folder picker. Tests
 * give fakes of both.
 */

export interface Host {
  /** Asks the person for a folder; null when they cancel. */
  readonly pickFolder: () => Promise<string | null>
  /** Where a dropped file or folder is on disk; empty when it isn't one. */
  readonly pathOf: (file: File) => string
}

export interface Services {
  readonly client: Client
  readonly host: Host
}

const ServicesContext = createContext<Services | null>(null)

export function ServicesProvider({ value, children }: { value: Services; children: ReactNode }) {
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>
}

export const useServices = (): Services => {
  const services = useContext(ServicesContext)
  if (services === null) throw new Error('useServices needs a ServicesProvider')
  return services
}

/** Calls `listener` with every change while the component is mounted. */
export const useWatch = (listener: (event: WatchEvent) => void) => {
  const { client } = useServices()
  const onEvent = useEffectEvent(listener)
  useEffect(() => client.watch((event) => onEvent(event)), [client])
}
