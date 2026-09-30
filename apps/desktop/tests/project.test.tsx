import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
import { ApiError } from '@charrette/contracts'

import { agents, changed, fakeClient, status, task, streamed } from './fixtures'
import { withServices } from './render'

function Project({ onBack = vi.fn(), onTask = vi.fn() }: { onBack?: () => void; onTask?: (threadId: string) => void }) {
  return <ProjectView model={useProject('p1')} onBack={onBack} onTask={onTask} />
}

describe('a project', () => {
  it('lists its tasks with who is working on them, and opens one', async () => {
    const onTask = vi.fn()
    const onBack = vi.fn()
    const { client, emit, watching } = fakeClient({
      listTasks: vi.fn(async () => ({
        cursor: 4,
        tasks: [
          task,
          { ...task, id: 't2', threadId: 'th2', title: 'Idle one', agentId: 'mystery', waiting: 1 },
          { ...task, id: 't3', threadId: 'th3', title: 'Two calls', agentId: null, waiting: 2 },
        ],
      })),
    })
    withServices(<Project onTask={onTask} onBack={onBack} />, client)
    await screen.findByRole('heading', { name: 'meridian', level: 1 })
    expect(screen.getByText('/code/meridian')).toBeTruthy()
    await screen.findByText('Claude Code is working')
    expect(screen.getByText('mystery is working · 1 call waits on you')).toBeTruthy()
    expect(screen.getByText('2 calls wait on you')).toBeTruthy()
    await userEvent.click(screen.getByText('Add a retry'))
    expect(onTask).toHaveBeenCalledWith('th1')
    await userEvent.click(screen.getByRole('button', { name: /Projects/ }))
    expect(onBack).toHaveBeenCalled()

    // It watches from the earlier of its two reads, and reads again only for changes it shows.
    await waitFor(() => expect(watching).toEqual([3]))
    emit(changed('task', 't1'))
    emit(changed('task', 't9', null, 'p9'))
    emit(changed('thread_item', 'i1'))
    emit(streamed('i1', 'Hi'))
    await waitFor(() => expect(client.listTasks).toHaveBeenCalledTimes(2))
  })

  it('starts a task: its worktree, then its lead, from what was written', async () => {
    const onTask = vi.fn()
    const { client } = fakeClient({ listTasks: vi.fn(async () => ({ cursor: 4, tasks: [] })) })
    withServices(<Project onTask={onTask} />, client)
    await screen.findByText('No tasks yet.')

    // Nothing written: it says what is missing rather than refuse the button.
    await userEvent.click(await screen.findByRole('button', { name: 'Start the task' }))
    expect(screen.getByText('Say what the task is.')).toBeTruthy()
    expect(client.createTask).not.toHaveBeenCalled()

    await userEvent.type(screen.getByLabelText('What should change'), '  Add a retry  ')
    expect(screen.queryByText('Say what the task is.')).toBeNull()
    await userEvent.type(screen.getByLabelText('Anything the lead should know'), ' Only the checkout call. ')
    await userEvent.click(screen.getByRole('combobox', { name: 'Lead' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Codex' }))
    await userEvent.click(screen.getByRole('button', { name: 'Start the task' }))
    await waitFor(() => expect(onTask).toHaveBeenCalledWith('th1'))
    expect(client.createTask).toHaveBeenCalledWith({ projectId: 'p1', title: 'Add a retry', description: 'Only the checkout call.' })
    expect(client.startSession).toHaveBeenCalledWith({ threadId: 'th1', agentId: 'codex' })
  })

  it('says what went wrong when a task could not start, and when no agent can lead', async () => {
    const onTask = vi.fn()
    const { client } = fakeClient({
      startSession: vi.fn(async () => Promise.reject(new ApiError({ reason: 'SessionFailed', message: "Claude Code couldn't start." }))),
    })
    withServices(<Project onTask={onTask} />, client)
    await userEvent.type(await screen.findByLabelText('What should change'), 'Add a retry')
    await userEvent.click(await screen.findByRole('button', { name: 'Start the task' }))
    await screen.findByText("Claude Code couldn't start.")
    expect(client.createTask).toHaveBeenCalledWith({ projectId: 'p1', title: 'Add a retry' })
    expect(onTask).not.toHaveBeenCalled()
  })

  it('asks for an agent to be signed in when none is', async () => {
    const { client } = fakeClient({
      status: vi.fn(async () => ({ ...status, agents: agents.map((agent) => ({ ...agent, signIn: 'signed_out' as const })) })),
      listProjects: vi.fn(async () => ({ cursor: 0, projects: [] })),
      listTasks: vi.fn(async () => Promise.reject(new ApiError({ reason: 'NotFound', message: "That project isn't there any more." }))),
    })
    withServices(<Project />, client)
    await screen.findByText('No agent is signed in. Sign one in with its own tool, then come back.')
    await screen.findByText("That project isn't there any more.")
    expect(screen.getByRole('heading', { name: 'Tasks', level: 1 })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Start the task' })).toBeNull()
  })

  it('says when the agents could not be asked', async () => {
    const { client } = fakeClient({ status: vi.fn(async () => Promise.reject(new Error('The port closed'))) })
    withServices(<Project />, client)
    await screen.findByText("Charrette's runtime didn't answer. If it keeps happening, restart Charrette.")
  })
})
