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
/**
 * Setting a home up over SSH, as main runs it ([bootstrap/README.md](../../host/bootstrap/README.md)): its steps in
 * order, each said as it goes. One at a time for the whole app, kept across a restart of Althar.
 */
export const SETUP_STEPS = ['reach', 'look', 'get', 'setup', 'start', 'identity'] as const
export type SetupStep = (typeof SETUP_STEPS)[number]
/** Going, waiting on the person's word for its host key, stopped on a trouble, paused, reconnecting, or set up. */
export type SetupPhase = 'running' | 'trust' | 'failed' | 'stopped' | 'reconnecting' | 'done'
export interface HomeSetup {
  /** Where it's being set up, now: `althar@host` once Althar made that user for a root login. */
  readonly target: SshHomeTarget
  readonly phase: SetupPhase
  /** The step it's on, by its index in SETUP_STEPS: those before it are done. */
  readonly at: number
  /** althar-host coming over, in bytes, where that's known. */
  readonly progress?: { readonly bytes: number; readonly total: number }
  /** Sent from this computer, as the server couldn't download it. */
  readonly upload: boolean
  /** The server's key, seen for the first time, for the person to trust. */
  readonly hostKey?: { readonly host: string; readonly type: string; readonly fingerprint: string }
  /** What stopped it: a code the window words (bootstrap/README.md's, and the desktop's own). */
  readonly problem?: string
  /** What the server is, as looked over. */
  readonly facts?: { readonly arch: string; readonly freeKiB: number; readonly git: boolean }
  /** Logged in as root: Althar made the home its own user, althar. */
  readonly madeUser: boolean
  /** The command that keeps it running after the last logout, where lingering is off and needs the server's administrator. */
  readonly linger?: string
  /** The release it installs, once found. */
  readonly version?: string
  /** The home it made, as the server said once it was done: what the window's own check must find there. */
  readonly identity?: { readonly homeId: string; readonly hostDeviceId: string }
  /** What it ran and what the server said, to show. */
  readonly log: ReadonlyArray<string>
}
export type SetupAction = 'trust' | 'stop' | 'resume' | 'upload' | 'dismiss'
/** Handed to a window that can't set a home up (the Flatpak: main/homes/setup.ts's canSetUp), so it doesn't offer it. */
export const NO_SETUP_ARG = '--althar-no-home-setup'

export const isHomeSetup = (value: unknown): value is HomeSetup | null => {
  if (value === null) return true
  if (typeof value !== 'object') return false
  const setup = value as Partial<HomeSetup>
  return (
    typeof setup.target?.target === 'string' &&
    typeof setup.at === 'number' &&
    Array.isArray(setup.log) &&
    ['running', 'trust', 'failed', 'stopped', 'reconnecting', 'done'].includes(setup.phase ?? '')
  )
}

export interface HomesHost {
  /** A home being set up over SSH, or none; with the calls that start and steer it. */
  readonly setup?: () => Promise<HomeSetup | null>
  readonly setUp?: (target: SshHomeTarget) => Promise<void>
  readonly setupAct?: (action: SetupAction) => Promise<void>
  readonly onSetup?: (listener: (setup: HomeSetup | null) => void) => () => void
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
