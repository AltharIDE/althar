import { randomUUID } from 'node:crypto'

import { API_VERSION, ClientDeviceId, ClientIdentity, HomeId, PAIRING_CODE_MAX_LENGTH } from '@althar/contracts'
import { Schema } from 'effect'

import type { CheckedHome, HomeProjects, HomeState, HomesOverview, RemoteHome, SshHomeTarget, WindowHome } from '../../homes'
import { type HomeGlances, reportedProjects } from './glances'
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
export type HomeUsageEvent =
  | { readonly name: 'home_pairing'; readonly properties: { readonly outcome: 'paired' | 'failed' | 'cancelled' } }
  | { readonly name: 'home_ssh_check'; readonly properties: { readonly outcome: 'verified' | 'failed' | 'cancelled' } }
  | {
      readonly name: 'home_connection'
      readonly properties: { readonly transport: 'ssh' | 'https'; readonly outcome: 'connected' | 'failed' | 'disconnected' }
    }
export interface HomeControllerOptions {
  readonly store: ReturnType<typeof homeStore>
  readonly pair?: (code: string, name: string, signal: AbortSignal) => Promise<RemoteHome>
  readonly inspect: (target: SshHomeTarget, signal: AbortSignal) => Promise<HostStatus>
  readonly open: (home: WindowHome, projectId?: string) => void
  readonly changed: (owner: number, state: HomeState) => void
  /** What the chip's menu and Manage homes show changed: the saved homes, a window and how it stands, or a home's projects. */
  readonly overviewChanged?: () => void
  readonly usage?: (event: HomeUsageEvent) => void
  readonly glances?: HomeGlances
  readonly now?: () => number
}
const notAvailable = () => new Error('This home check expired or belongs to another window. Check the host again.')
const notRestorable = () => new Error('This home can’t be put back now. Check its host to connect again.')
const savedId = /^remote_[0-9a-f]{32}$/
const projectIdOf = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.length > 128 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Choose a project on the home.')
  return value
}
/** How a window's connection ranks where several are open on one home: the best of them is how the home stands. */
const RANK: Record<HomeState['connection'], number> = { local: 3, connected: 2, connecting: 1, disconnected: 0 }
const FORGOTTEN_FOR = 30_000

/** Window-scoped, one-use confirmation. A renderer never chooses a home identity or claims paired authority. */
export const homeController = ({
  store,
  inspect,
  pair,
  open,
  changed,
  overviewChanged = () => {},
  usage = () => {},
  glances,
  now = Date.now,
}: HomeControllerOptions) => {
  let accepting = true
  const available = () => {
    if (!accepting) throw new Error('Althar is closing its home connections.')
  }
  const windows = new Map<number, WindowState>()
  const checks = new Map<string, Pending>()
  const inspecting = new Map<number, AbortController>()
  const activeInspections = new Set<AbortController>()
  /** Homes forgotten a moment ago, by id, held in main so Undo never takes a home's identity from a window. */
  const forgotten = new Map<string, { readonly home: RemoteHome; readonly index: number; readonly expires: number }>()
  const restorable = () => {
    for (const [id, one] of forgotten) if (one.expires <= now()) forgotten.delete(id)
    return [...forgotten.values()].map((one) => one.home)
  }
  const keyOf = (home: WindowHome) => (home.kind === 'local' ? 'local' : home.home.homeId)
  const state = (owner: number): HomeState => windows.get(owner)?.state ?? { current: { kind: 'local' }, connection: 'local' }
  const cancelCheck = (owner: number) => {
    inspecting.get(owner)?.abort()
    inspecting.delete(owner)
    for (const [id, check] of checks) if (check.owner === owner) checks.delete(id)
  }
  const update = (owner: number, state: HomeState, generation: number) => {
    windows.set(owner, { state, generation, page: windows.get(owner)?.page ?? 0 })
    changed(owner, state)
    overviewChanged()
  }
  /** Every window on a saved home takes its new name or connection: the chip says it, and a reconnect uses it. */
  const resaved = (home: RemoteHome) => {
    for (const [owner, one] of windows) {
      const { current } = one.state
      if (current.kind !== 'local' && current.home.id === home.id)
        update(owner, { ...one.state, current: { kind: home.https === undefined ? 'ssh' : 'https', home } }, one.generation)
    }
  }
  const checkOf = (owner: number, checkId: unknown) => {
    const pending = typeof checkId === 'string' ? checks.get(checkId) : undefined
    if (pending === undefined || pending.owner !== owner || pending.expires <= now() || !windows.has(owner)) throw notAvailable()
    checks.delete(checkId as string)
    return pending
  }
  const savedOf = (id: unknown) => {
    if (typeof id !== 'string' || !savedId.test(id)) throw new Error('Choose a saved home.')
    return id
  }
  const opening = (home: RemoteHome) => {
    glances?.opened(home.id)
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
    overview: async (): Promise<HomesOverview> => {
      const homes = await store.list()
      const windowsBy: Record<string, HomeState['connection']> = {}
      for (const { state } of windows.values()) {
        const key = keyOf(state.current)
        const was = windowsBy[key]
        if (was === undefined || RANK[state.connection] > RANK[was]) windowsBy[key] = state.connection
      }
      const live = (owner: number) => {
        const connection = windows.get(owner)?.state.connection
        return connection === 'local' || connection === 'connected'
      }
      const projects: Record<string, HomeProjects> = {}
      for (const key of new Set(['local', ...homes.map((home) => home.homeId), ...(glances?.keys() ?? [])])) {
        const known = glances?.projectsOf(key, live)
        if (known !== undefined) projects[key] = known
      }
      return { homes, windows: windowsBy, projects, opened: glances?.openedAt() ?? {} }
    },
    /** Saved ids and identities still wanted in the glances' cache: the saved homes', and those that can be put back. */
    wanted: async () => {
      const homes = [...(await store.list()), ...restorable()]
      return { ids: new Set(homes.map((home) => home.id)), keys: new Set(homes.map((home) => home.homeId)) }
    },
    register: (owner: number, home: WindowHome) => {
      available()
      if (windows.has(owner)) throw new Error('This window already belongs to a home.')
      windows.set(owner, { state: { current: home, connection: home.kind === 'local' ? 'local' : 'connecting' }, generation: 0, page: 0 })
      if (home.kind !== 'local') opening(home.home)
      overviewChanged()
    },
    pair: async (owner: number, code: unknown, name: unknown) => {
      available()
      const label = homeName(name)
      if (pair === undefined || typeof code !== 'string' || code.length > PAIRING_CODE_MAX_LENGTH || !windows.has(owner))
        throw new Error('Use a pairing code from the host in an open Althar window.')
      if (activeInspections.size >= 8) throw new Error('Several homes are being connected. Try again shortly.')
      cancelCheck(owner)
      const page = windows.get(owner)?.page
      const stop = new AbortController()
      inspecting.set(owner, stop)
      activeInspections.add(stop)
      let paired = false
      try {
        const home = await pair(code, label, stop.signal)
        await store.save(home)
        paired = true
        overviewChanged()
        if (accepting && !stop.signal.aborted && windows.get(owner)?.page === page) open({ kind: 'https', home })
      } finally {
        activeInspections.delete(stop)
        if (inspecting.get(owner) === stop) inspecting.delete(owner)
        usage({ name: 'home_pairing', properties: { outcome: paired ? 'paired' : stop.signal.aborted ? 'cancelled' : 'failed' } })
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
      let verified = false
      try {
        const status = Schema.decodeUnknownSync(statusSchema)(await inspect(target, stop.signal))
        if (stop.signal.aborted || !windows.has(owner)) throw notAvailable()
        if (status.apiVersion !== API_VERSION)
          throw new Error(`This host uses API ${status.apiVersion}; this app uses API ${API_VERSION}. Update them before connecting.`)
        const checkId = randomUUID()
        checks.set(checkId, { owner, target, status, expires: now() + 5 * 60_000 })
        verified = true
        return { checkId, ...status, target: target.target }
      } finally {
        activeInspections.delete(stop)
        if (inspecting.get(owner) === stop) inspecting.delete(owner)
        usage({ name: 'home_ssh_check', properties: { outcome: verified ? 'verified' : stop.signal.aborted ? 'cancelled' : 'failed' } })
      }
    },
    connect: async (owner: number, checkId: unknown, name: unknown) => {
      available()
      const label = homeName(name)
      const pending = checkOf(owner, checkId)
      const page = windows.get(owner)?.page
      const home = await store.save({
        id: `remote_${randomUUID().replaceAll('-', '')}`,
        name: label,
        homeId: pending.status.homeId,
        ssh: pending.target,
      })
      overviewChanged()
      // Saving settings may outlive its window, but cannot open a replacement window after the caller closed.
      if (accepting && windows.get(owner)?.page === page) {
        opening(home)
        open({ kind: home.https === undefined ? 'ssh' : 'https', home })
      }
    },
    /** A checked home saved beside the others, as Manage homes offers for a host with another home on it: no window opens. */
    save: async (owner: number, checkId: unknown, name: unknown) => {
      available()
      const label = homeName(name)
      const pending = checkOf(owner, checkId)
      await store.save({
        id: `remote_${randomUUID().replaceAll('-', '')}`,
        name: label,
        homeId: pending.status.homeId,
        ssh: pending.target,
      })
      overviewChanged()
    },
    open: async (owner: number, id: unknown, project?: unknown) => {
      available()
      if (!windows.has(owner)) throw new Error('This window is no longer open.')
      const projectId = projectIdOf(project)
      const page = windows.get(owner)?.page
      if (id === 'local') {
        open({ kind: 'local' }, projectId)
        return
      }
      const home = (await store.list()).find((one) => one.id === id)
      if (home === undefined) throw new Error('This saved home was forgotten. Check its host to connect again.')
      if (accepting && windows.get(owner)?.page === page) {
        opening(home)
        open({ kind: home.https === undefined ? 'ssh' : 'https', home }, projectId)
      }
    },
    rename: async (owner: number, id: unknown, name: unknown) => {
      available()
      if (!windows.has(owner)) throw new Error('This window is no longer open.')
      const renamed = await store.rename(savedOf(id), homeName(name))
      resaved(renamed)
      overviewChanged()
    },
    /** A saved home's connection, from this window's check of the new one: kept only where the host has the same home. */
    change: async (owner: number, id: unknown, checkId: unknown) => {
      available()
      const saved = savedOf(id)
      const pending = checkOf(owner, checkId)
      const home = (await store.list()).find((one) => one.id === saved)
      if (home === undefined) throw new Error('This saved home was forgotten. Check its host to connect again.')
      if (pending.status.homeId !== home.homeId) throw new Error(`${pending.target.target} has a different home.`)
      resaved(await store.change(saved, pending.target))
      overviewChanged()
    },
    forget: async (owner: number, id: unknown) => {
      available()
      if (!windows.has(owner) || typeof id !== 'string' || !savedId.test(id)) throw new Error('Choose a saved home to forget.')
      const homes = await store.list()
      const index = homes.findIndex((one) => one.id === id)
      await store.forget(id)
      if (index >= 0) forgotten.set(id, { home: homes[index]!, index, expires: now() + FORGOTTEN_FOR })
      overviewChanged()
    },
    /** Undo: a home this app forgot a moment ago, back where it was, as main held it. */
    restore: async (owner: number, id: unknown) => {
      available()
      if (!windows.has(owner)) throw new Error('This window is no longer open.')
      restorable()
      const held = typeof id === 'string' ? forgotten.get(id) : undefined
      if (held === undefined) throw notRestorable()
      forgotten.delete(held.home.id)
      await store.restore(held.home, held.index)
      overviewChanged()
    },
    /** The projects a window reads on its own home: by the home main gave the window, never one the window names. */
    report: (owner: number, value: unknown) => {
      const window = windows.get(owner)
      if (window === undefined) return
      glances?.report(owner, keyOf(window.state.current), reportedProjects(value))
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
      if (previous.state.connection === 'connecting')
        usage({ name: 'home_connection', properties: { transport: previous.state.current.kind, outcome: 'connected' } })
      return true
    },
    disconnected: (owner: number, generation: number, problem = 'The home disconnected. Reconnect to see its latest state.') => {
      const previous = windows.get(owner)
      if (previous === undefined || previous.generation !== generation || previous.state.current.kind === 'local') return
      update(owner, { current: previous.state.current, connection: 'disconnected', problem }, generation)
      if (accepting && (previous.state.connection === 'connecting' || previous.state.connection === 'connected'))
        usage({
          name: 'home_connection',
          properties: {
            transport: previous.state.current.kind,
            outcome: previous.state.connection === 'connecting' ? 'failed' : 'disconnected',
          },
        })
    },
    isCurrent: (owner: number, generation: number) => accepting && windows.get(owner)?.generation === generation,
    /** The window's check is called off: the form changed, or closed. What it reads of its home stays live. */
    cancel: (owner: number) => {
      cancelCheck(owner)
      const previous = windows.get(owner)
      if (previous !== undefined) windows.set(owner, { ...previous, page: previous.page + 1 })
    },
    /** The window loads its page again: its check is called off, and what it reported of its home isn't live until it reads again. */
    navigating: (owner: number) => {
      cancelCheck(owner)
      glances?.drop(owner)
      const previous = windows.get(owner)
      if (previous !== undefined) windows.set(owner, { ...previous, page: previous.page + 1 })
    },
    closed: (owner: number) => {
      cancelCheck(owner)
      glances?.drop(owner)
      if (windows.delete(owner)) overviewChanged()
    },
  }
}
export type HomeController = ReturnType<typeof homeController>
