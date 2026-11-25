import { Product } from '@althar/contracts'
import { Schema } from 'effect'

import { useServices } from '../data/services'
import { useHomesOverview } from '../features/homes/useHomes'
import { remoteOf } from './remotes'

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
  /** Its page on the host, cloned from: https://github.com/acme/site. */
  readonly url: string
  readonly product: Product | null
  /** The host's address and its path there, as a remote names them: github.com, acme/site. */
  readonly host: string
  readonly path: string
}

const isProduct = Schema.is(Product)

/** This computer's projects' repositories on code hosts, each once, for a window on another computer's home; none elsewhere. */
export const useProjectsHere = (): ReadonlyArray<ProjectHere> => {
  const { client, host } = useServices()
  const overview = useHomesOverview(host.homes)
  if (client.connection === undefined) return []
  const seen = new Set<string>()
  return (overview?.projects.local?.list ?? []).flatMap((project) =>
    (project.remotes ?? []).flatMap((remote) => {
      const ref = remoteOf(remote.url)
      if (ref === null || !ref.path.includes('/')) return []
      const key = `${ref.host.toLowerCase()}/${ref.path.toLowerCase()}`
      if (seen.has(key)) return []
      seen.add(key)
      return [
        {
          projectId: project.id,
          name: project.name,
          ink: project.ink,
          url: remote.url,
          product: isProduct(remote.product) ? remote.product : null,
          host: ref.host,
          path: ref.path,
        },
      ]
    }),
  )
}
