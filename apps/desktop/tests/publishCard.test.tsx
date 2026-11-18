import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '@althar/contracts'
import { expect, it, vi } from 'vitest'

import { ServicesProvider } from '../src/renderer/data/services'
import { keys } from '../src/renderer/data/reads'
import { hostChoices, PutOnHost } from '../src/renderer/shared/PutOnHost'
import { connectionList, fakeClient, githubConnection } from './fixtures'
import { servicesFor } from './render'

const owner = { id: 'ada', name: 'ada', kind: 'user' as const }
const organisation = { id: 'northwind', name: 'Northwind', kind: 'organization' as const }
const card = (overrides: Parameters<typeof fakeClient>[0] = {}) => {
  const { client } = fakeClient(overrides)
  const services = servicesFor(client)
  const done = vi.fn()
  const back = vi.fn()
  render(
    <ServicesProvider value={services}>
      <PutOnHost
        projectId="p1"
        repository="app"
        name="meridian"
        branch="trunk"
        connection={{ id: 'conn1', name: 'GitHub', product: 'github', thing: 'repository' }}
        onDone={done}
        onBack={back}
      />
    </ServicesProvider>,
  )
  return { client, services, done, back }
}

it('waits for the host’s owners and keeps an empty name or empty owner list from being published', async () => {
  let answer!: (owners: (typeof owner)[]) => void
  const at = card({
    listRepositoryOwners: vi.fn(
      () =>
        new Promise<(typeof owner)[]>((resolve) => {
          answer = resolve
        }),
    ),
  })
  expect(screen.getByRole('button', { name: 'Create and push' })).toHaveProperty('disabled', true)
  await act(async () => answer([]))
  expect(screen.getByRole('button', { name: 'Create and push' })).toHaveProperty('disabled', true)
  act(() => {
    at.services.cache.setQueryData(keys.repositoryOwners('conn1'), [owner])
  })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create and push' })).toHaveProperty('disabled', false))
  await userEvent.clear(screen.getByRole('textbox', { name: 'Name' }))
  expect(screen.getByRole('button', { name: 'Create and push' })).toHaveProperty('disabled', true)
  expect(at.client.publishRepository).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Back' }))
  expect(at.back).toHaveBeenCalledOnce()
})

it('publishes privately once, keeps the form busy until confirmed, then refreshes repository and thread reads', async () => {
  let finish!: (reply: { remote: string; webUrl: string; branch: string }) => void
  const publish = vi.fn(
    () =>
      new Promise<{ remote: string; webUrl: string; branch: string }>((resolve) => {
        finish = resolve
      }),
  )
  const at = card({ publishRepository: publish })
  const invalidate = vi.spyOn(at.services.cache, 'invalidateQueries')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create and push' })).toHaveProperty('disabled', false))
  await userEvent.click(screen.getByRole('button', { name: 'Create and push' }))
  expect(publish).toHaveBeenCalledExactlyOnceWith({
    at: { projectId: 'p1', repositoryId: 'app' },
    connectionId: 'conn1',
    owner,
    name: 'meridian',
    private: true,
  })
  expect(screen.getByRole('button', { name: 'Back' })).toHaveProperty('disabled', true)
  expect(at.done).not.toHaveBeenCalled()
  await act(async () => finish({ remote: 'ada/meridian', webUrl: 'https://github.com/ada/meridian', branch: 'trunk' }))
  await waitFor(() => expect(at.done).toHaveBeenCalledOnce())
  expect(invalidate).toHaveBeenCalledWith({ queryKey: keys.repositories('p1') })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['thread'] })
})

it('uses the organisation and visibility explicitly chosen by the person', async () => {
  const at = card({ listRepositoryOwners: vi.fn(async () => [owner, organisation]) })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create and push' })).toHaveProperty('disabled', false))
  await userEvent.click(screen.getByRole('combobox', { name: 'Owner' }))
  await userEvent.click(await screen.findByRole('option', { name: 'Northwind' }))
  await userEvent.click(screen.getByRole('radio', { name: 'Public' }))
  await userEvent.click(screen.getByRole('button', { name: 'Create and push' }))
  await waitFor(() => expect(at.done).toHaveBeenCalledOnce())
  expect(at.client.publishRepository).toHaveBeenCalledWith(expect.objectContaining({ owner: organisation, private: false }))
})

it.each([
  [new ApiError({ reason: 'PublishRefused', why: 'taken', message: 'That name is taken.' }), true, 'That name is taken.'],
  [new ApiError({ reason: 'PublishRefused', message: 'The host refused the push.' }), false, 'The host refused the push.'],
  [new Error('Private transport diagnostics.'), false, "Althar's runtime didn't answer. If it keeps happening, restart Althar."],
])('keeps a refused publication on the card and retries only after another explicit press (%s)', async (failure, atName, words) => {
  const publish = vi
    .fn()
    .mockRejectedValueOnce(failure)
    .mockResolvedValueOnce({ remote: 'ada/other', webUrl: 'https://github.com/ada/other', branch: 'trunk' })
  const at = card({ publishRepository: publish })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create and push' })).toHaveProperty('disabled', false))
  await userEvent.click(screen.getByRole('button', { name: 'Create and push' }))
  expect(await screen.findByText(words)).not.toBeNull()
  expect(at.done).not.toHaveBeenCalled()
  const name = screen.getByRole('textbox', { name: 'Name' })
  expect(name.getAttribute('aria-invalid')).toBe(atName ? 'true' : null)
  await userEvent.clear(name)
  await userEvent.type(name, 'other')
  expect(name.getAttribute('aria-invalid')).toBeNull()
  expect(publish).toHaveBeenCalledTimes(1)
  await userEvent.click(screen.getByRole('button', { name: 'Create and push' }))
  await waitFor(() => expect(at.done).toHaveBeenCalledOnce())
  expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'other' }))
})

it('offers connected code hosts first, leaving trackers and unavailable credentials out of publishing', () => {
  expect(hostChoices(null).hosts.map((host) => host.id)).toEqual(['github', 'gitlab', 'bitbucket'])
  const chosen = hostChoices({
    ...connectionList,
    connections: [
      githubConnection,
      { ...githubConnection, id: 'expired', state: 'reauth_required' },
      { ...githubConnection, id: 'tracker', product: 'linear' },
      { ...githubConnection, id: 'gitlab', product: 'gitlab', name: 'My GitLab' },
    ],
  })
  expect(chosen.ready.map((host) => host.id)).toEqual(['conn1', 'gitlab'])
  expect(chosen.hosts.map(({ id, connected, thing }) => ({ id, connected, thing }))).toEqual([
    { id: 'conn1', connected: true, thing: 'repository' },
    { id: 'gitlab', connected: true, thing: 'project' },
    { id: 'bitbucket', connected: false, thing: 'repository' },
  ])
})
