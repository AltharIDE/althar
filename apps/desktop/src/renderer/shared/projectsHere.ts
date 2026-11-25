import { type ConnectionList, Product } from '@althar/contracts'
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
  readonly product: Product | null
  /** The host's address and its path there, as Althar knows them: github.com, acme/site. */
  readonly host: string
  readonly path: string
}

/** The code hosts whose page for a repository is its git address too; Bitbucket Data Center's isn't. */
const PAGE_CLONES: ReadonlySet<Product> = new Set(['github', 'gitlab', 'bitbucket_cloud'])

const isProduct = Schema.is(Product)

/**
 * Where the home clones one of this computer's repositories from: through its own connection to that host, by the path Althar
 * knows it at there, where it has one; else by its page, where that's its git address. Null where neither is so (a Bitbucket
 * Data Center repository, with that server not connected there): it isn't offered.
 */
export const cloneFromHere = (
  one: ProjectHere,
  list: ConnectionList | null,
): { readonly connectionId: string; readonly path: ReadonlyArray<string> } | { readonly url: string } | null => {
  const connection = (list?.connections ?? []).find(
    (candidate) => candidate.state === 'ready' && hostnameOf(candidate.webUrl) === one.host.toLowerCase(),
  )
  if (connection !== undefined) return { connectionId: connection.id, path: one.path.split('/') }
  return one.product !== null && PAGE_CLONES.has(one.product) ? { url: one.url } : null
}

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
      const key = `${remote.host.toLowerCase()}/${remote.path.toLowerCase()}`
      if (seen.has(key)) return []
      const one: ProjectHere = {
        projectId: project.id,
        name: project.name,
        ink: project.ink,
        url: remote.url,
        product: isProduct(remote.product) ? remote.product : null,
        host: remote.host,
        path: remote.path,
      }
      if (cloneFromHere(one, list) === null) return []
      seen.add(key)
      return [one]
    }),
  )
}
