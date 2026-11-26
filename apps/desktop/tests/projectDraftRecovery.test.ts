import { expect, it, vi } from 'vitest'
import { ApiError, type FolderReading } from '@althar/contracts'

import {
  cloneFolders,
  draftActions,
  draftsOf,
  errorOf,
  foldersOf,
  type DraftClone,
  type DraftFolder,
} from '../src/renderer/features/newProject/draft'
import { makeQueryClient } from '../src/renderer/data/reads'
import { fakeClient, fakeHost } from './fixtures'

const later = <A>() => {
  let resolve!: (value: A) => void
  const promise = new Promise<A>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const clone: DraftClone = {
  id: 'clone',
  remote: 'ada/repo',
  host: 'github.com',
  hostName: 'GitHub',
  product: 'github',
  from: { connectionId: 'github', path: ['ada', 'repo'] },
  here: { found: 'found-repo', where: '~/repo' },
}
const plan = { publish: null, tracker: null }
const fixture = (clientOptions: Parameters<typeof fakeClient>[0] = {}, hostOptions: Parameters<typeof fakeHost>[0] = {}) => {
  const { client } = fakeClient(clientOptions)
  const host = fakeHost(hostOptions)
  const store = draftsOf(client)
  const draft = store.start()
  store.change(draft.id, (now) => ({ ...now, name: 'Repo' }))
  return { client, host, store, draft, actions: draftActions({ client, host, cache: makeQueryClient() }) }
}

it('discards a late folder read after its draft closed, without changing the new draft', async () => {
  const reading = later<FolderReading>()
  const at = fixture({ readFolder: vi.fn(() => reading.promise) }, { pickFolders: vi.fn(async () => ['grant_repo']) })
  const choosing = at.actions.choose()
  // Finish the picker microtask so the runtime read is pending.
  await Promise.resolve()
  expect(at.store.get()?.reading).toHaveLength(1)
  at.store.end()
  const next = at.store.start()
  reading.resolve({ kind: 'folder', name: 'Old', path: '/old', repositories: [], project: null })
  await choosing
  expect(at.store.get()).toEqual(next)
  expect(at.store.get()?.folders).toEqual([])
})

it('cancels placing and replacing a repository without losing its existing folder or starting git', async () => {
  const at = fixture({}, { pickPlace: vi.fn(async () => null), pickFolders: vi.fn(async () => []) })
  at.store.change(at.draft.id, (now) => ({
    ...now,
    folders: [
      {
        path: '/repo',
        grant: 'grant_repo',
        name: 'Repo',
        where: '~/repo',
        remote: null,
        project: null,
        found: null,
        git: 'none',
        empty: true,
      },
    ],
  }))
  await at.actions.startFresh()
  expect(at.store.get()).toMatchObject({ fresh: null, reading: [], error: null })
  await at.actions.replace('/repo')
  expect(at.store.get()?.folders).toHaveLength(1)
  expect(at.client.prepareFolder).not.toHaveBeenCalled()
})

it('reports a failed placement, and a retry keeps its grant and path for creation', async () => {
  const at = fixture({
    placeRepository: vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ reason: 'FolderRefused', why: 'unreadable', message: 'No access' }))
      .mockResolvedValue({ name: 'repo', path: '/repo' }),
  })
  await at.actions.startFresh()
  expect(at.store.get()?.error).toEqual({ said: 'No access', fix: { kind: 'access' } })
  expect(at.store.get()?.reading).toEqual([])
  await at.actions.startFresh()
  expect(at.store.get()?.fresh).toMatchObject({ name: 'repo', path: '/repo' })
  const calls = vi.mocked(at.client.placeRepository).mock.calls.length
  await at.actions.startFresh()
  expect(at.client.placeRepository).toHaveBeenCalledTimes(calls)
})

it('explains when a discovered or dropped folder cannot be granted, with no runtime read', async () => {
  const at = fixture({}, { grantFound: vi.fn(async () => null), grantDropped: vi.fn(async () => null) })
  await at.actions.addFound('missing', { name: 'Repo', where: '~/repo' })
  expect(at.store.get()?.error?.said).toContain('Choose it with Choose a folder')
  await at.actions.drop([new File([], 'plain.txt')])
  expect(at.store.get()?.error?.said).toContain('plain.txt isn’t a folder')
  expect(at.store.get()?.reading).toEqual([])
  expect(at.client.readFolder).not.toHaveBeenCalled()
})

it.each(['grant-refused', 'read-refused', 'not-repository', 'no-remote', 'different-host'] as const)(
  'clones instead of adopting a stale discovery (%s)',
  async (why) => {
    const reading: FolderReading = {
      kind: 'repository',
      name: 'repo',
      repositories: [
        { path: '/repo', folder: null, name: 'repo', branch: 'main', remote: why === 'no-remote' ? null : 'git@gitlab.com:ada/repo.git' },
      ],
      project: null,
    }
    const at = fixture(
      {
        readFolder:
          why === 'read-refused'
            ? vi.fn(async () => {
                throw new Error('Gone')
              })
            : vi.fn(async () =>
                why === 'not-repository' ? { kind: 'folder' as const, name: 'repo', repositories: [], project: null } : reading,
              ),
      },
      { grantFound: vi.fn(async () => (why === 'grant-refused' ? null : 'grant_found')) },
    )
    at.store.change(at.draft.id, (now) => ({ ...now, way: 'clone', clones: [clone] }))
    await at.actions.create('clay', plan)
    expect(at.client.cloneRepository).toHaveBeenCalledOnce()
    expect(at.client.openProject).toHaveBeenCalledOnce()
  },
)

it('prepares a discovered unborn repository at its own path and opens it without cloning', async () => {
  const at = fixture({
    readFolder: vi.fn(async (): Promise<FolderReading> => ({
      kind: 'repository',
      name: 'repo',
      repositories: [
        { path: '/existing/repo', folder: null, name: 'repo', branch: 'main', remote: 'git@github.com:ada/repo.git', commits: false },
      ],
      project: { id: 'existing', name: 'Existing' },
    })),
  })
  at.store.change(at.draft.id, (now) => ({ ...now, way: 'clone', clones: [clone] }))
  await at.actions.create('clay', plan)
  expect(at.client.cloneRepository).not.toHaveBeenCalled()
  expect(at.client.prepareFolder).toHaveBeenCalledWith(expect.any(String), '/existing/repo')
  expect(at.client.openProject).toHaveBeenCalledOnce()
})

it('cancels cloning if neither a usual place nor a chosen place exists, and clears busy state', async () => {
  const at = fixture({}, { clonePlace: vi.fn(async () => null), pickClonePlace: vi.fn(async () => null) })
  at.store.change(at.draft.id, (now) => ({ ...now, way: 'clone', clones: [{ ...clone, here: null }] }))
  expect(await at.actions.create('clay', plan)).toBeNull()
  expect(at.store.get()).toMatchObject({ creating: false, steps: { source: 'idle', home: 'idle', issues: 'idle' } })
  expect(at.client.cloneRepository).not.toHaveBeenCalled()
})

it('preserves the folder’s display place when an older runtime provides no path, and distinguishes unborn repositories', () => {
  const old: FolderReading = { kind: 'folder', name: 'Repo', repositories: [], project: null }
  expect(foldersOf(old, 'grant_old', {})).toMatchObject({ folders: [{ path: 'grant_old', where: 'Repo', git: 'none', empty: false }] })
  expect(foldersOf(old, 'grant_old', { where: '~/chosen' })).toMatchObject({ folders: [{ where: '~/chosen' }] })
  const reading: FolderReading = {
    kind: 'repository',
    name: 'Repo',
    repositories: [{ path: '/repo', folder: null, name: 'Repo', branch: null, remote: null, commits: false }],
    project: null,
  }
  expect(foldersOf(reading, 'grant_repo', { found: 'discovery', where: '~/chosen' })).toMatchObject({
    folders: [{ where: '~/chosen', found: 'discovery', git: 'unborn' }],
  })
})

it('offers SSO only for an SSO refusal, preserving an optional sign-in link', () => {
  expect(errorOf(new ApiError({ reason: 'CloneRefused', why: 'sso', message: 'Sign in', detail: 'https://github.com/org/sso' }))).toEqual({
    said: 'Sign in',
    fix: { kind: 'sso', url: 'https://github.com/org/sso' },
  })
  expect(errorOf(new ApiError({ reason: 'CloneRefused', why: 'sso', message: 'Sign in' }))).toEqual({
    said: 'Sign in',
    fix: { kind: 'sso', url: null },
  })
  expect(errorOf(new ApiError({ reason: 'CloneRefused', why: 'denied', message: 'Denied' }))).toEqual({ said: 'Denied' })
})

it('keeps the chosen clone place after a cancelled picker, and clones there instead of the usual place', async () => {
  const place = { grant: 'grant_place', where: '~/chosen' }
  const at = fixture({}, { pickClonePlace: vi.fn().mockResolvedValueOnce(place).mockResolvedValueOnce(null) })
  await at.actions.chooseCloneInto()
  await at.actions.chooseCloneInto()
  expect(at.store.get()?.cloneInto).toEqual(place)
  at.store.change(at.draft.id, (now) => ({ ...now, way: 'clone', clones: [{ ...clone, here: null }] }))
  await at.actions.create('clay', plan)
  expect(at.client.cloneRepository).toHaveBeenCalledWith('grant_place', clone.from)
  expect(at.host.clonePlace).not.toHaveBeenCalled()
})

it('clones each chosen into one place, asked for once, makes the project of them all, and clones only those left on Create again', async () => {
  const other: DraftClone = { ...clone, id: 'other', remote: 'ada/web', from: { connectionId: 'github', path: ['ada', 'web'] }, here: null }
  const at = fixture({
    cloneRepository: vi
      .fn()
      .mockResolvedValueOnce({ grant: 'grant_repo', path: '/Users/ada/code/repo' })
      .mockRejectedValueOnce(new ApiError({ reason: 'CloneRefused', why: 'denied', message: 'Denied' }))
      .mockResolvedValue({ grant: 'grant_web', path: '/Users/ada/code/web' }),
  })
  at.store.change(at.draft.id, (now) => ({ ...now, way: 'clone', clones: [{ ...clone, here: null }, other] }))
  // The second refused: the first stays cloned, said as such, and the project isn't made.
  expect(await at.actions.create('clay', plan)).toBeNull()
  expect(at.store.get()?.error).toEqual({ said: 'Denied' })
  expect(at.store.get()?.folders).toMatchObject([{ path: '/Users/ada/code/repo', came: 'clone', clone: 'clone' }])
  expect(at.client.openProject).not.toHaveBeenCalled()
  // Again: only the one left is cloned, and the project is made of both, in the order chosen.
  expect(await at.actions.create('clay', plan)).not.toBeNull()
  expect(vi.mocked(at.client.cloneRepository).mock.calls.map(([, from]) => from)).toEqual([clone.from, other.from, other.from])
  expect(at.host.clonePlace).toHaveBeenCalledTimes(2)
  expect(at.client.openProject).toHaveBeenCalledWith(
    'grant_repo',
    expect.objectContaining({
      repositories: [
        { grant: 'grant_repo', path: '/Users/ada/code/repo' },
        { grant: 'grant_web', path: '/Users/ada/code/web' },
      ],
    }),
  )
})

it('clones two of one name into folders of their own, the later one by its owner’s name and its own', async () => {
  const one: DraftClone = { ...clone, id: 'a', remote: 'org-a/api', from: { connectionId: 'github', path: ['org-a', 'api'] }, here: null }
  const two: DraftClone = { ...clone, id: 'b', remote: 'org-b/api', from: { connectionId: 'github', path: ['org-b', 'api'] }, here: null }
  const at = fixture()
  at.store.change(at.draft.id, (now) => ({ ...now, way: 'clone', clones: [one, two] }))
  expect(await at.actions.create('clay', plan)).not.toBeNull()
  expect(vi.mocked(at.client.cloneRepository).mock.calls).toEqual([
    ['grant_code', one.from],
    ['grant_code', two.from, 'org-b-api'],
  ])
  expect(at.store.get()?.folders.map((folder) => folder.path)).toEqual(['/Users/ada/code/api', '/Users/ada/code/org-b-api'])
})

it('keeps a clone that landed though making it ready failed, and makes it ready on Create again without cloning it again', async () => {
  const at = fixture({
    prepareFolder: vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ reason: 'GitFailed', message: 'Git couldn’t commit.' }))
      .mockResolvedValue({ did: 'committed', path: '/Users/ada/code/repo', branch: 'main', files: 0 }),
  })
  at.store.change(at.draft.id, (now) => ({ ...now, way: 'clone', clones: [{ ...clone, here: null }] }))
  expect(await at.actions.create('clay', plan)).toBeNull()
  expect(at.store.get()?.error).toEqual({ said: 'Git couldn’t commit.' })
  expect(at.store.get()?.folders).toMatchObject([{ path: '/Users/ada/code/repo', grant: 'grant_repo', came: 'clone', clone: 'clone' }])
  expect(await at.actions.create('clay', plan)).not.toBeNull()
  expect(at.client.cloneRepository).toHaveBeenCalledOnce()
  expect(at.client.prepareFolder).toHaveBeenLastCalledWith('grant_repo', '/Users/ada/code/repo')
  expect(at.store.get()?.folders).toMatchObject([{ git: 'ready' }])
})

it('names each clone a folder no other takes, the owner’s name taken too, and keeps those cloned already on Create again', async () => {
  const of = (id: string, remote: string): DraftClone => ({
    ...clone,
    id,
    remote,
    from: { connectionId: 'github', path: remote.split('/') },
    here: null,
  })
  const a = of('a', 'org-a/api')
  const c = of('c', 'org-c/org-b-api')
  const b = of('b', 'org-b/api')
  const at = fixture({
    cloneRepository: vi
      .fn()
      .mockImplementationOnce(async () => ({ grant: 'grant_api', path: '/Users/ada/code/api' }))
      .mockImplementationOnce(async () => ({ grant: 'grant_org-b-api', path: '/Users/ada/code/org-b-api' }))
      .mockRejectedValueOnce(new ApiError({ reason: 'CloneRefused', why: 'denied', message: 'Denied' }))
      .mockImplementation(async (_grant: string, _from: unknown, folder?: string) => ({
        grant: `grant_${folder}`,
        path: `/Users/ada/code/${folder}`,
      })),
  })
  at.store.change(at.draft.id, (now) => ({ ...now, way: 'clone', clones: [a, c, b] }))
  expect(await at.actions.create('clay', plan)).toBeNull()
  expect(await at.actions.create('clay', plan)).not.toBeNull()
  expect(vi.mocked(at.client.cloneRepository).mock.calls.map(([, from, folder]) => [from, folder])).toEqual([
    [a.from, undefined],
    [c.from, undefined],
    [b.from, 'org-b-api-2'],
    [b.from, 'org-b-api-2'],
  ])
  // One cloned already keeps its folder, whatever the order chosen now: the others take what is left.
  const kept: DraftFolder = {
    path: '/Users/ada/code/api',
    grant: 'grant_api',
    name: 'api',
    where: '~/code/api',
    remote: 'org-b/api',
    project: null,
    found: null,
    git: 'ready',
    empty: false,
    came: 'clone',
    clone: 'b',
  }
  expect([...cloneFolders([a, b], [kept])]).toEqual([
    ['b', 'api'],
    ['a', 'org-a-api'],
  ])
})
