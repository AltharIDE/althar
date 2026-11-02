import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type Launch } from '@althar/contracts'

import { useBoard } from '../src/renderer/features/board/useBoard'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
import { targetsOf } from '../src/renderer/features/runs/Runs'
import { coordinatorSnapshot, fakeClient, repositories, runnables } from './fixtures'
import { useSettingsOf, withServices } from './render'

/*
 * What a project runs, where the rest of its tests don't go: a run in a
 * task that says nothing of where it answers, a project of one repository
 * or none read, and each dialog kept open when what it asked didn't go
 * through.
 */

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

const refused = (message: string) => new ApiError({ reason: 'SqlError', message })

/** The project's front, read, with what it runs. */
const shown = async (more: Parameters<typeof fakeClient>[0] = {}) => {
  const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot({ runnables })), ...more })
  withServices(<Project />, client)
  await screen.findByRole('button', { name: /^Coordinator: / })
  return client
}

/** A menu item under the Run button's chevron. */
const pick = async (item: string) => {
  await userEvent.click(screen.getByRole('button', { name: 'Everything to run' }))
  await userEvent.click(within(await screen.findByRole('menu', { name: 'What it runs' })).getByRole('menuitem', { name: item }))
}

describe('what the Run button says of one running in a task', () => {
  it('says where, with no address where it says none', () => {
    const inTask: Launch = {
      id: 'proc_1',
      taskId: 't1',
      runnableId: 'rnbl_dev',
      where: 'Fix the login timeout',
      command: 'bun run dev',
      url: null,
      startedAt: '2026-10-14T09:00:00.000Z',
      ended: null,
    }
    expect(targetsOf(runnables, [inTask], null, '2026-10-14T09:10:00.000Z')[0]?.elsewhere).toEqual({ where: 'in Fix the login timeout' })
  })
})

describe('adding something to run', () => {
  it('names no repository of a script where the project has one', async () => {
    await shown({ getRepositories: vi.fn(async () => [repositories[0]!]) })
    await pick('Add something to run…')
    const add = within(await screen.findByRole('dialog', { name: 'Add something to run' }))
    await userEvent.click(add.getByRole('radio', { name: 'From package.json' }))
    const offered = await add.findAllByRole('checkbox')
    expect(offered.map((one) => one.closest('label')?.textContent)).toEqual(['bun run test:watch  ·  vitest'])
  })

  it('keeps a command with no repository where none is read', async () => {
    const client = await shown({ getRepositories: vi.fn(async () => []) })
    await pick('Add something to run…')
    const add = within(await screen.findByRole('dialog', { name: 'Add something to run' }))
    await userEvent.type(add.getByRole('textbox', { name: /Command/ }), 'make docs')
    await userEvent.click(add.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(client.keepRunnable).toHaveBeenCalledWith({ projectId: 'p1', name: null, command: 'make docs' }))
  })

  it('stays open, saying why, where scripts couldn’t be kept or the coordinator couldn’t be asked', async () => {
    const client = await shown({
      keepRunnable: vi.fn(async () => {
        throw refused('The project has no repository on this Mac to run it in.')
      }),
      send: vi.fn(async () => {
        throw refused('The coordinator isn’t running.')
      }),
    })
    await pick('Add something to run…')
    const add = within(await screen.findByRole('dialog', { name: 'Add something to run' }))
    await userEvent.click(add.getByRole('radio', { name: 'From package.json' }))
    await userEvent.click((await add.findAllByRole('checkbox'))[0]!)
    await userEvent.click(add.getByRole('button', { name: 'Add' }))
    expect((await add.findByRole('alert')).textContent).toContain('no repository on this Mac')
    await userEvent.click(add.getByRole('radio', { name: 'Ask the coordinator' }))
    await userEvent.click(add.getByRole('button', { name: 'Ask the coordinator' }))
    await waitFor(() => expect(client.send).toHaveBeenCalled())
    expect(screen.getByRole('dialog', { name: 'Add something to run' })).toBeTruthy()
  })
})

describe('changing one', () => {
  it('stays open, saying why, where it couldn’t be kept or removed', async () => {
    const client = await shown({
      keepRunnable: vi.fn(async () => {
        throw refused('That command is kept already.')
      }),
      dropRunnable: vi.fn(async () => {
        throw refused('Storybook is running; stop it first.')
      }),
    })
    await pick('Edit the list…')
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'What meridian runs' })).getByRole('button', { name: 'Edit Storybook' }),
    )
    const edit = within(await screen.findByRole('dialog', { name: 'Edit Storybook' }))
    await userEvent.click(edit.getByRole('button', { name: 'Save' }))
    expect((await edit.findByRole('alert')).textContent).toBe('That command is kept already.')
    await userEvent.click(edit.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(client.dropRunnable).toHaveBeenCalledWith('p1', 'rnbl_storybook'))
    expect((await edit.findByRole('alert')).textContent).toBe('Storybook is running; stop it first.')
    expect(screen.getByRole('dialog', { name: 'Edit Storybook' })).toBeTruthy()
  })

  it('keeps one in its own repository where the project’s aren’t read', async () => {
    const client = await shown({ getRepositories: vi.fn(async () => []) })
    await pick('Edit the list…')
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'What meridian runs' })).getByRole('button', { name: 'Edit Storybook' }),
    )
    const edit = within(await screen.findByRole('dialog', { name: 'Edit Storybook' }))
    await userEvent.click(edit.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(client.keepRunnable).toHaveBeenCalledWith({
        projectId: 'p1',
        id: 'rnbl_storybook',
        name: 'Storybook',
        command: 'bun --filter @meridian/ui storybook',
        repository: 'meridian-api',
      }),
    )
  })
})
