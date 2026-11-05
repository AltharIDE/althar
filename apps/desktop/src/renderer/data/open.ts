import type { DomMessagePort } from '@althar/contracts'

import { tabsStoreOf } from '../features/tabs/store'
import { makeRouter } from '../router'
import { connect } from './client'
import { follow } from './feed'
import { onModelsRead, readModelsAhead } from './models'
import { makeQueryClient, reads } from './reads'
import type { Host, Services } from './services'

/*
 * The window opening: it connects to the runtime, reads the projects and
 * watches every change after that read, then reads what the place it opens
 * on shows, and opens. Every other open tab's place is read once it has
 * opened, so going to any of them is instant without the launch waiting on
 * the slowest; one clicked before its read is done joins that read. Each
 * agent is asked again, once a launch, and its models read, without waiting
 * for either; each model's room is read again whenever they are.
 */

export const openWindow = async (port: DomMessagePort, host: Host) => {
  host.startup?.('open-window-start')
  const began = performance.now()
  const timed = async <A>(stage: string, read: () => Promise<A>): Promise<A> => {
    host.startup?.(`${stage}-start`)
    const at = performance.now()
    try {
      return await read()
    } finally {
      host.startup?.(stage, Math.round(performance.now() - at))
    }
  }
  const client = await timed('client-created', () => connect(port))
  const cache = makeQueryClient()
  const read = reads(client)
  // Watched from where the projects were read: nothing after is missed. Unread, from now.
  const listed = await timed('first-projects', () => cache.fetchQuery(read.projects()).catch(() => null))
  const feed = follow(client, cache, listed?.cursor)
  const services: Services = { client, host, cache, feed }
  const router = makeRouter({ client, cache })
  // Each model's room follows from which agents are signed in and which models are offered.
  onModelsRead(client, () => void cache.invalidateQueries({ queryKey: ['modelRooms'] }))
  await timed('first-route', () => router.load())
  host.startup?.('open-window-resolved', Math.round(performance.now() - began))

  const kept = tabsStoreOf(client).get().kept
  const known = new Set(listed?.projects.map((project) => project.id) ?? [])
  const readAhead = () =>
    (kept?.open ?? [])
      .filter((projectId) => known.has(projectId))
      .map((projectId) => {
        const place = kept?.places[projectId]
        return place?.kind === 'thread'
          ? router.preloadRoute({ to: '/threads/$threadId', params: { threadId: place.threadId } })
          : router.preloadRoute({ to: '/projects/$projectId', params: { projectId } })
      })
  let started = false
  const afterOpen = () => {
    if (started) return
    started = true
    // Join a mounted screen's status read instead of starting a second set of cold CLIs.
    void cache.fetchQuery(read.status()).catch(() => undefined)
    readModelsAhead(client)
    void Promise.allSettled(readAhead())
  }
  return { services, router, afterOpen, hasProjects: (listed?.projects.length ?? 0) > 0 }
}
