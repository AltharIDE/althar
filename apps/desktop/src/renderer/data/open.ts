import type { DomMessagePort } from '@althar/contracts'

import { tabsStoreOf } from '../features/tabs/store'
import { makeRouter } from '../router'
import { connect } from './client'
import { follow } from './feed'
import { makeQueryClient, reads, recheckStatus } from './reads'
import type { Host, Services } from './services'

/*
 * The window opening: it connects to the runtime, reads the projects and
 * watches every change after that read, then reads what the place it opens
 * on shows, and, behind it, every open tab's, so going to any of them is
 * instant. Each agent is asked again, once a launch, without waiting for it.
 */

export const openWindow = async (port: DomMessagePort, host: Host) => {
  const client = await connect(port)
  const cache = makeQueryClient()
  const read = reads(client)
  // Watched from where the projects were read: nothing after is missed. Unread, from now.
  const listed = await cache.fetchQuery(read.projects()).catch(() => null)
  const feed = follow(client, cache, listed?.cursor)
  const services: Services = { client, host, cache, feed }
  const router = makeRouter({ client, cache })
  void recheckStatus(client, cache).catch(() => undefined)
  await router.load()

  const kept = tabsStoreOf(client).get().kept
  const known = new Set(listed?.projects.map((project) => project.id) ?? [])
  const ahead = (kept?.open ?? [])
    .filter((projectId) => known.has(projectId))
    .map((projectId) => {
      const place = kept?.places[projectId]
      return place?.kind === 'thread'
        ? router.preloadRoute({ to: '/threads/$threadId', params: { threadId: place.threadId } })
        : router.preloadRoute({ to: '/projects/$projectId', params: { projectId } })
    })
  await Promise.allSettled(ahead)
  return { services, router }
}
