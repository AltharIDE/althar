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
export interface HomesHost {
  readonly state: () => Promise<HomeState>
  readonly list: () => Promise<ReadonlyArray<RemoteHome>>
  readonly pairingInfo?: (code: string) => Promise<{ origin: string; homeId: string; expiresAt: number }>
  readonly pair?: (code: string, name: string) => Promise<void>
  readonly inspect: (target: SshHomeTarget) => Promise<CheckedHome>
  readonly connect: (checkId: string, name: string) => Promise<void>
  readonly open: (id: string) => Promise<void>
  readonly forget: (id: string) => Promise<void>
  readonly cancelCheck: () => Promise<void>
  readonly reconnect: () => Promise<void>
  readonly onState: (listener: (state: HomeState) => void) => () => void
  readonly onOpen: (listener: () => void) => () => void
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
