import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type ConnectionList, type ConnectionSummary } from '@althar/contracts'

import { hostChoices, PutOnHost, thingOn } from '../src/renderer/shared/PutOnHost'
import { connectionList, fakeClient, githubConnection } from './fixtures'
import { withServices } from './render'

/*
 * A repository only on this computer, put on a code host from where the
 * person asked: under the owner they choose, named as it is unless they
 * change it, private unless they say. A name the host has taken is said at
 * the name; anything else on the card.
 */

const CONNECTION = { id: 'conn1', name: 'GitHub', product: 'github', thing: 'repository' } as const

const put = (overrides: Parameters<typeof fakeClient>[0] = {}) => {
  const { client } = fakeClient({
    listRepositoryOwners: vi.fn(async () => [
      { id: 'ada', name: 'ada', kind: 'user' as const },
      { id: 'northwind', name: 'northwind', kind: 'organization' as const },
    ]),
    ...overrides,
  })
  const onDone = vi.fn()
  const onBack = vi.fn()
  withServices(
    <PutOnHost
      projectId="p1"
      repository="tidepool"
      name="tidepool"
      branch="main"
      connection={CONNECTION}
      onDone={onDone}
      onBack={onBack}
    />,
    client,
  )
  return { client, onDone, onBack }
}

const createButton = () => screen.getByRole('button', { name: 'Create and push' })

describe('putting a repository on a code host', () => {
  it('makes it under the first owner, named as the repository is, private, then is done', async () => {
    const { client, onDone } = put()
    expect(screen.getByRole('heading', { name: 'A new repository on GitHub' })).toBeTruthy()
    expect(screen.getByText('Makes it empty, then pushes main. Tasks open their changes there from then.')).toBeTruthy()
    await waitFor(() => expect((createButton() as HTMLButtonElement).disabled).toBe(false))
    await userEvent.click(createButton())
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(client.publishRepository).toHaveBeenCalledWith({
      at: { projectId: 'p1', repositoryId: 'tidepool' },
      connectionId: 'conn1',
      owner: { id: 'ada', name: 'ada', kind: 'user' },
      name: 'tidepool',
      private: true,
    })
  })

  it('takes the owner, the name and the visibility the person gives', async () => {
    const { client, onDone } = put()
    await waitFor(() => expect((createButton() as HTMLButtonElement).disabled).toBe(false))
    await userEvent.click(screen.getByRole('combobox', { name: 'Owner' }))
    await userEvent.click(await screen.findByRole('option', { name: 'northwind' }))
    const name = screen.getByRole('textbox', { name: 'Name' })
    await userEvent.clear(name)
    expect((createButton() as HTMLButtonElement).disabled).toBe(true)
    await userEvent.type(name, '  tide-pool ')
    await userEvent.click(screen.getByRole('radio', { name: 'Public' }))
    await userEvent.click(createButton())
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(client.publishRepository).toHaveBeenCalledWith(
      expect.objectContaining({ owner: expect.objectContaining({ id: 'northwind' }), name: 'tide-pool', private: false }),
    )
  })

  it('says a name taken at the name, clears it as the name changes, and makes it under the new one', async () => {
    const publishRepository = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError({ reason: 'PublishRefused', why: 'taken', message: 'There’s an ada/tidepool on GitHub already.' }),
      )
      .mockResolvedValueOnce({ remote: 'ada/tidepool-2', webUrl: 'https://github.com/ada/tidepool-2', branch: 'main' })
    const { onDone } = put({ publishRepository })
    await waitFor(() => expect((createButton() as HTMLButtonElement).disabled).toBe(false))
    await userEvent.click(createButton())
    const name = screen.getByRole('textbox', { name: 'Name' })
    await waitFor(() => expect(name.getAttribute('aria-invalid')).toBe('true'))
    expect(screen.getByText('There’s an ada/tidepool on GitHub already.')).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()
    await userEvent.type(name, '-2')
    expect(name.getAttribute('aria-invalid')).toBeNull()
    await userEvent.click(createButton())
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(publishRepository).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'tidepool-2' }))
  })

  it('says any other failure on the card, keeps it there as the name changes, and lets the person go back', async () => {
    const publishRepository = vi
      .fn()
      .mockRejectedValue(new ApiError({ reason: 'PublishRefused', why: 'push_failed', message: 'GitHub could not be reached.' }))
    const { onDone, onBack } = put({ publishRepository })
    await waitFor(() => expect((createButton() as HTMLButtonElement).disabled).toBe(false))
    await userEvent.click(createButton())
    expect(await screen.findByText('GitHub could not be reached.')).toBeTruthy()
    const name = screen.getByRole('textbox', { name: 'Name' })
    expect(name.getAttribute('aria-invalid')).toBeNull()
    await userEvent.type(name, 'x')
    expect(screen.getByText('GitHub could not be reached.')).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('waits for the owners before it can make anything', async () => {
    const { client } = put({ listRepositoryOwners: vi.fn(() => new Promise<never>(() => undefined)) })
    expect((createButton() as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(createButton())
    expect(client.publishRepository).not.toHaveBeenCalled()
    expect((screen.getByRole('combobox', { name: 'Owner' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('the code hosts a repository can go on', () => {
  const gitlab: ConnectionSummary = { ...githubConnection, id: 'conn2', product: 'gitlab', name: 'GitLab', webUrl: 'https://gitlab.com' }
  const linear: ConnectionSummary = { ...githubConnection, id: 'conn3', product: 'linear', name: 'Linear', webUrl: 'https://linear.app' }
  const broken: ConnectionSummary = { ...githubConnection, id: 'conn4', state: 'needs_attention' as ConnectionSummary['state'] }
  const listOf = (connections: ReadonlyArray<ConnectionSummary>): ConnectionList => ({ ...connectionList, connections: [...connections] })

  it('offers each one, none connected, in order, before anything is read', () => {
    const { ready, hosts } = hostChoices(null)
    expect(ready).toEqual([])
    expect(hosts.map((host) => [host.id, host.thing, host.connected])).toEqual([
      ['github', 'repository', false],
      ['gitlab', 'project', false],
      ['bitbucket', 'repository', false],
    ])
  })

  it('puts the ready code hosts first, by their connection, and leaves out trackers and ones not ready', () => {
    const { ready, hosts } = hostChoices(listOf([linear, broken, gitlab]))
    expect(ready.map((connection) => connection.id)).toEqual(['conn2'])
    expect(hosts.map((host) => [host.id, host.name, host.thing, host.connected])).toEqual([
      ['conn2', 'GitLab', 'project', true],
      ['github', 'GitHub', 'repository', false],
      ['bitbucket', 'Bitbucket', 'repository', false],
    ])
  })

  it('calls a repository a project only on GitLab', () => {
    expect(thingOn('gitlab')).toBe('project')
    expect(thingOn('github')).toBe('repository')
    expect(thingOn('bitbucket')).toBe('repository')
  })
})
