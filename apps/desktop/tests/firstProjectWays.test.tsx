import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type ConnectionList, type HostRepository, type ProjectRepository, type ProjectSummary } from '@althar/contracts'

import { useAccountSignIn } from '../src/renderer/features/accounts/useAccountSignIn'
import { StartView } from '../src/renderer/features/start/StartView'
import { useStart } from '../src/renderer/features/start/useStart'
import { connectionList, fakeClient, fakeHost, githubConnection, project } from './fixtures'
import { withServices } from './render'
import { seenTheTour, toTheProject } from './welcome'

/*
 * The first project's three ways in, on the welcome: a folder of this
 * computer's, a clone from a code host connected, or a new repository,
 * named first. A clone skips the step for its code host; a repository only
 * here, with a code host connected, can be put on it from that step.
 */

function Start({ onProject = vi.fn() }: { onProject?: (id: string) => void }) {
  const start = useStart()
  return <StartView model={start} accounts={useAccountSignIn(start)} onProject={onProject} home={() => null} />
}

const connected: ConnectionList = { ...connectionList, connections: [githubConnection] }

const API: HostRepository = {
  path: ['meridian', 'api'],
  description: null,
  private: true,
  pushedAt: new Date(Date.now() - 3_600_000).toISOString(),
  webUrl: 'https://github.com/meridian/api',
  archived: false,
}

const onlyHere: ProjectRepository = {
  id: 'repo_meridian',
  name: 'meridian',
  path: '/Users/me/code/meridian',
  folder: null,
  branch: 'trunk',
  host: null,
  role: 'service',
  fork: null,
  tasks: 0,
  setup: { copy: [], commands: [] },
}

const way = (name: RegExp) => screen.getByRole('radio', { name })

const first = (more: Parameters<typeof fakeClient>[0] = {}) => {
  let projects: ReadonlyArray<ProjectSummary> = []
  const onProject = vi.fn()
  const made = { ...project, name: 'meridian' }
  const { client } = fakeClient({
    listProjects: vi.fn(async () => ({ cursor: 0, projects })),
    listConnections: vi.fn(async () => connected),
    listHostRepositories: vi.fn(async () => [API]),
    readFolder: vi.fn(async (grant: string) => ({
      kind: 'repository' as const,
      name: grant === 'grant_picked' ? 'meridian' : 'api',
      repositories: [{ path: `/Users/me/code/${grant}`, folder: null, name: 'meridian', branch: 'main', remote: null, commits: true }],
      project: null,
    })),
    openProject: vi.fn(async () => {
      projects = [made]
      return made
    }),
    ...more,
  })
  seenTheTour()
  withServices(<Start onProject={onProject} />, client, fakeHost())
  return { client, onProject }
}

describe('the first project’s ways in', () => {
  it('starts on a clone where a code host is connected and nothing was found here, and skips the code host’s step', async () => {
    const { client } = first()
    await toTheProject()
    await waitFor(() => expect(way(/^Clone/).getAttribute('aria-checked')).toBe('true'))
    await userEvent.click(await screen.findByRole('button', { name: 'Clone meridian/api' }))
    expect(await screen.findByRole('button', { name: 'Chosen meridian/api' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /^Make the project/ }))
    await waitFor(() => expect(client.openProject).toHaveBeenCalled())
    expect(client.cloneRepository).toHaveBeenCalled()
    // Its code lives where it came from: no step for its code host.
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Make the project/ })).toBeNull())
    expect(screen.queryByRole('list', { name: 'Code hosts' })).toBeNull()
  })

  it('says why a clone was refused, on the project’s step, and makes nothing', async () => {
    const cloneRepository = vi.fn(async () => Promise.reject(new ApiError({ reason: 'GitFailed', message: 'GitHub refused the clone.' })))
    const { client } = first({ cloneRepository })
    await toTheProject()
    await userEvent.click(await screen.findByRole('button', { name: 'Clone meridian/api' }))
    await userEvent.click(screen.getByRole('button', { name: /^Make the project/ }))
    expect(await screen.findByText('GitHub refused the clone.')).toBeTruthy()
    expect(client.openProject).not.toHaveBeenCalled()
  })

  it('starts empty, named first, placed, and makes a new repository as the project is made', async () => {
    const { client } = first()
    await toTheProject()
    await userEvent.click(way(/^Start empty/))
    await waitFor(() => expect(way(/^Start empty/).getAttribute('aria-checked')).toBe('true'))
    await userEvent.type(screen.getByRole('textbox', { name: 'Project name' }), 'Lighthouse')
    await userEvent.click(await screen.findByRole('button', { name: 'Choose where it goes…' }))
    await waitFor(() => expect(client.placeRepository).toHaveBeenCalledWith('grant_place', 'Lighthouse'))
    await userEvent.click(screen.getByRole('button', { name: /^Make the project/ }))
    await waitFor(() => expect(client.makeRepository).toHaveBeenCalled())
    await waitFor(() => expect(client.openProject).toHaveBeenCalled())
  })

  it('says a repository made only here is so, and puts it on the code host connected from its step', async () => {
    const getRepositories = vi.fn(async (): Promise<ReadonlyArray<ProjectRepository>> => [onlyHere])
    const { client } = first({ getRepositories })
    await toTheProject()
    await userEvent.click(way(/^A folder/))
    await userEvent.click(await screen.findByRole('button', { name: /Choose a folder/ }))
    await screen.findByRole('list', { name: 'Repositories for the project' })
    await userEvent.click(screen.getByRole('button', { name: /^Make the project/ }))
    expect(await screen.findByText(/meridian is only on this/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Push to…' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'A new repository on GitHub' }))
    const card = await screen.findByRole('heading', { name: 'A new repository on GitHub' })
    expect(card).toBeTruthy()
    // Back leaves it as it was, with the way to put it there again.
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Push to…' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'A new repository on GitHub' }))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Create and push' }) as HTMLButtonElement).disabled).toBe(false))
    getRepositories.mockResolvedValue([{ ...onlyHere, host: { ...githubConnectionHost } }])
    await userEvent.click(screen.getByRole('button', { name: 'Create and push' }))
    await waitFor(() =>
      expect(client.publishRepository).toHaveBeenCalledWith(
        expect.objectContaining({ at: { projectId: 'p1', repositoryId: 'repo_meridian' }, connectionId: 'conn1', name: 'meridian' }),
      ),
    )
    // On the host now, it says so no more.
    await waitFor(() => expect(screen.queryByText(/meridian is only on this/)).toBeNull())
    expect(screen.queryByRole('heading', { name: 'A new repository on GitHub' })).toBeNull()
    expect(within(screen.getByRole('list', { name: 'Code hosts' })).getByText('GitHub')).toBeTruthy()
  })
})

const githubConnectionHost: NonNullable<ProjectRepository['host']> = {
  product: 'github',
  name: 'GitHub',
  instance: null,
  path: 'ada/meridian',
  url: 'https://github.com/ada/meridian',
  account: { login: 'you', state: 'ready' },
}
