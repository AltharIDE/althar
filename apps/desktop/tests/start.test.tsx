import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError } from '@charrette/contracts'
import { RuntimeState } from '@charrette/ui'

import { useServices } from '../src/renderer/data/services'
import { runtimeEntry, StartView } from '../src/renderer/features/start/StartView'
import { useStart } from '../src/renderer/features/start/useStart'
import { agents, fakeClient, fakeHost, project } from './fixtures'
import { withServices } from './render'

function Start({ onProject }: { onProject: (id: string) => void }) {
  return <StartView model={useStart()} onProject={onProject} />
}

describe('the start', () => {
  it('lists the agents on this Mac, and the projects, and opens one', async () => {
    const onProject = vi.fn()
    const { client, emit } = fakeClient()
    withServices(<Start onProject={onProject} />, client)
    await screen.findByText('meridian')
    expect(screen.getByText('/code/meridian')).toBeTruthy()
    expect(screen.getByText('1 task · 1 working')).toBeTruthy()
    await screen.findByText('Claude Code')
    await userEvent.click(screen.getByText('meridian'))
    expect(onProject).toHaveBeenCalledWith('p1')

    // A change to a project reads the list again; a change to anything else doesn't.
    emit({ _tag: 'Changed', aggregateType: 'task', aggregateId: 't1', projectId: 'p1' })
    emit({ _tag: 'Changed', aggregateType: 'turn', aggregateId: 'u1', projectId: 'p1' })
    emit({ _tag: 'Streaming', threadId: 'th1', itemId: 'i1', text: 'Hi' })
    await waitFor(() => expect(client.listProjects).toHaveBeenCalledTimes(2))
  })

  it('opens a folder as a project: from the button, from ⌘N, and dropped on the window', async () => {
    const onProject = vi.fn()
    const { client } = fakeClient({ listProjects: vi.fn(async () => [{ ...project, running: 0, waiting: 2 }]) })
    const host = fakeHost()
    const view = withServices(<Start onProject={onProject} />, client, host)
    await screen.findByText('1 task · 2 calls wait on you')
    await userEvent.click(screen.getByRole('button', { name: 'Open a folder' }))
    await waitFor(() => expect(onProject).toHaveBeenCalledTimes(1))
    expect(client.openProject).toHaveBeenCalledWith('/code/meridian')

    fireEvent.keyDown(window, { key: 'n', metaKey: true })
    fireEvent.keyDown(window, { key: 'n', metaKey: true, shiftKey: true })
    fireEvent.keyDown(window, { key: 'm', metaKey: true })
    await waitFor(() => expect(onProject).toHaveBeenCalledTimes(2))

    const root = view.container.firstElementChild as Element
    const folder = new File([], 'meridian')
    fireEvent.dragOver(root)
    fireEvent.drop(root, { dataTransfer: { files: [folder] } })
    await waitFor(() => expect(client.openProject).toHaveBeenCalledWith('/code/dropped'))
    fireEvent.drop(root, { dataTransfer: { files: [] } })
    expect(host.pathOf).toHaveBeenCalledTimes(1)
  })

  it('shows the first screen when there is no project, and what went wrong', async () => {
    const failure = new ApiError({ reason: 'NotARepository', message: 'That folder is not in a git repository.' })
    const { client } = fakeClient({ listProjects: vi.fn(async () => []), openProject: vi.fn(async () => Promise.reject(failure)) })
    const host = fakeHost({ pathOf: vi.fn(() => '') })
    const onProject = vi.fn()
    const view = withServices(<Start onProject={onProject} />, client, host)
    await screen.findByText('Your first project')
    await userEvent.click(screen.getByRole('button', { name: /Open a folder/ }))
    await screen.findByText('That folder is not in a git repository.')
    // Something dropped that is not a file on disk opens nothing.
    fireEvent.drop(view.container.firstElementChild as Element, { dataTransfer: { files: [new File([], 'x')] } })
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
    await screen.findAllByText('The runtime stopped')
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
