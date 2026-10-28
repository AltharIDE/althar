import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type CoordinatorSnapshot, type ThreadItem } from '@althar/contracts'
import { Room } from '@althar/ui'

import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { useBoard } from '../src/renderer/features/board/useBoard'
import { agents, card, changed, coordinatorSnapshot, efforts, fakeClient, items, models, project, status, streamed } from './fixtures'
import { clock } from '../src/renderer/shared/time'
import { useSettingsOf, withServices } from './render'

function Project({
  onTask = vi.fn(),
  room,
  newTask,
  onRoomChange,
}: {
  onTask?: (threadId: string) => void
  room?: Room
  newTask?: boolean
  onRoomChange?: (room: Room) => void
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

describe('running the project, with no agent', () => {
  it('runs its default branch from the project’s front, shows it over the coordinator’s composer, and stops and clears it there', async () => {
    const { client, emit } = fakeClient({
      listProjects: vi.fn(async () => ({ cursor: 3, projects: [project] })),
      getCoordinator: vi.fn(async () =>
        coordinatorSnapshot({
          runnables: [{ id: 'rnbl_dev', name: null, command: 'npm run dev', repository: 'meridian', own: true, from: 'repository' }],
        }),
      ),
    })
    withServices(<WithSettings />, client)
    // Once the conversation is read, its front offers what the project runs.
    await screen.findByText(/^Ask the coordinator about/)
    await userEvent.click(await screen.findByRole('button', { name: /^Run$/ }))
    expect(client.runProject).toHaveBeenCalledWith('p1', null, 'thc', 'rnbl_dev')
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
    // Every run in the project shows here, a task's too, each saying where it runs.
    act(() =>
      emit({
        _tag: 'Launches',
        projectId: 'p1',
        launches: [launch, { ...launch, id: 'proc_2', taskId: 't1', where: 'Fix the login timeout', command: 'bun run dev' }],
      }),
    )
    const pill = await screen.findByRole('button', { name: /^Running/ })
    await waitFor(() => expect(pill.textContent).toContain('2 processes'))
    await userEvent.click(pill)
    const list = within(await screen.findByRole('dialog', { name: 'Running' }))
    expect(list.getByText(/^main/)).toBeTruthy()
    expect(list.getByText(/^Fix the login timeout/)).toBeTruthy()
    await userEvent.click(list.getByRole('button', { name: 'Stop npm run dev' }))
    expect(client.stopLaunch).toHaveBeenCalledWith('proc_1')
    await userEvent.keyboard('{Escape}')
    // One that ended by itself says how, and clears.
    act(() => emit({ _tag: 'Launches', projectId: 'p1', launches: [{ ...launch, ended: { at: '2026-10-10T09:01:00.000Z', code: 1 } }] }))
    await userEvent.click(await screen.findByRole('button', { name: /^Ran/ }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Ran' })).getByRole('button', { name: 'Clear npm run dev' }))
    expect(client.clearLaunch).toHaveBeenCalledWith('proc_1')
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
  it('steps through the views by b, never while typing, and has no button to start a task', async () => {
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot()) })
    const view = withServices(<Project />, client)
    const checked = () => screen.getAllByRole('radio').find((radio) => radio.getAttribute('aria-checked') === 'true')?.textContent
    await waitFor(() => expect(checked()).toMatch(/^Home/))
    ;(document.activeElement as HTMLElement | null)?.blur()
    await userEvent.keyboard('b')
    expect(checked()).toMatch(/^Conversation/)
    await userEvent.keyboard('b')
    expect(checked()).toMatch(/^Board/)
    await userEvent.keyboard('b')
    expect(checked()).toMatch(/^Home/)
    await userEvent.keyboard('b')
    expect(checked()).toMatch(/^Conversation/)
    await userEvent.type(screen.getByRole('textbox', { name: /Tell the coordinator/ }), 'b')
    expect(checked()).toMatch(/^Conversation/)
    // A task starts by telling the coordinator; nothing else starts one.
    expect(screen.queryByRole('button', { name: 'New task' })).toBeNull()
    view.unmount()
  })

  it('opens on Home where no view was named or kept', async () => {
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot()) })
    withServices(<Project />, client)
    const views = await screen.findByRole('radiogroup', { name: 'View' })
    expect(within(views).getByRole('radio', { checked: true }).textContent).toMatch(/^Home/)
  })

  it('says which view it is on, to open on it again, and has only its views, its automations and its settings to choose from', async () => {
    const onRoomChange = vi.fn()
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot()) })
    withServices(<Project room={Room.Both} onRoomChange={onRoomChange} />, client)
    await waitFor(() => expect(onRoomChange).toHaveBeenLastCalledWith(Room.Both))
    const views = screen.getByRole('radiogroup', { name: 'View' })
    expect(
      within(views)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['Home', 'Conversation', 'Board', 'Automations', 'Settings'])
    await userEvent.click(within(views).getByRole('radio', { name: 'Board' }))
    expect(onRoomChange).toHaveBeenLastCalledWith(Room.Board)
    // Its settings are a view too, kept like the others to open on again.
    await userEvent.click(within(views).getByRole('radio', { name: 'Settings' }))
    expect(onRoomChange).toHaveBeenLastCalledWith(Room.Settings)
    expect(screen.getByRole('navigation', { name: 'Project settings' })).toBeTruthy()
  })
})

describe('the Talk room', () => {
  it("shows the coordinator's thread with each task's card, folds its finished work, and opens a task", async () => {
    const onTask = vi.fn()
    const { client, watching } = fakeClient({ getCoordinator: vi.fn(async () => talk()) })
    withServices(<Project room={Room.Talk} onTask={onTask} />, client)
    await screen.findByRole('heading', { name: 'meridian', level: 1 })
    // Its front page says what it is made of, never where it is on this Mac.
    const made = await screen.findByRole('list', { name: 'Made of' })
    await waitFor(() =>
      expect(
        within(made)
          .getAllByRole('listitem')
          .map((part) => part.textContent),
      ).toEqual(['meridian-api', 'meridian-web', 'meridian-infra']),
    )
    expect(screen.queryByText(/\/code\/meridian/)).toBeNull()
    expect(screen.getByText('The call has no retry. I planned a task.')).toBeTruthy()
    expect(screen.queryByText('checkout.ts')).toBeNull()
    expect(screen.getByRole('button', { name: /^Worked for/ })).toBeTruthy()
    // A running task's card says where it is; a planned one shows its plan, and why the coordinator chose its lead.
    expect(screen.getByText('Reviewing')).toBeTruthy()
    expect(screen.getByText('It knows the code.')).toBeTruthy()
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
    expect(screen.getByText('Held. Starts when you say')).toBeTruthy()
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

  it('lets the person change a started plan while its first step waits for a free agent, saying what it waits for', async () => {
    const waitingCard = card({ phase: 'running', step: 'implement', queued: { busy: 4, atOnce: 4 }, planWaits: true })
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot({ items: [items.card(waitingCard)] })) })
    withServices(<Project room={Room.Talk} />, client)
    expect(await screen.findByText('Waiting: 4 of 4 agents busy on this Mac')).toBeTruthy()
    // Nothing to start or hold: it starts on its own once an agent is free.
    expect(screen.queryByRole('button', { name: 'Start now' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Hold' })).toBeNull()
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

  it('talks to the coordinator on the agent last used, or on another the person picks', async () => {
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot({ session: { ...session, held: false } })) })
    withServices(<Project room={Room.Talk} />, client)
    expect(await screen.findByText('Ask the coordinator about meridian, or say what should change.')).toBeTruthy()
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
    expect(await screen.findByText("OpenCode isn't signed in, so the coordinator starts on Claude Code.")).toBeTruthy()
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
    expect(screen.getByText('Queued; the coordinator reads it next')).toBeTruthy()
    // While it works, its work folds too, under how long it has worked so far and what it is doing now.
    expect(screen.queryByText('checkout.ts')).toBeNull()
    expect(screen.getByRole('button', { name: /Working for .*Reading checkout\.ts/ })).toBeTruthy()
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
    expect(screen.queryByText('Queued · the coordinator reads it next')).toBeNull()
    const queue = screen.getByRole('region', { name: '2 queued; the coordinator reads them in order' })
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
      await screen.findByText('Queued · the coordinator reads it next')
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
      await waitFor(() => expect(screen.queryByText('Queued · the coordinator reads it next')).toBeNull())
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
      expect(screen.queryByText('Queued · the coordinator reads it next')).toBeNull()
      act(() => emit(changed('provider_session', 's1', 'thc')))
      await vi.advanceTimersByTimeAsync(50)
      await waitFor(() => expect(client.getThreadItem).toHaveBeenCalledWith('thc', sent.id))
      // The head that says so waits for the message read again: it doesn't jump into the composer's queue meanwhile.
      expect(screen.queryByRole('region', { name: 'Queued; the coordinator reads it next' })).toBeNull()
      expect(screen.getByText('Why is checkout slow?')).toBeTruthy()
      act(() => delivered({ ...items.you('Why is checkout slow?', { state: 'delivered', interrupting: false }), id: sent.id }))
      await waitFor(() => expect(screen.getByRole('textbox', { name: /^Add to the queue/ })).toBeTruthy())
      expect(screen.getByText('Thinking')).toBeTruthy()
      expect(screen.queryByRole('region', { name: 'Queued; the coordinator reads it next' })).toBeNull()
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
    withServices(<Project room={Room.Talk} />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Show' }))
    expect(await screen.findByText('The oldest.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show' })).toBeNull()
  })
})

describe('what can go wrong', () => {
  it('asks for an agent to be signed in when none is', async () => {
    const { client } = fakeClient({
      status: vi.fn(async () => ({ ...status, agents: agents.map((agent) => ({ ...agent, signIn: 'signed_out' as const })) })),
    })
    withServices(<Project room={Room.Talk} />, client)
    expect(await screen.findByText('No agent is signed in. Sign one in from Settings, then come back.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Coordinator:/ })).toBeNull()
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
    withServices(<Project room={Room.Talk} />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Hold' }))
    expect(await screen.findByText("That plan isn't there any more.")).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Show' }))
    expect(await screen.findByText('Gone.')).toBeTruthy()
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
