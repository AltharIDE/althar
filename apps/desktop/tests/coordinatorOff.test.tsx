import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { AwaySnapshot } from '@althar/contracts'
import { Room } from '@althar/ui'

import { titleOf } from '../src/renderer/features/project/ProjectView'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useBoard } from '../src/renderer/features/board/useBoard'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { useProject } from '../src/renderer/features/project/useProject'
import { coordinatorSnapshot, fakeClient, items, project, projectRules, task } from './fixtures'
import { useSettingsOf, withServices } from './render'

/*
 * A project whose coordinator is off (ADR-097): its Conversation says so and
 * how to turn it on, what the person writes there starts a task at once with
 * Auto or the lead they pick, and the board's empty Up next offers New task.
 * What agents did outside their worktrees sits over the lanes, with or
 * without it, each row with how it is taken back or why it can't be.
 */

function Project({ room = Room.Both }: { room?: Room }) {
  return (
    <ProjectView
      model={useProject('p1')}
      board={useBoard('p1')}
      connections={useConnections()}
      settings={useSettingsOf('p1')}
      onTask={vi.fn()}
      room={room}
    />
  )
}

const off = () =>
  fakeClient({
    listProjects: vi.fn(async () => ({ cursor: 3, projects: [project] })),
    getProjectRules: vi.fn(async (projectId: string) => ({ ...projectRules, projectId, coordinator: false })),
    getCoordinator: vi.fn(async () => coordinatorSnapshot({ items: [] })),
    startTask: vi.fn(async () => task),
  })

describe('the coordinator off', () => {
  it('says so in the conversation, and what the person writes starts a task with Auto', async () => {
    const { client } = off()
    withServices(<Project />, client)
    expect(await screen.findByText('The coordinator is off in meridian.')).toBeTruthy()
    expect(screen.getByText(/What you write here starts a task\./)).toBeTruthy()
    // The composer describes a task, and its lead is Auto's to pick.
    const box = await screen.findByRole('textbox', { name: /Describe a task/ })
    expect(screen.getByRole('button', { name: 'Lead: Auto' })).toBeTruthy()
    await userEvent.type(box, 'Fix the Run menu: it says Strat{Enter}')
    await waitFor(() =>
      expect(client.startTask).toHaveBeenCalledWith({
        projectId: 'p1',
        title: 'Fix the Run menu: it says Strat',
        description: 'Fix the Run menu: it says Strat',
      }),
    )
    expect(client.send).not.toHaveBeenCalled()
    // The board's empty Up next starts one too.
    expect(screen.getByRole('button', { name: 'New task' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Talk to the coordinator' })).toBeNull()
  })

  it('turns on again from the conversation', async () => {
    const { client } = off()
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Turn it on' }))
    await waitFor(() => expect(client.setProjectRules).toHaveBeenCalledWith({ projectId: 'p1', coordinator: true }))
  })

  it('says it under what the coordinator said before', async () => {
    const { client } = fakeClient({
      getProjectRules: vi.fn(async (projectId: string) => ({ ...projectRules, projectId, coordinator: false })),
      getCoordinator: vi.fn(async () => coordinatorSnapshot({ items: [items.you('Why is checkout slow?'), items.says('No retry.')] })),
    })
    withServices(<Project />, client)
    expect(await screen.findByText('No retry.')).toBeTruthy()
    expect(await screen.findByText('The coordinator is off in meridian.')).toBeTruthy()
  })

  it('cuts a long first line to a title, at a word', () => {
    expect(titleOf('\n  Fix it  \nMore words')).toBe('Fix it')
    const long = 'Make the board say what agents did outside their worktrees while the person was away'
    const title = titleOf(long)
    expect(title.length).toBeLessThanOrEqual(60)
    expect(title.endsWith('…')).toBe(true)
    expect(long.startsWith(title.slice(0, -1))).toBe(true)
  })
})

const AWAY: AwaySnapshot = {
  looked: '2026-09-29T09:40:00.000Z',
  acts: [
    {
      id: 'oac_merge',
      kind: 'merge',
      what: 'Merged #634 into main',
      at: '2026-09-29T11:10:00.000Z',
      task: { taskId: 't1', threadId: 'th1', title: 'Tabs keep their order' },
      undo: 'revert',
      cant: null,
      state: 'done',
      error: null,
      undoTask: null,
    },
    {
      id: 'oac_post',
      kind: 'post',
      what: 'Commented on #612',
      at: '2026-09-29T10:52:00.000Z',
      task: { taskId: 't2', threadId: 'th2', title: 'Design review of #612' },
      undo: null,
      cant: 'dana replied',
      state: 'done',
      error: null,
      undoTask: null,
    },
  ],
  upTo: 7,
  earlier: 0,
}

describe('while you were away', () => {
  it('sits over the lanes: each row taken back its way, or why not; × clears what it showed', async () => {
    let cleared = false
    const { client } = fakeClient({
      getAway: vi.fn(async () => (cleared ? { looked: '2026-09-29T12:00:00.000Z', acts: [], upTo: 7, earlier: 0 } : AWAY)),
      clearAway: vi.fn(async () => void (cleared = true)),
    })
    withServices(<Project room={Room.Board} />, client)
    const away = await screen.findByRole('region', { name: 'While you were away' })
    expect(within(away).getByText('Merged #634 into main')).toBeTruthy()
    expect(within(away).getByText('dana replied')).toBeTruthy()
    // What can't be taken back offers no way to.
    expect(within(away).queryByRole('button', { name: 'Delete' })).toBeNull()
    await userEvent.click(within(away).getByRole('button', { name: 'Revert it' }))
    expect(client.undoAway).toHaveBeenCalledWith('oac_merge')
    await userEvent.click(within(away).getByRole('button', { name: 'Clear' }))
    expect(client.clearAway).toHaveBeenCalledWith('p1', 7)
    await waitFor(() => expect(screen.queryByRole('region', { name: 'While you were away' })).toBeNull())
  })

  it('says how many earlier acts there are, and shows them when asked', async () => {
    const { client } = fakeClient({
      getAway: vi.fn(async (_projectId: string, all?: boolean) =>
        all === true
          ? { ...AWAY, acts: [...AWAY.acts, { ...AWAY.acts[1]!, id: 'oac_old', what: 'Commented on #600' }] }
          : { ...AWAY, earlier: 1 },
      ),
    })
    withServices(<Project room={Room.Board} />, client)
    const away = await screen.findByRole('region', { name: 'While you were away' })
    await userEvent.click(within(away).getByRole('button', { name: '1 earlier' }))
    expect(await within(away).findByText('Commented on #600')).toBeTruthy()
    expect(client.getAway).toHaveBeenCalledWith('p1', true)
    expect(within(away).queryByRole('button', { name: '1 earlier' })).toBeNull()
  })
})
