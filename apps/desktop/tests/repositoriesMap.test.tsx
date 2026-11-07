import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type ConnectionList, type ProjectRepository } from '@althar/contracts'
import { Brand, ChangeTarget, HostReach, RepositoryRole } from '@althar/ui'

import type { Opening } from '../src/renderer/features/connections/ConnectDialog'
import { ForkOffer, useForkOffer } from '../src/renderer/features/repositories/ForkOffer'
import { entryOf, hostsOf, Repositories } from '../src/renderer/features/repositories/Repositories'
import { useRepositories } from '../src/renderer/features/repositories/useRepositories'
import { connectionList, fakeClient, project, repositories } from './fixtures'
import { withServices } from './render'

/*
 * A project's repositories as the map draws them, where the rest of their
 * tests don't go: one not on this Mac, in a folder of a repository, on no
 * branch, staying here, or on a host Althar doesn't know or must sign in to
 * again; and the part for a project not listed yet.
 */

const [api, web, infra] = repositories as [ProjectRepository, ProjectRepository, ProjectRepository]

describe('a repository on the map', () => {
  it('says where it is, inside a repository too, and nothing of a place or branch it hasn’t', () => {
    expect(entryOf({ ...api, folder: 'packages/sdk' })).toMatchObject({ where: '~/code/meridian-api/packages/sdk' })
    const away = entryOf({ ...api, path: null, branch: null, host: null })
    expect(away).toEqual({ id: 'repo_api', name: 'meridian-api', role: RepositoryRole.Service, tasks: 1 })
  })

  it('names a remote with no page to open, on a host Althar doesn’t know', () => {
    const unknown = {
      ...infra,
      host: { product: null, name: 'git.northwind.io', instance: null, path: 'ops/infra', url: null, account: null },
    }
    expect(entryOf(unknown).remote).toEqual({ host: 'elsewhere:git.northwind.io', path: 'ops/infra' })
    expect(hostsOf([unknown])).toEqual([{ id: 'elsewhere:git.northwind.io', name: 'git.northwind.io', reach: HostReach.Unknown }])
  })

  it('draws each host once, with its server and its sign-in as it stands', () => {
    const own = {
      ...infra,
      host: { ...infra.host!, instance: 'gitlab.northwind.io', account: { login: 'dana', state: 'reauth_required' as const } },
    }
    expect(hostsOf([api, web, own, { ...api, id: 'repo_sdk', host: null }])).toEqual([
      { id: 'github:GitHub', name: 'GitHub', brand: Brand.GitHub, reach: HostReach.Connected, account: 'you' },
      {
        id: 'gitlab:gitlab.northwind.io',
        name: 'GitLab',
        brand: Brand.GitLab,
        instance: 'gitlab.northwind.io',
        reach: HostReach.SignInAgain,
        account: 'dana',
      },
    ])
  })
})

describe('a project’s repositories part', () => {
  function Part({ connections, onConnect }: { connections: ConnectionList | null; onConnect: (opening: Opening) => void }) {
    return <Repositories model={useRepositories('p1')} connections={connections} onConnect={onConnect} />
  }

  it('names a project not listed yet as the project, says nothing of worktrees not made, and connects a host its work goes to', async () => {
    const onConnect = vi.fn()
    const { client } = fakeClient({
      listProjects: vi.fn(async () => ({ cursor: 3, projects: [] })),
      getRepositories: vi.fn(async () => [{ ...api, host: null }, infra]),
    })
    withServices(<Part connections={connectionList} onConnect={onConnect} />, client)
    const here = within(await screen.findByRole('list', { name: 'On this Mac' }))
    expect(here.getByText('~/code/meridian-api')).toBeTruthy()
    expect(screen.getByText('Tasks work in their own worktrees')).toBeTruthy()
    await userEvent.click(here.getByRole('button', { name: 'More for meridian-infra' }))
    expect(await screen.findByRole('menuitem', { name: /Leave out of The project/ })).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Connect GitLab' }))
    expect(onConnect).toHaveBeenCalledWith({ service: 'gitlab' })
  })

  it('names the project’s worktrees where they are made', async () => {
    const { client } = fakeClient({ listProjects: vi.fn(async () => ({ cursor: 3, projects: [project] })) })
    withServices(<Part connections={null} onConnect={vi.fn()} />, client)
    await waitFor(() => expect(screen.getByText(/Tasks work in their own worktrees, in/)).toBeTruthy())
    expect(screen.getByText('~/Althar/meridian')).toBeTruthy()
  })
})

describe('a fork’s branches going upstream', () => {
  const fork = (set: Partial<NonNullable<ProjectRepository['fork']>>): ProjectRepository => ({
    ...web,
    fork: {
      fork: 'you/meridian-web',
      upstream: 'meridian/web',
      remote: 'upstream',
      by: 'names',
      target: 'upstream',
      canPush: true,
      offer: true,
      ...set,
    },
  })

  function Offer() {
    return <ForkOffer offer={useForkOffer('p1', useRepositories('p1').repositories)} />
  }

  function Settings() {
    return <Repositories model={useRepositories('p1')} connections={connectionList} onConnect={() => {}} />
  }

  it('tells the map what the host said, and nothing where it hasn’t', () => {
    expect(entryOf(fork({ canPush: false })).fork).toEqual({
      upstream: 'meridian/web',
      target: ChangeTarget.Upstream,
      canPush: false,
      remote: 'upstream',
    })
    expect(entryOf(fork({ target: 'upstream_branch' })).fork).toEqual({
      upstream: 'meridian/web',
      target: ChangeTarget.UpstreamBranch,
      canPush: true,
      remote: 'upstream',
    })
    expect(entryOf(fork({ canPush: null })).fork).toEqual({ upstream: 'meridian/web', target: ChangeTarget.Upstream, remote: 'upstream' })
  })

  it('offers to add the repository it was forked from as a remote where its host says it is one, and adds it', async () => {
    const { client } = fakeClient({ getRepositories: vi.fn(async () => [fork({ remote: null, by: 'host', offer: false })]) })
    withServices(<Settings />, client)
    expect(
      await screen.findByText(
        'Your clone has no remote for meridian/web, so tasks start from your fork, and you can’t push branches there yourself.',
      ),
    ).toBeTruthy()
    vi.mocked(client.getRepositories).mockResolvedValue([fork({ remote: 'upstream', by: 'host', offer: false })])
    await userEvent.click(screen.getByRole('button', { name: 'Add it as a remote' }))
    expect(client.addParentRemote).toHaveBeenCalledWith('p1', web.id)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add it as a remote' })).toBeNull())
  })

  it('names the remote its clone has the repository it forks as', async () => {
    const { client } = fakeClient({ getRepositories: vi.fn(async () => [fork({ remote: 'base', by: 'host', offer: false })]) })
    withServices(<Settings />, client)
    expect(await screen.findByText('The repository it forks, as base')).toBeTruthy()
  })

  it('offers it once: accepting sets the project and takes the offer away, with no remote touched', async () => {
    const { client } = fakeClient({ getRepositories: vi.fn(async () => [fork({})]) })
    withServices(<Offer />, client)
    expect(await screen.findByText('You can push to meridian/web now. Push new tasks’ branches there instead of your fork?')).toBeTruthy()
    vi.mocked(client.getRepositories).mockResolvedValue([fork({ target: 'upstream_branch', offer: false })])
    await userEvent.click(screen.getByRole('button', { name: 'Push there' }))
    expect(client.setRepository).toHaveBeenCalledWith({ projectId: 'p1', repositoryId: web.id, changeTarget: 'upstream_branch' })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Push there' })).toBeNull())
  })

  it('takes not now for an answer, changing nothing but the offer', async () => {
    const { client } = fakeClient({ getRepositories: vi.fn(async () => [fork({})]) })
    withServices(<Offer />, client)
    await screen.findByRole('button', { name: 'Not now' })
    vi.mocked(client.getRepositories).mockResolvedValue([fork({ offer: false })])
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(client.setRepository).toHaveBeenCalledWith({ projectId: 'p1', repositoryId: web.id, notNow: true })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull())
  })

  it('says why, where it was answered, if the host has taken the access away since', async () => {
    const { client } = fakeClient({
      getRepositories: vi.fn(async () => [fork({})]),
      setRepository: vi.fn(async () => {
        throw new ApiError({ reason: 'ProjectRefused', message: 'You can’t push to the repository it was forked from yet.' })
      }),
    })
    withServices(<Offer />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Push there' }))
    expect((await screen.findByRole('alert')).textContent).toBe('You can’t push to the repository it was forked from yet.')
  })

  it('offers nothing without access or once answered', async () => {
    const { client } = fakeClient({ getRepositories: vi.fn(async () => [fork({ offer: false, canPush: false })]) })
    withServices(<Offer />, client)
    await waitFor(() => expect(client.getRepositories).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Push there' })).toBeNull()
  })
})
