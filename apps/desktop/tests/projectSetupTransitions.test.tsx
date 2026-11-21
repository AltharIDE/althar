import { useSyncExternalStore } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { ConnectionList } from '@althar/contracts'

import { type Draft, type DraftFolder, draftsOf } from '../src/renderer/features/newProject/draft'
import { useSetup } from '../src/renderer/features/newProject/useSetup'
import { ServicesProvider } from '../src/renderer/data/services'
import { fakeClient, fakeHost, connectionList, githubConnection } from './fixtures'
import { servicesFor } from './render'

const folder: DraftFolder = {
  path: '/work/repo',
  grant: 'grant_repo',
  name: 'repo',
  where: '~/repo',
  remote: null,
  project: null,
  found: null,
  git: 'ready',
  empty: false,
}
const connected: ConnectionList = { ...connectionList, connections: [githubConnection] }
const setup = (initial: Partial<Draft> = {}, list: ConnectionList | null = connected, overrides: Parameters<typeof fakeClient>[0] = {}) => {
  const { client } = fakeClient(overrides)
  const store = draftsOf(client)
  const draft = store.start()
  store.change(draft.id, (now) => ({ ...now, name: 'Repo', way: 'folder', folders: [folder], ...initial }))
  const services = servicesFor(client, fakeHost({ clonePlace: vi.fn(async () => null) }))
  const hook = renderHook(
    () => {
      const current = useSyncExternalStore(store.subscribe, store.get)!
      return useSetup(current, store, list)
    },
    { wrapper: ({ children }) => <ServicesProvider value={services}>{children}</ServicesProvider> },
  )
  return { ...hook, client, store, change: (next: Partial<Draft>) => act(() => store.change(draft.id, (now) => ({ ...now, ...next }))) }
}

it('keeps owner, repository name and visibility together when changing the code host, and clears them when staying local', async () => {
  const owners = [
    { id: 'ada', name: 'Ada', kind: 'user' as const },
    { id: 'team', name: 'Team', kind: 'organization' as const },
  ]
  const at = setup({}, connected, { listRepositoryOwners: vi.fn(async () => owners) })
  await waitFor(() => expect(at.result.current.plan.publish?.owner?.id).toBe('ada'))
  act(() => at.result.current.onOwner('team'))
  expect(at.result.current.plan.publish?.owner?.id).toBe('team')
  act(() => at.result.current.onRepoName('new-name'))
  act(() => at.result.current.onPrivate(false))
  expect(at.result.current.plan.publish).toMatchObject({ name: 'new-name', private: false, owner: owners[1] })
  act(() => at.result.current.onHome('here'))
  expect(at.result.current.plan.publish).toBeNull()
  const kept = at.store.get()?.home
  act(() => {
    at.result.current.onOwner('team')
    at.result.current.onRepoName('ignored')
    at.result.current.onPrivate(true)
  })
  expect(at.store.get()?.home).toEqual(kept)
  act(() => at.result.current.onHome('conn1'))
  act(() => at.result.current.onOwner('missing'))
  expect(at.store.get()?.home).toMatchObject({ kind: 'host', owner: null })
})

it('reports failed repository discovery and retries it, and independently retries owner discovery', async () => {
  const repositories = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue([])
  const owners = vi
    .fn()
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValue([{ id: 'ada', name: 'Ada', kind: 'user' }])
  const at = setup({}, connected, { listHostRepositories: repositories, listRepositoryOwners: owners })
  await waitFor(() => expect(at.result.current.failed).toEqual(['github']))
  await waitFor(() => expect(at.result.current.home).toMatchObject({ kind: 'picks', ownersFailed: true }))
  act(() => at.result.current.retry())
  act(() => {
    const home = at.result.current.home
    if (home.kind === 'picks') home.retryOwners()
  })
  await waitFor(() => expect(at.result.current.failed).toEqual([]))
  await waitFor(() => expect(at.result.current.plan.publish?.owner?.id).toBe('ada'))
  expect(repositories).toHaveBeenCalledTimes(2)
  expect(owners).toHaveBeenCalledTimes(2)
})

it('keeps tracker and container choices, ignores unknown containers, and switches back to host issues or none', async () => {
  const tracker = { ...githubConnection, id: 'linear', product: 'linear' as const, name: 'Linear', webUrl: 'https://linear.app' }
  const list = { ...connected, connections: [...connected.connections, tracker] }
  const at = setup({}, list, {
    listContainers: vi.fn(async () => [
      { id: 'one', key: null, name: 'One' },
      { id: 'two', key: null, name: 'Two' },
    ]),
  })
  await waitFor(() => expect(at.result.current.issues.container).toBe('one'))
  act(() => at.result.current.onContainer('two'))
  expect(at.result.current.plan.tracker).toEqual({ connectionId: 'linear', container: { id: 'two', name: 'Two' } })
  act(() => at.result.current.onContainer('missing'))
  expect(at.result.current.issues.container).toBe('two')
  act(() => at.result.current.onIssues('host'))
  expect(at.result.current.plan.tracker?.connectionId).toBe('conn1')
  act(() => at.result.current.onIssues('none'))
  act(() => at.result.current.onContainer('two'))
  expect(at.result.current.plan.tracker).toBeNull()
  act(() => at.result.current.onIssues('linear'))
  expect(at.result.current.issues.value).toBe('linear')
})

it('falls back from a disconnected host and tracker and names multiple connections without confusing them', async () => {
  const another = { ...githubConnection, id: 'other', webUrl: 'https://git.example.com' }
  const malformed = { ...githubConnection, id: 'bad-url', webUrl: 'not-a-url' }
  const at = setup(
    {
      home: { kind: 'host', connectionId: 'gone', owner: null, name: null, private: true },
      issues: { kind: 'tracker', connectionId: 'gone', container: null },
    },
    { ...connected, connections: [githubConnection, another, malformed] },
  )
  await waitFor(() => expect(at.result.current.plan.publish?.connectionId).toBe('conn1'))
  expect(at.result.current.home).toMatchObject({
    connected: [{ name: 'GitHub (github.com)' }, { name: 'GitHub (git.example.com)' }, { name: 'GitHub' }],
  })
  expect(at.result.current.issues.value).toBe('none')
})

it('does not discard a completed clone when reselecting the same remote, and removes it when choosing another', async () => {
  const repositories = [
    { path: ['ada', 'repo'], webUrl: 'https://github.com/ada/repo', description: null, private: false, pushedAt: null, archived: false },
    { path: ['ada', 'other'], webUrl: 'https://github.com/ada/other', description: null, private: false, pushedAt: null, archived: false },
  ]
  const clone = {
    id: 'conn1:ada/repo',
    remote: 'ada/repo',
    from: { connectionId: 'conn1', path: ['ada', 'repo'] },
    product: 'github' as const,
    hostName: 'GitHub',
    host: 'github.com',
    here: null,
  }
  const at = setup({ name: '', way: 'clone', folders: [{ ...folder, came: 'clone' }], clone }, connected, {
    listHostRepositories: vi.fn(async () => repositories),
  })
  await waitFor(() => expect(at.result.current.repositories).toHaveLength(2))
  act(() => at.result.current.choose('conn1:ada/repo'))
  expect(at.store.get()?.folders).toHaveLength(1)
  expect(at.store.get()?.name).toBe('Repo')
  act(() => at.result.current.choose('conn1:ada/other'))
  expect(at.store.get()?.folders).toEqual([])
  expect(at.store.get()?.clone?.remote).toBe('ada/other')
  const before = at.store.get()
  act(() => at.result.current.choose('missing'))
  expect(at.store.get()).toBe(before)
})

it('describes local and unrecognized remotes without assigning a connected host’s issues to them', () => {
  const at = setup({ folders: [{ ...folder, remote: '/srv/repo' }] }, null)
  expect(at.result.current.home).toEqual({ kind: 'fixed', brand: null, said: 'At /srv/repo.' })
  expect(at.result.current.issues.host).toBeNull()
  at.change({ folders: [folder], home: { kind: 'here' } })
  expect(at.result.current.plan.publish).toBeNull()
  at.change({ folders: [folder, { ...folder, path: '/work/second' }] })
  expect(at.result.current.home).toEqual({ kind: 'none' })
})

it.each(['https://github.com/ada/unlisted', 'https://git.example.com/ada/unlisted'])(
  'keeps a pasted remote’s authority when choosing an unlisted repository (%s)',
  async (url) => {
    const at = setup({ way: 'clone', folders: [], query: url })
    await waitFor(() => expect(at.result.current.repositories).toEqual([]))
    const pasted = at.result.current.pasted!
    expect(pasted.name).toBe('unlisted')
    act(() => at.result.current.choose(pasted.id))
    const picked = at.store.get()?.clone
    expect(picked?.remote).toBe('ada/unlisted')
    const github = new URL(url).hostname === 'github.com'
    expect(picked?.from).toEqual(github ? { connectionId: 'conn1', path: ['ada', 'unlisted'] } : { url })
    expect(at.result.current.clone?.brand === null).toBe(!github)
    act(() => at.result.current.connect('gitlab'))
    expect(at.result.current.connecting).toBe('gitlab')
    act(() => at.result.current.endConnect())
    expect(at.result.current.connecting).toBeNull()
  },
)
