import { createContext, type ReactNode, useContext, useEffect, useEffectEvent } from 'react'

import type { WatchEvent } from '@charrette/contracts'

import type { Client } from './client'

/*
 * What the view models reach through React: the runtime's client, and the
 * few things only the host can do, such as opening the folder picker. Tests
 * give fakes of both.
 */

/**
 * What only the app's main process can do. The window never handles a path:
 * the main process shows the picker, or is told what was dropped, and hands
 * back a grant the runtime knows the folder by.
 */
export interface Host {
  /** Asks the person for a folder, for a project or an agent's account; its grant, or null when they cancel. */
  readonly pickFolder: (purpose?: 'project' | 'account') => Promise<string | null>
  /** A grant for a folder dropped on the window; null when it isn't a folder on disk. */
  readonly grantDropped: (file: File) => Promise<string | null>
  /** Calls `listener` with the thread a notification the person clicked is about, until the returned function is called. */
  readonly onOpen: (listener: (threadId: string) => void) => () => void
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

/**
 * Calls `listener` with every change after `since`, the cursor of the view
 * model's first read, while the component is mounted. Until that read has
 * come back (`since` is null), it doesn't watch; after, it doesn't start
 * again when later reads move the cursor on.
 */
export const useWatch = (listener: (event: WatchEvent) => void, since: number | null) => {
  const { client } = useServices()
  const onEvent = useEffectEvent(listener)
  useEffect(() => (since === null ? undefined : client.watch((event) => onEvent(event), since)), [client, since])
}
