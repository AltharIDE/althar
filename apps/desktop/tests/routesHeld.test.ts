import { describe, expect, it, vi } from 'vitest'

import type { AppSettings, ConnectionList } from '@althar/contracts'

import type { Client } from '../src/renderer/data/client'
import { keys, makeQueryClient, reads } from '../src/renderer/data/reads'
import { newProjectRoute } from '../src/renderer/features/newProject/route'
import { settingsRoute } from '../src/renderer/features/settings/route'
import { taskRoute } from '../src/renderer/features/task/route'
import { fakeClient, project } from './fixtures'

/*
 * A place the person has been opens at once on what the window holds, whatever the runtime is doing: Settings, a new
 * project and a task never wait for a read the feed has said is out of date, which is read again behind them
 * (docs/decisions/desktop-app.md, How the window reads). Here the runtime never answers again once the window has read,
 * so one that waited would never open.
 */

/** A read that hasn't come back, and doesn't. */
const never = <A>() => new Promise<A>(() => {})

/** The window, having read once, with each of these reads out of date and the runtime no longer answering. */
const heldThenSlow = async (read: (client: Client) => ReadonlyArray<{ readonly queryKey: ReadonlyArray<unknown> }>) => {
  const { client } = fakeClient()
  const cache = makeQueryClient()
  for (const options of read(client)) await cache.fetchQuery(options as never)
  for (const name of ['getSettings', 'listConnections', 'listProjects', 'listSkills', 'getThread'] as const)
    vi.mocked(client[name]).mockImplementation(never as never)
  await cache.invalidateQueries({ refetchType: 'none' })
  return { client, cache }
}

type Loader = (options: unknown) => unknown

describe('a place the window holds, out of date', () => {
  it('opens Settings at once, reading it again behind', async () => {
    const { client, cache } = await heldThenSlow((one) => [reads(one).settings(), reads(one).connections(), reads(one).skills()])
    const loading = (settingsRoute.options.loader as Loader)({ params: { section: 'skills' }, context: { client, cache } })
    // Waiting on a read again, it would never open: the runtime doesn't answer.
    await loading
    expect(cache.getQueryData<AppSettings>(keys.settings)).toBeDefined()
    // Read again behind it, all the same.
    expect(client.getSettings).toHaveBeenCalledTimes(2)
  })

  it('opens a new project at once', async () => {
    const { client, cache } = await heldThenSlow((one) => [reads(one).projects(), reads(one).connections()])
    const loading = (newProjectRoute.options.loader as Loader)({ context: { client, cache } })
    await loading
    expect(cache.getQueryData<ConnectionList>(keys.connections)).toBeDefined()
    expect(client.listConnections).toHaveBeenCalledTimes(2)
  })

  it('opens a task it hasn’t read without waiting for the projects again, which it holds', async () => {
    const { client, cache } = await heldThenSlow((one) => [reads(one).projects()])
    const deciding = (taskRoute.options.beforeLoad as Loader)({ params: { threadId: 'th9' }, context: { client, cache } })
    await deciding
    expect(client.listProjects).toHaveBeenCalledTimes(1)
  })

  it('opens a coordinator’s thread as its project’s conversation, from the projects it holds', async () => {
    const { client, cache } = await heldThenSlow((one) => [reads(one).projects()])
    const coordinator = project.coordinatorThreadId
    const deciding = Promise.resolve(
      (taskRoute.options.beforeLoad as Loader)({ params: { threadId: coordinator }, context: { client, cache } }),
    )
    await expect(deciding).rejects.toMatchObject({ options: { to: '/projects/$projectId' } })
  })
})
