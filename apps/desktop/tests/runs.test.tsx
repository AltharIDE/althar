import { ApiError, type Launch } from '@althar/contracts'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { useBoard } from '../src/renderer/features/board/useBoard'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
import { MAIN, mainOf, placeOfLaunch, runsAt, STARTING_FOR, targetsOf } from '../src/renderer/features/runs/Runs'
import { askText, nameOf } from '../src/renderer/features/runs/useRuns'
import { coordinatorSnapshot, fakeClient, repositories, runnables, scripts } from './fixtures'
import { useSettingsOf, withServices } from './render'

/*
 * What a project runs, from its front (ADR-090): Run opens the list, each
 * started and stopped there, several at once; where it runs picked beside it,
 * a branch or pull request fetched as it runs; adding something more to run,
 * three ways; and the whole list to order, edit and remove.
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
  await screen.findByRole('button', { name: /^Coordinator: / })
  return { client, emit }
}

/** The list Run opens. */
const listed = async () => {
  await userEvent.click(screen.getByRole('button', { name: /^Run/ }))
  return within(await screen.findByRole('dialog', { name: 'What it runs' }))
}

describe('what the project runs, from its front', () => {
  it('runs nothing at a press: the list starts and stops each, several at once', async () => {
    const { client, emit } = await shown()
    const list = await listed()
    expect(client.runProject).not.toHaveBeenCalled()
    await userEvent.click(list.getByRole('button', { name: 'Run bun run dev' }))
    expect(client.runProject).toHaveBeenCalledWith('p1', null, 'thc', 'rnbl_dev')
    // Up, it says where it answers; Storybook starts beside it; the button still says Run, and how many run.
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
    expect(await screen.findByRole('button', { name: /^Run\s*1 running$/ })).toBeTruthy()
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null)
    await userEvent.click(list.getByText('localhost:5173'))
    expect(opened).toHaveBeenCalledWith('http://localhost:5173/', '_blank')
    opened.mockRestore()
    expect(list.getByText('Starting…')).toBeTruthy()
    await userEvent.click(list.getByRole('button', { name: 'Stop Storybook' }))
    expect(client.stopLaunch).toHaveBeenCalledWith('proc_2')
  })

  it('adds one by its command, picks scripts from package.json, or asks the coordinator to work it out', async () => {
    const { client } = await shown()
    await userEvent.click((await listed()).getByRole('button', { name: 'Add something to run' }))
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
    await userEvent.click((await listed()).getByRole('button', { name: 'Add something to run' }))
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
    await userEvent.click((await listed()).getByRole('button', { name: 'Add something to run' }))
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
    await userEvent.click((await listed()).getByRole('button', { name: 'Run bun run dev' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Could not fetch main from origin.')
  })

  it('offers a script kept in one repository again in another, saying which', async () => {
    const web = { ...repositories[0]!, id: 'repo_web', name: 'meridian-web', path: '/Users/me/code/meridian-web' }
    await shown([], {
      getRepositories: vi.fn(async () => [repositories[0]!, web]),
      getRepositoryScripts: vi.fn(async () => [...scripts, { ...scripts[2]!, repository: 'meridian-web' }]),
    })
    await userEvent.click((await listed()).getByRole('button', { name: 'Add something to run' }))
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
    await userEvent.click((await listed()).getByRole('button', { name: 'Add something to run' }))
    const add = within(await screen.findByRole('dialog', { name: 'Add something to run' }))
    await userEvent.type(add.getByRole('textbox', { name: /Command/ }), 'make docs')
    await userEvent.click(add.getByRole('button', { name: 'Add' }))
    expect(await add.findByRole('alert')).toBeTruthy()
  })

  it('orders, edits and removes them in the whole list, the first its default', async () => {
    const { client } = await shown()
    await userEvent.click((await listed()).getByRole('button', { name: 'Edit the list' }))
    const list = within(await screen.findByRole('dialog', { name: 'What meridian runs' }))
    await userEvent.click(list.getByRole('button', { name: 'Make default' }))
    expect(client.orderRunnables).toHaveBeenCalledWith('p1', ['rnbl_storybook', 'rnbl_dev'])
    // A grip moves its row with the arrow keys, as dragging it does.
    list.getByRole('button', { name: 'Drag to move bun run dev' }).focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(client.orderRunnables).toHaveBeenCalledTimes(2)
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

  it('runs on a pull request picked beside Run, fetching it, and says on its line what went wrong', async () => {
    // The host has more open than it listed: words are searched there.
    const older = { number: 12, name: 'PR #12', title: 'An older pull request', branch: 'older', author: 'sam', draft: false, fork: true }
    const getRunnableRefs = vi.fn(async (_projectId: string, text?: string) =>
      text === undefined
        ? [
            {
              repository: 'meridian-api',
              pullRequests: [
                {
                  number: 41,
                  name: 'PR #41',
                  title: 'Add a services directory',
                  branch: 'feature/find-a-pro',
                  author: 'mira',
                  draft: false,
                  fork: false,
                },
              ],
              branches: ['main', 'feature/gone'],
              note: null,
              more: true,
            },
          ]
        : [{ repository: 'meridian-api', pullRequests: text === 'older' ? [older] : [], branches: [], note: null, more: false }],
    )
    const runProject = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ reason: 'LaunchRefused', message: 'origin has no pull request #41.' }))
      .mockResolvedValue(launch({ id: 'proc_9', branch: 'PR #41 · feature/find-a-pro', where: 'PR #41 · feature/find-a-pro' }))
    const { client, emit } = await shown([], { getRunnableRefs, runProject })
    // Run runs on the default branch until another place is picked.
    await userEvent.click(screen.getByRole('button', { name: 'main' }))
    const picker = within(await screen.findByRole('dialog', { name: 'Where Run runs' }))
    // Asked as it opens: the default branch, then the pull request, then the branches.
    await picker.findByRole('option', { name: /Add a services directory/ })
    expect(getRunnableRefs).toHaveBeenCalledWith('p1')
    expect(picker.getAllByRole('option').map((one) => one.textContent)).toEqual([
      'main',
      expect.stringContaining('Add a services directory'),
      'main',
      'feature/gone',
    ])
    // One past the listing, found on the host by its words.
    await userEvent.type(picker.getByRole('combobox'), 'older')
    expect(await picker.findByRole('option', { name: /An older pull request/ })).toBeTruthy()
    expect(getRunnableRefs).toHaveBeenCalledWith('p1', 'older')
    await userEvent.clear(picker.getByRole('combobox'))
    await userEvent.type(picker.getByRole('combobox'), 'services{Enter}')
    expect(await screen.findByRole('button', { name: 'PR #41' })).toBeTruthy()

    // Run there fetches it; refused, its line says why, and tries again.
    const list = await listed()
    await userEvent.click(list.getByRole('button', { name: 'Run bun run dev' }))
    expect(client.runProject).toHaveBeenLastCalledWith('p1', null, 'thc', 'rnbl_dev', { pullRequest: '41' })
    expect(await list.findByText('origin has no pull request #41.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Run\s*1 failed$/ })).toBeTruthy()
    await userEvent.click(list.getByRole('button', { name: 'Clear bun run dev' }))
    expect(list.queryByText('origin has no pull request #41.')).toBeNull()

    // Again, it runs and says where it answers; the switcher says it.
    await userEvent.click(list.getByRole('button', { name: 'Run bun run dev' }))
    expect(client.runProject).toHaveBeenLastCalledWith('p1', null, 'thc', 'rnbl_dev', { pullRequest: '41' })
    act(() =>
      emit({
        _tag: 'Launches',
        projectId: 'p1',
        launches: [
          launch({
            id: 'proc_9',
            url: 'http://localhost:5199/',
            branch: 'PR #41 · feature/find-a-pro',
            where: 'PR #41 · feature/find-a-pro',
          }),
        ],
      }),
    )
    expect(await list.findByText('localhost:5199')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'PR #41' })).toBeTruthy()
    // Nothing over the composer says it: Run and its switcher do.
    expect(screen.queryByRole('button', { name: /^Running/ })).toBeNull()
  })

  it('says in the whole list what went wrong removing or ordering one', async () => {
    const { client } = await shown()
    vi.mocked(client.dropRunnable).mockRejectedValueOnce(
      new ApiError({ reason: 'SqlError', message: 'Storybook is running; stop it first.' }),
    )
    await userEvent.click((await listed()).getByRole('button', { name: 'Edit the list' }))
    const list = within(await screen.findByRole('dialog', { name: 'What meridian runs' }))
    await userEvent.click(list.getByRole('button', { name: 'Remove Storybook' }))
    expect((await list.findByRole('alert')).textContent).toBe('Storybook is running; stop it first.')
    // Done, and opened again, it starts afresh.
    await userEvent.click(list.getByRole('button', { name: 'Done' }))
    await userEvent.click((await listed()).getByRole('button', { name: 'Edit the list' }))
    expect(within(await screen.findByRole('dialog', { name: 'What meridian runs' })).queryByRole('alert')).toBeNull()
  })
})

describe('where Run runs with no task, by name', () => {
  it('names the branch the project works toward, which it runs a copy of', async () => {
    await shown([], {
      getRepositories: vi.fn(async () => [{ ...repositories[0]!, defaultBranch: 'main', workToward: 'release/0.8.0' }]),
    })
    expect(await screen.findByRole('button', { name: 'release/0.8.0' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'main' })).toBeNull()
  })

  it('names the branch a run there runs while it runs, though Work toward moved since, and the new one once it stops', async () => {
    const { emit } = await shown([launch({ where: 'main' })], {
      getRepositories: vi.fn(async () => [{ ...repositories[0]!, defaultBranch: 'main', workToward: 'release/0.8.0' }]),
    })
    expect(await screen.findByRole('button', { name: 'main' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'release/0.8.0' })).toBeNull()
    act(() =>
      emit({
        _tag: 'Launches',
        projectId: 'p1',
        launches: [launch({ where: 'main', ended: { at: '2026-10-14T09:05:00.000Z', code: 0 } })],
      }),
    )
    expect(await screen.findByRole('button', { name: 'release/0.8.0' })).toBeTruthy()
  })

  it('takes a branch picked beside Run as the project’s Work toward, and makes one typed that the remote doesn’t have', async () => {
    let kept = [{ ...repositories[0]!, defaultBranch: 'main', workToward: null as string | null, branches: ['main', 'release/0.8.0'] }]
    const setRepository = vi.fn(async (input: { repositoryId: string; workToward?: string | null }) => {
      kept = kept.map((each) => (each.id === input.repositoryId ? { ...each, workToward: input.workToward ?? null } : each))
    })
    const getRunnableRefs = vi.fn(async () => [
      { repository: 'meridian-api', pullRequests: [], branches: ['main', 'release/0.8.0'], note: null, more: false },
    ])
    const { client } = await shown([], { setRepository, getRunnableRefs, getRepositories: vi.fn(async () => kept) })
    await userEvent.click(await screen.findByRole('button', { name: 'main' }))
    let picker = within(await screen.findByRole('dialog', { name: 'Where Run runs' }))
    // Its foot says what picking a branch does.
    expect(picker.getByText(/A branch picked here is what new tasks work toward too/)).toBeTruthy()
    await userEvent.click(await picker.findByRole('option', { name: 'release/0.8.0' }))
    await waitFor(() =>
      expect(setRepository).toHaveBeenCalledWith({ projectId: 'p1', repositoryId: kept[0]!.id, workToward: 'release/0.8.0' }),
    )
    // Run's own place runs it: no fetched copy of the branch.
    expect(await screen.findByRole('button', { name: 'release/0.8.0' })).toBeTruthy()
    await userEvent.click((await listed()).getByRole('button', { name: 'Run bun run dev' }))
    expect(client.runProject).toHaveBeenLastCalledWith('p1', null, 'thc', 'rnbl_dev')
    await userEvent.keyboard('{Escape}')

    // A name it doesn't have is made from the default branch, then worked toward.
    await userEvent.click(screen.getByRole('button', { name: 'release/0.8.0' }))
    picker = within(await screen.findByRole('dialog', { name: 'Where Run runs' }))
    await picker.findByRole('option', { name: 'main' })
    await userEvent.type(picker.getByRole('combobox'), 'release/0.9.0')
    await userEvent.click(await picker.findByRole('option', { name: /Create release\/0\.9\.0/ }))
    await waitFor(() =>
      expect(client.createBranch).toHaveBeenCalledWith({ projectId: 'p1', repositoryId: kept[0]!.id, branch: 'release/0.9.0' }),
    )
    await waitFor(() =>
      expect(setRepository).toHaveBeenLastCalledWith({ projectId: 'p1', repositoryId: kept[0]!.id, workToward: 'release/0.9.0' }),
    )
    expect(await screen.findByRole('button', { name: 'release/0.9.0' })).toBeTruthy()
  })

  it('takes a branch a run goes on, picked beside Run, as Work toward too, and opens there so the run can be stopped', async () => {
    const kept = [{ ...repositories[0]!, defaultBranch: 'main', workToward: null as string | null, branches: ['main', 'release/0.8.0'] }]
    const setRepository = vi.fn(async (input: { repositoryId: string; workToward?: string | null }) => {
      kept[0] = { ...kept[0]!, workToward: input.workToward ?? null }
    })
    const getRunnableRefs = vi.fn(async () => [
      { repository: 'meridian-api', pullRequests: [], branches: ['main', 'release/0.8.0'], note: null, more: false },
    ])
    await shown([launch({ branch: 'release/0.8.0', where: 'release/0.8.0' })], {
      setRepository,
      getRunnableRefs,
      getRepositories: vi.fn(async () => kept),
    })
    await userEvent.click(await screen.findByRole('button', { name: 'main' }))
    const picker = within(await screen.findByRole('dialog', { name: 'Where Run runs' }))
    await userEvent.click(await picker.findByRole('option', { name: /^release\/0\.8\.0/ }))
    await waitFor(() =>
      expect(setRepository).toHaveBeenCalledWith({ projectId: 'p1', repositoryId: kept[0]!.id, workToward: 'release/0.8.0' }),
    )
    // Where the run goes, so it can be stopped there.
    expect((await listed()).getByRole('button', { name: 'Stop bun run dev' })).toBeTruthy()
  })

  it('says, while a run goes on the old branch, that it stays there until stopped and the next run takes the new one', async () => {
    await shown([launch({ where: 'main' })], {
      getRepositories: vi.fn(async () => [{ ...repositories[0]!, defaultBranch: 'main', workToward: 'release/0.8.0' }]),
    })
    await userEvent.click(await screen.findByRole('button', { name: 'main' }))
    const picker = within(await screen.findByRole('dialog', { name: 'Where Run runs' }))
    expect(await picker.findByText('bun run dev runs on main until stopped. The next run takes release/0.8.0.')).toBeTruthy()
  })

  it('says the default branch where repositories go different ways, and where none says one', () => {
    expect(
      mainOf([
        { defaultBranch: 'main', workToward: 'release/0.8.0' },
        { defaultBranch: 'main', workToward: null },
      ]).label,
    ).toBe('main')
    expect(mainOf([{ defaultBranch: 'trunk', workToward: null }]).label).toBe('trunk')
    expect(mainOf(undefined)).toEqual(MAIN)
  })
})

describe('what the Run button says of each', () => {
  const now = '2026-10-14T09:10:00.000Z'

  it('takes one that says nothing of where it answers as starting, then as running, as an app’s window', () => {
    const fresh = launch({ startedAt: new Date(Date.parse(now) - STARTING_FOR / 2).toISOString() })
    const long = launch({ startedAt: new Date(Date.parse(now) - STARTING_FOR * 2).toISOString() })
    expect(targetsOf(runnables, [fresh], MAIN, now)[0]?.run).toEqual({ state: 'starting' })
    expect(targetsOf(runnables, [long], MAIN, now)[0]?.run).toEqual({ state: 'running', since: '20s' })
    // How one ended by itself.
    expect(targetsOf(runnables, [launch({ ended: { at: '2026-10-14T09:05:00.000Z', code: 1 } })], MAIN, now)[0]?.run).toEqual({
      state: 'ended',
      code: 1,
      since: '5m ago',
    })
  })

  it('says what runs at the place picked: the default branch, a task, or a pull request or branch', () => {
    const inTask = launch({ taskId: 't1', where: 'Fix the login timeout', url: 'http://localhost:5174/' })
    const onPull = launch({ id: 'proc_3', branch: 'PR #41 · feature/x', where: 'PR #41 · feature/x' })
    const onBranch = launch({ id: 'proc_4', branch: 'feature/x', where: 'feature/x' })
    const task = placeOfLaunch(inTask)
    const pull = placeOfLaunch(onPull)
    const branch = placeOfLaunch(onBranch)
    expect(task).toMatchObject({ key: 'task:t1', kind: 'task', label: 'Fix the login timeout' })
    expect(pull).toMatchObject({ kind: 'pull', label: 'PR #41', detail: 'feature/x' })
    expect(branch).toMatchObject({ kind: 'branch', label: 'feature/x' })
    expect(targetsOf(runnables, [inTask, onPull, onBranch], MAIN, now)[0]?.run).toBeUndefined()
    expect(targetsOf(runnables, [inTask], task, now)[0]?.run).toEqual({ state: 'running', url: 'localhost:5174', since: '10m' })
    expect([inTask, onPull, onBranch].map((one) => [runsAt(one, MAIN), runsAt(one, task), runsAt(one, pull), runsAt(one, branch)])).toEqual(
      [
        [false, true, false, false],
        [false, false, true, false],
        [false, false, false, true],
      ],
    )
    expect(targetsOf(runnables, [], task, now)[1]).toEqual({
      id: 'rnbl_storybook',
      name: 'Storybook',
      command: 'bun --filter @meridian/ui storybook',
      from: 'person',
    })
  })

  it('says a fetch on its way, or what went wrong with it, over the last run there', () => {
    const pull = placeOfLaunch(launch({ branch: 'PR #41 · feature/x' }))
    const ended = launch({ branch: 'PR #41 · feature/x', ended: { at: '2026-10-14T09:05:00.000Z', code: 1 } })
    const key = `${pull.key}\nrnbl_dev`
    expect(targetsOf(runnables, [ended], pull, now, new Map([[key, { state: 'fetching' }]]))[0]?.run).toEqual({ state: 'fetching' })
    expect(
      targetsOf(runnables, [ended], pull, now, new Map([[key, { state: 'unfetched', why: 'offline', at: '2026-10-14T09:09:00.000Z' }]]))[0]
        ?.run,
    ).toEqual({ state: 'unfetched', why: 'offline', since: '1m ago' })
  })

  it('names a picked script after itself, or with its package for a workspace’s', () => {
    expect(nameOf(scripts[1]!, true)).toBe('Test watch')
    expect(nameOf(scripts[2]!, false)).toBe('Storybook · ui')
  })
})
