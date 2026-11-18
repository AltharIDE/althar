import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Room } from '@althar/ui'

import { useBoard } from '../src/renderer/features/board/useBoard'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { firstConnectionsOf } from '../src/renderer/features/project/FirstConnectionsView'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
import { connectionList, coordinatorSnapshot, fakeClient, githubConnection, items } from './fixtures'
import { useSettingsOf, withServices } from './render'

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
