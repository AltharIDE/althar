import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ProjectInk } from '@althar/ui'

import type { Client } from '../src/renderer/data/client'
import { makeQueryClient } from '../src/renderer/data/reads'
import { type Host, ServicesProvider } from '../src/renderer/data/services'
import { draftActions, draftsOf } from '../src/renderer/features/newProject/draft'
import { useNewProject } from '../src/renderer/features/newProject/useNewProject'
import { connectionList, fakeClient, fakeHost, project, repositories } from './fixtures'
import { servicesFor } from './render'

/*
 * A new project's draft where the rest of its tests don't go: its model and
 * actions with no draft open, repositories found that can't be read, a
 * folder on a host Althar doesn't know, and a repository found in a project
 * already, by where it is.
 */

const modelOf = (client: Client, host: Host = fakeHost()) => {
  const services = servicesFor(client, host)
  return renderHook(() => useNewProject(), {
    wrapper: ({ children }: { children: ReactNode }) => <ServicesProvider value={services}>{children}</ServicesProvider>,
  })
}

describe('a new project with no draft open', () => {
  it('shows nothing, and renames, colours, leaves out, adds and makes nothing', async () => {
    const { client } = fakeClient()
    const host = fakeHost()
    const { result } = modelOf(client, host)
    expect(result.current.draft).toBeNull()
    expect(result.current.folders).toEqual([])
    expect(result.current.found).toBeNull()
    expect(result.current.findings).toEqual([])
    act(() => {
      result.current.rename('Northwind')
      result.current.colour(ProjectInk.Rose)
      result.current.leaveOut('/w/app')
    })
    await act(async () => result.current.add('f-unknown'))
    expect(await act(async () => result.current.create())).toBeNull()
    expect(draftsOf(client).get()).toBeNull()
    expect(host.grantFound).not.toHaveBeenCalled()
    expect(client.openProject).not.toHaveBeenCalled()
  })

  it('picks, takes in and makes nothing through its actions', async () => {
    const { client } = fakeClient()
    const host = fakeHost()
    const actions = draftActions({ client, host, cache: makeQueryClient() })
    await actions.choose()
    await actions.drop([new File([], 'ops')])
    expect(await actions.create('clay')).toBeNull()
    expect(host.pickFolders).not.toHaveBeenCalled()
    expect(host.grantDropped).not.toHaveBeenCalled()
    expect(client.openProject).not.toHaveBeenCalled()
  })
})

describe('a new project’s draft', () => {
  it('offers nothing found where looking for repositories failed', async () => {
    const { client } = fakeClient()
    draftsOf(client).start()
    const { result } = modelOf(client, fakeHost({ findRepositories: vi.fn(async () => Promise.reject(new Error('gone'))) }))
    await waitFor(() => expect(result.current.found).toEqual({ like: null, first: [], more: [] }))
  })

  it('names a folder on a host Althar doesn’t know by its host alone, with nothing to connect there', async () => {
    const { client } = fakeClient({
      readFolder: vi.fn(async () => ({
        kind: 'repository' as const,
        name: 'infra',
        repositories: [{ path: '/w/infra', folder: null, name: 'infra', branch: 'main', remote: 'git@git.northwind.io:ops/infra.git' }],
        project: null,
      })),
      listConnections: vi.fn(async () => connectionList),
    })
    draftsOf(client).start()
    const { result } = modelOf(client, fakeHost({ pickFolders: vi.fn(async () => ['grant_infra']) }))
    await act(async () => result.current.choose())
    await waitFor(() => expect(result.current.folders).toHaveLength(1))
    await waitFor(() => expect(result.current.folders[0]).toMatchObject({ host: { name: 'git.northwind.io' }, remote: 'ops/infra' }))
    expect(result.current.folders[0]).not.toHaveProperty('host.brand')
    expect(result.current.findings).toEqual([])
  })

  it('says a repository found is in a project already by where it is, passing over one not on this Mac', async () => {
    const { client } = fakeClient({
      listProjects: vi.fn(async () => ({ cursor: 3, projects: [project] })),
      getRepositories: vi.fn(async () => [
        { ...repositories[0]!, path: null },
        { ...repositories[1]!, path: '/opt/code/meridian-web' },
      ]),
    })
    draftsOf(client).start()
    const found = {
      lookedIn: ['/opt/code'],
      repositories: [{ id: 'f-web', name: 'meridian-web', where: '/opt/code/meridian-web', branch: 'main', worked: 0 }],
    }
    const { result } = modelOf(client, fakeHost({ findRepositories: vi.fn(async () => found) }))
    await waitFor(() => expect(result.current.found?.first[0]).toMatchObject({ id: 'f-web', in: 'meridian' }))
  })
})
