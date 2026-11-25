import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { HomeUpdateOffer, HomeUpdateRun } from '@althar/ui/screens'

import {
  releaseMakesProjects,
  type HomeSetup,
  type HomeState,
  type HomesHost,
  type HomesOverview,
  type RemoteHome,
  type WindowHome,
} from '../../../homes'

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

/** The launcher a home's SSH connection runs where none is saved for it (transport-node's sshArguments): where Althar installs one. */
export const USUAL_LAUNCHER = '"${XDG_DATA_HOME:-$HOME/.local/share}/althar-host-program/launcher"'

const quoted = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

/**
 * How the window's home updates, run there (apps/host/README.md, Managed
 * releases and updates), and how sure the window is of it. Over SSH, by the
 * launcher and profile its connection runs, so it's the very installation
 * the window talks to: `known` where that's where Althar installs one,
 * `custom` where it's one saved for the home, which may be a source
 * checkout's. Paired, or before the window knows, the window can't see how
 * it was installed: `unknown`, by where Althar installs one.
 */
export interface HomeUpdate {
  readonly command: string
  readonly installed: 'known' | 'custom' | 'unknown'
}

export const updateOf = (current: WindowHome | undefined): HomeUpdate => {
  const ssh = current === undefined || current.kind === 'local' ? undefined : current.home.ssh
  const launcher = ssh?.launcher === undefined ? USUAL_LAUNCHER : quoted(ssh.launcher)
  const profile = ssh?.profile === undefined ? '' : ` --profile ${quoted(ssh.profile)}`
  return {
    command: `sh ${launcher} update --apply --wait${profile}`,
    installed: ssh === undefined ? 'unknown' : ssh.launcher === undefined ? 'known' : 'custom',
  }
}

/** How the home the window is on updates, as its connection says. */
export const useHomeUpdate = (): HomeUpdate => {
  const { host } = useServices()
  return updateOf(useHomeState(host.homes)?.current)
}

type Running = 'idle' | 'running' | 'done' | { readonly problem: string }

/**
 * An older home's update, for its window to offer: run by the window itself where it reaches the home over SSH by the
 * launcher Althar installs (`known`), each step as it really stands (the release coming down while the connection
 * holds, the home restarting once it drops), and the window reconnecting onto the new release once it answers; where
 * the window can't, the command to run there and Check again. `onDone` goes just before the window reconnects.
 *
 * Only where a published release would help: the newest is looked for first, and where it's no newer than the last
 * without making projects, the home is told none is out yet (`release: 'unreleased'`), with Check again looking anew.
 * A home run from its own launcher may be a source checkout's, which pulling brings it, so it isn't asked; where the
 * newest can't be found out, the update is offered, and says itself how it went.
 */
export const useHomeUpdating = (
  older: boolean,
  onDone?: () => void,
): { readonly offer: HomeUpdateOffer; readonly onUpdate?: () => void; readonly onCheckAgain: () => void } => {
  const { host } = useServices()
  const homes = host.homes
  const state = useHomeState(homes)
  const overview = useHomesOverview(homes)
  const { command, installed } = updateOf(state?.current)
  const [running, setRunning] = useState<Running>('idle')
  const asked = homes?.release
  const [fresh, setFresh] = useState(0)
  const news = useQuery({
    queryKey: ['homes', 'hostRelease', fresh],
    queryFn: () => asked?.(fresh > 0) ?? Promise.resolve(null),
    enabled: older && asked !== undefined && installed !== 'custom' && state !== null,
    staleTime: 5 * 60_000,
    retry: false,
    placeholderData: (previous) => previous,
  })
  // Its restart stops what's running there: the tasks this window, or another on the home, last counted.
  const home = state !== null && state.current.kind !== 'local' ? state.current.home.homeId : null
  const busy = home === null ? 0 : (overview?.projects[home]?.list.reduce((sum, one) => sum + one.working, 0) ?? 0)
  const connected = state?.connection === 'connected'
  const reconnect = () => void homes?.reconnect().catch(() => undefined)
  const update = homes?.update
  if (asked !== undefined && installed !== 'custom' && running === 'idle') {
    if (news.isPending || news.isFetching) return { offer: { command, installed, release: 'checking' }, onCheckAgain: reconnect }
    if (news.data != null && !releaseMakesProjects(news.data))
      return { offer: { command, installed, release: 'unreleased' }, onCheckAgain: () => setFresh((at) => at + 1) }
  }
  if (update === undefined || installed !== 'known') return { offer: { command, installed }, onCheckAgain: reconnect }
  const run: HomeUpdateRun =
    running === 'idle'
      ? { state: 'idle', ...(busy > 0 ? { busy } : {}) }
      : running === 'running' || running === 'done'
        ? {
            state: 'running',
            step: running === 'done' ? 'reconnecting' : connected ? 'getting' : 'restarting',
          }
        : // The connection dropped on the way: the home may be serving its old release again, for a Reconnect.
          { state: 'failed', problem: running.problem, ...(connected ? {} : { offline: true }) }
  return {
    offer: { command, installed, run },
    onUpdate: () => {
      if (running === 'running' || running === 'done') return
      setRunning('running')
      update().then(
        () => {
          setRunning('done')
          onDone?.()
          reconnect()
        },
        (error: unknown) => setRunning({ problem: homeProblem(error) }),
      )
    },
    onCheckAgain: reconnect,
  }
}

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

export type HomesDialog = 'connect' | 'manage' | 'phones' | null
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
