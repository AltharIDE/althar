import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { Client } from '../src/renderer/data/client'
import { useBoard } from '../src/renderer/features/board/useBoard'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
import { TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { coordinatorSnapshot, fakeClient, items, snapshot } from './fixtures'
import { useSettingsOf, withServices } from './render'

/*
 * What a slash in a composer offers, by screen: a task's what it can do now
 * (its goal, its model, its title, running it), each done as its own press
 * does it and never sent to the lead; the coordinator's its own, with /goal
 * said to it, for a task toward the objective.
 */

const names = () =>
  within(screen.getByRole('listbox', { name: 'Commands' }))
    .getAllByRole('option')
    .map((row) => row.querySelector('span:nth-child(2)')?.textContent)

function Task() {
  return <TaskView model={useTask('th1')} onBack={vi.fn()} />
}

function Project() {
  return (
    <ProjectView
      model={useProject('p1')}
      board={useBoard('p1')}
      connections={useConnections()}
      settings={useSettingsOf('p1')}
      onTask={vi.fn()}
    />
  )
}

const context = { used: 96_000, size: 200_000 }

describe('a task’s composer', () => {
  const mount = (overrides: Partial<Client> = {}) => {
    const base = snapshot()
    const { client } = fakeClient({
      getThread: vi.fn(async () =>
        snapshot({
          items: [items.you('Add a retry'), items.says('Done.')],
          session: { ...base.session!, context },
        }),
      ),
      ...overrides,
    })
    withServices(<Task />, client)
    return client
  }

  it('lists what the task can do now, each with where it stands', async () => {
    mount()
    const composer = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Tell Claude Code something' })
    await userEvent.type(composer, '/')
    expect(names()).toEqual(['/goal', '/model', '/compact', '/run', '/rename'])
    expect(screen.getByText('48% full')).toBeTruthy()
  })

  it('compacts the conversation as /compact is picked, and sends nothing', async () => {
    const client = mount()
    const composer = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Tell Claude Code something' })
    await userEvent.type(composer, '/comp{Enter}')
    await waitFor(() => expect(client.compact).toHaveBeenCalledTimes(1))
    expect(composer.value).toBe('')
    expect(client.send).not.toHaveBeenCalled()
  })

  it('renames the task with the words after /rename', async () => {
    const client = mount()
    const composer = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Tell Claude Code something' })
    await userEvent.type(composer, '/rename Retry the refund call{Enter}')
    await waitFor(() => expect(client.renameTask).toHaveBeenCalledWith('t1', 'Retry the refund call'))
    expect(client.send).not.toHaveBeenCalled()
  })

  it('sets the goal from /goal, and opens into it once it is set', async () => {
    const client = mount({ setThreadGoal: vi.fn(async () => null) })
    const composer = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Tell Claude Code something' })
    await userEvent.type(composer, '/goal ')
    expect(screen.getByText('Not set')).toBeTruthy()
    expect(screen.getByText('The lead keeps working toward it on its own, up to 12 turns, until it’s done or stuck.')).toBeTruthy()
    await userEvent.type(composer, 'Get the spec passing')
    expect(names()).toEqual(['Set the goal'])
    await userEvent.keyboard('{Enter}')
    await waitFor(() =>
      expect(client.setThreadGoal).toHaveBeenCalledWith({ threadId: 'th1', control: { action: 'set', objective: 'Get the spec passing' } }),
    )
    expect(client.send).not.toHaveBeenCalled()
  })

  it('changes the lead’s model from /model, as the picker does', async () => {
    const client = mount()
    const composer = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Tell Claude Code something' })
    await userEvent.type(composer, '/model sonnet')
    const rows = within(screen.getByRole('listbox', { name: 'Commands' })).getAllByRole('option')
    expect(rows.length).toBeGreaterThan(0)
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(client.setModel).toHaveBeenCalledWith({ threadId: 'th1', agentId: 'claude-code', model: 'sonnet' }))
    expect(composer.value).toBe('')
  })

  it('offers /interrupt while the lead works', async () => {
    const base = snapshot()
    const { client } = fakeClient({
      getThread: vi.fn(async () => snapshot({ session: { ...base.session!, turnRunning: true, turnStartedAt: new Date().toISOString() } })),
    })
    withServices(<Task />, client)
    const composer = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: /Claude Code|queue/ })
    await userEvent.type(composer, '/int{Enter}')
    await waitFor(() => expect(client.interrupt).toHaveBeenCalledWith('th1'))
  })
})

describe('the coordinator’s composer', () => {
  const session = { ...snapshot().session!, id: 'sc', context: { used: 24_000, size: 200_000 } }

  it('offers its own commands, and says a /goal to it, for a task toward it', async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () => coordinatorSnapshot({ session })),
      setThreadGoal: vi.fn(async () => null),
    })
    withServices(<Project />, client)
    const composer = await screen.findByRole<HTMLTextAreaElement>('textbox', { name: /Tell the coordinator something/ })
    await userEvent.type(composer, '/')
    expect(names()).toEqual(['/aside', '/goal', '/model', '/compact'])
    await userEvent.type(composer, 'goal ')
    expect(screen.getByText('A new task')).toBeTruthy()
    // Nothing written, Enter does nothing.
    await userEvent.keyboard('{Enter}')
    expect(client.send).not.toHaveBeenCalled()
    await userEvent.type(composer, 'Ship it')
    expect(names()).toEqual(['Start a task toward it'])
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(client.send).toHaveBeenCalledTimes(1))
    expect(JSON.stringify(vi.mocked(client.send).mock.calls[0])).toContain('/goal Ship it')
    expect(composer.value).toBe('')
    expect(client.setThreadGoal).not.toHaveBeenCalled()
  })
})
