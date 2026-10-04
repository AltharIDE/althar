import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError } from '@charrette/contracts'
import { RuntimeState } from '@charrette/ui'

import { useServices } from '../src/renderer/data/services'
import { accountEntry, runtimeEntry, shortFolder, StartView } from '../src/renderer/features/start/StartView'
import { useStart } from '../src/renderer/features/start/useStart'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { agents, changed, fakeClient, fakeHost, project, streamed, usual } from './fixtures'
import { withServices } from './render'

function Start({ onProject }: { onProject: (id: string) => void }) {
  return <StartView model={useStart()} connections={useConnections()} onProject={onProject} />
}

describe('accounts on the start', () => {
  it('says where each account signs in and how it stands', () => {
    const now = new Date('2026-10-03T12:00:00')
    expect(shortFolder('/Users/me/.codex-work')).toBe('~/.codex-work')
    expect(shortFolder('/opt/homes/work')).toBe('/opt/homes/work')
    expect(accountEntry(usual('acc_1', 'signed_in'), now)).toEqual({
      id: 'acc_1',
      name: 'main',
      place: { kind: 'usual' },
      state: { kind: 'ready', paid: 'plan' },
    })
    const adopted = { ...usual('acc_2', 'signed_out'), name: 'Client', home: '/Users/me/.codex-client', adoptedFrom: 'codex-profiles' }
    expect(accountEntry(adopted, now)).toMatchObject({
      place: { kind: 'adopted', folder: '~/.codex-client', from: 'codex-profiles' },
      state: { kind: 'signedOut' },
    })
    const own = { ...usual('acc_3', 'signed_in'), home: '/Users/me/profile/accounts/acc_3', outUntil: '2026-10-03T14:00:00' }
    expect(accountEntry(own, now)).toMatchObject({ place: { kind: 'own' }, state: { kind: 'out' } })
    expect(accountEntry({ ...usual('acc_4', 'unknown') }, now).state).toEqual({ kind: 'ready' })
  })

  it('adds an account a switcher made, opens a new one’s sign-in, and renames, moves and removes them', async () => {
    const { client } = fakeClient({
      status: vi.fn(async () => ({
        apiVersion: 1,
        appVersion: '0.0.0',
        agents: [
          {
            ...(agents[1] ?? agents[0]!),
            accounts: [usual('acc_usual', 'signed_in'), { ...usual('acc_work', 'signed_in'), name: 'work', home: '/Users/me/work' }],
          },
        ],
      })),
    })
    const host = fakeHost({ pickFolder: vi.fn(async () => 'grant_chosen') })
    withServices(<Start onProject={vi.fn()} />, client, host)
    await screen.findByText('work')

    // A folder codex-profiles made, found by its name.
    await userEvent.click(screen.getByRole('button', { name: 'Add an account' }))
    await waitFor(() => expect(client.findAccounts).toHaveBeenCalledWith('codex'))
    await userEvent.click(await screen.findByRole('radio', { name: /~\/\.codex-work/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(client.addAccount).toHaveBeenCalledWith({ agentId: 'codex', name: 'work', grant: 'grant_work' }))
    // It came back signed out, so its sign-in opens.
    await waitFor(() => expect(client.signInAccount).toHaveBeenCalledWith('acc_added'))

    // Another folder the person chooses.
    await userEvent.click(screen.getByRole('button', { name: 'Add an account' }))
    await userEvent.type(await screen.findByRole('textbox', { name: 'Name' }), 'client')
    await userEvent.click(screen.getByRole('radio', { name: /Another folder/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(client.addAccount).toHaveBeenCalledWith({ agentId: 'codex', name: 'client', grant: 'grant_chosen' }))
    expect(host.pickFolder).toHaveBeenCalledWith('account')

    await userEvent.click(screen.getByRole('button', { name: 'More for work' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move up' }))
    await waitFor(() => expect(client.orderAccounts).toHaveBeenCalledWith('codex', ['acc_work', 'acc_usual']))
    await userEvent.click(screen.getByRole('button', { name: 'More for work' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Remove/ }))
    await waitFor(() => expect(client.removeAccount).toHaveBeenCalledWith('acc_work'))
  })

  it('says the line to run where Terminal can’t open', async () => {
    const { client } = fakeClient({
      signInAccount: vi.fn(async () => ({ line: 'CODEX_HOME=/x codex login', opened: false })),
      status: vi.fn(async () => ({
        apiVersion: 1,
        appVersion: '0.0.0',
        agents: [
          {
            ...(agents[1] ?? agents[0]!),
            accounts: [usual('acc_usual', 'signed_in'), { ...usual('acc_x', 'signed_out'), name: 'x', home: '/x' }],
          },
        ],
      })),
    })
    withServices(<Start onProject={vi.fn()} />, client)
    // The code hosts' rows sign in too: this one is the account's.
    await userEvent.click(within(await screen.findByRole('list', { name: 'Codex accounts' })).getByRole('button', { name: 'Sign in' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Run this in a terminal to sign in, then come back: CODEX_HOME=/x codex login',
    )
  })
})

describe('the start', () => {
  it('lists the agents on this Mac, and the projects, and opens one', async () => {
    const onProject = vi.fn()
    const { client, emit, watching } = fakeClient()
    withServices(<Start onProject={onProject} />, client)
    await screen.findByText('meridian')
    expect(screen.getByText('/code/meridian')).toBeTruthy()
    expect(screen.getByText('1 task · 1 working')).toBeTruthy()
    await screen.findByText('Claude Code')
    await userEvent.click(screen.getByText('meridian'))
    expect(onProject).toHaveBeenCalledWith('p1')

    // A change to a project reads the list again; a change to anything else doesn't.
    // It watches from the list's cursor, and asks each agent again, since this is where sign-in shows.
    await waitFor(() => expect(watching).toEqual(expect.arrayContaining([3, 2])))
    expect(client.status).toHaveBeenCalledWith({ recheck: true })
    emit(changed('task', 't1'))
    emit(changed('thread_item', 'i1'))
    emit(streamed('i1', 'Hi'))
    await waitFor(() => expect(client.listProjects).toHaveBeenCalledTimes(2))
    // A later read doesn't start the watch again: one for the projects, one for the connections.
    expect(watching).toHaveLength(2)
  })

  it('opens a folder as a project: from the button, from ⌘N, and dropped on the window', async () => {
    const onProject = vi.fn()
    const { client } = fakeClient({ listProjects: vi.fn(async () => ({ cursor: 3, projects: [{ ...project, running: 0, waiting: 2 }] })) })
    const host = fakeHost()
    const view = withServices(<Start onProject={onProject} />, client, host)
    await screen.findByText('1 task · 2 calls wait on you')
    await userEvent.click(screen.getByRole('button', { name: 'Open a folder' }))
    await waitFor(() => expect(onProject).toHaveBeenCalledTimes(1))
    expect(client.openProject).toHaveBeenCalledWith('grant_picked')

    fireEvent.keyDown(window, { key: 'n', metaKey: true })
    fireEvent.keyDown(window, { key: 'n', metaKey: true, shiftKey: true })
    fireEvent.keyDown(window, { key: 'm', metaKey: true })
    await waitFor(() => expect(onProject).toHaveBeenCalledTimes(2))

    const root = view.container.firstElementChild as Element
    const folder = new File([], 'meridian')
    fireEvent.dragOver(root)
    fireEvent.drop(root, { dataTransfer: { files: [folder] } })
    await waitFor(() => expect(client.openProject).toHaveBeenCalledWith('grant_dropped'))
    expect(host.grantDropped).toHaveBeenCalledWith(folder)
    fireEvent.drop(root, { dataTransfer: { files: [] } })
    expect(host.grantDropped).toHaveBeenCalledTimes(1)
  })

  it('shows the first screen when there is no project, and what went wrong', async () => {
    const failure = new ApiError({ reason: 'NotARepository', message: 'That folder is not in a git repository.' })
    const { client } = fakeClient({
      listProjects: vi.fn(async () => ({ cursor: 0, projects: [] })),
      openProject: vi.fn(async () => Promise.reject(failure)),
    })
    const host = fakeHost({ grantDropped: vi.fn(async () => null) })
    const onProject = vi.fn()
    const view = withServices(<Start onProject={onProject} />, client, host)
    await screen.findByText('Your first project')
    await userEvent.click(screen.getByRole('button', { name: /Open a folder/ }))
    await screen.findByText('That folder is not in a git repository.')
    // Something dropped that is not a file on disk opens nothing.
    fireEvent.drop(view.container.firstElementChild as Element, { dataTransfer: { files: [new File([], 'x')] } })
    await waitFor(() => expect(host.grantDropped).toHaveBeenCalled())
    expect(client.openProject).toHaveBeenCalledTimes(1)
    expect(onProject).not.toHaveBeenCalled()
  })

  it('opens nothing when the picker is cancelled, and says when the runtime cannot answer', async () => {
    const { client } = fakeClient({
      listProjects: vi.fn(async () => Promise.reject(new Error('The runtime stopped'))),
      status: vi.fn(async () => Promise.reject(new Error('The runtime stopped'))),
    })
    const host = fakeHost({ pickFolder: vi.fn(async () => null) })
    withServices(<Start onProject={vi.fn()} />, client, host)
    await screen.findAllByText("Charrette's runtime didn't answer. If it keeps happening, restart Charrette.")
    expect(screen.getByText('Looking at the agents on this Mac…')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Open a folder' }))
    expect(client.openProject).not.toHaveBeenCalled()
  })

  it('says how each agent is signed in', () => {
    expect(agents.map(runtimeEntry).map((entry) => [entry.state, 'account' in entry])).toEqual([
      [RuntimeState.Ready, false],
      [RuntimeState.Ready, true],
      [RuntimeState.SignedOut, false],
    ])
  })

  it('needs its services', () => {
    function Bare() {
      useServices()
      return null
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Bare />)).toThrow('useServices needs a ServicesProvider')
  })
})
