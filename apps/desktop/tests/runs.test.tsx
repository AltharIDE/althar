import { ApiError, type Launch } from '@althar/contracts'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { useBoard } from '../src/renderer/features/board/useBoard'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
import { STARTING_FOR, targetsOf } from '../src/renderer/features/runs/Runs'
import { askText, nameOf } from '../src/renderer/features/runs/useRuns'
import { coordinatorSnapshot, fakeClient, repositories, runnables, scripts } from './fixtures'
import { withServices } from './render'

/*
 * What a project runs, from its front (ADR-043): the default one press away,
 * the rest from the list, several at once; adding something more to run,
 * three ways; and the whole list to order, edit and remove.
 */

function Project() {
  return <ProjectView model={useProject('p1')} board={useBoard('p1')} connections={useConnections()} onTask={vi.fn()} />
}

const launch = (overrides: Partial<Launch>): Launch => ({
  id: 'proc_1',
  taskId: null,
  runnableId: 'rnbl_dev',
  where: 'main',
  command: 'bun run dev',
  url: null,
  startedAt: '2026-10-14T09:00:00.000Z',
  ended: null,
  ...overrides,
})

/** The project's front, read, with what it runs. */
const shown = async (launches: ReadonlyArray<Launch> = [], more: Parameters<typeof fakeClient>[0] = {}) => {
  const { client, emit } = fakeClient({
    getCoordinator: vi.fn(async () => coordinatorSnapshot({ runnables, launches })),
    ...more,
  })
  withServices(<Project />, client)
  await screen.findByText(/^Ask the coordinator about/)
  return { client, emit }
}

/** The list under the Run button's chevron. */
const listed = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Everything to run' }))
  return within(await screen.findByRole('menu', { name: 'What it runs' }))
}

describe('what the project runs, from its front', () => {
  it('runs the default at a press, and starts and stops the rest from the list, several at once', async () => {
    const { client, emit } = await shown()
    await userEvent.click(screen.getByRole('button', { name: 'Run bun run dev' }))
    expect(client.runProject).toHaveBeenCalledWith('p1', null, 'thc', 'rnbl_dev')
    // Up, it says where it answers; Storybook starts beside it.
    act(() =>
      emit({
        _tag: 'Launches',
        projectId: 'p1',
        launches: [
          launch({ url: 'http://localhost:5173/' }),
          launch({
            id: 'proc_2',
            runnableId: 'rnbl_storybook',
            command: 'bun --filter @meridian/ui storybook',
            startedAt: new Date().toISOString(),
          }),
        ],
      }),
    )
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null)
    await userEvent.click(await screen.findByRole('button', { name: 'bun run dev · localhost:5173' }))
    expect(opened).toHaveBeenCalledWith('http://localhost:5173/', '_blank')
    opened.mockRestore()
    const list = await listed()
    expect(within(list.getByRole('group', { name: 'Running' })).getAllByRole('menuitemcheckbox')).toHaveLength(2)
    expect(list.getByText('Starting…')).toBeTruthy()
    // Picking one that runs stops it, here.
    await userEvent.click(list.getByRole('menuitemcheckbox', { name: 'Storybook' }))
    expect(client.stopLaunch).toHaveBeenCalledWith('proc_2')
  })

  it('adds one by its command, picks scripts from package.json, or asks the coordinator to work it out', async () => {
    const { client } = await shown()
    await userEvent.click((await listed()).getByRole('menuitem', { name: 'Add something to run…' }))
    const add = within(await screen.findByRole('dialog', { name: 'Add something to run' }))
    await userEvent.type(add.getByRole('textbox', { name: /Command/ }), 'bun run test:watch')
    await userEvent.type(add.getByRole('textbox', { name: /Name/ }), 'Tests, watching')
    await userEvent.click(add.getByRole('button', { name: 'Add' }))
    expect(client.keepRunnable).toHaveBeenCalledWith({
      projectId: 'p1',
      name: 'Tests, watching',
      command: 'bun run test:watch',
      repository: 'meridian-api',
    })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add something to run' })).toBeNull())

    // From package.json: only what isn't kept already, each named after its script.
    await userEvent.click((await listed()).getByRole('menuitem', { name: 'Add something to run…' }))
    const pick = within(await screen.findByRole('dialog', { name: 'Add something to run' }))
    await userEvent.click(pick.getByRole('radio', { name: 'From package.json' }))
    const offered = await pick.findAllByRole('checkbox')
    expect(offered).toHaveLength(1)
    await userEvent.click(offered[0]!)
    await userEvent.click(pick.getByRole('button', { name: 'Add' }))
    expect(client.keepRunnable).toHaveBeenLastCalledWith({
      projectId: 'p1',
      name: 'Test watch',
      command: 'bun run test:watch',
      repository: 'meridian-api',
    })

    // The coordinator is asked in the project's conversation.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add something to run' })).toBeNull())
    await userEvent.click((await listed()).getByRole('menuitem', { name: 'Add something to run…' }))
    const ask = within(await screen.findByRole('dialog', { name: 'Add something to run' }))
    await userEvent.click(ask.getByRole('radio', { name: 'Ask the coordinator' }))
    await userEvent.click(ask.getByRole('button', { name: 'Ask the coordinator' }))
    await waitFor(() => expect(client.send).toHaveBeenCalledWith({ threadId: 'thc', body: askText, disposition: 'after_current' }))
  })

  it('says over the composer what went wrong running one from the button', async () => {
    const { client } = await shown()
    vi.mocked(client.runProject).mockRejectedValueOnce(
      new ApiError({ reason: 'LaunchRefused', message: 'Could not fetch main from origin.' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Run bun run dev' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Could not fetch main from origin.')
  })

  it('offers a script kept in one repository again in another, saying which', async () => {
    const web = { ...repositories[0]!, id: 'repo_web', name: 'meridian-web', path: '/Users/me/code/meridian-web' }
    await shown([], {
      getRepositories: vi.fn(async () => [repositories[0]!, web]),
      getRepositoryScripts: vi.fn(async () => [...scripts, { ...scripts[2]!, repository: 'meridian-web' }]),
    })
    await userEvent.click((await listed()).getByRole('menuitem', { name: 'Add something to run…' }))
    const pick = within(await screen.findByRole('dialog', { name: 'Add something to run' }))
    await userEvent.click(pick.getByRole('radio', { name: 'From package.json' }))
    // Storybook is kept in meridian-api, not in meridian-web; its dev server is kept.
    const offered = await pick.findAllByRole('checkbox')
    expect(offered.map((one) => one.closest('label')?.textContent)).toEqual([
      'bun run test:watch  ·  vitest  ·  meridian-api',
      'bun --filter @meridian/ui storybook  ·  storybook dev  ·  meridian-web',
    ])
  })

  it('says what went wrong adding one, and keeps the dialog open', async () => {
    const { client } = await shown()
    vi.mocked(client.keepRunnable).mockRejectedValueOnce(new Error('The project has no repository on this Mac to run it in.'))
    await userEvent.click((await listed()).getByRole('menuitem', { name: 'Add something to run…' }))
    const add = within(await screen.findByRole('dialog', { name: 'Add something to run' }))
    await userEvent.type(add.getByRole('textbox', { name: /Command/ }), 'make docs')
    await userEvent.click(add.getByRole('button', { name: 'Add' }))
    expect(await add.findByRole('alert')).toBeTruthy()
  })

  it('orders, edits and removes them in the whole list, the first its default', async () => {
    const { client } = await shown()
    await userEvent.click((await listed()).getByRole('menuitem', { name: 'Edit the list…' }))
    const list = within(await screen.findByRole('dialog', { name: 'What meridian runs' }))
    await userEvent.click(list.getByRole('button', { name: 'Make default' }))
    expect(client.orderRunnables).toHaveBeenCalledWith('p1', ['rnbl_storybook', 'rnbl_dev'])
    await userEvent.click(list.getByRole('button', { name: 'Move bun run dev down' }))
    expect(client.orderRunnables).toHaveBeenLastCalledWith('p1', ['rnbl_storybook', 'rnbl_dev'])
    await userEvent.click(list.getByRole('button', { name: 'Remove Storybook' }))
    expect(client.dropRunnable).toHaveBeenCalledWith('p1', 'rnbl_storybook')
    // Its repository's own way: named, it stays its own.
    await userEvent.click(list.getByRole('button', { name: 'Edit bun run dev' }))
    const edit = within(await screen.findByRole('dialog', { name: 'Edit bun run dev' }))
    await userEvent.type(edit.getByRole('textbox', { name: /Name/ }), 'API')
    await userEvent.click(edit.getByRole('button', { name: 'Save' }))
    expect(client.keepRunnable).toHaveBeenCalledWith({
      projectId: 'p1',
      id: 'rnbl_dev',
      name: 'API',
      command: null,
      repository: 'meridian-api',
    })
    // Back to the list once kept; from there, adding opens too.
    const again = within(await screen.findByRole('dialog', { name: 'What meridian runs' }))
    await userEvent.click(again.getByRole('button', { name: 'Edit Storybook' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Edit Storybook' })).getByRole('button', { name: 'Remove' }))
    expect(client.dropRunnable).toHaveBeenLastCalledWith('p1', 'rnbl_storybook')
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'What meridian runs' })).getByRole('button', { name: 'Add something to run' }),
    )
    expect(await screen.findByRole('dialog', { name: 'Add something to run' })).toBeTruthy()
  })

  it('says in the whole list what went wrong removing or ordering one', async () => {
    const { client } = await shown()
    vi.mocked(client.dropRunnable).mockRejectedValueOnce(
      new ApiError({ reason: 'SqlError', message: 'Storybook is running; stop it first.' }),
    )
    await userEvent.click((await listed()).getByRole('menuitem', { name: 'Edit the list…' }))
    const list = within(await screen.findByRole('dialog', { name: 'What meridian runs' }))
    await userEvent.click(list.getByRole('button', { name: 'Remove Storybook' }))
    expect((await list.findByRole('alert')).textContent).toBe('Storybook is running; stop it first.')
    // Done, and opened again, it starts afresh.
    await userEvent.click(list.getByRole('button', { name: 'Done' }))
    await userEvent.click((await listed()).getByRole('menuitem', { name: 'Edit the list…' }))
    expect(within(await screen.findByRole('dialog', { name: 'What meridian runs' })).queryByRole('alert')).toBeNull()
  })
})

describe('what the Run button says of each', () => {
  const now = '2026-10-14T09:10:00.000Z'

  it('takes one that says nothing of where it answers as starting, then as running, as an app’s window', () => {
    const fresh = launch({ startedAt: new Date(Date.parse(now) - STARTING_FOR / 2).toISOString() })
    const long = launch({ startedAt: new Date(Date.parse(now) - STARTING_FOR * 2).toISOString() })
    expect(targetsOf(runnables, [fresh], null, now)[0]?.run).toEqual({ state: 'starting' })
    expect(targetsOf(runnables, [long], null, now)[0]?.run).toEqual({ state: 'running', since: '20s' })
    // How one ended by itself.
    expect(targetsOf(runnables, [launch({ ended: { at: '2026-10-14T09:05:00.000Z', code: 1 } })], null, now)[0]?.run).toEqual({
      state: 'ended',
      code: 1,
      since: '5m ago',
    })
  })

  it('says, on the project, where one runs in a task; on the task, where it runs is this task', () => {
    const inTask = launch({ taskId: 't1', where: 'Fix the login timeout', url: 'http://localhost:5174/' })
    expect(targetsOf(runnables, [inTask], null, now)[0]).toMatchObject({
      where: 'default branch',
      elsewhere: { where: 'in Fix the login timeout', url: 'localhost:5174' },
    })
    expect(targetsOf(runnables, [inTask], 't1', now)[0]).toMatchObject({
      where: 'this task',
      run: { state: 'running', url: 'localhost:5174' },
    })
    expect(targetsOf(runnables, [], 't1', now)[1]).toEqual({
      id: 'rnbl_storybook',
      name: 'Storybook',
      command: 'bun --filter @meridian/ui storybook',
      where: 'this task',
      from: 'person',
    })
  })

  it('names a picked script after itself, or with its package for a workspace’s', () => {
    expect(nameOf(scripts[1]!, true)).toBe('Test watch')
    expect(nameOf(scripts[2]!, false)).toBe('Storybook · ui')
  })
})
