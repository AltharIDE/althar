import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createContext, type ReactNode, useContext, useEffect, useEffectEvent } from 'react'

import type { WatchEvent } from '@althar/contracts'

import type { Client } from './client'
import type { Feed } from './feed'

/*
 * What the view models reach through React: the runtime's client, the
 * window's cache of what it read and its watch on what changes, and the few
 * things only the host can do, such as opening the folder picker. Tests give
 * fakes of the client and the host.
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
  /** The icon the person gave the app, by name (see `shared/appIcons`), or null where there is no Dock to show one. */
  readonly appIcon: () => Promise<string | null>
  /** Gives the app another icon, kept and shown on the Dock at once. */
  readonly setAppIcon: (icon: string) => Promise<void>
  /** Calls `listener` with the thread a notification the person clicked is about, until the returned function is called. */
  readonly onOpen: (listener: (threadId: string) => void) => () => void
}

export interface Services {
  readonly client: Client
  readonly host: Host
  /** What the window has read, by key (`reads.ts`). */
  readonly cache: QueryClient
  readonly feed: Feed
}

const ServicesContext = createContext<Services | null>(null)

export function ServicesProvider({ value, children }: { value: Services; children: ReactNode }) {
  return (
    <ServicesContext.Provider value={value}>
      <QueryClientProvider client={value.cache}>{children}</QueryClientProvider>
    </ServicesContext.Provider>
  )
}

export const useServices = (): Services => {
  const services = useContext(ServicesContext)
  if (services === null) throw new Error('useServices needs a ServicesProvider')
  return services
}

/** Calls `listener` with every change the window hears while the component is mounted. */
export const useWatch = (listener: (event: WatchEvent) => void) => {
  const { feed } = useServices()
  const onEvent = useEffectEvent(listener)
  useEffect(() => feed.listen((event) => onEvent(event)), [feed])
}
