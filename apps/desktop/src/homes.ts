import type { HttpsHomeTarget } from '@althar/transport-node'
import type { ClientIdentity } from '@althar/contracts'

/** Connection settings only. Credentials stay with system OpenSSH; these are never person-authority device keys. */
export interface SshHomeTarget {
  readonly target: string
  readonly profile?: string
  readonly launcher?: string
  readonly configFile?: string
  readonly port?: number
}
export type RemoteHome = {
  readonly id: string
  readonly name: string
  readonly homeId: string
} & ({ readonly ssh: SshHomeTarget; readonly https?: never } | { readonly https: HttpsHomeTarget; readonly ssh?: never })
export type SshRemoteHome = Extract<RemoteHome, { readonly ssh: SshHomeTarget }>
export type WindowHome = { readonly kind: 'local' } | { readonly kind: 'ssh' | 'https'; readonly home: RemoteHome }
export interface HomeState {
  readonly current: WindowHome
  readonly connection: 'local' | 'connecting' | 'connected' | 'disconnected'
  readonly identity?: ClientIdentity
  readonly problem?: string
}
export interface CheckedHome {
  readonly checkId: string
  readonly homeId: string
  readonly hostDeviceId: string
  readonly apiVersion: number
  readonly version: string
  readonly target: string
}
/** A project on a home, as a window on that home last read it: what Manage homes draws it by. */
export interface HomeProject {
  readonly id: string
  readonly name: string
  /** Its ink, one of the contracts' `Inks`. */
  readonly ink: string
  /** Tasks under way there; known only while a window on the home is connected, else 0. */
  readonly working: number
  /** What waits on the person there, as its board counts it; the same. */
  readonly yours: number
}
/** Where a home's projects stand: read now by a connected window on it (live), or as one last read them. */
export interface HomeProjects {
  readonly live: boolean
  readonly list: ReadonlyArray<HomeProject>
}
/**
 * What main knows of every home, for the chip's menu and Manage homes: the
 * saved ones, each home's open window and how it stands, the projects on
 * each, and when each saved home was last opened. Windows and projects are
 * by `local` or a home's identity (`homeId`); `opened` by a saved home's id.
 */
export interface HomesOverview {
  readonly homes: ReadonlyArray<RemoteHome>
  readonly windows: Readonly<Record<string, HomeState['connection']>>
  readonly projects: Readonly<Record<string, HomeProjects>>
  readonly opened: Readonly<Record<string, number>>
}
export interface HomesHost {
  readonly state: () => Promise<HomeState>
  readonly list: () => Promise<ReadonlyArray<RemoteHome>>
  readonly pairingInfo?: (code: string) => Promise<{ origin: string; homeId: string; expiresAt: number }>
  readonly pair?: (code: string, name: string) => Promise<void>
  readonly overview: () => Promise<HomesOverview>
  readonly inspect: (target: SshHomeTarget) => Promise<CheckedHome>
  readonly connect: (checkId: string, name: string) => Promise<void>
  /** A checked home saved beside the others, without opening it. */
  readonly save: (checkId: string, name: string) => Promise<void>
  /** Its window, opened or brought forward; on one of its projects, where one is given. */
  readonly open: (id: string, projectId?: string) => Promise<void>
  readonly rename: (id: string, name: string) => Promise<void>
  /** A saved home's connection, from a check that found the same home there. */
  readonly change: (id: string, checkId: string) => Promise<void>
  readonly forget: (id: string) => Promise<void>
  /** A home forgotten a moment ago, back where it was. */
  readonly restore: (id: string) => Promise<void>
  readonly cancelCheck: () => Promise<void>
  readonly reconnect: () => Promise<void>
  /** The projects this window reads on its home, for every window's Manage homes. */
  readonly report: (projects: ReadonlyArray<HomeProject>) => void
  readonly onState: (listener: (state: HomeState) => void) => () => void
  readonly onOverview: (listener: (overview: HomesOverview) => void) => () => void
  readonly onOpen: (listener: () => void) => () => void
  /** A project to show, asked from another window's Manage homes: held until the window listens. */
  readonly onProject: (listener: (projectId: string) => void) => () => void
}

export const isHomeState = (value: unknown): value is HomeState => {
  if (typeof value !== 'object' || value === null) return false
  const state = value as Partial<HomeState>
  return (
    state.current !== undefined &&
    (state.current.kind === 'local' ||
      ((state.current.kind === 'ssh' || state.current.kind === 'https') && typeof state.current.home?.homeId === 'string')) &&
    ['local', 'connecting', 'connected', 'disconnected'].includes(state.connection ?? '')
  )
}

export const isHomesOverview = (value: unknown): value is HomesOverview => {
  if (typeof value !== 'object' || value === null) return false
  const overview = value as Partial<HomesOverview>
  return (
    Array.isArray(overview.homes) &&
    typeof overview.windows === 'object' &&
    overview.windows !== null &&
    typeof overview.projects === 'object' &&
    overview.projects !== null &&
    typeof overview.opened === 'object' &&
    overview.opened !== null
  )
}
