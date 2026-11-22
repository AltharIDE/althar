import { useEffect, useState, useSyncExternalStore } from 'react'
import type { HomeSetup, HomeState, HomesHost, HomesOverview, RemoteHome } from '../../../homes'

import { useServices } from '../../data/services'
import { device } from '../../shared/device'

/*
 * What the window's homes share: where its own home stands, what main knows
 * of every home (kept current as main says it changes), and what is open over
 * the window: the chip's menu, Connect a home, or Manage homes.
 */

export const homeProblem = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
    : 'The home connection could not be changed. Try again.'

/** A slower first read never replaces a newer event: shared by the window's home and the overview. */
const useFollowed = <A>(read: (() => Promise<A>) | undefined, follow: ((listener: (value: A) => void) => () => void) | undefined) => {
  const [value, setValue] = useState<A | null>(null)
  useEffect(() => {
    if (read === undefined || follow === undefined) return
    let live = true
    let events = 0
    const off = follow((next) => {
      events++
      if (live) setValue(next)
    })
    const readAt = events
    void read()
      .then((next) => {
        if (live && events === readAt) setValue(next)
      })
      .catch(() => undefined)
    return () => {
      live = false
      off()
    }
  }, [read, follow])
  return value
}

export const useHomeState = (homes: HomesHost | undefined): HomeState | null => useFollowed(homes?.state, homes?.onState)

/** How a home installed as the desktop sets one up updates itself, run there (apps/host/README.md, Managed releases and updates). */
export const UPDATE_COMMAND = 'sh "$HOME/.local/share/althar-host-program/launcher" update --apply --wait'

/**
 * The home the window is on, as its words name it: another computer's by its
 * name (runner-1), this one's as this computer is named (this Mac).
 */
export const useHomeName = (): { readonly remote: boolean; readonly name: string } => {
  const { client, host } = useServices()
  const state = useHomeState(host.homes)
  const remote = client.connection !== undefined
  if (!remote) return { remote, name: device.this }
  return { remote, name: state !== null && state.current.kind !== 'local' ? state.current.home.name : 'this home' }
}

/** Every home, as main knows it; null until first read. */
export const useHomesOverview = (homes: HomesHost | undefined): HomesOverview | null => useFollowed(homes?.overview, homes?.onOverview)

/** A home being set up over SSH, as main tells it; null while there's none, and until first read. */
export const useHomeSetup = (homes: HomesHost | undefined): HomeSetup | null => useFollowed(homes?.setup, homes?.onSetup)

/** Asks the window to show its homes, as File › Homes… does: the chip's menu, or Connect a home where there's no chip yet. */
export const showHomes = () => window.dispatchEvent(new Event('althar:show-homes'))

export type HomesDialog = 'connect' | 'manage' | null
interface HomesUi {
  readonly menu: boolean
  readonly dialog: HomesDialog
  /** How many chips are drawn: with none, there's no menu to open. */
  readonly chips: number
}
let ui: HomesUi = { menu: false, dialog: null, chips: 0 }
const listeners = new Set<() => void>()
/** What is open over this window for its homes. Each window is its own page, so this is the window's own. */
export const homesUi = {
  get: () => ui,
  set: (next: Partial<HomesUi>) => {
    ui = { ...ui, ...next }
    for (const listener of listeners) listener()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  },
}
export const useHomesUi = () => useSyncExternalStore(homesUi.subscribe, homesUi.get)

/** The key main files a home's window and projects under: `local`, or the home's identity. */
export const keyOf = (home: { readonly id: string; readonly homeId?: string } | 'local') =>
  home === 'local' || home.id === 'local' ? 'local' : (home.homeId ?? home.id)

/** How a home's window stands: connected, on its way, dropped, or none open. This computer is always here. */
export type Liveness = 'live' | 'connecting' | 'down' | 'rest'
export const livenessOf = (overview: HomesOverview | null, home: RemoteHome | 'local'): Liveness => {
  if (home === 'local') return 'live'
  const connection = overview?.windows[home.homeId]
  return connection === 'connected' ? 'live' : connection === 'connecting' ? 'connecting' : connection === 'disconnected' ? 'down' : 'rest'
}

/** "40 minutes ago", "Yesterday", "6 days ago": when a home was last opened. */
export const openedAgo = (at: number | undefined, now = Date.now()) => {
  if (at === undefined) return 'Not opened yet'
  const minutes = Math.max(0, Math.round((now - at) / 60_000))
  if (minutes < 2) return 'Just now'
  if (minutes < 60) return `${minutes} minutes ago`
  if (minutes < 60 * 24) return Math.round(minutes / 60) === 1 ? 'An hour ago' : `${Math.round(minutes / 60)} hours ago`
  if (minutes < 60 * 48) return 'Yesterday'
  return `${Math.round(minutes / 60 / 24)} days ago`
}

/** The host, without its user. */
export const hostOf = (target: string) => target.split('@').at(-1) ?? target
/** A name to start from: the host, without its user or domain. */
export const nameFrom = (target: string) => hostOf(target.trim()).replace(/\..*$/, '')
