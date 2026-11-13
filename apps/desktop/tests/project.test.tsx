import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError, type CoordinatorSnapshot, type ThreadItem } from '@althar/contracts'
import { Room } from '@althar/ui'

import { ProjectView } from '../src/renderer/features/project/ProjectView'
import type { SettingsWays } from '../src/renderer/features/settings/open'
import { useProject } from '../src/renderer/features/project/useProject'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { useBoard } from '../src/renderer/features/board/useBoard'
import {
  agents,
  card,
  changed,
  coordinatorSnapshot,
  efforts,
  fakeClient,
  items,
  models,
  project,
  repositories,
  status,
  streamed,
} from './fixtures'
import { clock } from '../src/renderer/shared/time'
import { useSettingsOf, withServices, pickLayout } from './render'

function Project({
  onTask = vi.fn(),
  room,
  newTask,
  onRoomChange,
  ways,
}: {
  onTask?: (threadId: string) => void
  room?: Room
  newTask?: boolean
  onRoomChange?: (room: Room) => void
  ways?: SettingsWays
}) {
  return (
    <ProjectView
      model={useProject('p1')}
      board={useBoard('p1')}
      connections={useConnections()}
      settings={useSettingsOf('p1')}
      onTask={onTask}
      {...(room === undefined ? {} : { room })}
      {...(newTask === undefined ? {} : { newTask })}
      {...(onRoomChange === undefined ? {} : { onRoomChange })}
      {...(ways === undefined ? {} : { ways })}
    />
  )
}

const session = {
  id: 'sc',
  agentId: 'claude-code',
  agentName: 'Claude Code',
  state: 'active',
  model: null,
  account: null,
  effort: null,
  models: [],
  turnRunning: false,
  turnStartedAt: null,
  turnEndedAt: null,
  held: true,
  context: null,
  background: [],
}

/** The coordinator's thread with a conversation and two cards: one running, one planned. */
const talk = (overrides: Partial<CoordinatorSnapshot> = {}) =>
  coordinatorSnapshot({
    session,
    items: [
      items.you('Why is checkout slow, and can you fix it?'),
      items.tool({ title: 'Read checkout.ts' }),
      items.says('The call has no retry. I planned a task.'),
      items.card(card({ taskId: 't2', threadId: 'th2', slug: 'fix-it', title: 'Fix it', phase: 'running', step: 'review' }), 'c2'),
      items.card(card(), 'c1'),
    ],
    ...overrides,
  })

/** The project with its settings, as its route gives it. */
function WithSettings() {
  return (
    <ProjectView
      model={useProject('p1')}
      board={useBoard('p1')}
      connections={useConnections()}
      onTask={vi.fn()}
      settings={useSettingsOf('p1')}
    />
  )
}

/**
 * The home's layout as ⋯ says it, the menu opened and closed again: the conversation, the board, and the conversation on
 * the right, each on or off, and fixed where it can't be changed.
 */
const layout = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'More' }))
  const menu = await screen.findByRole('menu', { name: 'More' })
  const state = ['Conversation', 'Board', 'Conversation on the right'].map((name) => {
    const item = within(menu).getByRole('menuitemcheckbox', { name })
    return `${item.getAttribute('aria-checked') === 'true' ? 'on' : 'off'}${item.getAttribute('aria-disabled') === 'true' ? ', fixed' : ''}`
  })
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('menu', { name: 'More' })).toBeNull())
  return state
}

describe('running the project, with no agent', () => {
  it('runs on its default branch from the project’s front, picks a task’s worktree beside Run, and stops and clears each there', async () => {
    const { client, emit } = fakeClient({
      listProjects: vi.fn(async () => ({ cursor: 3, projects: [project] })),
      getCoordinator: vi.fn(async () =>
        coordinatorSnapshot({
          runnables: [{ id: 'rnbl_dev', name: null, command: 'npm run dev', repository: 'meridian', own: true, from: 'repository' }],
        }),
      ),
    })
    withServices(<WithSettings />, client)
    // Once the conversation is read, its front offers what the project runs, on the default branch.
    await screen.findByRole('button', { name: /^Coordinator: / })
    expect(screen.getByRole('button', { name: 'main' })).toBeTruthy()
    await userEvent.click(await screen.findByRole('button', { name: /^Run$/ }))
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'What it runs' })).getByRole('button', { name: 'Run npm run dev' }),
    )
    expect(client.runProject).toHaveBeenCalledWith('p1', null, 'thc', 'rnbl_dev')
    await userEvent.keyboard('{Escape}')
    const launch = {
      id: 'proc_1',
      taskId: null,
      runnableId: 'rnbl_dev',
      where: 'main',
      command: 'npm run dev',
      url: 'http://localhost:5199/',
      startedAt: '2026-10-10T09:00:00.000Z',
      ended: null,
    }
    // Run says what runs where it runs; the switcher, what runs at each place, a task's too.
    act(() =>
      emit({
        _tag: 'Launches',
        projectId: 'p1',
        launches: [launch, { ...launch, id: 'proc_2', taskId: 't1', where: 'Fix the login timeout', command: 'bun run dev' }],
      }),
    )
    await userEvent.click(await screen.findByRole('button', { name: /^Run\s*1 running$/ }))
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'What it runs' })).getByRole('button', { name: 'Stop npm run dev' }),
    )
    expect(client.stopLaunch).toHaveBeenCalledWith('proc_1')
    await userEvent.keyboard('{Escape}')
    // Stopped, it is gone; the task's runs on.
    act(() =>
      emit({
        _tag: 'Launches',
        projectId: 'p1',
        launches: [{ ...launch, id: 'proc_2', taskId: 't1', where: 'Fix the login timeout', command: 'bun run dev' }],
      }),
    )
    await screen.findByRole('button', { name: /^Run$/ })
    await userEvent.click(screen.getByRole('button', { name: 'main' }))
    const places = within(await screen.findByRole('dialog', { name: 'Where Run runs' }))
    await userEvent.click(await places.findByRole('option', { name: /^Fix the login timeout/ }))
    await userEvent.click(await screen.findByRole('button', { name: /^Run\s*1 running$/ }))
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'What it runs' })).getByRole('button', { name: 'Stop npm run dev' }),
    )
    expect(client.stopLaunch).toHaveBeenLastCalledWith('proc_2')
    await userEvent.keyboard('{Escape}')
    // One that ended by itself, there, says how, and clears.
    act(() =>
      emit({
        _tag: 'Launches',
        projectId: 'p1',
        launches: [
          { ...launch, id: 'proc_2', taskId: 't1', where: 'Fix the login timeout', ended: { at: '2026-10-10T09:01:00.000Z', code: 1 } },
        ],
      }),
    )
    await userEvent.click(await screen.findByRole('button', { name: /^Run\s*1 failed$/ }))
    const list = within(await screen.findByRole('dialog', { name: 'What it runs' }))
    expect(list.getByText('Exited 1')).toBeTruthy()
    await userEvent.click(list.getByRole('button', { name: 'Clear npm run dev' }))
    expect(client.clearLaunch).toHaveBeenCalledWith('proc_2')
  })

  it('leaves each run’s card in the coordinator’s thread: open the one that is up, stop it, run again a task’s that ended', async () => {
    const up = items.run({ launchId: 'proc_1', taskId: null, where: 'main', command: 'npm run dev', url: 'http://localhost:5199/' })
    const ended = items.run({
      launchId: 'proc_2',
      ended: { at: '2026-10-10T09:01:00.000Z', code: null, stopped: true, last: null },
    })
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot({ items: [up, ended] })) })
    const opened = vi.spyOn(window, 'open').mockImplementation(() => null)
    withServices(<WithSettings />, client)
    const main = within(await screen.findByRole('article', { name: 'Run of main' }))
    // Nothing says how the project runs: its front offers the ways to say what runs, and nothing to run.
    expect(screen.queryByRole('button', { name: 'Run npm run dev' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Run' })).toBeTruthy()
    await userEvent.click(main.getByRole('button', { name: 'Open localhost:5199' }))
    expect(opened).toHaveBeenCalledWith('http://localhost:5199/', '_blank')
    await userEvent.click(main.getByRole('button', { name: 'Stop npm run dev' }))
    expect(client.stopLaunch).toHaveBeenCalledWith('proc_1')
    // A task's run, stopped: it runs again in the task's worktree, its card here.
    const task = within(screen.getByRole('article', { name: 'Run of Fix the login timeout' }))
    expect(task.queryByRole('button', { name: 'Stop bun run dev' })).toBeNull()
    await userEvent.click(task.getByRole('button', { name: 'Run bun run dev again' }))
    expect(client.runProject).toHaveBeenCalledWith('p1', 't1', 'thc')
    opened.mockRestore()
  })
})

describe('the project’s bar', () => {
  it('keeps the parts the coordinator offers as a preset, by its name, with one press', async () => {
    const parts = {
      workspace: 'worktree' as const,
      checked: 'none' as const,
      end: 'draft' as const,
      shelf: 'board' as const,
      lead: 'claude-code/opus',
      reviewer: null,
      brief: '',
    }
    const offer = items.notice(
      {
        source: 'runtime',
        title: 'You set up these parts twice. Keep them as a preset?',
        description: 'opus change: a worktree, no review, a draft pull request, led by opus.',
        offer: { kind: 'preset', name: 'opus change', parts },
      },
      null,
    )
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot({ items: [offer] })) })
    withServices(<WithSettings />, client)
    await screen.findByText('You set up these parts twice. Keep them as a preset?')
    await userEvent.click(await screen.findByRole('button', { name: 'Keep it as “opus change”' }))
    await waitFor(() => expect(client.savePreset).toHaveBeenCalledWith({ name: 'opus change', parts }))
    expect(await screen.findByText('Kept as “opus change”: Settings has your presets.')).toBeTruthy()
  })

  it('draws a review the coordinator offered as its line, naming the task, and Add puts its reviewer on', async () => {
    const offer = items.notice(
      {
        source: 'runtime',
        title: 'Add a review of “Harden the prototype”?',
        offer: { kind: 'review', projectId: 'p1', taskId: 'r', agentId: 'codex', model: null },
      },
      null,
    )
    const task = {
      ...card(),
      state: 'open' as const,
      createdAt: '2026-10-01T09:00:00.000Z',
      settledAt: null,
      changed: null,
      here: [],
      taskId: 'r',
      title: 'Harden the prototype',
      reviewOffer: { key: 'review' as const, agentId: 'codex', model: null, skipped: false },
      plan: { ...card().plan!, steps: card().plan!.steps.filter((step) => step.key !== 'review') },
    }
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () => coordinatorSnapshot({ items: [offer] })),
      getBoard: vi.fn(async () => ({ cursor: 1, tasks: [task], calls: [], settledTotal: 0 })),
    })
    withServices(<WithSettings />, client)
    await screen.findByText('Add a review of “Harden the prototype”?')
    await userEvent.click(await screen.findByRole('button', { name: 'Add gpt-5.2-codex' }))
    await waitFor(() =>
      expect(client.changeTeam).toHaveBeenCalledWith('r', [
        ...task.plan.steps,
        { key: 'review', agentId: 'codex', model: null, skipped: false },
      ]),
    )
  })

  it('hides and shows the conversation by c and the board by b, keeps one showing, never while typing, and has no button to start a task', async () => {
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot()) })
    const view = withServices(<Project />, client)
    expect(await layout()).toEqual(['on', 'on', 'off'])
    await userEvent.keyboard('b')
    expect(await layout()).toEqual(['on, fixed', 'off', 'off, fixed'])
    // The only pane showing stays.
    await userEvent.keyboard('c')
    expect(await layout()).toEqual(['on, fixed', 'off', 'off, fixed'])
    await userEvent.keyboard('b')
    expect(await layout()).toEqual(['on', 'on', 'off'])
    await userEvent.keyboard('c')
    expect(await layout()).toEqual(['off', 'on, fixed', 'off, fixed'])
    // Home stays on whichever panes show.
    expect(screen.getByRole('radio', { name: 'Home' }).getAttribute('aria-checked')).toBe('true')
    // Hidden, the conversation leaves its composer under the board, where a c is only a letter.
    await userEvent.type(screen.getByRole('textbox', { name: /Tell the coordinator/ }), 'c')
    expect(await layout()).toEqual(['off', 'on, fixed', 'off, fixed'])
    // A task starts by telling the coordinator; nothing else starts one.
    expect(screen.queryByRole('button', { name: 'New task' })).toBeNull()
    view.unmount()
  })

  it('puts the conversation on the board’s right from ⋯ while both show, kept for the window', async () => {
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot()) })
    const view = withServices(<Project />, client)
    await pickLayout('Conversation on the right')
    expect(window.localStorage.getItem('althar.swapped')).toBe('true')
    // The divider is the conversation's left edge now.
    expect(screen.getByRole('separator', { name: 'Width of the conversation' }).className).toMatch(/start/)
    expect(await layout()).toEqual(['on', 'on', 'on'])
    // One pane alone has no sides: the choice stays as it was, and can't be changed.
    await pickLayout('Board')
    expect(await layout()).toEqual(['on, fixed', 'off', 'on, fixed'])
    expect(window.localStorage.getItem('althar.swapped')).toBe('true')
    window.localStorage.removeItem('althar.swapped')
    view.unmount()
  })

  it('sends from the composer under the board, and brings the conversation back for the answer', async () => {
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot()) })
    withServices(<Project room={Room.Board} />, client)
    const composer = await screen.findByRole('textbox', { name: /Tell the coordinator/ })
    expect(screen.queryByRole('region', { name: 'Conversation' })).toBeNull()
    await userEvent.type(composer, 'What needs me?{Enter}')
    await waitFor(() => expect(client.send).toHaveBeenCalled())
    expect(await screen.findByRole('region', { name: 'Conversation' })).toBeTruthy()
    expect(await layout()).toEqual(['on', 'on', 'off'])
  })

  it('tells the coordinator from under the board while a new aside is open, and brings the coordinator back for the answer', async () => {
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot()) })
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'New aside' }))
    expect(await screen.findByRole('textbox', { name: /Ask on the side/ })).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    ;(document.activeElement as HTMLElement | null)?.blur()
    await userEvent.keyboard('c')
    const composer = await screen.findByRole('textbox', { name: /Tell the coordinator/ })
    await userEvent.type(composer, 'What needs me?{Enter}')
    await waitFor(() => expect(client.send).toHaveBeenCalledWith(expect.objectContaining({ threadId: coordinatorSnapshot().threadId })))
    expect(client.send).toHaveBeenCalledTimes(1)
    expect(await layout()).toEqual(['on', 'on', 'off'])
    expect(screen.queryByRole('textbox', { name: /Ask on the side/ })).toBeNull()
    expect(screen.getByRole('textbox', { name: /Tell the coordinator/ })).toBeTruthy()
  })

  it('tells the coordinator from under the board while an aside is open, and brings the coordinator back, not the aside', async () => {
    const aside = {
      ...card(),
      state: 'open' as const,
      createdAt: '2026-11-11T11:00:00.000Z',
      settledAt: null,
      changed: null,
      here: [],
      taskId: 'a1',
      threadId: 'th-a1',
      title: 'A quick question',
      phase: 'ready' as const,
      scratch: true,
    }
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () => coordinatorSnapshot()),
      getBoard: vi.fn(async () => ({ cursor: 1, tasks: [aside], calls: [], settledTotal: 0 })),
    })
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('tab', { name: /A quick question/ }))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: /Tell the coordinator/ })).toBeNull())
    ;(document.activeElement as HTMLElement | null)?.blur()
    await userEvent.keyboard('c')
    const composer = await screen.findByRole('textbox', { name: /Tell the coordinator/ })
    await userEvent.type(composer, 'What needs me?{Enter}')
    await waitFor(() => expect(client.send).toHaveBeenCalledWith(expect.objectContaining({ threadId: coordinatorSnapshot().threadId })))
    expect(client.send).not.toHaveBeenCalledWith(expect.objectContaining({ threadId: 'th-a1' }))
    expect(await screen.findByRole('region', { name: 'Conversation' })).toBeTruthy()
    // The coordinator's own conversation is back, with its composer, not the aside's.
    expect(await screen.findByRole('tab', { name: 'Coordinator', selected: true })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: /Tell the coordinator/ })).toBeTruthy()
  })

  it('goes back to the home as it was left, from another view, or by showing a pane from ⋯', async () => {
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot()) })
    withServices(<Project room={Room.Board} />, client)
    const views = await screen.findByRole('radiogroup', { name: 'View' })
    await userEvent.click(within(views).getByRole('radio', { name: 'Settings' }))
    expect(await layout()).toEqual(['off', 'off', 'off, fixed'])
    await userEvent.click(within(views).getByRole('radio', { name: 'Home' }))
    expect(await layout()).toEqual(['off', 'on, fixed', 'off, fixed'])
    await userEvent.click(within(views).getByRole('radio', { name: 'Settings' }))
    await pickLayout('Conversation')
    expect(await layout()).toEqual(['on', 'on', 'off'])
  })

  it('opens on Home where no view was named or kept', async () => {
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot()) })
    withServices(<Project />, client)
    const views = await screen.findByRole('radiogroup', { name: 'View' })
    expect(within(views).getByRole('radio', { checked: true }).textContent).toMatch(/^Home/)
  })

  it('says which view it is on, to open on it again, and has only its views, its automations, its artifacts and its settings to choose from', async () => {
    const onRoomChange = vi.fn()
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot()) })
    withServices(<Project room={Room.Both} onRoomChange={onRoomChange} />, client)
    await waitFor(() => expect(onRoomChange).toHaveBeenLastCalledWith(Room.Both))
    const views = screen.getByRole('radiogroup', { name: 'View' })
    expect(
      within(views)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['Home', 'Automations', 'Artifacts', 'Settings'])
    // The conversation hidden, the board alone is the home's layout, kept too.
    await pickLayout('Conversation')
    expect(onRoomChange).toHaveBeenLastCalledWith(Room.Board)
    // Its settings are a view too, kept like the others to open on again.
    await userEvent.click(within(views).getByRole('radio', { name: 'Settings' }))
    expect(onRoomChange).toHaveBeenLastCalledWith(Room.Settings)
    expect(screen.getByRole('navigation', { name: 'Project settings' })).toBeTruthy()
  })
})

describe('the Talk room', () => {
  it('offers, once, to push a fork’s branches to the repository it came from, over the composer', async () => {
    const [api, forked] = repositories
    const offering = {
      ...forked!,
      fork: { fork: 'you/meridian-web', upstream: 'meridian/web', target: 'upstream' as const, canPush: true, offer: true },
    }
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => talk()), getRepositories: vi.fn(async () => [api!, offering]) })
    withServices(<Project room={Room.Talk} onTask={vi.fn()} />, client)
    expect(await screen.findByText('You can push to meridian/web now. Push new tasks’ branches there instead of your fork?')).toBeTruthy()
    vi.mocked(client.getRepositories).mockResolvedValue([api!, { ...offering, fork: { ...offering.fork, offer: false } }])
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(client.setRepository).toHaveBeenCalledWith({ projectId: 'p1', repositoryId: forked!.id, notNow: true })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Push there' })).toBeNull())
  })

  it("shows the coordinator's thread with each task's card, folds its finished work, and opens a task", async () => {
    const onTask = vi.fn()
    const { client, watching } = fakeClient({ getCoordinator: vi.fn(async () => talk()) })
    withServices(<Project room={Room.Talk} onTask={onTask} />, client)
    await screen.findByRole('heading', { name: 'meridian', level: 1 })
    // Its header's ⋯ says what it is made of, never where it is on this computer.
    await userEvent.click(await screen.findByRole('button', { name: 'More' }))
    const made = await screen.findByRole('menu', { name: 'More' })
    expect(
      within(made)
        .getAllByRole('menuitem')
        .map((part) => part.textContent),
    ).toEqual([expect.stringMatching(/^meridian-api/), expect.stringMatching(/^meridian-web/), expect.stringMatching(/^meridian-infra/)])
    expect(screen.queryByText(/\/code\/meridian/)).toBeNull()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'More' })).toBeNull())
    expect(screen.getByText('The call has no retry. I planned a task.')).toBeTruthy()
    expect(screen.queryByText('checkout.ts')).toBeNull()
    expect(screen.getByRole('button', { name: /^Worked for/ })).toBeTruthy()
    // A running task's card says where it is; a planned one shows its plan, with no reason beside the lead.
    expect(screen.getByText('Reviewing')).toBeTruthy()
    expect(screen.queryByText('It knows the code.')).toBeNull()
    expect(screen.getByText(/^Starts in \d+s$/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Open task/ }))
    expect(onTask).toHaveBeenCalledWith('th2')
    // The window watches once for every screen; the room doesn't watch on its own.
    expect(watching).toHaveLength(1)
  })

  it('draws each task as it stands: ready with its summary, waiting on you, stopped, held, or started by hand', async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () =>
        coordinatorSnapshot({
          items: [
            items.card(card({ phase: 'ready', summary: 'Added the retry.\nAnd a test.', startedAt: '2026-09-29T11:00:00.000Z' })),
            items.card(card({ taskId: 't3', slug: 'deploy', title: 'Deploy', phase: 'waiting', step: 'implement' })),
            items.card(card({ taskId: 't4', slug: 'by-hand', title: 'By hand', phase: 'stopped', plan: null, lead: null, branch: null })),
            items.card(
              card({ taskId: 't5', slug: 'later', title: 'Later', phase: 'held', plan: { ...card().plan!, id: 'pln5', startsAt: null } }),
            ),
            items.card(
              card({
                taskId: 't6',
                slug: 'reset',
                title: 'Reset',
                phase: 'running',
                step: 'implement',
                waits: { agentId: 'claude-code', until: '2026-10-03T15:40:00.000Z' },
              }),
            ),
          ],
        }),
      ),
    })
    withServices(<Project room={Room.Talk} />, client)
    expect(await screen.findByText('Added the retry.')).toBeTruthy()
    expect(screen.getByText('Ready')).toBeTruthy()
    expect(screen.getByText('Needs you')).toBeTruthy()
    expect(screen.getByText('Implementing')).toBeTruthy()
    expect(screen.getByText('Stopped')).toBeTruthy()
    expect(screen.getByText('Held', { exact: true })).toBeTruthy()
    expect(screen.getByText(`Claude Code is out of usage until ${clock('2026-10-03T15:40:00.000Z')}`)).toBeTruthy()
    // Held for the reset, it is paused, as on the board, not running.
    expect(screen.getByText('Paused')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(client.startPlan).toHaveBeenCalledWith('pln5')
  })

  it('files, changes and discards an issue the coordinator drafted, and shows it filed or why it wasn’t', async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () =>
        coordinatorSnapshot({
          items: [
            items.draft(),
            items.draft({ draftId: 'idr_2', title: 'Flaky checkout test', state: 'failed', error: 'Linear didn’t answer.' }),
            items.draft({
              draftId: 'idr_3',
              title: 'Retry webhooks',
              state: 'filed',
              issue: { key: 'MER-240', url: 'https://linear.app/m/issue/MER-240' },
            }),
            items.draft({ draftId: 'idr_4', title: 'Rename the env var', state: 'discarded' }),
          ],
        }),
      ),
    })
    withServices(<Project room={Room.Talk} />, client)
    const pending = (await screen.findByRole('heading', { name: 'Refunds skip the rate limiter' })).closest('article')
    expect(pending).toBeTruthy()
    const card = within(pending as HTMLElement)
    expect(card.getByText('Issue draft · Linear · Meridian')).toBeTruthy()
    // Its description is drawn as Markdown.
    expect(card.getByText('refunds').tagName).toBe('STRONG')
    expect(card.getByText('Labels: payments')).toBeTruthy()
    await userEvent.click(card.getByRole('button', { name: 'File issue' }))
    expect(client.fileIssueDraft).toHaveBeenCalledWith('idr_1')
    await userEvent.click(card.getByRole('button', { name: 'Edit' }))
    const title = card.getByRole('textbox', { name: 'Title' })
    await userEvent.clear(title)
    await userEvent.type(title, 'Refunds bypass the limiter')
    await userEvent.type(card.getByRole('textbox', { name: /Labels/ }), ', billing')
    await userEvent.click(card.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(client.changeIssueDraft).toHaveBeenCalledWith('idr_1', {
        title: 'Refunds bypass the limiter',
        body: 'Charges go through it; **refunds** don’t.',
        labels: ['payments', 'billing'],
      }),
    )
    await userEvent.click(card.getByRole('button', { name: 'Discard' }))
    expect(client.discardIssueDraft).toHaveBeenCalledWith('idr_1')

    // Not filed: why, and filing it again.
    expect(screen.getByText(/Couldn’t file it on Linear\. Linear didn’t answer\./)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'File again' }))
    expect(client.fileIssueDraft).toHaveBeenCalledWith('idr_2')
    // Filed: its key, as a link to it; discarded: said so.
    expect(screen.getByRole('link', { name: /MER-240/ }).getAttribute('href')).toBe('https://linear.app/m/issue/MER-240')
    expect(screen.getByText('Issue draft discarded')).toBeTruthy()
  })

  it('applies or discards the coordinator’s changes to issues, several on one card, and folds applied ones to a line', async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () =>
        coordinatorSnapshot({ items: [items.changes(), items.changes({ changesId: 'ich_2', state: 'applied' })] }),
      ),
    })
    withServices(<Project room={Room.Talk} />, client)
    const card = within(await screen.findByRole('article', { name: 'Issue changes · Linear' }))
    expect(
      card.getByText((_, node) => node?.tagName === 'SPAN' && node.textContent === 'Status Done' && node.childElementCount > 0),
    ).toBeTruthy()
    expect(
      card.getByText((_, node) => node?.tagName === 'SPAN' && node.textContent === 'Priority Low' && node.childElementCount > 0),
    ).toBeTruthy()
    await userEvent.click(card.getByRole('button', { name: 'Apply' }))
    expect(client.applyIssueChanges).toHaveBeenCalledWith('ich_1')
    await userEvent.click(card.getByRole('button', { name: 'Discard' }))
    expect(client.discardIssueChanges).toHaveBeenCalledWith('ich_1')
    expect(screen.getByText('Changed')).toBeTruthy()
  })

  it('holds, changes and starts a plan before it starts on its own', async () => {
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot({ items: [items.card(card())] })) })
    withServices(<Project room={Room.Talk} />, client)
    // Each step's agent, model and effort.
    await userEvent.click(await screen.findByRole('button', { name: 'Review: gpt-5.2-codex Medium' }))
    await userEvent.click(await screen.findByRole('radio', { name: 'High' }))
    await waitFor(() =>
      expect(client.changePlan).toHaveBeenCalledWith(
        'pln1',
        [
          { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
          { key: 'review', agentId: 'codex', model: null, effort: 'high', skipped: false },
        ],
        null,
      ),
    )
    await userEvent.click(await screen.findByRole('radio', { name: /Claude Code default/ }))
    await waitFor(() =>
      expect(client.changePlan).toHaveBeenLastCalledWith(
        'pln1',
        [
          { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
          { key: 'review', agentId: 'claude-code', model: 'default', effort: null, skipped: false },
        ],
        null,
      ),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(() =>
      expect(client.changePlan).toHaveBeenLastCalledWith(
        'pln1',
        [
          { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
          { key: 'review', agentId: 'claude-code', model: 'default', effort: null, skipped: true },
        ],
        null,
      ),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Hold' }))
    expect(client.holdPlan).toHaveBeenCalledWith('pln1')
    await userEvent.click(screen.getByRole('button', { name: 'Start now' }))
    expect(client.startPlan).toHaveBeenCalledWith('pln1')
  })

  it('plans a review of someone else’s pull request with its one lead, offering every agent', async () => {
    const review = card({
      slug: 'review-1199-send-back',
      title: 'Review #1199: Send back won’t restart a dead lead session',
      kind: 'review',
      reviewing: {
        product: 'github',
        repository: 'meridian/api',
        number: 1199,
        url: 'https://github.com/meridian/api/pull/1199',
        title: 'Send back won’t restart a dead lead session',
        author: 'ninemate',
        outside: true,
        additions: 58,
        deletions: 20,
        findings: 0,
        blocking: 0,
        verdict: null,
        posted: null,
      },
      plan: {
        ...card().plan!,
        steps: [{ key: 'implement', agentId: 'claude-code', model: null, skipped: false }],
        reason: 'Strong at reading.',
      },
    })
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot({ items: [items.card(review)] })) })
    withServices(<Project room={Room.Talk} />, client)
    // One step, which reviews, with why; nothing to pick for when it is done.
    const lead = await screen.findByRole('button', { name: /^Lead for this task: / })
    expect(screen.getByText('Review')).toBeTruthy()
    expect(screen.queryByText('Strong at reading.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull()
    expect(screen.queryByText('When the work is done')).toBeNull()
    // Any agent may lead it: Codex is offered too.
    await userEvent.click(lead)
    expect(await screen.findByRole('radio', { name: /Claude Code default/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /gpt-5\.2-codex/ })).toBeTruthy()
    await userEvent.click(screen.getByRole('radio', { name: 'High' }))
    await waitFor(() =>
      expect(client.changePlan).toHaveBeenLastCalledWith(
        'pln1',
        [{ key: 'implement', agentId: 'claude-code', model: null, effort: 'high', skipped: false }],
        null,
      ),
    )
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Hold' }))
    expect(client.holdPlan).toHaveBeenCalledWith('pln1')
    await userEvent.click(screen.getByRole('button', { name: 'Start now' }))
    expect(client.startPlan).toHaveBeenCalledWith('pln1')
  })

  it('points a plan at another branch from its last row, or at one it makes from the default branch (ADR-093)', async () => {
    const planned = card({
      plan: { ...card().plan!, end: 'draft', defaultBranch: 'main', branches: ['main', 'release/0.8.0'], repositoryId: 'repo_api' },
    })
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot({ items: [items.card(planned)] })) })
    withServices(<Project room={Room.Talk} />, client)
    // After how the work ends: Open a draft PR into main.
    await userEvent.click(await screen.findByRole('button', { name: 'Works toward: main' }))
    await userEvent.click(await screen.findByRole('option', { name: 'release/0.8.0' }))
    await waitFor(() => expect(client.changePlan).toHaveBeenLastCalledWith('pln1', expect.anything(), 'draft', undefined, 'release/0.8.0'))
    // One it doesn't have is made first, then the plan goes toward it.
    await userEvent.click(await screen.findByRole('button', { name: 'Works toward: release/0.8.0' }))
    await userEvent.type(screen.getByRole('combobox', { name: 'Find or name a branch' }), 'hotfix/0.8.1{Enter}')
    expect(await screen.findByRole('button', { name: 'Works toward: hotfix/0.8.1' })).toBeTruthy()
    await waitFor(() => expect(client.changePlan).toHaveBeenLastCalledWith('pln1', expect.anything(), 'draft', undefined, 'hotfix/0.8.1'))
    expect(client.createBranch).toHaveBeenCalledWith({ projectId: 'p1', repositoryId: 'repo_api', branch: 'hotfix/0.8.1' })
    // Held before the host is asked, so its countdown can't start it toward the old branch meanwhile.
    expect(client.holdPlan).toHaveBeenCalledWith('pln1')
    expect(vi.mocked(client.holdPlan).mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(client.createBranch).mock.invocationCallOrder[0]!,
    )
  })

  it('leaves a plan held, toward its old branch, where the host refuses the branch to make', async () => {
    const planned = card({
      plan: { ...card().plan!, end: 'draft', defaultBranch: 'main', branches: ['main'], repositoryId: 'repo_api' },
    })
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () => coordinatorSnapshot({ items: [items.card(planned)] })),
      createBranch: vi.fn(async () => {
        throw new ApiError({ reason: 'BranchRefused', message: 'meridian/api didn’t take the new branch: protected' })
      }),
    })
    withServices(<Project room={Room.Talk} />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Works toward: main' }))
    await userEvent.type(screen.getByRole('combobox', { name: 'Find or name a branch' }), 'release/0.9.0{Enter}')
    expect(await screen.findByText(/didn’t take the new branch: protected/)).toBeTruthy()
    expect(client.holdPlan).toHaveBeenCalledWith('pln1')
    expect(client.changePlan).not.toHaveBeenCalled()
  })

  it('lets the person hold a started Local plan that waits for its checkout, saying what it waits for', async () => {
    const waitingCard = card({
      phase: 'running',
      step: 'implement',
      queued: null,
      planWaits: true,
      holdable: true,
      waitsForCheckout: { why: 'taken', by: { taskId: 'x', title: 'Dark mode' } },
    })
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot({ items: [items.card(waitingCard)] })) })
    withServices(<Project room={Room.Talk} />, client)
    expect(await screen.findByText(/Dark mode/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Start now' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Hold' }))
    expect(client.holdPlan).toHaveBeenCalledWith('pln1')
  })

  it('lets the person change a started plan while its first step waits for a free agent, saying what it waits for', async () => {
    const waitingCard = card({ phase: 'running', step: 'implement', queued: { busy: 4, atOnce: 4 }, planWaits: true })
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot({ items: [items.card(waitingCard)] })) })
    withServices(<Project room={Room.Talk} />, client)
    expect(await screen.findByText('Waiting: 4 of 4 agents busy on this Mac')).toBeTruthy()
    // Nothing to start: it starts on its own once an agent is free. It can still be held, which takes it out of the line.
    expect(screen.queryByRole('button', { name: 'Start now' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Hold' }))
    expect(client.holdPlan).toHaveBeenCalledWith('pln1')
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(() =>
      expect(client.changePlan).toHaveBeenLastCalledWith(
        'pln1',
        [
          { key: 'implement', agentId: 'claude-code', model: null, skipped: false },
          { key: 'review', agentId: 'codex', model: null, skipped: true },
        ],
        null,
      ),
    )
  })

  it('keeps a card’s steps while a later step waits for a free agent, saying it waits and not that it runs', async () => {
    const waitingCard = card({ phase: 'running', step: 'review', queued: { busy: 4, atOnce: 4 }, branch: 'althar/midway' })
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot({ items: [items.card(waitingCard)] })) })
    withServices(<Project room={Room.Talk} />, client)
    expect(await screen.findByText('Waiting: 4 of 4 agents busy on this Mac')).toBeTruthy()
    const track = screen.getByRole('list', { name: 'Steps' })
    expect(track.getAttribute('data-status')).toBe('queued')
    // The branch is on the task's own view, not on the card.
    expect(screen.queryByText('althar/midway')).toBeNull()
  })

  it('shows the effort the coordinator picked for a step as one the person chose, keeps it, and lets the person change it', async () => {
    const plan = {
      ...card().plan!,
      steps: [
        { key: 'implement' as const, agentId: 'claude-code', model: 'opus', effort: 'high', skipped: false },
        { key: 'review' as const, agentId: 'codex', model: null, skipped: false },
      ],
    }
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot({ items: [items.card(card({ plan }))] })) })
    withServices(<Project room={Room.Talk} />, client)
    // The lead at the coordinator's effort; the review, which it left out, at the model's own.
    expect(await screen.findByRole('button', { name: 'Lead for this task: Claude Opus High' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Review: gpt-5.2-codex Medium' })).toBeTruthy()
    // Skipping the review keeps it.
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(() =>
      expect(client.changePlan).toHaveBeenLastCalledWith(
        'pln1',
        [
          { key: 'implement', agentId: 'claude-code', model: 'opus', effort: 'high', skipped: false },
          { key: 'review', agentId: 'codex', model: null, skipped: true },
        ],
        null,
      ),
    )
    // The person changes it as they would their own.
    await userEvent.click(screen.getByRole('button', { name: 'Lead for this task: Claude Opus High' }))
    await userEvent.click(await screen.findByRole('radio', { name: 'Low' }))
    await waitFor(() =>
      expect(client.changePlan).toHaveBeenLastCalledWith(
        'pln1',
        [
          { key: 'implement', agentId: 'claude-code', model: 'opus', effort: 'low', skipped: false },
          { key: 'review', agentId: 'codex', model: null, skipped: true },
        ],
        null,
      ),
    )
  })

  it('says beside a running task’s lead how hard it thinks, and nothing where that isn’t known', async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () =>
        coordinatorSnapshot({
          items: [
            // A mini task, which has no plan's card to show it.
            items.card(card({ phase: 'running', step: 'implement', plan: null, leadModel: 'opus', leadEffort: 'high' })),
            items.card(card({ taskId: 't2', slug: 'tidy', title: 'Tidy', phase: 'running', step: 'review', leadModel: 'sonnet' })),
          ],
        }),
      ),
    })
    withServices(<Project room={Room.Talk} />, client)
    const running = await screen.findByRole('article', { name: 'Add a retry' })
    expect(within(running).getByText('Claude Opus')).toBeTruthy()
    expect(within(running).getByText('High')).toBeTruthy()
    const tidy = screen.getByRole('article', { name: 'Tidy' })
    expect(within(tidy).getByText('Claude Sonnet')).toBeTruthy()
    expect(within(tidy).queryByText(/^(Low|Medium|High)$/)).toBeNull()
  })

  it('names an OpenCode Go lead in people’s words before OpenCode lists its models', async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () =>
        coordinatorSnapshot({
          items: [
            // The id as OpenCode stores it, while its models aren't reported yet.
            items.card(
              card({ phase: 'running', step: 'implement', plan: null, lead: 'opencode', leadModel: 'opencode-go/deepseek-v4.1-flash' }),
            ),
          ],
        }),
      ),
    })
    withServices(<Project room={Room.Talk} />, client)
    const running = await screen.findByRole('article', { name: 'Add a retry' })
    expect(await within(running).findByText('DeepSeek V4.1 Flash')).toBeTruthy()
    expect(within(running).queryByText(/opencode-go/)).toBeNull()
  })

  it('talks to the coordinator on the agent last used, or on another the person picks', async () => {
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot({ session: { ...session, held: false } })) })
    withServices(<Project room={Room.Talk} />, client)
    await screen.findByRole('button', { name: /^Coordinator: / })
    const box = screen.getByRole('textbox', { name: 'Tell the coordinator something' })
    await userEvent.type(box, 'Add a retry{Enter}')
    await waitFor(() => expect(client.send).toHaveBeenCalledWith({ threadId: 'thc', body: 'Add a retry', disposition: 'after_current' }))
    // A stale session summary is not held: start the coordinator on the picked agent before sending.
    expect(client.startSession).toHaveBeenCalledWith({ threadId: 'thc', agentId: 'claude-code' })
    expect(vi.mocked(client.startSession).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(client.send).mock.invocationCallOrder[0] ?? 0)

    await userEvent.click(screen.getByRole('button', { name: 'Coordinator: Claude Code default Medium' }))
    await userEvent.click(await screen.findByRole('radio', { name: /gpt-5\.2-codex/ }))
    expect(screen.getByRole('button', { name: 'Coordinator: gpt-5.2-codex Medium' })).toBeTruthy()
    await userEvent.click(await screen.findByRole('radio', { name: 'Low' }))
    await userEvent.keyboard('{Escape}')
    await userEvent.type(box, 'And a test{Enter}')
    await waitFor(() =>
      expect(client.startSession).toHaveBeenCalledWith({ threadId: 'thc', agentId: 'codex', model: 'gpt-5.2-codex', effort: 'low' }),
    )
    expect(client.send).toHaveBeenLastCalledWith({ threadId: 'thc', body: 'And a test', disposition: 'after_current' })
  })

  it('keeps the effort picked on another of the agent’s models only where that model offers it', async () => {
    const sonnetLowOrMedium = models.map((offered) =>
      offered.agentId === 'claude-code'
        ? {
            ...offered,
            models: offered.models.map((model) => (model.id === 'sonnet' ? { ...model, efforts: efforts('Low', 'Medium') } : model)),
          }
        : offered,
    )
    const { client } = fakeClient({ getModels: vi.fn(async () => sonnetLowOrMedium) })
    withServices(<Project room={Room.Talk} />, client)
    const use = async (from: string, model: string) => {
      await userEvent.click(await screen.findByRole('button', { name: from }))
      await userEvent.click(screen.getByRole('button', { name: /All models/ }))
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: `Use ${model}` }))
    }
    await userEvent.click(await screen.findByRole('button', { name: 'Coordinator: Claude Code default Medium' }))
    await userEvent.click(await screen.findByRole('radio', { name: 'High' }))
    await userEvent.keyboard('{Escape}')
    await use('Coordinator: Claude Code default High', 'Claude Opus')
    // Sonnet has no High: it starts at its own.
    await use('Coordinator: Claude Opus High', 'Claude Sonnet')
    expect(await screen.findByRole('button', { name: 'Coordinator: Claude Sonnet Medium' })).toBeTruthy()
    await userEvent.type(screen.getByRole('textbox', { name: 'Tell the coordinator something' }), 'Hello{Enter}')
    await waitFor(() => expect(client.startSession).toHaveBeenCalledWith({ threadId: 'thc', agentId: 'claude-code', model: 'sonnet' }))
  })

  it('sends images dropped on its composer with what the person says to it', async () => {
    const { client } = fakeClient()
    withServices(<Project room={Room.Talk} />, client)
    const box = await screen.findByRole('textbox', { name: 'Tell the coordinator something' })
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 2,
    ])
    fireEvent.paste(box, { clipboardData: { files: [new File([png], '', { type: 'image/png' })], types: ['Files'] } })
    expect(await screen.findByRole('img', { name: 'Pasted image' })).toBeTruthy()
    await userEvent.type(box, 'This is the bug{Enter}')
    await waitFor(() =>
      expect(client.send).toHaveBeenCalledWith({
        threadId: 'thc',
        body: 'This is the bug',
        disposition: 'after_current',
        images: [{ data: Buffer.from(png).toString('base64'), name: 'Pasted image' }],
      }),
    )
    expect(screen.getByRole('button', { name: 'View Pasted image' })).toBeTruthy()
  })

  it('puts what the person said, and its images, back in its composer when Althar didn’t take it', async () => {
    const { client } = fakeClient()
    vi.mocked(client.send).mockRejectedValueOnce(new Error('Althar is restarting.'))
    withServices(<Project room={Room.Talk} />, client)
    const box = await screen.findByRole('textbox', { name: 'Tell the coordinator something' })
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 2,
    ])
    fireEvent.drop(box, { dataTransfer: { types: ['Files'], files: [new File([png], 'bug.png', { type: 'image/png' })] } })
    expect(await screen.findByRole('img', { name: 'bug.png' })).toBeTruthy()
    await userEvent.type(box, 'This is the bug{Enter}')
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe('This is the bug'))
    expect(screen.getByRole('list', { name: '1 attachment to send' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'bug.png' })).toBeTruthy()
  })

  it('keeps the note unsent when the coordinator cannot start, and accepts one already starting', async () => {
    const { client } = fakeClient()
    vi.mocked(client.startSession).mockRejectedValueOnce(new ApiError({ reason: 'SessionFailed', message: "Claude Code couldn't start." }))
    withServices(<Project room={Room.Talk} />, client)
    const box = await screen.findByRole('textbox', { name: 'Tell the coordinator something' })
    await userEvent.type(box, 'Plan it{Enter}')
    expect(await screen.findByText("Claude Code couldn't start.")).toBeTruthy()
    expect(client.send).not.toHaveBeenCalled()
    expect((box as HTMLTextAreaElement).value).toBe('Plan it')
    // A session that started between the read and start attempt takes this note next.
    vi.mocked(client.startSession).mockRejectedValueOnce(
      new ApiError({ reason: 'SessionRunning', message: 'An agent is already working on this task.' }),
    )
    await userEvent.type(box, '{Enter}')
    await waitFor(() => expect(client.send).toHaveBeenCalledWith({ threadId: 'thc', body: 'Plan it', disposition: 'after_current' }))
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe(''))
    expect(vi.mocked(client.startSession).mock.invocationCallOrder[1]).toBeLessThan(vi.mocked(client.send).mock.invocationCallOrder[0] ?? 0)
  })

  it("says when the agent it last ran on isn't signed in, and starts it on one that is", async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () =>
        coordinatorSnapshot({ suggested: { agentId: 'opencode', agentName: 'OpenCode', model: null, effort: null, available: false } }),
      ),
    })
    withServices(<Project room={Room.Talk} />, client)
    expect(await screen.findByText("OpenCode isn't signed in. Using Claude Code.")).toBeTruthy()
    await userEvent.type(screen.getByRole('textbox', { name: 'Tell the coordinator something' }), 'Hello{Enter}')
    await waitFor(() => expect(client.startSession).toHaveBeenCalledWith({ threadId: 'thc', agentId: 'claude-code' }))
  })

  it('shows the coordinator thinking where its reply will start, and its last reply as it was', async () => {
    const asked = { ...items.you('And the docs?'), createdAt: new Date().toISOString() }
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () =>
        coordinatorSnapshot({
          session: { ...session, turnRunning: true, turnStartedAt: asked.createdAt },
          items: [
            items.you('Why is checkout slow?'),
            items.tool({ title: 'Read checkout.ts' }),
            items.says('The call has no retry.'),
            asked,
          ],
        }),
      ),
    })
    withServices(<Project room={Room.Talk} />, client)
    const thinking = await screen.findByText('Thinking')
    expect(thinking.closest('article')).toBe(screen.getAllByRole('article').at(-1))
    // The reply before it is over: its work folded under how long it took, not at work again.
    expect(screen.getByRole('button', { name: /Worked for/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Working for/ })).toBeNull()
  })

  it('folds the coordinator’s work under how long it took as it starts to answer, its turn still running', async () => {
    const said = items.says('Two tasks are running.')
    const answer: ThreadItem = said.kind === 'agent_message' ? { ...said, content: { ...said.content, answer: true } } : said
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () =>
        coordinatorSnapshot({
          session: { ...session, turnRunning: true },
          items: [items.you('What runs?'), items.says('I’ll check the board.'), items.tool({ title: 'Read checkout.ts' }), answer],
        }),
      ),
    })
    withServices(<Project room={Room.Talk} />, client)
    expect(await screen.findByText('Two tasks are running.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Worked for / }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: /^Working for / })).toBeNull()
    // What it said on the way folded with the rest of its work.
    expect(screen.queryByText('I’ll check the board.')).toBeNull()
  })

  it('lets go of Thinking once the coordinator’s turn ended with nothing said, as when it was interrupted before its first word', async () => {
    const asked = { ...items.you('And the docs?'), createdAt: new Date(Date.now() - 5000).toISOString() }
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () =>
        coordinatorSnapshot({
          session: { ...session, turnEndedAt: new Date().toISOString() },
          items: [items.you('Why is checkout slow?'), items.says('The call has no retry.'), asked],
        }),
      ),
    })
    withServices(<Project room={Room.Talk} />, client)
    expect(await screen.findByText('And the docs?')).toBeTruthy()
    expect(screen.queryByText('Thinking')).toBeNull()
    expect(screen.getByRole('textbox', { name: /^Tell the coordinator/ })).toBeTruthy()
  })

  it('interrupts it, sends now, and moves it to another agent while it works', async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () =>
        coordinatorSnapshot({
          session: { ...session, turnRunning: true },
          items: [items.you('Plan it', { state: 'queued', interrupting: false }), items.tool({ status: 'in_progress' })],
        }),
      ),
    })
    withServices(<Project room={Room.Talk} />, client)
    const busy = await screen.findByRole('textbox', { name: 'Add to the queue, or interrupt the coordinator' })
    expect(screen.getByText('Queued')).toBeTruthy()
    // While it works, its work folds too, under how long it has worked so far, with one line for what it is doing now.
    expect(screen.getByRole('button', { name: /^Working for / })).toBeTruthy()
    expect(screen.getByText('Reading checkout.ts')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Interrupt/ }))
    expect(client.interrupt).toHaveBeenCalledWith('thc')
    await userEvent.type(busy, 'Stop{Meta>}{Enter}{/Meta}')
    await waitFor(() => expect(client.send).toHaveBeenCalledWith({ threadId: 'thc', body: 'Stop', disposition: 'interrupt_and_continue' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Coordinator: Claude Code default Medium' }))
    await userEvent.click(await screen.findByRole('radio', { name: 'High' }))
    await waitFor(() => expect(client.setEffort).toHaveBeenCalledWith({ threadId: 'thc', effort: 'high' }))
    // At work, another agent takes over only with what the person says next.
    await userEvent.click(screen.getByRole('radio', { name: /gpt-5\.2-codex, via Codex/ }))
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByText(/gpt-5\.2-codex takes over from Claude Code default when you send\./)).toBeTruthy()
    expect(client.switchAgent).not.toHaveBeenCalled()
    await userEvent.type(busy, 'Plan it{Enter}')
    await waitFor(() =>
      expect(client.switchAgent).toHaveBeenCalledWith({ threadId: 'thc', agentId: 'codex', model: 'gpt-5.2-codex', body: 'Plan it' }),
    )
  })

  it('takes back what waits its turn: Edit puts it back in the composer, and one the coordinator has already says so', async () => {
    const first = items.you('Rename the flag', { state: 'queued', interrupting: false })
    const second = items.you('Ship it', { state: 'queued', interrupting: false })
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () =>
        coordinatorSnapshot({ session: { ...session, turnRunning: true }, items: [first, second, items.tool({ status: 'in_progress' })] }),
      ),
      takeBack: vi.fn(async (itemId: string) =>
        itemId === second.id
          ? Promise.reject(
              new ApiError({ reason: 'AlreadyDelivered', message: "The agent already has that message, so it can't be taken back." }),
            )
          : undefined,
      ),
    })
    withServices(<Project room={Room.Talk} />, client)
    const composer = await screen.findByRole('textbox', { name: 'Add to the queue, or interrupt the coordinator' })
    // Behind a running turn, waiting messages are in the composer's queue rather than the thread.
    expect(screen.queryByText('Queued')).toBeNull()
    const queue = screen.getByRole('region', { name: '2 queued' })
    // Waiting, it is in the composer's queue rather than the thread.
    expect(within(queue).getByText('Rename the flag')).toBeTruthy()
    await userEvent.type(composer, 'Also the docs')
    await userEvent.click(within(queue).getAllByRole('button', { name: 'Edit' })[0] as HTMLElement)
    expect(client.takeBack).toHaveBeenCalledWith(first.id)
    // What was written stays, with the message after it to change.
    await waitFor(() => expect((composer as HTMLTextAreaElement).value).toBe('Also the docs\n\nRename the flag'))
    expect(screen.queryByRole('button', { name: 'Take “Rename the flag” out of the queue' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Take “Ship it” out of the queue' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('already has that message'))
  })

  it("reads a changed item alone, its head for anything else, and the cards when the project's tasks move", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const queued = items.you('Next', { state: 'queued', interrupting: false })
      const { client, emit } = fakeClient({
        // Althar no longer holds the coordinator, so what waits for it stays queued.
        getCoordinator: vi.fn(async () =>
          coordinatorSnapshot({ session: { ...session, held: false }, items: [queued, items.card(card(), 'c1')] }),
        ),
        getThreadItem: vi.fn(async (_threadId: string, itemId: string) =>
          itemId === queued.id ? { ...queued, input: { state: 'delivered' as const, interrupting: false } } : items.says('Read again'),
        ),
      })
      withServices(<Project room={Room.Talk} />, client)
      await screen.findByText('Queued')
      act(() => emit(streamed('live', 'Thinking it over', 'thc')))
      expect(await screen.findByText('Thinking it over')).toBeTruthy()
      // How full the coordinator's context is shows in its composer as it says.
      act(() => emit({ _tag: 'Context', threadId: 'thc', used: 100_000, size: 1_000_000 }))
      expect(await screen.findByRole('button', { name: 'Context 10% used' })).toBeTruthy()
      act(() => {
        emit(changed('thread_item', 'i9', 'thc'))
        emit(changed('provider_session', 's1', 'thc'))
        emit(changed('user_input', 'u1', 'thc'))
        emit(changed('run', 'r1', 'th1'))
        emit(changed('run', 'r9', 'th9', 'p9'))
        emit(changed('thread_item', 'x', 'th1'))
        emit(streamed('x', 'Not here', 'th1'))
      })
      await vi.advanceTimersByTimeAsync(50)
      await waitFor(() => expect(client.getThreadItem).toHaveBeenCalledTimes(3))
      expect(
        vi
          .mocked(client.getThreadItem)
          .mock.calls.map(([, itemId]) => itemId)
          .toSorted(),
      ).toEqual(['c1', 'i9', queued.id].toSorted())
      expect(client.getCoordinator).toHaveBeenLastCalledWith('p1', { limit: 0 })
      await waitFor(() => expect(screen.queryByText('Queued')).toBeNull())
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the coordinator thinking on what waits for it idle, and the turn on it only once that is read as delivered', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const sent = items.you('Why is checkout slow?', { state: 'queued', interrupting: false })
      let delivered: (item: ThreadItem) => void = () => undefined
      const { client, emit } = fakeClient({
        getCoordinator: vi
          .fn(async () =>
            coordinatorSnapshot({ session: { ...session, turnRunning: true, turnStartedAt: new Date().toISOString() }, items: [] }),
          )
          .mockResolvedValueOnce(coordinatorSnapshot({ session, items: [sent] })),
        getThreadItem: vi.fn(() => new Promise<ThreadItem>((resolve) => (delivered = resolve))),
      })
      withServices(<Project room={Room.Talk} />, client)
      // Read before the runtime gave it to the coordinator, idle, it is being read: the coordinator thinks; then the turn on it starts.
      expect(await screen.findByText('Thinking')).toBeTruthy()
      expect(screen.queryByText('Queued')).toBeNull()
      act(() => emit(changed('provider_session', 's1', 'thc')))
      await vi.advanceTimersByTimeAsync(50)
      await waitFor(() => expect(client.getThreadItem).toHaveBeenCalledWith('thc', sent.id))
      // The head that says so waits for the message read again: it doesn't jump into the composer's queue meanwhile.
      expect(screen.queryByRole('region', { name: 'Queued' })).toBeNull()
      expect(screen.getByText('Why is checkout slow?')).toBeTruthy()
      act(() => delivered({ ...items.you('Why is checkout slow?', { state: 'delivered', interrupting: false }), id: sent.id }))
      await waitFor(() => expect(screen.getByRole('textbox', { name: /^Add to the queue/ })).toBeTruthy())
      expect(screen.getByText('Thinking')).toBeTruthy()
      expect(screen.queryByRole('region', { name: 'Queued' })).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a card as it was read last, when an earlier read comes back after it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      let answerFirst: (item: ReturnType<typeof items.card>) => void = () => undefined
      const getThreadItem = vi
        .fn()
        .mockImplementationOnce(() => new Promise((resolve) => (answerFirst = resolve)))
        .mockImplementation(async () => items.card(card({ phase: 'ready', summary: 'Retried twice.' }), 'c1'))
      const { client, emit } = fakeClient({
        getCoordinator: vi.fn(async () =>
          coordinatorSnapshot({ items: [items.card(card({ phase: 'running', step: 'implement' }), 'c1')] }),
        ),
        getThreadItem,
      })
      withServices(<Project room={Room.Talk} />, client)
      await screen.findByText('Implementing')
      act(() => emit(changed('thread_item', 'c1', 'thc')))
      await vi.advanceTimersByTimeAsync(50)
      act(() => emit(changed('thread_item', 'c1', 'thc')))
      await vi.advanceTimersByTimeAsync(50)
      expect(await screen.findByText('Retried twice.')).toBeTruthy()
      // The first read answers last, with the card as it was then: it doesn't put it back.
      await act(async () => answerFirst(items.card(card({ phase: 'running', step: 'implement' }), 'c1')))
      expect(screen.getByText('Retried twice.')).toBeTruthy()
      expect(screen.queryByText('Implementing')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows earlier items when asked', async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async (_projectId: string, page?: { before?: number }) =>
        page?.before === undefined
          ? coordinatorSnapshot({ items: [items.says('The newest.')], earlier: true })
          : coordinatorSnapshot({ items: [items.says('The oldest.')], earlier: false }),
      ),
    })
    if (vi.isMockFunction(window.getComputedStyle)) vi.mocked(window.getComputedStyle).mockRestore()
    const computed = window.getComputedStyle
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = computed(element)
      Object.defineProperty(style, 'overflowY', {
        value: element.classList.contains('scroll') || element.getAttribute('class')?.includes('scroll_') ? 'auto' : 'visible',
        configurable: true,
      })
      return style
    })
    withServices(<Project room={Room.Talk} />, client)
    await screen.findByText('The newest.')
    scrollEarlier()
    expect(await screen.findByText('The oldest.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show' })).toBeNull()
  })
})

describe('what can go wrong', () => {
  it('asks for an agent to be signed in when none is', async () => {
    const { client } = fakeClient({
      status: vi.fn(async () => ({ ...status, agents: agents.map((agent) => ({ ...agent, signIn: 'signed_out' as const })) })),
    })
    const ways = { signIn: vi.fn(), agents: vi.fn(), connections: vi.fn() }
    withServices(<Project room={Room.Talk} ways={ways} />, client)
    expect(await screen.findByText(/^No agent is signed in\./)).toBeTruthy()
    // Its way out: Settings, at the agents.
    await userEvent.click(screen.getByRole('button', { name: 'Sign one in' }))
    expect(ways.agents).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: /^Coordinator:/ })).toBeNull()
  })

  it('says nothing about agents until they are read, then asks for one when none is signed in', async () => {
    // The agents' read stays open while the coordinator's thread is already read.
    let answer: (value: typeof status) => void = () => undefined
    const reading = new Promise<typeof status>((resolve) => (answer = resolve))
    const { client } = fakeClient({
      status: vi.fn(async () => reading),
      getCoordinator: vi.fn(async () => coordinatorSnapshot({ items: [items.says('Ready.')] })),
    })
    const ways = { signIn: vi.fn(), agents: vi.fn(), connections: vi.fn() }
    withServices(<Project room={Room.Talk} ways={ways} />, client)
    expect(await screen.findByText('Ready.')).toBeTruthy()
    // No agent is known yet, so nothing is said about there being none.
    expect(screen.queryByText(/No agent is signed in\./)).toBeNull()
    // Every agent signed out: once they are known, it asks for one.
    await act(async () => answer({ ...status, agents: status.agents.map((agent) => ({ ...agent, signIn: 'signed_out' as const })) }))
    expect(await screen.findByText(/^No agent is signed in\./)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Sign one in' }))
    expect(ways.agents).toHaveBeenCalledOnce()
  })

  it("says when the project can't be read, or the runtime didn't answer", async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () =>
        Promise.reject(new ApiError({ reason: 'NotFound', message: "That project isn't there any more." })),
      ),
      status: vi.fn(async () => Promise.reject(new Error('The port closed'))),
    })
    withServices(<Project room={Room.Talk} />, client)
    expect(await screen.findByText(/That project isn't there any more\.|runtime didn't answer/)).toBeTruthy()
    // The projects were read, so it is still named.
    expect(screen.getByRole('heading', { name: 'meridian', level: 1 })).toBeTruthy()
  })

  it('says when a plan could not be held, or earlier items could not be read', async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async (_projectId: string, page?: { before?: number }) =>
        page?.before === undefined
          ? coordinatorSnapshot({ items: [items.card(card())], earlier: true })
          : Promise.reject(new ApiError({ reason: 'NotFound', message: 'Gone.' })),
      ),
      holdPlan: vi.fn(async () => Promise.reject(new ApiError({ reason: 'NotFound', message: "That plan isn't there any more." }))),
    })
    if (vi.isMockFunction(window.getComputedStyle)) vi.mocked(window.getComputedStyle).mockRestore()
    const computed = window.getComputedStyle
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = computed(element)
      Object.defineProperty(style, 'overflowY', {
        value: element.classList.contains('scroll') || element.getAttribute('class')?.includes('scroll_') ? 'auto' : 'visible',
        configurable: true,
      })
      return style
    })
    withServices(<Project room={Room.Talk} />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Hold' }))
    expect(await screen.findByText("That plan isn't there any more.")).toBeTruthy()
    scrollEarlier()
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})

describe('a send to the coordinator that fails', () => {
  it('takes its copy out of the conversation again, says why, and puts what was said back in the composer', async () => {
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot()) })
    vi.mocked(client.send).mockRejectedValueOnce(new ApiError({ reason: 'NotFound', message: 'The project went away.' }))
    withServices(<Project room={Room.Talk} />, client)
    const box = await screen.findByRole('textbox', { name: 'Tell the coordinator something' })
    await userEvent.type(box, 'Plan it{Enter}')
    expect(await screen.findByText('The project went away.')).toBeTruthy()
    expect(screen.queryByText('Plan it', { selector: 'p' })).toBeNull()
    expect((box as HTMLTextAreaElement).value).toBe('Plan it')
  })
})

function scrollEarlier() {
  const thread = document.querySelector<HTMLElement>('section[data-arrivals]')!
  let box = thread.parentElement!
  while (!/(auto|scroll)/.test(getComputedStyle(box).overflowY) && box.parentElement) box = box.parentElement
  Object.defineProperty(box, 'clientHeight', { configurable: true, value: 600 })
  fireEvent.scroll(box)
}

afterEach(() => {
  if (vi.isMockFunction(window.getComputedStyle)) vi.mocked(window.getComputedStyle).mockRestore()
})
