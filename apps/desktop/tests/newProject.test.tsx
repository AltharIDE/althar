import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import {
  ApiError,
  type ConnectionList,
  type FolderReading,
  type FoundRepository,
  type HostRepository,
  inkFor,
  type ProjectSummary,
} from '@althar/contracts'

import { newProjectId } from '../src/renderer/data/client'
import { makeQueryClient } from '../src/renderer/data/reads'
import type { FoundRepositories } from '../src/renderer/data/services'
import { draftActions, draftsOf } from '../src/renderer/features/newProject/draft'
import { unsent } from '../src/renderer/features/elsewhere/unsent'
import { NewProjectView } from '../src/renderer/features/newProject/NewProjectView'
import { useNewProject } from '../src/renderer/features/newProject/useNewProject'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { changesOn, codeHostOf, remoteOf } from '../src/renderer/shared/remotes'
import { connectionList, fakeClient, fakeHost, githubConnection, project } from './fixtures'
import { withServices } from './render'

/*
 * A new project, in a tab of its own: named on its left, set up on its right.
 * Its code comes in one of three ways: cloned from a code host connected, a
 * folder on this computer (one that isn't a repository yet gets git, and one
 * with no commit its first), or a new repository; a repository only here goes
 * on a connected host as it is made, or stays; its issues go to a tracker or
 * its host's own. Create does each in turn, keeps what each did, and opens
 * the project under the id its mark was drawn from.
 */

const repo = (path: string, remote: string | null, extra: Partial<FoundRepository> = {}): FoundRepository => ({
  path,
  folder: null,
  name: path.split('/').at(-1) ?? path,
  branch: 'main',
  remote,
  commits: true,
  ...extra,
})

const APP = repo('/Users/me/code/northwind/app', 'git@github.com:northwind-co/app.git')
const OPS = repo('/Users/me/code/northwind/ops', 'git@gitlab.com:northwind/ops.git')
const LOCAL = repo('/Users/me/code/tidepool', null)
const UNBORN = repo('/Users/me/code/fresh', null, { commits: false, branch: 'trunk' })

const FOUND: FoundRepositories = {
  lookedIn: ['~/code'],
  repositories: [
    { id: 'f-app', name: 'app', where: '~/code/northwind/app', branch: 'main', worked: Date.now() - 2 * 3_600_000 },
    { id: 'f-tide', name: 'tidepool-old', where: '~/code/tidepool-old', branch: 'main', worked: Date.now() - 86_400_000 },
  ],
}

/** Each grant reads as the folder it stands for. */
const readings: Record<string, FolderReading> = {
  'grant_f-app': { kind: 'repository', name: 'app', repositories: [APP], project: null },
  'grant_f-tide': { kind: 'repository', name: 'tidepool-old', repositories: [repo('/Users/me/code/tidepool-old', null)], project: null },
  grant_ops: { kind: 'repository', name: 'ops', repositories: [OPS], project: null },
  grant_local: { kind: 'repository', name: 'tidepool', repositories: [LOCAL], project: null },
  grant_unborn: { kind: 'repository', name: 'fresh', repositories: [UNBORN], project: null },
  grant_files: { kind: 'folder', name: 'tidepool', repositories: [], project: null, empty: false, path: '/Users/me/code/tidepool' },
  grant_empty: { kind: 'folder', name: 'empty', repositories: [], project: null, empty: true, path: '/Users/me/code/empty' },
  grant_halyard: {
    kind: 'repository',
    name: 'gateway',
    repositories: [repo('/Users/me/code/halyard/gateway', null)],
    project: { id: 'p2', name: 'halyard' },
  },
  grant_inside: {
    kind: 'inside',
    name: 'web',
    repositories: [{ ...repo('/Users/me/code/mono', null), folder: 'packages/web' }],
    project: null,
  },
}

/** GitHub connected as you, and Linear: what a person with both has. */
const connected: ConnectionList = {
  ...connectionList,
  connections: [
    githubConnection,
    {
      id: 'lin1',
      product: 'linear',
      name: 'Linear',
      webUrl: 'https://linear.app',
      account: { login: 'you', name: 'You' },
      auth: 'token',
      state: 'ready',
    },
  ],
}

const listed = (path: string, extra: Partial<HostRepository> = {}): HostRepository => ({
  path: path.split('/'),
  description: null,
  private: true,
  pushedAt: new Date(Date.now() - 3_600_000).toISOString(),
  webUrl: `https://github.com/${path}`,
  archived: false,
  ...extra,
})

const HOSTED = [
  listed('charrette/althar', { description: 'Agents that ship' }),
  listed('you/tidepool', { description: 'Tide tables' }),
  listed('charrette/old', { archived: true }),
]

function NewProject({
  onCreated = vi.fn(),
  onOpen = vi.fn(),
  onClose = vi.fn(),
}: {
  onCreated?: (id: string) => void
  onOpen?: (id: string) => void
  onClose?: () => void
}) {
  return <NewProjectView model={useNewProject()} connections={useConnections()} onCreated={onCreated} onOpen={onOpen} onClose={onClose} />
}

/** The tab, opened on a draft of its own, with a client and host that read the folders above. */
const opened = (overrides: Parameters<typeof fakeClient>[0] = {}, host: Parameters<typeof fakeHost>[0] = {}) => {
  const fake = fakeClient({
    readFolder: vi.fn(async (grant: string) => readings[grant] ?? readings.grant_ops!),
    listHostRepositories: vi.fn(async () => HOSTED),
    ...overrides,
  })
  const fakes = fakeHost({ findRepositories: vi.fn(async () => FOUND), ...host })
  const drafts = draftsOf(fake.client)
  const draft = drafts.start()
  const onCreated = vi.fn()
  const onOpen = vi.fn()
  const onClose = vi.fn()
  const view = withServices(<NewProject onCreated={onCreated} onOpen={onOpen} onClose={onClose} />, fake.client, fakes)
  return { ...fake, host: fakes, drafts, draft, onCreated, onOpen, onClose, view }
}

const way = (name: RegExp) => within(screen.getByRole('radiogroup', { name: 'Where its code comes from' })).getByRole('radio', { name })
const named = async (name: string) => userEvent.type(screen.getByRole('textbox', { name: 'Name' }), name)
const create = (name: string) => userEvent.click(screen.getByRole('button', { name: new RegExp(`^Create ${name}`) }))

/** A worktree Conductor left in a folder chosen for a new project. */
const LIMA = {
  key: 'worktree:/Users/me/conductor/workspaces/tidepool/lima',
  tool: 'conductor' as const,
  repositoryId: '/Users/me/code/tidepool',
  repository: 'tidepool',
  path: '/Users/me/conductor/workspaces/tidepool/lima',
  branch: 'feature/lima',
  name: 'lima',
  uncommitted: 1,
  unpushed: 0,
  ahead: 1,
  pullRequest: null,
  archived: false,
  lastAt: null,
  conversations: [],
  taskId: null,
}

describe('a new project’s three ways in', () => {
  it('starts on Clone, with each code host to connect where none is, and a folder or a new repository one press away', async () => {
    opened()
    expect(way(/^Clone/).getAttribute('aria-checked')).toBe('true')
    expect(way(/^Clone/).textContent).toContain('From GitHub, GitLab or Bitbucket')
    expect(await screen.findByRole('button', { name: 'Connect GitHub' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Connect GitLab' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Connect Bitbucket' })).toBeTruthy()
    await userEvent.click(way(/^A folder/))
    expect(screen.getByText('Drop a folder here')).toBeTruthy()
    await userEvent.click(way(/^Start empty/))
    expect((screen.getByRole('button', { name: 'Name it first' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('moves between the ways with the arrow keys, as a radio group does', async () => {
    opened()
    act(() => way(/^Clone/).focus())
    await userEvent.keyboard('{ArrowRight}')
    expect(way(/^A folder/).getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(way(/^A folder/))
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(way(/^Start empty/).getAttribute('aria-checked')).toBe('true')
  })
})

describe('a new project from a folder', () => {
  it('takes one with files and no git, says what Create does, and starts git in it before the project is made', async () => {
    const order: string[] = []
    const { client, draft, onCreated } = opened(
      {
        prepareFolder: vi.fn(async (_grant: string, path?: string) => {
          order.push('prepare')
          return { did: 'started' as const, path: path ?? '', branch: 'main', files: 3 }
        }),
        openProject: vi.fn(async () => {
          order.push('open')
          return { ...project, id: draft.id }
        }),
      },
      { pickFolders: vi.fn(async () => ['grant_files']) },
    )
    await named('Tidepool')
    await userEvent.click(way(/^A folder/))
    await userEvent.click(screen.getByRole('button', { name: 'Choose a folder…' }))
    expect(await screen.findByText('No git yet. It starts on main, with what’s in it as the first commit.')).toBeTruthy()
    expect(screen.getByText('~/code/tidepool')).toBeTruthy()
    expect(screen.getByText('Create starts git in it. Its code stays on this Mac.')).toBeTruthy()
    await create('Tidepool')
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(draft.id))
    expect(client.prepareFolder).toHaveBeenCalledWith('grant_files', '/Users/me/code/tidepool')
    expect(client.openProject).toHaveBeenCalledWith('grant_files', {
      name: 'Tidepool',
      projectId: draft.id,
      ink: inkFor(draft.id, ['teal']),
      repositories: [{ grant: 'grant_files', path: '/Users/me/code/tidepool' }],
    })
    expect(order).toEqual(['prepare', 'open'])
    // Nothing connected: nothing put on a host, no tracker set.
    expect(client.publishRepository).not.toHaveBeenCalled()
    expect(client.setProjectTracker).not.toHaveBeenCalled()
  })

  it('says an empty folder gets git with a first commit, and one with no commit gets its first', async () => {
    const pickFolders = vi
      .fn<() => Promise<ReadonlyArray<string>>>()
      .mockResolvedValueOnce(['grant_empty'])
      .mockResolvedValueOnce(['grant_unborn'])
    const { client } = opened({}, { pickFolders })
    await userEvent.click(way(/^A folder/))
    await userEvent.click(screen.getByRole('button', { name: 'Choose a folder…' }))
    expect(await screen.findByText('Empty. Git starts in it on main, with a first commit.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Add a folder…' }))
    expect(await screen.findByText('Git, with no commits yet. What’s in it becomes the first, on its branch.')).toBeTruthy()
    expect(screen.getByText('Create starts git in it and makes its first commit.')).toBeTruthy()
    await named('Two')
    await create('Two')
    await waitFor(() => expect(client.openProject).toHaveBeenCalled())
    expect(client.prepareFolder).toHaveBeenCalledWith('grant_empty', '/Users/me/code/empty')
    expect(client.prepareFolder).toHaveBeenCalledWith('grant_unborn', UNBORN.path)
  })

  it('shows what other tools left in its folders, nothing taken, and brings in what was taken once it is made', async () => {
    const lima = LIMA
    const { client, onCreated } = opened(
      { lookElsewhere: vi.fn(async () => ({ worktrees: [lima], setups: [], conversations: [] })) },
      { pickFolders: vi.fn(async () => ['grant_local']) },
    )
    await named('Tidepool')
    await userEvent.click(way(/^A folder/))
    await userEvent.click(screen.getByRole('button', { name: 'Choose a folder…' }))
    const found = await screen.findByRole('region', { name: 'Already under way' })
    expect(client.lookElsewhere).toHaveBeenCalledWith({ grant: 'grant_local' })
    await userEvent.click(within(found).getByRole('button', { name: /^Conductor/ }))
    expect(await screen.findByText('Then bring in 1 worktree.')).toBeTruthy()
    await create('Tidepool')
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(client.bringIn).toHaveBeenCalledWith({
      projectId: onCreated.mock.calls[0]?.[0],
      worktrees: [lima.key],
      setups: [],
      conversations: [],
      steps: [],
    })
  })

  it('opens the project at once though bringing in is refused, leaving the project’s conversation to say so', async () => {
    const unhandled: Array<unknown> = []
    const note = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', note)
    const asked: Array<string> = []
    const { onCreated } = opened(
      {
        lookElsewhere: vi.fn(async () => ({ worktrees: [LIMA], setups: [], conversations: [] })),
        // Not a mock, which would handle what it returns itself: refused, as the runtime gone would.
        bringIn: (input: { readonly projectId: string }) => {
          asked.push(input.projectId)
          return Promise.reject(new Error('The runtime went away.'))
        },
      },
      { pickFolders: vi.fn(async () => ['grant_local']) },
    )
    await named('Tidepool')
    await userEvent.click(way(/^A folder/))
    await userEvent.click(screen.getByRole('button', { name: 'Choose a folder…' }))
    const found = await screen.findByRole('region', { name: 'Already under way' })
    await userEvent.click(within(found).getByRole('button', { name: /^Conductor/ }))
    await create('Tidepool')
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    // Refused, and caught: nothing is left unhandled, and the tab has gone on to the project.
    await waitFor(() => expect(asked).toHaveLength(1))
    await new Promise((settled) => setTimeout(settled, 50))
    process.off('unhandledRejection', note)
    expect(unhandled).toEqual([])
    // The runtime never got it, so the window keeps what was picked, for the project's conversation to say with Try again.
    expect(unsent.of(asked[0] ?? '')).toMatchObject({ names: expect.arrayContaining(['lima']), worktrees: [expect.any(String)] })
    unsent.reset()
  })

  it('says a folder that is a project already, opens that project from there, and makes no second one', async () => {
    const { client, onOpen } = opened({}, { pickFolders: vi.fn(async () => ['grant_halyard']) })
    await named('Again')
    await userEvent.click(way(/^A folder/))
    await userEvent.click(screen.getByRole('button', { name: 'Choose a folder…' }))
    expect(await screen.findByText(/It’s halyard already\./)).toBeTruthy()
    await create('Again')
    expect(await screen.findByText(/gateway is halyard already\./)).toBeTruthy()
    expect(client.openProject).not.toHaveBeenCalled()
    await userEvent.click(screen.getAllByRole('button', { name: 'Open halyard' })[0]!)
    expect(onOpen).toHaveBeenCalledWith('p2')
  })

  it('says why a folder can’t be had, with what puts it right: Althar not let in, or one inside a repository', async () => {
    const pickFolders = vi
      .fn<() => Promise<ReadonlyArray<string>>>()
      .mockResolvedValueOnce(['grant_documents'])
      .mockResolvedValue(['grant_inside'])
    const readFolder = vi.fn(async (grant: string) => {
      if (grant === 'grant_documents')
        throw new ApiError({
          reason: 'FolderRefused',
          why: 'unreadable',
          message: 'Althar can’t read Documents. Give it access to the folder, then choose it again.',
        })
      return readings[grant] ?? readings.grant_ops!
    })
    const { host } = opened({ readFolder }, { pickFolders })
    await userEvent.click(way(/^A folder/))
    await userEvent.click(screen.getByRole('button', { name: 'Choose a folder…' }))
    expect(await screen.findByText(/Althar can’t read Documents\./)).toBeTruthy()
    // On a Mac, where it's let in; elsewhere, another folder.
    const access = screen.queryByRole('button', { name: 'Open Privacy & Security' })
    if (access !== null) {
      await userEvent.click(access)
      expect(host.openFolderAccess).toHaveBeenCalled()
      await userEvent.click(screen.getByRole('button', { name: 'Choose a folder…' }))
    } else await userEvent.click(screen.getByRole('button', { name: 'Choose another folder' }))
    expect(await screen.findByText('That’s a folder inside mono. Add mono itself.')).toBeTruthy()
  })

  it('changes a folder for another, keeping it where the picker is cancelled, and leaves one of several out', async () => {
    const pickFolders = vi
      .fn<() => Promise<ReadonlyArray<string>>>()
      .mockResolvedValueOnce(['grant_local'])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['grant_ops'])
      .mockResolvedValueOnce(['grant_f-app'])
    const { drafts } = opened({}, { pickFolders })
    await userEvent.click(way(/^A folder/))
    await userEvent.click(screen.getByRole('button', { name: 'Choose a folder…' }))
    await waitFor(() => expect(drafts.get()?.folders.map((folder) => folder.name)).toEqual(['tidepool']))
    await userEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(drafts.get()?.folders.map((folder) => folder.name)).toEqual(['tidepool'])
    await userEvent.click(screen.getByRole('button', { name: 'Change' }))
    await waitFor(() => expect(drafts.get()?.folders.map((folder) => folder.name)).toEqual(['ops']))
    await userEvent.click(screen.getByRole('button', { name: 'Add a folder…' }))
    await waitFor(() => expect(drafts.get()?.folders).toHaveLength(2))
    await userEvent.click(screen.getAllByRole('button', { name: 'Leave out' })[0]!)
    expect(drafts.get()?.folders.map((folder) => folder.name)).toEqual(['app'])
  })

  it('offers what this computer has named like it, each added in a press', async () => {
    const { drafts } = opened()
    await named('Tidepool')
    await userEvent.click(way(/^A folder/))
    expect(await screen.findByRole('heading', { name: /named like Tidepool/ })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Add tidepool-old' }))
    await waitFor(() => expect(drafts.get()?.folders).toHaveLength(1))
  })
})

describe('where a new project’s code lives', () => {
  it('puts a repository only here on GitHub before the project is made, under the account, named after it, private', async () => {
    const order: string[] = []
    const { client, draft, onCreated } = opened(
      {
        listConnections: vi.fn(async () => connected),
        publishRepository: vi.fn(async (input: { readonly owner: { readonly id: string }; readonly name: string }) => {
          order.push('publish')
          return { remote: `${input.owner.id}/${input.name}`, webUrl: `https://github.com/${input.owner.id}/${input.name}`, branch: 'main' }
        }),
        openProject: vi.fn(async () => {
          order.push('open')
          return { ...project, id: draft.id }
        }),
      },
      { pickFolders: vi.fn(async () => ['grant_local']) },
    )
    await named('Tide Pool')
    await userEvent.click(way(/^A folder/))
    await userEvent.click(screen.getByRole('button', { name: 'Choose a folder…' }))
    const code = await screen.findByRole('radiogroup', { name: 'Where its code lives' })
    expect(
      within(code)
        .getByRole('radio', { name: /A new repository on GitHub/ })
        .getAttribute('aria-checked'),
    ).toBe('true')
    await waitFor(() => expect((within(code).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('tide-pool'))
    expect(screen.getByText('Create puts it on GitHub.')).toBeTruthy()
    await create('Tide Pool')
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(client.publishRepository).toHaveBeenCalledWith({
      at: { grant: 'grant_local', path: LOCAL.path },
      connectionId: 'conn1',
      owner: { id: 'ada', name: 'ada', kind: 'user' },
      name: 'tide-pool',
      private: true,
    })
    expect(order).toEqual(['publish', 'open'])
  })

  it('says a name the host has taken at the name, and puts it there under the one given instead, git started once', async () => {
    const publishRepository = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError({ reason: 'PublishRefused', why: 'taken', message: 'There’s a ada/tidepool on GitHub already. Choose another name.' }),
      )
      .mockResolvedValueOnce({ remote: 'ada/tidepool-2', webUrl: 'https://github.com/ada/tidepool-2', branch: 'main' })
    const { client, onCreated } = opened(
      { listConnections: vi.fn(async () => connected), publishRepository },
      { pickFolders: vi.fn(async () => ['grant_files']) },
    )
    await named('Tidepool')
    await userEvent.click(way(/^A folder/))
    await userEvent.click(screen.getByRole('button', { name: 'Choose a folder…' }))
    const code = await screen.findByRole('radiogroup', { name: 'Where its code lives' })
    await waitFor(() => expect(within(code).getByRole('textbox', { name: 'Name' })).toBeTruthy())
    await create('Tidepool')
    const name = within(code).getByRole('textbox', { name: 'Name' })
    await waitFor(() => expect(name.getAttribute('aria-invalid')).toBe('true'))
    expect(within(code).getByText('There’s a ada/tidepool on GitHub already. Choose another name.')).toBeTruthy()
    expect(client.openProject).not.toHaveBeenCalled()
    await userEvent.clear(name)
    await userEvent.type(name, 'tidepool-2')
    expect(name.getAttribute('aria-invalid')).toBeNull()
    await create('Tidepool')
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(client.prepareFolder).toHaveBeenCalledTimes(1)
    expect(publishRepository).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'tidepool-2' }))
  })

  it('waits for where it can go on the host, read as Create is pressed, and puts it there', async () => {
    let owners: (list: ReadonlyArray<{ id: string; name: string; kind: 'user' }>) => void = () => undefined
    const listRepositoryOwners = vi.fn(
      () => new Promise<ReadonlyArray<{ id: string; name: string; kind: 'user' }>>((done) => (owners = done)),
    )
    const { client, onCreated } = opened(
      { listConnections: vi.fn(async () => connected), listRepositoryOwners },
      { pickFolders: vi.fn(async () => ['grant_local']) },
    )
    await named('Tidepool')
    await userEvent.click(way(/^A folder/))
    await userEvent.click(screen.getByRole('button', { name: 'Choose a folder…' }))
    await screen.findByRole('radiogroup', { name: 'Where its code lives' })
    expect(screen.getByText('Create puts it on GitHub.')).toBeTruthy()
    await create('Tidepool')
    expect(client.openProject).not.toHaveBeenCalled()
    await act(async () => owners([{ id: 'ada', name: 'ada', kind: 'user' }]))
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(client.publishRepository).toHaveBeenCalledWith(expect.objectContaining({ owner: { id: 'ada', name: 'ada', kind: 'user' } }))
  })

  it('says where it can go couldn’t be read, with a way to read it again, and keeps nothing here in its place', async () => {
    const listRepositoryOwners = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue([{ id: 'ada', name: 'ada', kind: 'user' }])
    const { client } = opened(
      { listConnections: vi.fn(async () => connected), listRepositoryOwners },
      { pickFolders: vi.fn(async () => ['grant_local']) },
    )
    await named('Tidepool')
    await userEvent.click(way(/^A folder/))
    await userEvent.click(screen.getByRole('button', { name: 'Choose a folder…' }))
    const code = await screen.findByRole('radiogroup', { name: 'Where its code lives' })
    expect(await within(code).findByText(/Where it can go on GitHub couldn’t be read\./)).toBeTruthy()
    await create('Tidepool')
    expect(await within(code).findByText('Where it can go couldn’t be read. Try again.')).toBeTruthy()
    expect(client.publishRepository).not.toHaveBeenCalled()
    expect(client.openProject).not.toHaveBeenCalled()
    await userEvent.clear(within(code).getByRole('textbox', { name: 'Name' }))
    await userEvent.type(within(code).getByRole('textbox', { name: 'Name' }), 'tidepool')
    await userEvent.click(within(code).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect((within(code).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('tidepool'))
    await waitFor(() => expect(within(code).queryByRole('button', { name: 'Try again' })).toBeNull())
  })

  it('asks for a name on the host before anything is done, where it was emptied', async () => {
    const { client } = opened({ listConnections: vi.fn(async () => connected) }, { pickFolders: vi.fn(async () => ['grant_files']) })
    await named('Tidepool')
    await userEvent.click(way(/^A folder/))
    await userEvent.click(screen.getByRole('button', { name: 'Choose a folder…' }))
    const code = await screen.findByRole('radiogroup', { name: 'Where its code lives' })
    await waitFor(() => expect(within(code).getByRole('textbox', { name: 'Name' })).toBeTruthy())
    await userEvent.clear(within(code).getByRole('textbox', { name: 'Name' }))
    await create('Tidepool')
    expect(await within(code).findByText('Give it a name.')).toBeTruthy()
    expect(client.prepareFolder).not.toHaveBeenCalled()
    expect(client.publishRepository).not.toHaveBeenCalled()
    expect(client.openProject).not.toHaveBeenCalled()
  })

  it('stays only here where the person says, put on nothing', async () => {
    const { client, onCreated } = opened(
      { listConnections: vi.fn(async () => connected) },
      { pickFolders: vi.fn(async () => ['grant_local']) },
    )
    await named('Tidepool')
    await userEvent.click(way(/^A folder/))
    await userEvent.click(screen.getByRole('button', { name: 'Choose a folder…' }))
    const code = await screen.findByRole('radiogroup', { name: 'Where its code lives' })
    await userEvent.click(within(code).getByRole('radio', { name: /Only on this Mac/ }))
    expect(screen.queryByText(/puts it on GitHub/)).toBeNull()
    await create('Tidepool')
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(client.publishRepository).not.toHaveBeenCalled()
  })
})

describe('a new project cloned from its host', () => {
  it('lists your repositories, those named like it first and none archived, and clones the one chosen where you keep code', async () => {
    const order: string[] = []
    const { client, host, draft, onCreated } = opened({
      listConnections: vi.fn(async () => connected),
      cloneRepository: vi.fn(async () => {
        order.push('clone')
        return { grant: 'grant_tidepool', path: '/Users/me/code/tidepool' }
      }),
      // An empty repository clones too: made ready, it gets a first commit to branch from.
      prepareFolder: vi.fn(async (_grant: string, path?: string) => {
        order.push('prepare')
        return { did: 'committed' as const, path: path ?? '', branch: 'main', files: 0 }
      }),
      openProject: vi.fn(async () => {
        order.push('open')
        return { ...project, id: draft.id }
      }),
    })
    await named('Tidepool')
    const rows = await screen.findAllByRole('button', { name: /^Clone [a-z]/ })
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(['Clone you/tidepool', 'Clone charrette/althar'])
    expect(within(rows[0]!).getByText('Named like the project')).toBeTruthy()
    await userEvent.click(rows[0]!)
    expect(screen.getByRole('button', { name: 'Chosen you/tidepool' })).toBeTruthy()
    expect(await screen.findByText('Into ~/code')).toBeTruthy()
    expect(screen.getByText('On GitHub, at you/tidepool. Tasks open pull requests there.')).toBeTruthy()
    expect(screen.getByText('Create clones you/tidepool.')).toBeTruthy()
    // Linear is connected, so its issues go there unless the person says; its own on GitHub are one press away.
    const issues = screen.getByRole('radiogroup', { name: 'Issues' })
    expect(
      within(issues)
        .getByRole('radio', { name: /^Linear/ })
        .getAttribute('aria-checked'),
    ).toBe('true')
    await userEvent.click(within(issues).getByRole('radio', { name: /^GitHub Issues/ }))
    await create('Tidepool')
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(host.clonePlace).toHaveBeenCalled()
    expect(client.cloneRepository).toHaveBeenCalledWith('grant_code', { connectionId: 'conn1', path: ['you', 'tidepool'] })
    expect(client.openProject).toHaveBeenCalledWith(
      'grant_tidepool',
      expect.objectContaining({ repositories: [{ grant: 'grant_tidepool', path: '/Users/me/code/tidepool' }] }),
    )
    expect(client.setProjectTracker).toHaveBeenCalledWith(draft.id, {
      connectionId: 'conn1',
      container: { id: 'you/tidepool', name: 'you/tidepool' },
    })
    expect(client.prepareFolder).toHaveBeenCalledWith('grant_tidepool', '/Users/me/code/tidepool')
    expect(order).toEqual(['clone', 'prepare', 'open'])
  })

  it('adds one of its name on this computer in its place only where it is the same repository on the same host', async () => {
    const tidepool = { id: 'f-tidepool', name: 'tidepool', where: '~/code/tidepool', branch: 'main', worked: Date.now() }
    for (const [remote, reused] of [
      ['git@gitlab.com:you/tidepool.git', false],
      ['git@github.com:You/Tidepool.git', true],
    ] as const) {
      const readFolder = vi.fn(async (grant: string) =>
        grant === 'grant_f-tidepool'
          ? { kind: 'repository' as const, name: 'tidepool', repositories: [repo('/Users/me/code/tidepool', remote)], project: null }
          : (readings[grant] ?? readings.grant_ops!),
      )
      const { client, onCreated, view } = opened(
        { listConnections: vi.fn(async () => connected), readFolder },
        { findRepositories: vi.fn(async () => ({ lookedIn: ['~/code'], repositories: [tidepool] })) },
      )
      await named('Tidepool')
      // Of its name here, it is offered as added; which it is, is known once it is read, as it is made.
      await userEvent.click(await screen.findByRole('button', { name: 'Add you/tidepool' }))
      await create('Tidepool')
      await waitFor(() => expect(onCreated).toHaveBeenCalled())
      expect(client.cloneRepository).toHaveBeenCalledTimes(reused ? 0 : 1)
      view.unmount()
    }
  })

  it('clones once: the project not made, Create again opens what was cloned', async () => {
    const openProject = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ reason: 'GitFailed', message: 'Git couldn’t read it.' }))
      .mockResolvedValueOnce(project)
    const { client, onCreated } = opened({ listConnections: vi.fn(async () => connected), openProject })
    await named('Tidepool')
    await userEvent.click(await screen.findByRole('button', { name: 'Clone you/tidepool' }))
    await create('Tidepool')
    expect(await screen.findByText('Git couldn’t read it.')).toBeTruthy()
    await create('Tidepool')
    await waitFor(() => expect(openProject).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(client.cloneRepository).toHaveBeenCalledTimes(1)
  })

  it('asks where it goes where there is nowhere usual, and makes nothing when the person cancels', async () => {
    const { client } = opened(
      { listConnections: vi.fn(async () => connected) },
      { clonePlace: vi.fn(async () => null), pickClonePlace: vi.fn(async () => null) },
    )
    await named('Tidepool')
    await userEvent.click(await screen.findByRole('button', { name: 'Clone you/tidepool' }))
    expect(await screen.findByRole('button', { name: 'Choose where it goes' })).toBeTruthy()
    await create('Tidepool')
    await waitFor(() => expect(screen.getByRole('button', { name: /^Create Tidepool/ }).getAttribute('aria-busy')).toBeNull())
    expect(client.cloneRepository).not.toHaveBeenCalled()
    expect(client.openProject).not.toHaveBeenCalled()
  })

  it('says a group’s single sign-on stops it, with where to sign in', async () => {
    const cloneRepository = vi.fn(async () =>
      Promise.reject(
        new ApiError({
          reason: 'CloneRefused',
          why: 'sso',
          detail: 'https://github.com/orgs/charrette/sso',
          message: 'GitHub wants you signed in to its organization’s single sign-on before charrette/althar can be cloned.',
        }),
      ),
    )
    opened({ listConnections: vi.fn(async () => connected), cloneRepository })
    await named('Althar')
    await userEvent.click(await screen.findByRole('button', { name: 'Clone charrette/althar' }))
    await create('Althar')
    expect(await screen.findByText(/wants you signed in to its organization’s single sign-on/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('https://github.com/orgs/charrette/sso')
  })

  it('clones a URL pasted, with the person’s own git where no connection reaches its host', async () => {
    const { client } = opened({ listConnections: vi.fn(async () => connected) })
    await named('Elsewhere')
    const find = await screen.findByRole('searchbox', { name: 'Find a repository, or paste its URL' })
    await userEvent.type(find, 'https://gitlab.com/someone/elsewhere.git')
    await userEvent.click(await screen.findByRole('button', { name: 'Clone someone/elsewhere' }))
    await create('Elsewhere')
    await waitFor(() =>
      expect(client.cloneRepository).toHaveBeenCalledWith('grant_code', { url: 'https://gitlab.com/someone/elsewhere.git' }),
    )
  })

  it('says a host’s repositories couldn’t be read, with a way to read them again', async () => {
    const listHostRepositories = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(HOSTED)
    opened({ listConnections: vi.fn(async () => connected), listHostRepositories })
    expect(await screen.findByText(/GitHub’s repositories couldn’t be read\./)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: 'Clone you/tidepool' })).toBeTruthy()
  })
})

describe('a new project that starts from nothing', () => {
  it('places a new repository named after it where the person chooses, and makes it once, as the project is', async () => {
    const openProject = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ reason: 'GitFailed', message: 'No.' }))
      .mockResolvedValueOnce(project)
    const { client, host, onCreated } = opened({ openProject }, { pickPlace: vi.fn(async () => 'grant_code') })
    await named('Northwind Ops')
    await userEvent.click(way(/^Start empty/))
    await userEvent.click(screen.getByRole('button', { name: 'Choose where it goes…' }))
    expect(host.pickPlace).toHaveBeenCalledWith('Northwind Ops')
    expect(await screen.findByText('A new repository, on main')).toBeTruthy()
    await create('Northwind Ops')
    expect(await screen.findByText('No.')).toBeTruthy()
    await create('Northwind Ops')
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(client.makeRepository).toHaveBeenCalledTimes(1)
  })
})

describe('a new project’s tab', () => {
  it('closes with Escape, and opens nothing when its tab closed while it was being made', async () => {
    let made: (summary: ProjectSummary) => void = () => undefined
    const openProject = vi.fn(() => new Promise<ProjectSummary>((resolve) => (made = resolve)))
    const { drafts, onCreated, onClose } = opened({ openProject }, { pickFolders: vi.fn(async () => ['grant_ops']) })
    await named('Northwind')
    await userEvent.click(way(/^A folder/))
    await userEvent.click(screen.getByRole('button', { name: 'Choose a folder…' }))
    await waitFor(() => expect(drafts.get()?.folders).toHaveLength(1))
    await create('Northwind')
    // Being made, Escape doesn't leave it; closing its tab does.
    await userEvent.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    act(() => drafts.end())
    await act(async () => made(project))
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('keeps each folder to the draft it was added to, and waits for one still being granted before it is made', async () => {
    let grant: (granted: string | null) => void = () => undefined
    const grantDropped = vi.fn(() => new Promise<string | null>((resolve) => (grant = resolve)))
    const { drafts, draft, client } = opened({}, { grantDropped })
    act(() => drafts.change(draft.id, (now) => ({ ...now, name: 'Northwind', way: 'folder' })))
    const actions = draftActions({ client, host: fakeHost({ grantDropped }), cache: makeQueryClient() })
    const dropped = actions.drop([new File([], 'ops')])
    expect(drafts.get()?.reading).toHaveLength(1)
    expect(await actions.create('clay', { publish: null, tracker: null })).toBeNull()
    expect(client.openProject).not.toHaveBeenCalled()
    act(() => drafts.end())
    act(() => void drafts.start())
    await act(async () => {
      grant('grant_ops')
      await dropped
    })
    expect(drafts.get()?.folders).toEqual([])
    expect(drafts.get()?.reading).toEqual([])
  })

  it('is nothing once it is closed', () => {
    const { drafts, view } = opened()
    act(() => drafts.end())
    expect(view.container.textContent).toBe('')
  })
})

describe('a new project’s id', () => {
  it('is a project id as the runtime makes them', () => {
    expect(newProjectId()).not.toBe(newProjectId())
  })
})
describe('where code is hosted', () => {
  it('reads a remote, by its host and its path there', () => {
    expect(remoteOf('git@github.com:northwind-co/app.git')).toEqual({ host: 'github.com', path: 'northwind-co/app' })
    expect(remoteOf('ssh://git@gitlab.example.com:22/group/sub/repo')).toEqual({ host: 'gitlab.example.com', path: 'group/sub/repo' })
    expect(remoteOf('https://GitHub.com/a/b')).toEqual({ host: 'github.com', path: 'a/b' })
    expect(remoteOf('/srv/git/repo.git')).toBeNull()
    expect(remoteOf('file:///srv/git/a/b')).toBeNull()
    expect(remoteOf('https://exa mple')).toBeNull()
    expect(remoteOf('git@github.com:repo')).toBeNull()
    // Escapes that don't read are kept as written.
    expect(remoteOf('https://github.com/acme/app%ZZ.git')).toEqual({ host: 'github.com', path: 'acme/app%ZZ' })
  })

  it('knows the host as connected, as a hosted service, or by its name', () => {
    const github = remoteOf('git@github.com:a/b.git')!
    expect(codeHostOf(github, { ...connectionList, connections: [githubConnection] })).toEqual({
      product: 'github',
      name: 'GitHub',
      account: 'you',
    })
    expect(codeHostOf(github, { ...connectionList, connections: [{ ...githubConnection, state: 'reauth_required' }] })).toEqual({
      product: 'github',
      name: 'GitHub',
      account: null,
    })
    expect(codeHostOf(github, null)).toEqual({ product: 'github', name: 'GitHub', account: null })
    expect(codeHostOf(remoteOf('git@bitbucket.org:a/b.git')!, null)).toEqual({
      product: 'bitbucket_cloud',
      name: 'Bitbucket',
      account: null,
    })
    expect(codeHostOf(remoteOf('git@git.acme.dev:a/b.git')!, connectionList)).toEqual({
      product: null,
      name: 'git.acme.dev',
      account: null,
    })
    expect([changesOn('gitlab'), changesOn('github'), changesOn(null)]).toEqual(['merge requests', 'pull requests', 'pull requests'])
  })
})
