import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { ApiError } from '@althar/contracts'

import { PutOnHost } from '../src/renderer/shared/PutOnHost'
import { fakeClient } from './fixtures'
import { withServices } from './render'

const connection = { id: 'github', name: 'GitHub', product: 'github' as const, thing: 'repository' }
it('publishes an existing project’s repository privately, then refreshes its host before closing', async () => {
  let finish!: () => void
  const { client } = fakeClient({
    publishRepository: vi.fn(
      () =>
        new Promise<{ remote: string; webUrl: string; branch: string }>((resolve) => {
          finish = () => resolve({ remote: 'ada/project', webUrl: 'https://github.com/ada/project', branch: 'main' })
        }),
    ),
  })
  const done = vi.fn()
  withServices(
    <PutOnHost projectId="p1" repository="repo" name="project" branch="main" connection={connection} onDone={done} onBack={() => {}} />,
    client,
  )
  const create = await screen.findByRole('button', { name: 'Create and push' })
  await waitFor(() => expect((create as HTMLButtonElement).disabled).toBe(false))
  await userEvent.click(create)
  expect(client.publishRepository).toHaveBeenCalledExactlyOnceWith({
    at: { projectId: 'p1', repositoryId: 'repo' },
    connectionId: 'github',
    owner: { id: 'ada', name: 'ada', kind: 'user' },
    name: 'project',
    private: true,
  })
  expect(done).not.toHaveBeenCalled()
  expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(true)
  finish()
  await waitFor(() => expect(done).toHaveBeenCalledOnce())
})

it.each([true, false])('keeps a refused publication editable, with name-specific feedback when taken (%s)', async (taken) => {
  const { client } = fakeClient({
    publishRepository: vi
      .fn()
      .mockRejectedValueOnce(
        taken ? new ApiError({ reason: 'PublishRefused', why: 'taken', message: 'That name is taken.' }) : new Error('Host unavailable'),
      )
      .mockResolvedValue({ remote: 'ada/next', webUrl: 'https://github.com/ada/next', branch: 'main' }),
  })
  const back = vi.fn()
  const done = vi.fn()
  withServices(
    <PutOnHost projectId="p1" repository="repo" name="project" branch="main" connection={connection} onDone={done} onBack={back} />,
    client,
  )
  const create = screen.getByRole('button', { name: 'Create and push' })
  await waitFor(() => expect((create as HTMLButtonElement).disabled).toBe(false))
  await userEvent.click(create)
  await screen.findByText(taken ? 'That name is taken.' : "Althar's runtime didn't answer. If it keeps happening, restart Althar.")
  const name = screen.getByRole('textbox', { name: 'Name' })
  await userEvent.clear(name)
  expect((create as HTMLButtonElement).disabled).toBe(true)
  await userEvent.type(name, ' next ')
  if (taken) expect(screen.queryByText('That name is taken.')).toBeNull()
  await userEvent.click(create)
  await waitFor(() => expect(done).toHaveBeenCalledOnce())
  expect(client.publishRepository).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'next' }))
  expect(back).not.toHaveBeenCalled()
})
