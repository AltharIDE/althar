import { type ConnectionList, type ConnectionSummary, Product } from '@althar/contracts'
import { Schema } from 'effect'

import { useServices } from '../data/services'
import { useHomesOverview } from '../features/homes/useHomes'
import { hostnameOf } from './remotes'

/*
 * This computer's projects whose code is on a code host, as its own window
 * told main: what a window on another computer's home offers to clone there,
 * from where each one's code is. Nothing in this computer's own window, and
 * nothing while that window is closed: what it said isn't kept.
 */

/** One of this computer's projects, and a repository of it on a code host. */
export interface ProjectHere {
  readonly projectId: string
  readonly name: string
  readonly ink: string
  /** Its page on the host: https://github.com/acme/site. */
  readonly url: string
  /** The code host it's on: one on a host Althar doesn't know isn't one of these. */
  readonly product: Product
  /** The host's address and its path there, as Althar knows them: github.com, acme/site. */
  readonly host: string
  readonly path: string
}

/** Whether a page is on the server at `base`, base path and all: https://git.acme.com/bitbucket/projects/… is on https://git.acme.com/bitbucket. */
const within = (page: string, base: string) => {
  try {
    const at = new URL(page)
    const server = new URL(base)
    const root = server.pathname.replace(/\/+$/, '')
    return at.origin === server.origin && (root === '' || at.pathname === root || at.pathname.startsWith(`${root}/`))
  } catch {
    return false
  }
}

/** The code hosts whose page for a repository is its git address too; Bitbucket Data Center's isn't. */
const PAGE_CLONES: ReadonlySet<Product> = new Set(['github', 'gitlab', 'bitbucket_cloud'])

const isProduct = Schema.is(Product)

/**
 * Whether a connection of the home's is to the very server one of this computer's repositories is on, for its product: a
 * Jira on the same host isn't, nor another server at another base path there.
 */
export const servesHere = (connection: Pick<ConnectionSummary, 'product' | 'webUrl'>, one: ProjectHere) =>
  connection.product === one.product && hostnameOf(connection.webUrl) === one.host.toLowerCase() && within(one.url, connection.webUrl)

/**
 * Where the home clones one of this computer's repositories from: through its own connection to that server for that product,
 * by the path Althar knows it at there, where it has one; else by its page, where that's its git address. Null where neither is so (a Bitbucket
 * Data Center repository, with that server not connected there): it isn't offered.
 */
export const cloneFromHere = (
  one: ProjectHere,
  list: ConnectionList | null,
): { readonly connectionId: string; readonly path: ReadonlyArray<string> } | { readonly url: string } | null => {
  const connection = (list?.connections ?? []).find((candidate) => candidate.state === 'ready' && servesHere(candidate, one))
  if (connection !== undefined) return { connectionId: connection.id, path: one.path.split('/') }
  return PAGE_CLONES.has(one.product) ? { url: one.url } : null
}

/** Which repository a clone from `cloneFromHere` is: on one connection, by its path whatever its case; else by its address. */
const sourceKey = (source: NonNullable<ReturnType<typeof cloneFromHere>>) =>
  'connectionId' in source
    ? `${source.connectionId}:${source.path.join('/').toLowerCase()}`
    : source.url.replace(/(?:\.git)?\/*$/, '').toLowerCase()

/**
 * This computer's projects' repositories on code hosts, each once, for a window on another computer's home, those the home
 * can clone (`cloneFromHere`) as its connections in `list` stand; none elsewhere.
 */
export const useProjectsHere = (list: ConnectionList | null): ReadonlyArray<ProjectHere> => {
  const { client, host } = useServices()
  const overview = useHomesOverview(host.homes)
  if (client.connection === undefined) return []
  const seen = new Set<string>()
  return (overview?.projects.local?.list ?? []).flatMap((project) =>
    (project.remotes ?? []).flatMap((remote) => {
      if (!isProduct(remote.product)) return []
      const one: ProjectHere = {
        projectId: project.id,
        name: project.name,
        ink: project.ink,
        url: remote.url,
        product: remote.product,
        host: remote.host,
        path: remote.path,
      }
      // Each repository once, by where it's cloned from: two servers on one host, at their own base paths, aren't one.
      const source = cloneFromHere(one, list)
      if (source === null || seen.has(sourceKey(source))) return []
      seen.add(sourceKey(source))
      return [one]
    }),
  )
}
