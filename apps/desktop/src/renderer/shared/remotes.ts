import type { ConnectionList, Product } from '@althar/contracts'

import { productName } from './products'

/*
 * Where a repository's code is hosted, read from its remote without asking
 * anyone: the host's name and the repository's path there, and whether
 * Althar is connected to that host, as whom. A host is known because the
 * person connected an instance on it, or because it is a hosted service's
 * own (github.com, gitlab.com, bitbucket.org).
 */

/** A remote, read: its host's name and the repository's path there, as `owner/repo`. */
export interface RemoteRef {
  readonly host: string
  readonly path: string
}

/**
 * Reads a git remote: `git@host:owner/repo.git`, `ssh://git@host:22/owner/repo`,
 * `https://host/owner/repo.git`, and GitLab's nested groups. Null for a local
 * path or anything else without a host.
 */
export const remoteOf = (remote: string): RemoteRef | null => {
  const text = remote.trim()
  let host: string
  let path: string
  if (!text.includes('://')) {
    // scp-like: [user@]host:path
    const scp = /^(?:[^@\s]+@)?([^:/\s]+):(.+)$/.exec(text)
    if (scp === null) return null
    host = scp[1] ?? ''
    path = scp[2] ?? ''
  } else {
    let url: URL
    try {
      url = new URL(text)
    } catch {
      return null
    }
    if (!['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol) || url.hostname === '') return null
    host = url.hostname
    // A path whose escapes don't read is kept as it was written.
    try {
      path = decodeURIComponent(url.pathname)
    } catch {
      path = url.pathname
    }
  }
  const segments = path
    .replace(/\.git\/?$/, '')
    .split('/')
    .filter((segment) => segment !== '')
  return segments.length < 2 ? null : { host: host.toLowerCase(), path: segments.join('/') }
}

/** The hosted services' own hosts, for when the connections aren't read. */
const HOSTED: Readonly<Record<string, Product>> = { 'github.com': 'github', 'gitlab.com': 'gitlab', 'bitbucket.org': 'bitbucket_cloud' }

/** A host's name, from an address; empty where it has none. */
const hostnameOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/** Where a remote's code is: the product, its name, and the account Althar is connected as there, or null where it isn't. */
export interface CodeHostOf {
  readonly product: Product | null
  readonly name: string
  readonly account: string | null
}

/**
 * The code host a remote is on: one Althar is connected to, with whom; a
 * hosted service it knows, not connected; or the host's own name, where it
 * knows none.
 */
export const codeHostOf = (remote: RemoteRef, list: ConnectionList | null): CodeHostOf => {
  const hosts = new Set((list?.products ?? []).filter((product) => product.host).map((product) => product.product))
  const connected = list?.connections.find(
    (connection) => hosts.has(connection.product) && connection.state === 'ready' && hostnameOf(connection.webUrl) === remote.host,
  )
  if (connected !== undefined) return { product: connected.product, name: connected.name, account: connected.account.login }
  const hosted =
    list?.products.find((product) => product.host && product.hostedUrl !== null && hostnameOf(product.hostedUrl) === remote.host)
      ?.product ?? HOSTED[remote.host]
  return hosted === undefined
    ? { product: null, name: remote.host, account: null }
    : { product: hosted, name: productName(hosted), account: null }
}

/** What a code host calls a change its tasks open: GitLab's merge requests, everyone else's pull requests. */
export const changesOn = (product: Product | null) => (product === 'gitlab' ? 'merge requests' : 'pull requests')
