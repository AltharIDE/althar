export const RELAY_CHUNK_LIMIT = 256 * 1024
export const RELAY_READY = 1
export const RELAY_TOKEN = /^[a-zA-Z0-9_-]{43}$/
export const RELAY_ROUTE = /^wrl_[a-f0-9]{32}$/
export type RelayRole = 'home' | 'worker'

export const relayPath = (path: string): { route: string; role: RelayRole } | undefined => {
  const pieces = /^\/v1\/worker-relay\/(wrl_[a-f0-9]{32})\/(home|worker)$/.exec(path)
  const route = pieces?.[1]
  const role = pieces?.[2]
  return route !== undefined && (role === 'home' || role === 'worker') ? { route, role } : undefined
}
