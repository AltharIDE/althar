import { act, getDefaultNormalizer, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type Launch } from '@althar/contracts'

import { useBoard } from '../src/renderer/features/board/useBoard'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
import { placeOfLaunch, targetsOf } from '../src/renderer/features/runs/Runs'
import { askAfterText, askText } from '../src/renderer/features/runs/useRuns'
import { draftKey, setDraftText } from '../src/renderer/shared/drafts'
import { coordinatorSnapshot, fakeClient, repositories, runnables } from './fixtures'
import { useSettingsOf, withServices } from './render'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', async (actual) => ({
  ...(await actual<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}))

/*
 * What a project runs, where the rest of its tests don't go: a run in a
 * task that says nothing of where it answers, a project of one repository
 * or none read, each dialog kept open when what the runtime checks didn't
 * go through, and what is shown at once, the ask and a removal, taken back
 * with a line where it didn't.
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

/** Words as they stand, their new lines kept. */
const asIs = { normalizer: getDefaultNormalizer({ collapseWhitespace: false }) }

const refused = (message: string) => new ApiError({ reason: 'SqlError', message })

/** The project's front, read, with what it runs. */
const shown = async (more: Parameters<typeof fakeClient>[0] = {}) => {
  const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot({ runnables })), ...more })
  withServices(<Project />, client)
  await screen.findByRole('button', { name: /^Coordinator: / })
  return client
}

/** One of the ways at the foot of the list Run opens. */
const pick = async (item: string) => {
  await userEvent.click(screen.getByRole('button', { name: /^Run/ }))
  await userEvent.click(within(await screen.findByRole('dialog', { name: 'What it runs' })).getByRole('button', { name: item }))
}

describe('what the Run button says of one running in a task', () => {
  it('says it runs, with no address where it says none', () => {
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
    expect(targetsOf(runnables, [inTask], placeOfLaunch(inTask), '2026-10-14T09:10:00.000Z')[0]?.run).toEqual({
      state: 'running',
      since: '10m',
    })
  })
})

describe('adding something to run', () => {
  it('names no repository of a script where the project has one', async () => {
    await shown({ getRepositories: vi.fn(async () => [repositories[0]!]) })
    await pick('Add something to run')
    const add = within(await screen.findByRole('dialog', { name: 'Add something to run' }))
    await userEvent.click(add.getByRole('radio', { name: 'From package.json' }))
    const offered = await add.findAllByRole('checkbox')
    expect(offered.map((one) => one.closest('label')?.textContent)).toEqual(['bun run test:watch  ·  vitest'])
  })

  it('keeps a command with no repository where none is read', async () => {
    const client = await shown({ getRepositories: vi.fn(async () => []) })
    await pick('Add something to run')
    const add = within(await screen.findByRole('dialog', { name: 'Add something to run' }))
    await userEvent.type(add.getByRole('textbox', { name: /Command/ }), 'make docs')
    await userEvent.click(add.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(client.keepRunnable).toHaveBeenCalledWith({ projectId: 'p1', name: null, command: 'make docs' }))
  })

  it('stays open, saying why, where scripts couldn’t be kept', async () => {
    await shown({
      keepRunnable: vi.fn(async () => {
        throw refused('The project has no repository on this Mac to run it in.')
      }),
    })
    await pick('Add something to run')
    const add = within(await screen.findByRole('dialog', { name: 'Add something to run' }))
    await userEvent.click(add.getByRole('radio', { name: 'From package.json' }))
    await userEvent.click((await add.findAllByRole('checkbox'))[0]!)
    await userEvent.click(add.getByRole('button', { name: 'Add' }))
    expect((await add.findByRole('alert')).textContent).toContain('no repository on this Mac')
    expect(screen.getByRole('dialog', { name: 'Add something to run' })).toBeTruthy()
  })

  it('asks the coordinator in its composer, unsent, after what the person had written, once however often it is asked', async () => {
    const client = await shown()
    await act(async () => setDraftText(draftKey.coordinator('p1'), 'The login page looks off on Safari.'))
    await pick('Add something to run')
    const add = within(await screen.findByRole('dialog', { name: 'Add something to run' }))
    await userEvent.click(add.getByRole('radio', { name: 'Ask the coordinator' }))
    // Nothing to wait on: the scripts read behind it don't make it busy.
    expect(add.getByRole('button', { name: 'Ask the coordinator' }).getAttribute('aria-busy')).not.toBe('true')
    await userEvent.click(add.getByRole('button', { name: 'Ask the coordinator' }))
    // Closed from the press, the conversation asked for, and the words there, unsent, never over the person's own.
    expect(screen.queryByRole('dialog', { name: 'Add something to run' })).toBeNull()
    expect(navigate).toHaveBeenLastCalledWith({ to: '/projects/$projectId', params: { projectId: 'p1' }, search: { room: 'talk' } })
    expect(screen.getByDisplayValue(`The login page looks off on Safari.\n${askAfterText}`, asIs)).toBeTruthy()
    // Asked again, it is there once.
    await pick('Add something to run')
    const again = within(await screen.findByRole('dialog', { name: 'Add something to run' }))
    await userEvent.click(again.getByRole('radio', { name: 'Ask the coordinator' }))
    await userEvent.click(again.getByRole('button', { name: 'Ask the coordinator' }))
    expect(screen.getByDisplayValue(`The login page looks off on Safari.\n${askAfterText}`, asIs)).toBeTruthy()
    expect(client.send).not.toHaveBeenCalled()
    expect(askAfterText.startsWith('And please work out what this project runs')).toBe(true)
    expect(askText.startsWith('Please work out')).toBe(true)
  })

  it('asks from Run’s own item, with nothing to run yet, with no dialog', async () => {
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot({ runnables: [] })) })
    withServices(<Project />, client)
    await screen.findByRole('button', { name: /^Coordinator: / })
    await userEvent.click(screen.getByRole('button', { name: /^Run/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Ask the coordinator to work it out/ }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByDisplayValue(askText, asIs)).toBeTruthy()
    expect(navigate).toHaveBeenLastCalledWith({ to: '/projects/$projectId', params: { projectId: 'p1' }, search: { room: 'talk' } })
    expect(client.send).not.toHaveBeenCalled()
  })
})

describe('changing one', () => {
  it('stays open, saying why, where it couldn’t be kept', async () => {
    await shown({
      keepRunnable: vi.fn(async () => {
        throw refused('That command is kept already.')
      }),
    })
    await pick('Edit the list')
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'What meridian runs' })).getByRole('button', { name: 'Edit Storybook' }),
    )
    const edit = within(await screen.findByRole('dialog', { name: 'Edit Storybook' }))
    await userEvent.click(edit.getByRole('button', { name: 'Save' }))
    expect((await edit.findByRole('alert')).textContent).toBe('That command is kept already.')
    expect(screen.getByRole('dialog', { name: 'Edit Storybook' })).toBeTruthy()
  })

  it('removes it at once, back on the list, and puts it back there, saying why, where it couldn’t be removed', async () => {
    let refuse: (failure: unknown) => void = () => undefined
    const client = await shown({ dropRunnable: vi.fn(() => new Promise<void>((_, reject) => (refuse = reject))) })
    await pick('Edit the list')
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'What meridian runs' })).getByRole('button', { name: 'Edit Storybook' }),
    )
    const edit = within(await screen.findByRole('dialog', { name: 'Edit Storybook' }))
    await userEvent.click(edit.getByRole('button', { name: 'Remove' }))
    expect(client.dropRunnable).toHaveBeenCalledWith('p1', 'rnbl_storybook')
    // Gone from the list it goes back to, before the runtime answers.
    const list = within(screen.getByRole('dialog', { name: 'What meridian runs' }))
    expect(list.queryByRole('button', { name: 'Edit Storybook' })).toBeNull()
    await act(async () => refuse(refused('Storybook is running; stop it first.')))
    expect((await list.findByRole('alert')).textContent).toBe('Storybook is running; stop it first.')
    expect(list.getByRole('button', { name: 'Edit Storybook' })).toBeTruthy()
  })

  it('keeps one in its own repository where the project’s aren’t read', async () => {
    const client = await shown({ getRepositories: vi.fn(async () => []) })
    await pick('Edit the list')
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
