import { parseRemote } from '@althar/connectors'

/*
 * A fork, as its clone says: its own remote, `origin`, and the repository it
 * was forked from, `upstream`, by the convention git hosts teach. Read from
 * the remotes alone, without asking the host, so it is known before any host
 * is connected. A clone with only one of them is no fork Althar can tell.
 */

export interface Fork {
  /** The fork's remote, and its path on its host: you/meridian-web. */
  readonly fork: { readonly url: string; readonly path: ReadonlyArray<string> }
  /** The repository it was forked from. */
  readonly upstream: { readonly url: string; readonly path: ReadonlyArray<string> }
}

/** The fork a repository's remotes make it, or null: an `upstream` beside `origin`, on the same host, naming another repository. */
export const forkOf = (remotes: ReadonlyArray<{ readonly name: string; readonly url: string }>): Fork | null => {
  const origin = remotes.find((remote) => remote.name === 'origin')
  const upstream = remotes.find((remote) => remote.name === 'upstream')
  if (origin === undefined || upstream === undefined) return null
  const own = parseRemote(origin.url)
  const from = parseRemote(upstream.url)
  if (own === null || from === null || own.host !== from.host) return null
  if (own.path.join('/').toLowerCase() === from.path.join('/').toLowerCase()) return null
  return { fork: { url: origin.url, path: own.path }, upstream: { url: upstream.url, path: from.path } }
}
