import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type FolderReading } from '@althar/contracts'

import { useAccountSignIn } from '../src/renderer/features/accounts/useAccountSignIn'
import { StartView } from '../src/renderer/features/start/StartView'
import { useStart } from '../src/renderer/features/start/useStart'
import { fakeClient, fakeHost } from './fixtures'
import { withServices } from './render'

/*
 * The first project, made on the first screen, where the rest of its tests
 * don't go: with its name cleared, so it takes its folder's own, alone or
 * of several repositories; and the runtime refusing to make it.
 */

function Start({ onProject = vi.fn() }: { onProject?: (id: string) => void }) {
  const start = useStart()
  return <StartView model={start} accounts={useAccountSignIn(start)} onProject={onProject} home={() => null} />
}

const found = (name: string, at = '/w') => ({ path: `${at}/${name}`, folder: null, name, branch: 'main', remote: null })

/** The first screen, with the folder picked read as given. */
const first = (reading: FolderReading, more: Parameters<typeof fakeClient>[0] = {}) => {
  const onProject = vi.fn()
  const { client } = fakeClient({
    listProjects: vi.fn(async () => ({ cursor: 0, projects: [] })),
    readFolder: vi.fn(async () => reading),
    ...more,
  })
  withServices(<Start onProject={onProject} />, client, fakeHost())
  return { client, onProject }
}

/** Adds the folder, clears the name the project would take, and makes it. */
const makeUnnamed = async () => {
  await userEvent.click(await screen.findByRole('button', { name: /Add a folder/ }))
  await screen.findByRole('list', { name: 'Repositories for the project' })
  await userEvent.clear(screen.getByRole('textbox', { name: 'Project name' }))
  await userEvent.click(screen.getByRole('button', { name: /Make the project/ }))
}

describe('the first screen', () => {
  it('looks around while the agents are still being read', async () => {
    const { client } = fakeClient({
      listProjects: vi.fn(async () => ({ cursor: 0, projects: [] })),
      status: vi.fn(() => new Promise<never>(() => undefined)),
    })
    withServices(<Start />, client, fakeHost())
    expect(await screen.findByText('Looking around this Mac…')).toBeTruthy()
  })
})

describe('the first project, its name cleared', () => {
  it('opens one repository as the folder it is, under its own name', async () => {
    const { client, onProject } = first({ kind: 'repository', name: 'meridian', repositories: [found('meridian')], project: null })
    await makeUnnamed()
    await waitFor(() => expect(onProject).toHaveBeenCalledWith('p1'))
    expect(client.openProject).toHaveBeenCalledWith('grant_picked')
  })

  it('makes one of several repositories with no name of its own', async () => {
    const { client, onProject } = first({ kind: 'folder', name: 'work', repositories: [found('api'), found('web')], project: null })
    await makeUnnamed()
    await waitFor(() => expect(onProject).toHaveBeenCalledWith('p1'))
    expect(client.openProject).toHaveBeenCalledWith('grant_picked', {
      repositories: [
        { grant: 'grant_picked', path: '/w/api' },
        { grant: 'grant_picked', path: '/w/web' },
      ],
    })
  })
})

describe('the first project, refused', () => {
  it('says why in the runtime’s words, and can be made again', async () => {
    const openProject = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ reason: 'GitFailed', message: 'Git couldn’t read it.' }))
      .mockResolvedValue({ id: 'p1' })
    const { onProject } = first({ kind: 'repository', name: 'meridian', repositories: [found('meridian')], project: null }, { openProject })
    await userEvent.click(await screen.findByRole('button', { name: /Add a folder/ }))
    const list = await screen.findByRole('list', { name: 'Repositories for the project' })
    expect(within(list).getByRole('checkbox', { name: /meridian/ })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Make the project/ }))
    expect(await screen.findByText('Git couldn’t read it.')).toBeTruthy()
    expect(onProject).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /Make the project/ }))
    await waitFor(() => expect(onProject).toHaveBeenCalledWith('p1'))
  })
})
