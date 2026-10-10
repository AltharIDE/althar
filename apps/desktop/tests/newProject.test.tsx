import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type FolderReading, type FoundRepository, inkFor } from '@althar/contracts'

import { newProjectId } from '../src/renderer/data/client'
import type { FoundRepositories } from '../src/renderer/data/services'
import { draftsOf } from '../src/renderer/features/newProject/draft'
import { NewProjectView } from '../src/renderer/features/newProject/NewProjectView'
import { useNewProject } from '../src/renderer/features/newProject/useNewProject'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { changesOn, codeHostOf, remoteOf } from '../src/renderer/shared/remotes'
import { connectionList, fakeClient, fakeHost, githubConnection, project } from './fixtures'
import { withServices } from './render'

/*
 * A new project, in a tab of its own: named first, then its folders, each
 * read as it is added, with what this Mac has named like it one press away
 * and what reading them found; made under the id its mark was drawn from,
 * in the ink shown.
 */

const repo = (path: string, remote: string | null, branch = 'main'): FoundRepository => ({
  path,
  folder: null,
  name: path.split('/').at(-1) ?? path,
  branch,
  remote,
})

const APP = repo('/Users/me/code/northwind/app', 'git@github.com:northwind-co/app.git')
const API = repo('/Users/me/code/northwind/api', 'https://github.com/northwind-co/api.git', 'nw-412-invoice-export')
const OPS = repo('/Users/me/code/northwind/ops', 'git@gitlab.com:northwind/ops.git')

/** What main found where code is kept: two of Northwind's, one of meridian's, and one of nobody's. */
const FOUND: FoundRepositories = {
  lookedIn: ['~/code'],
  repositories: [
    { id: 'f-app', name: 'app', where: '~/code/northwind/app', branch: 'main', worked: Date.now() - 2 * 3_600_000 },
    { id: 'f-api', name: 'api', where: '~/code/northwind/api', branch: 'nw-412-invoice-export', worked: Date.now() - 20 * 60_000 },
    { id: 'f-dot', name: 'dotfiles', where: '~/dotfiles', branch: 'main', worked: 0 },
    { id: 'f-meridian', name: 'meridian-api', where: '~/code/meridian-api', branch: 'main', worked: Date.now() - 86_400_000 },
  ],
}

/** Each grant reads as the folder it stands for. */
const readings: Record<string, FolderReading> = {
  'grant_f-app': { kind: 'repository', name: 'app', repositories: [APP], project: null },
  'grant_f-api': { kind: 'repository', name: 'api', repositories: [API], project: null },
  grant_northwind: { kind: 'folder', name: 'northwind', repositories: [APP, OPS], project: null },
  grant_ops: { kind: 'repository', name: 'ops', repositories: [OPS], project: null },
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
  grant_empty: { kind: 'folder', name: 'notes', repositories: [], project: null },
}

function NewProject({ onCreated = vi.fn(), onClose = vi.fn() }: { onCreated?: (id: string) => void; onClose?: () => void }) {
  return <NewProjectView model={useNewProject()} connections={useConnections()} onCreated={onCreated} onClose={onClose} />
}

/** The tab, opened on a draft of its own, with a client and host that read the folders above. */
const opened = (overrides: Parameters<typeof fakeClient>[0] = {}, host: Parameters<typeof fakeHost>[0] = {}) => {
  const fake = fakeClient({ readFolder: vi.fn(async (grant: string) => readings[grant] ?? readings.grant_ops!), ...overrides })
  const fakes = fakeHost({ findRepositories: vi.fn(async () => FOUND), ...host })
  const drafts = draftsOf(fake.client)
  const draft = drafts.start()
  const onCreated = vi.fn()
  const onClose = vi.fn()
  const view = withServices(<NewProject onCreated={onCreated} onClose={onClose} />, fake.client, fakes)
  return { ...fake, host: fakes, drafts, draft, onCreated, onClose, view }
}

const folders = () => screen.getByRole('list', { name: 'Its folders' })

/** A flow of many presses and reads: more than the usual five seconds where the machine is busy. */
const LONG_FLOW = 15_000

describe('a new project', () => {
  it(
    'is named first, which offers what this Mac has named like it, each added in one press as it is read',
    async () => {
      const { host } = opened()
      const name = screen.getByRole('textbox', { name: 'Name' })
      await waitFor(() => expect(document.activeElement).toBe(name))
      // Unnamed, no mark yet, and what was found is offered as it is.
      expect(await screen.findByRole('heading', { name: 'On this Mac' })).toBeTruthy()
      expect(screen.getByText('Closing the tab makes nothing.')).toBeTruthy()
      await userEvent.type(name, 'Northwind')
      expect(screen.getByRole('heading', { name: 'On this Mac, named like Northwind' })).toBeTruthy()
      expect(screen.getByRole('button', { name: /Create Northwind/ })).toBeTruthy()

      await userEvent.click(screen.getByRole('button', { name: 'Add app' }))
      expect(host.grantFound).toHaveBeenCalledWith('f-app')
      await waitFor(() => expect(within(folders()).getByText('GitHub ·')).toBeTruthy())
      expect(within(folders()).getByText('northwind-co/app')).toBeTruthy()
      expect(within(folders()).getByText('~/code/northwind/app')).toBeTruthy()
      // Added, it isn't offered again; it is what the project is made of.
      expect(screen.queryByRole('button', { name: 'Add app' })).toBeNull()
      expect(screen.getByText('1 repository')).toBeTruthy()

      // The rest, behind a link: one in another project says so in place of Add.
      await userEvent.click(screen.getByRole('button', { name: '2 more on this Mac' }))
      expect(screen.getByText('in meridian')).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Add meridian-api' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Add dotfiles' })).toBeTruthy()
    },
    LONG_FLOW,
  )

  it(
    'says where the code is hosted: connected as whom, or not, with the way to connect',
    async () => {
      const { host } = opened(
        { listConnections: vi.fn(async () => ({ ...connectionList, connections: [githubConnection] })) },
        { pickFolders: vi.fn(async () => ['grant_northwind']) },
      )
      await userEvent.click(screen.getByRole('button', { name: 'Choose a folder…' }))
      expect(host.pickFolders).toHaveBeenCalled()
      // A folder of several repositories adds each.
      await waitFor(() => expect(within(folders()).getAllByRole('listitem')).toHaveLength(2))
      const read = screen.getByRole('region', { name: 'What Althar read' })
      expect(read.textContent).toContain('Code on GitHub, northwind-co. Connected as you.')
      expect(read.textContent).toContain(
        'northwind/ops is on GitLab, which isn’t connected. Its tasks push their branch; connected, they open merge requests.',
      )
      await userEvent.click(within(read).getByRole('button', { name: 'Connect GitLab' }))
      const dialog = await screen.findByRole('dialog', { name: 'Code hosts and trackers' })
      // Escape closes what is open over the page, not the page.
      await userEvent.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(dialog).toBeTruthy()
      // Leaving one out takes what it said with it.
      await userEvent.click(within(folders()).getByRole('button', { name: 'Leave out ops' }))
      await waitFor(() => expect(screen.queryByText(/GitLab/)).toBeNull())
    },
    LONG_FLOW,
  )

  it('says a folder is in another project too', async () => {
    opened({}, { pickFolders: vi.fn(async () => ['grant_halyard']) })
    await userEvent.click(screen.getByRole('button', { name: 'Choose a folder…' }))
    expect(await screen.findByText(/gateway is in halyard too/)).toBeTruthy()
    // Without a remote, it says so, and no host is said.
    expect(within(folders()).getByText('no remote')).toBeTruthy()
  })

  it(
    'is made under the id its mark was drawn from, in the ink shown, of each folder added, by Create or ⌘↵',
    async () => {
      const { client, draft, drafts, onCreated } = opened(
        { openProject: vi.fn(async () => ({ ...project, id: draft.id })) },
        { pickFolders: vi.fn(async () => ['grant_northwind', 'grant_ops']) },
      )
      const name = screen.getByRole('textbox', { name: 'Name' })
      await userEvent.type(name, '  Northwind ')
      await userEvent.click(screen.getByRole('button', { name: 'Choose a folder…' }))
      // Ops comes from both folders, and is added once.
      await waitFor(() => expect(within(folders()).getAllByRole('listitem')).toHaveLength(2))
      expect(screen.getByText('2 repositories')).toBeTruthy()
      // The swatch shown is the runtime's pick, beside meridian's teal, until another is chosen.
      expect(screen.getByRole('radio', { name: 'Teal, meridian’s' })).toBeTruthy()
      const pick = inkFor(draft.id, ['teal'])
      expect(screen.getByRole('radio', { checked: true }).getAttribute('aria-label')).toMatch(new RegExp(pick, 'i'))
      await userEvent.click(screen.getByRole('radio', { name: 'Umber' }))
      await userEvent.type(name, '{Meta>}{Enter}{/Meta}')
      await waitFor(() => expect(onCreated).toHaveBeenCalledWith(draft.id))
      expect(client.openProject).toHaveBeenCalledWith('grant_northwind', {
        name: 'Northwind',
        projectId: draft.id,
        ink: 'umber',
        repositories: [
          { grant: 'grant_northwind', path: APP.path },
          { grant: 'grant_northwind', path: OPS.path },
        ],
      })
      expect(drafts.get()?.creating).toBe(true)
    },
    LONG_FLOW,
  )

  it(
    'says what went wrong: a folder inside a repository, one with none, one gone, a drop that isn’t a folder, and the project not made',
    async () => {
      const pickFolders = vi
        .fn<() => Promise<ReadonlyArray<string>>>()
        .mockResolvedValueOnce(['grant_inside'])
        .mockResolvedValueOnce(['grant_empty'])
        .mockResolvedValueOnce(['grant_gone'])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(['grant_ops'])
      const readFolder = vi.fn(async (grant: string) => {
        if (grant === 'grant_gone') throw new ApiError({ reason: 'NotFound', message: 'That folder isn’t there any more.' })
        return readings[grant] ?? readings.grant_ops!
      })
      const openProject = vi.fn(async () => Promise.reject(new ApiError({ reason: 'GitFailed', message: 'Git couldn’t read it.' })))
      const { host, view, onCreated } = opened({ readFolder, openProject }, { pickFolders, grantDropped: vi.fn(async () => null) })
      const choose = screen.getByRole('button', { name: 'Choose a folder…' })
      await userEvent.click(choose)
      expect(await screen.findByText('That’s a folder inside mono. Add mono itself.')).toBeTruthy()
      await userEvent.click(choose)
      expect(await screen.findByText('There’s no git repository in notes.')).toBeTruthy()
      await userEvent.click(choose)
      expect(await screen.findByText('That folder isn’t there any more.')).toBeTruthy()
      // Nothing chosen adds nothing.
      await userEvent.click(choose)
      expect(screen.getByText('No folders yet.')).toBeTruthy()

      const page = view.container.querySelector('section') as Element
      fireEvent.drop(page, { dataTransfer: { types: ['Files'], files: [new File([], 'notes.txt')] } })
      expect(await screen.findByText('notes.txt isn’t a folder on this computer.')).toBeTruthy()
      expect(host.grantDropped).toHaveBeenCalled()

      // Named and with a folder, the runtime says no: the foot says why, and the tab stays.
      await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Northwind')
      await userEvent.click(choose)
      await waitFor(() => expect(within(folders()).getAllByRole('listitem')).toHaveLength(1))
      await userEvent.click(screen.getByRole('button', { name: /Create Northwind/ }))
      expect(await screen.findByText('Git couldn’t read it.')).toBeTruthy()
      expect(onCreated).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: /Create Northwind/ }).getAttribute('aria-busy')).toBeNull()
    },
    LONG_FLOW,
  )

  it('adds folders dropped on the page', async () => {
    const { host, view } = opened({}, { grantDropped: vi.fn(async () => 'grant_ops') })
    const page = view.container.querySelector('section') as Element
    const folder = new File([], 'ops')
    fireEvent.dragEnter(page, { dataTransfer: { types: ['Files'], files: [folder] } })
    expect(screen.getByText('Let go to add them.')).toBeTruthy()
    fireEvent.drop(page, { dataTransfer: { types: ['Files'], files: [folder] } })
    await waitFor(() => expect(within(folders()).getByText('ops')).toBeTruthy())
    expect(host.grantDropped).toHaveBeenCalledWith(folder)
  })

  it('closes with Escape, and what was still being read once it closed changes nothing', async () => {
    let finish: (reading: FolderReading) => void = () => undefined
    const readFolder = vi.fn(() => new Promise<FolderReading>((resolve) => (finish = resolve)))
    const { drafts, draft, onClose } = opened({ readFolder }, { pickFolders: vi.fn(async () => ['grant_ops']) })
    await userEvent.click(screen.getByRole('button', { name: 'Choose a folder…' }))
    expect(await screen.findByText('Reading it. Nothing in the folder changes.')).toBeTruthy()
    // Create waits while a folder is read.
    expect(screen.getByRole('button', { name: /Create project/ }).getAttribute('aria-busy')).toBe('true')
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
    act(() => drafts.end())
    const next = drafts.start()
    await act(async () => finish(readings.grant_ops!))
    expect(next.id).not.toBe(draft.id)
    expect(drafts.get()?.folders).toEqual([])
  })

  it('is nothing once it is closed', () => {
    const { drafts, view } = opened()
    act(() => drafts.end())
    expect(view.container.textContent).toBe('')
  })
})

describe('a new project’s id', () => {
  it('is a project id as the runtime makes them, its time first', () => {
    const at = Date.UTC(2026, 9, 10, 23, 0, 0)
    const id = newProjectId(at)
    expect(id).toMatch(/^proj_[0-9a-f]{12}7[0-9a-f]{3}[89ab][0-9a-f]{15}$/)
    expect(Number.parseInt(id.slice(5, 17), 16)).toBe(at)
    expect(newProjectId(at + 1) > id).toBe(true)
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
