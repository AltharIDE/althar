import { useSyncExternalStore } from 'react'

import type { CheckedHome, HomeState, HomesHost, RemoteHome, SshHomeTarget } from '../../src/homes'
import { lab, opening } from './state'

/*
 * What the lab's fake main process knows of homes: the saved ones, which has
 * a window open and how that window's connection stands, and a host check
 * that answers as a real one might. Typing a host with "down" in it times
 * out; "nohome", a host without Althar's host; "old", a home on an older API.
 * Opening a home opens (or brings forward) its window, which connects in a
 * moment. The lab's bar drops a window's connection, or makes the next
 * reconnect fail, to see those states.
 *
 * Beyond the HomesHost #982 has, the directions read two facts main keeps or
 * could keep: when each home was last opened, and whether its window is open.
 */

export interface LabHome extends RemoteHome {
  /** Minutes since it was last opened. */
  readonly opened: number
  /** Only with "Many" on. */
  readonly many?: boolean
}

const hex = (seed: string) => {
  let out = ''
  let h = 2166136261
  for (let i = 0; out.length < 32; i++) {
    h ^= seed.charCodeAt(i % seed.length) + i
    h = Math.imul(h, 16777619) >>> 0
    out += h.toString(16).padStart(8, '0').slice(0, 4)
  }
  return out.slice(0, 32)
}
export const homeIdOf = (target: string) => `home_${hex(target)}`

const saved = (id: string, name: string, target: string, opened: number, many?: boolean): LabHome => ({
  id,
  name,
  homeId: homeIdOf(target),
  ssh: { target },
  opened,
  ...(many ? { many } : {}),
})

let homes: LabHome[] = [
  saved('hetzner', 'hetzner-01', 'balazs@hetzner-01', 40),
  saved('studio', 'Studio Mac mini', 'studio', 60 * 26),
  saved('build', 'Build server in Frankfurt, second rack', 'ci@build-fra-02.internal.example.com', 60 * 24 * 6, true),
  saved('pi', 'Raspberry Pi', 'pi@raspberrypi.local', 60 * 24 * 20, true),
  saved('office', 'Office workstation', 'balazs@ws-office', 60 * 24 * 41, true),
]

export const HOST_VERSION = '0.9.2'
export const API_VERSION = 7

export type Connection = 'connecting' | 'connected' | 'disconnected'
interface WindowNow {
  readonly connection: Connection
  readonly problem?: string
  /** It has been connected: what it read is on screen, and connecting now is connecting again. */
  readonly again?: boolean
}

const windows = new Map<string, WindowNow>()
let failNext = false
const listeners = new Set<() => void>()
const stateListeners = new Map<string, Set<(state: HomeState) => void>>()
const openListeners = new Map<string, Set<() => void>>()
let version = 0

const changed = (windowId?: string) => {
  version++
  for (const listener of listeners) listener()
  if (windowId !== undefined) for (const listener of stateListeners.get(windowId) ?? []) listener(stateOf(windowId))
}

export const shownHomes = (): ReadonlyArray<LabHome> => homes.filter((home) => lab.get().many || home.many !== true)
export const homeOf = (id: string) => homes.find((home) => home.id === id)

export const stateOf = (windowId: string): HomeState => {
  const home = homeOf(windowId)
  if (windowId === 'local' || home === undefined) return { current: { kind: 'local' }, connection: 'local' }
  const now = windows.get(windowId) ?? { connection: 'connecting' }
  return {
    current: { kind: 'ssh', home },
    connection: now.connection,
    ...(now.connection === 'connected'
      ? { identity: { homeId: home.homeId, actorId: `act_${hex('ada')}`, deviceId: `dev_${hex(home.id)}`, role: 'socket' as const } }
      : {}),
    ...(now.problem === undefined ? {} : { problem: now.problem }),
  }
}

/** Connecting a window's tunnel: in a moment, or, where its host is down or the lab said so, refused. */
const connectWindow = (windowId: string) => {
  const again = windows.get(windowId)?.again === true
  windows.set(windowId, { connection: 'connecting', again })
  changed(windowId)
  const home = homeOf(windowId)
  setTimeout(
    () => {
      if (windows.get(windowId)?.connection !== 'connecting') return
      const fails = failNext || home?.ssh.target.includes('down') === true
      failNext = false
      windows.set(
        windowId,
        fails
          ? {
              connection: 'disconnected',
              problem: `ssh: connect to host ${hostOf(home?.ssh.target ?? '')} port 22: Network is unreachable`,
              again,
            }
          : { connection: 'connected', again: true },
      )
      changed(windowId)
    },
    again ? 1600 : 1100,
  )
}

export const hostOf = (target: string) => target.split('@').at(-1) ?? target

/** A home's window: opened (or brought forward), connecting as it opens. */
export const openWindow = (id: string) => {
  if (id !== 'local' && !windows.has(id)) connectWindow(id)
  lab.set({ w: id })
  changed()
}

export const world = {
  /** The windows open, this computer's first. */
  windows: () => ['local', ...homes.filter((home) => windows.has(home.id)).map((home) => home.id)],
  isOpen: (id: string) => id === 'local' || windows.has(id),
  closeWindow: (id: string) => {
    windows.delete(id)
    if (lab.get().w === id) lab.set({ w: 'local' })
    changed()
  },
  /** The lab's bar: the connection broke. */
  drop: (id: string) => {
    if (!windows.has(id)) return
    windows.set(id, { connection: 'disconnected', problem: 'The connection to the host closed: Broken pipe.', again: true })
    changed(id)
  },
  failNext: () => {
    failNext = !failNext
    changed()
  },
  failing: () => failNext,
  showHomes: (windowId: string) => {
    for (const listener of openListeners.get(windowId) ?? []) listener()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  version: () => version,
}

/** Re-renders on any change of homes or windows. */
export const useWorld = () => useSyncExternalStore(world.subscribe, world.version)

/** How a host check answers, by what was typed. */
const checkOf = (target: SshHomeTarget): CheckedHome | Error => {
  const host = hostOf(target.target)
  if (target.target.includes('down')) return new Error(`ssh: connect to host ${host} port ${target.port ?? 22}: Operation timed out`)
  if (target.target.includes('nohome'))
    return new Error(`${host} answered over SSH, but althar-host isn’t installed there, or isn’t on its PATH.`)
  if (target.target.includes('old'))
    return new Error(`This host uses API 6; this app uses API ${API_VERSION}. Update them before connecting.`)
  return {
    checkId: `chk_${hex(target.target + Date.now())}`,
    homeId: homeIdOf(target.target),
    hostDeviceId: `dev_${hex(`${host}-host`)}`,
    apiVersion: API_VERSION,
    version: HOST_VERSION,
    target: target.target,
  }
}

const checks = new Map<string, SshHomeTarget>()

/** The homes, as a window's preload hands them to it. */
/** Each window's homes, one per window, as its preload gives it. */
const hosts = new Map<string, HomesHost>()
export const homesFor = (windowId: string): HomesHost => {
  const known = hosts.get(windowId)
  if (known !== undefined) return known
  const made = makeHomes(windowId)
  hosts.set(windowId, made)
  return made
}

const makeHomes = (windowId: string): HomesHost => {
  let checking: { timer: ReturnType<typeof setTimeout>; reject: (error: Error) => void } | null = null
  return {
    state: async () => stateOf(windowId),
    list: async () => shownHomes(),
    inspect: (target) =>
      new Promise((resolve, reject) => {
        checking?.reject(new Error('The home check was cancelled.'))
        const timer = setTimeout(
          () => {
            checking = null
            const answer = checkOf(target)
            if (answer instanceof Error) reject(answer)
            else {
              checks.set(answer.checkId, target)
              resolve(answer)
            }
          },
          target.target.includes('down') ? 2600 : 1500,
        )
        checking = { timer, reject }
      }),
    cancelCheck: async () => {
      if (checking === null) return
      clearTimeout(checking.timer)
      checking.reject(new Error('The home check was cancelled.'))
      checking = null
    },
    connect: async (checkId, name) => {
      const target = checks.get(checkId)
      if (target === undefined) throw new Error('This home check expired or belongs to another window. Check the host again.')
      await new Promise((resolve) => setTimeout(resolve, 400))
      const existing = homes.find((home) => home.homeId === homeIdOf(target.target))
      const id = existing?.id ?? `h_${hex(target.target).slice(0, 8)}`
      if (existing === undefined) homes = [{ id, name: name.trim(), homeId: homeIdOf(target.target), ssh: target, opened: 0 }, ...homes]
      openWindow(id)
    },
    open: async (id) => {
      await new Promise((resolve) => setTimeout(resolve, 120))
      if (id !== 'local' && homeOf(id) === undefined) throw new Error('This saved home was forgotten. Check its host to connect again.')
      openWindow(id)
    },
    forget: async (id) => {
      await new Promise((resolve) => setTimeout(resolve, 150))
      homes = homes.filter((home) => home.id !== id)
      if (windows.has(id)) world.closeWindow(id)
      changed()
    },
    reconnect: async () => {
      if (windowId === 'local') throw new Error('This window uses its local runtime.')
      connectWindow(windowId)
    },
    onState: (listener) => {
      const set = stateListeners.get(windowId) ?? new Set()
      set.add(listener)
      stateListeners.set(windowId, set)
      return () => set.delete(listener)
    },
    onOpen: (listener) => {
      const set = openListeners.get(windowId) ?? new Set()
      set.add(listener)
      openListeners.set(windowId, set)
      return () => set.delete(listener)
    },
  }
}

/** A screenshot's window, as the address says: open, and connected, connecting or dropped. */
const first = lab.get().w
if (first !== 'local' && homeOf(first) !== undefined) {
  windows.set(
    first,
    opening.conn === 'connecting'
      ? { connection: 'connecting' }
      : opening.conn === 'reconnecting'
        ? { connection: 'connecting', again: true }
        : opening.conn === 'dropped'
          ? { connection: 'disconnected', problem: 'The connection to the host closed: Broken pipe.', again: true }
          : opening.conn === 'failed'
            ? {
                connection: 'disconnected',
                problem: `ssh: connect to host ${hostOf(homeOf(first)?.ssh.target ?? '')} port 22: Network is unreachable`,
                again: true,
              }
            : opening.conn === 'refused'
              ? {
                  connection: 'disconnected',
                  problem: `ssh: connect to host ${hostOf(homeOf(first)?.ssh.target ?? '')} port 22: Network is unreachable`,
                }
              : { connection: 'connected', again: true },
  )
}

/** Whether a window has been connected: what it read is on screen, and connecting now is connecting again. */
export const againOf = (windowId: string) => windows.get(windowId)?.again === true

/** "40 minutes ago", "Yesterday", "6 days ago", as a home's last opening reads. */
export const openedAgo = (minutes: number) => {
  if (minutes < 2) return 'Just now'
  if (minutes < 60) return `${minutes} minutes ago`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} hours ago`
  if (minutes < 60 * 48) return 'Yesterday'
  return `${Math.round(minutes / 60 / 24)} days ago`
}
