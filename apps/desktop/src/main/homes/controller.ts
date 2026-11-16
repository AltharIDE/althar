import { randomUUID } from 'node:crypto'

import { API_VERSION, ClientDeviceId, ClientIdentity, HomeId } from '@althar/contracts'
import { Schema } from 'effect'

import type { CheckedHome, HomeState, RemoteHome, SshHomeTarget, WindowHome } from '../../homes'
import { homeName, homeTarget, type homeStore } from './store'

export interface HostStatus {
  readonly homeId: string
  readonly hostDeviceId: string
  readonly apiVersion: number
  readonly version: string
}
const statusSchema = Schema.Struct({
  homeId: HomeId,
  hostDeviceId: ClientDeviceId,
  apiVersion: Schema.Int,
  version: Schema.String.check(Schema.isMaxLength(128)),
})
interface Pending {
  readonly owner: number
  readonly target: SshHomeTarget
  readonly status: HostStatus
  readonly expires: number
}
interface WindowState {
  readonly state: HomeState
  readonly generation: number
  readonly page: number
}
export interface HomeControllerOptions {
  readonly store: ReturnType<typeof homeStore>
  readonly pair?: (code: string, name: string, signal: AbortSignal) => Promise<RemoteHome>
  readonly inspect: (target: SshHomeTarget, signal: AbortSignal) => Promise<HostStatus>
  readonly open: (home: WindowHome) => void
  readonly changed: (owner: number, state: HomeState) => void
  readonly now?: () => number
}
const notAvailable = () => new Error('This home check expired or belongs to another window. Check the host again.')

/** Window-scoped, one-use confirmation. A renderer never chooses a home identity or claims paired authority. */
export const homeController = ({ store, inspect, pair, open, changed, now = Date.now }: HomeControllerOptions) => {
  let accepting = true
  const available = () => {
    if (!accepting) throw new Error('Althar is closing its home connections.')
  }
  const windows = new Map<number, WindowState>()
  const checks = new Map<string, Pending>()
  const inspecting = new Map<number, AbortController>()
  const activeInspections = new Set<AbortController>()
  const state = (owner: number): HomeState => windows.get(owner)?.state ?? { current: { kind: 'local' }, connection: 'local' }
  const cancelCheck = (owner: number) => {
    inspecting.get(owner)?.abort()
    inspecting.delete(owner)
    for (const [id, check] of checks) if (check.owner === owner) checks.delete(id)
  }
  const update = (owner: number, state: HomeState, generation: number) => {
    windows.set(owner, { state, generation, page: windows.get(owner)?.page ?? 0 })
    changed(owner, state)
  }
  return {
    state,
    stopping: () => {
      accepting = false
      for (const stop of activeInspections) stop.abort()
      inspecting.clear()
      checks.clear()
    },
    list: store.list,
    register: (owner: number, home: WindowHome) => {
      available()
      if (windows.has(owner)) throw new Error('This window already belongs to a home.')
      windows.set(owner, { state: { current: home, connection: home.kind === 'local' ? 'local' : 'connecting' }, generation: 0, page: 0 })
    },
    pair: async (owner: number, code: unknown, name: unknown) => {
      available()
      const label = homeName(name)
      if (pair === undefined || typeof code !== 'string' || code.length > 8192 || !windows.has(owner))
        throw new Error('Use a pairing code from the host in an open Althar window.')
      if (activeInspections.size >= 8) throw new Error('Several homes are being connected. Try again shortly.')
      cancelCheck(owner)
      const page = windows.get(owner)?.page
      const stop = new AbortController()
      inspecting.set(owner, stop)
      activeInspections.add(stop)
      try {
        const home = await pair(code, label, stop.signal)
        await store.save(home)
        if (accepting && !stop.signal.aborted && windows.get(owner)?.page === page) open({ kind: 'https', home })
      } finally {
        activeInspections.delete(stop)
        if (inspecting.get(owner) === stop) inspecting.delete(owner)
      }
    },
    inspect: async (owner: number, value: unknown): Promise<CheckedHome> => {
      available()
      if (!windows.has(owner)) throw new Error('This window is no longer open.')
      for (const [id, check] of checks) if (check.expires <= now()) checks.delete(id)
      if (activeInspections.size >= 8) throw new Error('Several hosts are being checked. Try again shortly.')
      cancelCheck(owner)
      const target = homeTarget(value)
      const stop = new AbortController()
      inspecting.set(owner, stop)
      activeInspections.add(stop)
      try {
        const status = Schema.decodeUnknownSync(statusSchema)(await inspect(target, stop.signal))
        if (stop.signal.aborted || !windows.has(owner)) throw notAvailable()
        if (status.apiVersion !== API_VERSION)
          throw new Error(`This host uses API ${status.apiVersion}; this app uses API ${API_VERSION}. Update them before connecting.`)
        const checkId = randomUUID()
        checks.set(checkId, { owner, target, status, expires: now() + 5 * 60_000 })
        return { checkId, ...status, target: target.target }
      } finally {
        activeInspections.delete(stop)
        if (inspecting.get(owner) === stop) inspecting.delete(owner)
      }
    },
    connect: async (owner: number, checkId: unknown, name: unknown) => {
      available()
      const label = homeName(name)
      const pending = typeof checkId === 'string' ? checks.get(checkId) : undefined
      if (pending === undefined || pending.owner !== owner || pending.expires <= now() || !windows.has(owner)) throw notAvailable()
      checks.delete(checkId as string)
      const page = windows.get(owner)?.page
      const home = await store.save({
        id: `remote_${randomUUID().replaceAll('-', '')}`,
        name: label,
        homeId: pending.status.homeId,
        ssh: pending.target,
      })
      // Saving settings may outlive its window, but cannot open a replacement window after the caller closed.
      if (accepting && windows.get(owner)?.page === page) open({ kind: home.https === undefined ? 'ssh' : 'https', home })
    },
    open: async (owner: number, id: unknown) => {
      available()
      if (!windows.has(owner)) throw new Error('This window is no longer open.')
      const page = windows.get(owner)?.page
      if (id === 'local') {
        open({ kind: 'local' })
        return
      }
      const home = (await store.list()).find((one) => one.id === id)
      if (home === undefined) throw new Error('This saved home was forgotten. Check its host to connect again.')
      if (accepting && windows.get(owner)?.page === page) open({ kind: home.https === undefined ? 'ssh' : 'https', home })
    },
    forget: async (owner: number, id: unknown) => {
      available()
      if (!windows.has(owner) || typeof id !== 'string' || !/^remote_[0-9a-f]{32}$/.test(id))
        throw new Error('Choose a saved home to forget.')
      await store.forget(id)
    },
    begin: (owner: number): { readonly home: RemoteHome; readonly generation: number } => {
      available()
      const previous = windows.get(owner)
      if (previous === undefined || previous.state.current.kind === 'local') throw new Error('This window uses its local runtime.')
      const generation = previous.generation + 1
      update(owner, { current: previous.state.current, connection: 'connecting' }, generation)
      return { home: previous.state.current.home, generation }
    },
    connected: (owner: number, generation: number, value: unknown): boolean => {
      const previous = windows.get(owner)
      if (!accepting || previous === undefined || previous.generation !== generation || previous.state.current.kind === 'local')
        return false
      const identity = Schema.decodeUnknownSync(ClientIdentity)(value)
      if (
        identity.homeId !== previous.state.current.home.homeId ||
        identity.role !== 'socket' ||
        (previous.state.current.home.https !== undefined && identity.deviceId !== previous.state.current.home.https.deviceId)
      )
        throw new Error('The home returned an unexpected identity or authority.')
      update(owner, { current: previous.state.current, connection: 'connected', identity }, generation)
      return true
    },
    disconnected: (owner: number, generation: number, problem = 'The home disconnected. Reconnect to see its latest state.') => {
      const previous = windows.get(owner)
      if (previous === undefined || previous.generation !== generation || previous.state.current.kind === 'local') return
      update(owner, { current: previous.state.current, connection: 'disconnected', problem }, generation)
    },
    isCurrent: (owner: number, generation: number) => accepting && windows.get(owner)?.generation === generation,
    navigating: (owner: number) => {
      cancelCheck(owner)
      const previous = windows.get(owner)
      if (previous !== undefined) windows.set(owner, { ...previous, page: previous.page + 1 })
    },
    closed: (owner: number) => {
      cancelCheck(owner)
      windows.delete(owner)
    },
  }
}
export type HomeController = ReturnType<typeof homeController>
