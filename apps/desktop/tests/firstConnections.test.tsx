import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Room } from '@althar/ui'

import { useBoard } from '../src/renderer/features/board/useBoard'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { cantPushOf, FirstConnectionsView, firstConnectionsOf } from '../src/renderer/features/project/FirstConnectionsView'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
import { connectionList, coordinatorSnapshot, fakeClient, githubCheck, githubConnection, items } from './fixtures'
import { servicesFor, useSettingsOf, withServices } from './render'
import { ServicesProvider } from '../src/renderer/data/services'
import type { ConnectionsModel } from '../src/renderer/features/connections/useConnections'

/*
 * A new project's card for its code host and a tracker, at the head of its
 * empty conversation: what it offers, from the connections and where the
 * project's code is; its walks in, in the card; and its Not now, kept.
 */

function Project() {
  return (
    <ProjectView
      model={useProject('p1')}
      board={useBoard('p1')}
      connections={useConnections()}
      settings={useSettingsOf('p1')}
      onTask={vi.fn()}
      room={Room.Talk}
    />
  )
}

const LINEAR = { ...githubConnection, id: 'conn2', product: 'linear' as const, name: 'Linear', webUrl: 'https://linear.app' }

describe('what a new project’s card offers', () => {
  it('names the host its code is on, while it isn’t connected, and the trackers while none is', () => {
    expect(firstConnectionsOf(connectionList, 'meridian')).toEqual({
      host: { service: { id: 'github', name: 'GitHub', brand: 'github' }, where: 'northwind/meridian-api' },
      hosts: [],
      trackers: [{ id: 'linear', name: 'Linear', brand: 'linear' }],
    })
    // Connected, only a tracker is asked for; with a tracker too, nothing.
    expect(firstConnectionsOf({ ...connectionList, connections: [githubConnection] }, 'meridian')).toEqual({
      hosts: [],
      trackers: [{ id: 'linear', name: 'Linear', brand: 'linear' }],
    })
    expect(firstConnectionsOf({ ...connectionList, connections: [githubConnection, LINEAR] }, 'meridian')).toEqual({
      hosts: [],
      trackers: [],
    })
  })

  it('offers on another computer’s home only what its window may connect: its code host where the home allows, never a tracker', () => {
    const offer = firstConnectionsOf(connectionList, 'meridian', { hosts: true, trackers: false })
    expect(offer.host).toBeDefined()
    expect(offer.trackers).toEqual([])
    const older = firstConnectionsOf(connectionList, 'meridian', { hosts: false, trackers: false })
    expect(older).toEqual({ hosts: [], trackers: [] })
  })

  it('offers every host where the code names none, and none once one is connected', () => {
    expect(firstConnectionsOf(connectionList, 'halyard').hosts).toEqual([{ id: 'github', name: 'GitHub', brand: 'github' }])
    expect(firstConnectionsOf({ ...connectionList, connections: [githubConnection] }, 'halyard').hosts).toEqual([])
  })

  it('still names a company’s own server while only the hosted service is connected', () => {
    const own = { ...connectionList.places[0]!, webUrl: 'https://git.northwind.dev' }
    const offer = firstConnectionsOf({ ...connectionList, places: [own], connections: [githubConnection] }, 'meridian')
    expect(offer.host?.service.id).toBe('github')
  })
})

describe('a new project’s card', () => {
  it('asks in the empty conversation, opens a walk in in the card, and goes back to its rows', async () => {
    const { client } = fakeClient()
    withServices(<Project />, client)
    const card = await screen.findByRole('region', { name: 'Before the first pull request' })
    expect(card.textContent).toContain('northwind/meridian-api')
    const [github] = await screen.findAllByRole('button', { name: 'Connect' })
    if (github === undefined) throw new Error('No Connect for GitHub')
    await userEvent.click(github)
    await waitFor(() => expect(client.getConnectGuide).toHaveBeenCalledWith('github'))
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }))
    expect(await screen.findByText('northwind/meridian-api')).toBeTruthy()
  })

  it('is put away for the project by Not now, and stays away', async () => {
    const { client } = fakeClient()
    const view = withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Not now' }))
    expect(screen.queryByRole('region', { name: 'Before the first pull request' })).toBeNull()
    expect(window.localStorage.getItem('althar.firstConnections')).toBe('["p1"]')
    view.unmount()
    withServices(<Project />, fakeClient().client)
    await screen.findByRole('textbox')
    expect(screen.queryByRole('region', { name: 'Before the first pull request' })).toBeNull()
  })

  it('isn’t there once the conversation has begun', async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () => coordinatorSnapshot({ items: [items.you('Fix the checkout retry')] })),
    })
    withServices(<Project />, client)
    await screen.findByText('Fix the checkout retry')
    expect(screen.queryByRole('region', { name: 'Before the first pull request' })).toBeNull()
  })

  it('reads storage it can’t make sense of as nothing put away, and puts the card away for the window where storage refuses', async () => {
    window.localStorage.setItem('althar.firstConnections', '{not a list')
    const { client } = fakeClient()
    const view = withServices(<Project />, client)
    expect(await screen.findByRole('region', { name: 'Before the first pull request' })).toBeTruthy()
    view.unmount()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    withServices(<Project />, fakeClient().client)
    await userEvent.click(await screen.findByRole('button', { name: 'Not now' }))
    expect(screen.queryByRole('region', { name: 'Before the first pull request' })).toBeNull()
    vi.restoreAllMocks()
  })
})

/** GitHub's check, its push line refused for the repositories given, as git's first question of a push was answered. */
const refusing = (names: ReadonlyArray<string>, url: string | null = 'https://github.com/settings/personal-access-tokens') => ({
  ...githubCheck,
  lines: githubCheck.lines.map((line) =>
    line.need === 'push' ? { ...line, state: 'no' as const, reason: { kind: 'no_push' as const, names, url } } : line,
  ),
})

describe('a new project whose host is connected but can’t push there', () => {
  it('names the project’s repositories its sign-in can’t push to, and why, and nothing where it can', () => {
    expect(cantPushOf(refusing(['Northwind/Meridian-API', 'northwind/other']), ['northwind/meridian-api'], 'GitHub', 'you')).toEqual({
      names: ['northwind/meridian-api'],
      why: 'GitHub won’t take a push there with you’s token. Give it write access on GitHub, or connect again with one that can push.',
    })
    expect(cantPushOf(refusing(['northwind/other']), ['northwind/meridian-api'], 'GitHub', 'you')).toBeNull()
    expect(cantPushOf(githubCheck, ['northwind/meridian-api'], 'GitHub', 'you')).toBeNull()
    expect(cantPushOf(refusing(['northwind/meridian-api'], null), ['northwind/meridian-api'], 'GitHub', 'you')?.why).toContain(
      'Althar’s GitHub app may not push there',
    )
  })

  it('goes by each repository’s own outcome: another project’s read-only role is never this one’s', () => {
    const check = {
      ...githubCheck,
      lines: githubCheck.lines.map((line) =>
        line.need === 'push'
          ? {
              ...line,
              state: 'no' as const,
              reason: { kind: 'role' as const, role: null },
              repositories: [
                { path: 'northwind/other', state: 'no' as const, reason: { kind: 'role' as const, role: null } },
                { path: 'northwind/meridian-api', state: 'ok' as const, reason: null },
              ],
            }
          : line,
      ),
    }
    expect(cantPushOf(check, ['northwind/meridian-api'], 'GitHub', 'you')).toBeNull()
    expect(cantPushOf(check, ['northwind/other'], 'GitHub', 'you')).toEqual({
      names: ['northwind/other'],
      why: 'you may only read there: its owners can give the account write access, or connect again as one that can push.',
    })
    // Without each one's outcome, a role names no repository: nothing is said rather than the wrong thing.
    const { repositories: _, ...summary } = check.lines.find((line) => line.need === 'push')!
    expect(cantPushOf({ ...check, lines: [summary] }, ['northwind/meridian-api'], 'GitHub', 'you')).toBeNull()
  })

  it('asks again for a repository added since, not by what it answered for the ones before', async () => {
    const before = { ...connectionList, connections: [githubConnection, LINEAR] }
    const checkConnection = vi.fn(async () => githubCheck)
    const { client } = fakeClient({ checkConnection })
    const services = servicesFor(client)
    const card = (list: typeof before) => (
      <ServicesProvider value={services}>
        <FirstConnectionsView projectId="p1" project="meridian" model={{ list } as unknown as ConnectionsModel} />
      </ServicesProvider>
    )
    const view = render(card(before))
    await waitFor(() => expect(checkConnection).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/Can’t push/)).toBeNull()
    // A repository the token may only read joins the project, while the first answer is still fresh.
    checkConnection.mockImplementation(async () => refusing(['northwind/web']))
    const place = before.places[0]!
    view.rerender(card({ ...before, places: [{ ...place, repositories: [...place.repositories, 'northwind/web'] }] }))
    expect(await screen.findByText('Can’t push to northwind/web')).toBeTruthy()
    expect(checkConnection).toHaveBeenCalledTimes(2)
  })

  it('says so as the project is added, and connects again in the card', async () => {
    const { client } = fakeClient({
      listConnections: vi.fn(async () => ({ ...connectionList, connections: [githubConnection, LINEAR] })),
      checkConnection: vi.fn(async () => refusing(['northwind/meridian-api'])),
    })
    withServices(<Project />, client)
    const card = await screen.findByRole('region', { name: 'Before the first pull request' })
    expect(await screen.findByText('Can’t push to northwind/meridian-api')).toBeTruthy()
    expect(card.textContent).toContain('won’t take a push there')
    expect(client.checkConnection).toHaveBeenCalledWith(githubConnection.id)
    await userEvent.click(screen.getByRole('button', { name: 'Connect again' }))
    await waitFor(() => expect(client.getConnectGuide).toHaveBeenCalledWith('github'))
  })

  it('asks nothing more of a project whose host can push, with its tracker connected', async () => {
    const { client } = fakeClient({ listConnections: vi.fn(async () => ({ ...connectionList, connections: [githubConnection, LINEAR] })) })
    withServices(<Project />, client)
    await screen.findByRole('textbox')
    await waitFor(() => expect(client.checkConnection).toHaveBeenCalled())
    expect(screen.queryByRole('region', { name: 'Before the first pull request' })).toBeNull()
  })
})
