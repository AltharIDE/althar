import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ConnectionList, ProjectRepository } from '@althar/contracts'
import { Brand, HostReach, RepositoryRole } from '@althar/ui'

import type { Opening } from '../src/renderer/features/connections/ConnectDialog'
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
    expect(screen.getByText('Tasks work in their own worktrees, never in these folders')).toBeTruthy()
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
