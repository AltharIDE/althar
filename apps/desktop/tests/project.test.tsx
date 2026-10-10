import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type CoordinatorSnapshot } from '@althar/contracts'
import { Room } from '@althar/ui'

import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { useBoard } from '../src/renderer/features/board/useBoard'
import { agents, card, changed, coordinatorSnapshot, efforts, fakeClient, items, models, status, streamed } from './fixtures'
import { clock } from '../src/renderer/shared/time'
import { withServices } from './render'

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
  context: null,
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

describe('the project’s bar', () => {
  it('steps through the views by b, never while typing, and opens on the view or the new task a task’s bar asked for', async () => {
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot()) })
    const view = withServices(<Project />, client)
    const checked = () => screen.getAllByRole('radio').find((radio) => radio.getAttribute('aria-checked') === 'true')?.textContent
    await waitFor(() => expect(checked()).toMatch(/^Conversation/))
    ;(document.activeElement as HTMLElement | null)?.blur()
    await userEvent.keyboard('b')
    expect(checked()).toMatch(/^Board/)
    await userEvent.keyboard('b')
    expect(checked()).toMatch(/^Both/)
    await userEvent.keyboard('b')
    expect(checked()).toMatch(/^Conversation/)
    await userEvent.type(screen.getByRole('textbox', { name: /Tell the coordinator/ }), 'b')
    expect(checked()).toMatch(/^Conversation/)
    view.unmount()

    withServices(<Project room={Room.Board} newTask />, client)
    // Planning a task opens beside the conversation, so the board is shown with it.
    await waitFor(() => expect(checked()).toMatch(/^Both/))
    expect(await screen.findByRole('complementary', { name: 'New task' })).toBeTruthy()
  })

  it('says which view it is on, to open on it again, and has only its views to choose from', async () => {
    const onRoomChange = vi.fn()
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot()) })
    withServices(<Project room={Room.Both} onRoomChange={onRoomChange} />, client)
    await waitFor(() => expect(onRoomChange).toHaveBeenLastCalledWith(Room.Both))
    const views = screen.getByRole('radiogroup', { name: 'View' })
    expect(
      within(views)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['Conversation', 'Board', 'Both'])
    await userEvent.click(within(views).getByRole('radio', { name: 'Board' }))
    expect(onRoomChange).toHaveBeenLastCalledWith(Room.Board)
  })
})

describe('the Talk room', () => {
  it("shows the coordinator's thread with each task's card, folds its finished work, and opens a task", async () => {
    const onTask = vi.fn()
    const { client, watching } = fakeClient({ getCoordinator: vi.fn(async () => talk()) })
    withServices(<Project onTask={onTask} />, client)
    await screen.findByRole('heading', { name: 'meridian', level: 1 })
    expect(screen.getByText('/code/meridian')).toBeTruthy()
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
    withServices(<Project />, client)
    expect(await screen.findByText('Added the retry.')).toBeTruthy()
    expect(screen.getByText('Ready')).toBeTruthy()
    expect(screen.getByText('Needs you')).toBeTruthy()
    expect(screen.getByText('Implementing')).toBeTruthy()
    expect(screen.getByText('Stopped')).toBeTruthy()
    expect(screen.getByText('Held. Starts when you say')).toBeTruthy()
    expect(screen.getByText(`Waits for Claude Code, back at ${clock('2026-10-03T15:40:00.000Z')}`)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(client.startPlan).toHaveBeenCalledWith('pln5')
  })

  it('holds, changes and starts a plan before it starts on its own', async () => {
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot({ items: [items.card(card())] })) })
    withServices(<Project />, client)
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

  it('talks to the coordinator on the agent last used, or on another the person picks', async () => {
    const { client } = fakeClient()
    withServices(<Project />, client)
    expect(await screen.findByText('Ask the coordinator about the project, or say what should change.')).toBeTruthy()
    const box = screen.getByRole('textbox', { name: 'Tell the coordinator something' })
    await userEvent.type(box, 'Add a retry{Enter}')
    await waitFor(() => expect(client.send).toHaveBeenCalledWith({ threadId: 'thc', body: 'Add a retry', disposition: 'after_current' }))
    expect(client.startSession).not.toHaveBeenCalled()

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
    withServices(<Project />, client)
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

  it("says when the agent it last ran on isn't signed in, and starts it on one that is", async () => {
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () =>
        coordinatorSnapshot({ suggested: { agentId: 'opencode', agentName: 'OpenCode', model: null, effort: null, available: false } }),
      ),
    })
    withServices(<Project />, client)
    expect(await screen.findByText("OpenCode isn't signed in, so the coordinator starts on Claude Code.")).toBeTruthy()
    await userEvent.type(screen.getByRole('textbox', { name: 'Tell the coordinator something' }), 'Hello{Enter}')
    await waitFor(() => expect(client.startSession).toHaveBeenCalledWith({ threadId: 'thc', agentId: 'claude-code' }))
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
    withServices(<Project />, client)
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
    await userEvent.click(screen.getByRole('radio', { name: /gpt-5\.2-codex, via Codexhands the conversation to Codex/ }))
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
    withServices(<Project />, client)
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
        getCoordinator: vi.fn(async () => coordinatorSnapshot({ session, items: [queued, items.card(card(), 'c1')] })),
        getThreadItem: vi.fn(async (_threadId: string, itemId: string) =>
          itemId === queued.id ? { ...queued, input: { state: 'delivered' as const, interrupting: false } } : items.says('Read again'),
        ),
      })
      withServices(<Project />, client)
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
      withServices(<Project />, client)
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
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Show' }))
    expect(await screen.findByText('The oldest.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show' })).toBeNull()
  })
})

describe('a task the person plans', () => {
  it('starts beside the conversation: what should change, its lead and its review', async () => {
    const { client } = fakeClient()
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'New task' }))
    const panel = await screen.findByRole('complementary', { name: 'New task' })

    // Nothing written: it says what is missing rather than refuse the button.
    await userEvent.click(within(panel).getByRole('button', { name: 'Start the task' }))
    expect(within(panel).getByText('Say what the task is.')).toBeTruthy()
    expect(client.startTask).not.toHaveBeenCalled()

    await userEvent.type(within(panel).getByLabelText('What should change'), '  Add a retry  ')
    await userEvent.type(within(panel).getByLabelText('Anything the lead should know'), ' Only the checkout call. ')
    // Another agent reviews by default.
    expect(await within(panel).findByRole('button', { name: 'Review: gpt-5.2-codex Medium' })).toBeTruthy()
    await userEvent.click(within(panel).getByRole('button', { name: 'Start the task' }))
    await waitFor(() =>
      expect(client.startTask).toHaveBeenCalledWith({
        projectId: 'p1',
        title: 'Add a retry',
        description: 'Only the checkout call.',
        steps: [
          { key: 'implement', agentId: 'claude-code', model: null, effort: null, skipped: false },
          { key: 'review', agentId: 'codex', model: null, effort: null, skipped: false },
        ],
        // The repository's host isn't connected here: the task ends on its branch.
        end: null,
      }),
    )
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'New task' })).toBeNull())
  })

  it('can go without a review, with another lead; and says what went wrong', async () => {
    const { client } = fakeClient({
      startTask: vi.fn(async () => Promise.reject(new ApiError({ reason: 'GitFailed', message: "git worktree didn't work." }))),
    })
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'New task' }))
    const panel = await screen.findByRole('complementary', { name: 'New task' })
    await userEvent.type(within(panel).getByLabelText('What should change'), 'Bump the version')
    await userEvent.click(await within(panel).findByRole('button', { name: 'Lead: Claude Code default Medium' }))
    await userEvent.click(await screen.findByRole('radio', { name: /gpt-5\.2-codex/ }))
    // The review goes to another agent than the lead's; without one, it can be added back.
    await userEvent.click(await within(panel).findByRole('button', { name: 'Review: Claude Code default Medium' }))
    await userEvent.click(await screen.findByRole('button', { name: 'No review' }))
    await userEvent.click(within(panel).getByRole('button', { name: 'Add a review' }))
    await userEvent.click(await within(panel).findByRole('button', { name: 'Review: Claude Code default Medium' }))
    await userEvent.click(await screen.findByRole('button', { name: 'No review' }))
    await userEvent.click(within(panel).getByRole('button', { name: 'Start the task' }))
    expect(await screen.findByText("git worktree didn't work.")).toBeTruthy()
    expect(client.startTask).toHaveBeenCalledWith({
      projectId: 'p1',
      title: 'Bump the version',
      steps: [{ key: 'implement', agentId: 'codex', model: 'gpt-5.2-codex', effort: null, skipped: false }],
      end: null,
    })
    // It stays open, to try again; Close puts it away, and Dismiss the message.
    await userEvent.click(within(panel).getByRole('button', { name: 'Close the panel' }))
    expect(screen.queryByRole('complementary', { name: 'New task' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText("git worktree didn't work.")).toBeNull()
  })
})

describe('what can go wrong', () => {
  it('asks for an agent to be signed in when none is', async () => {
    const { client } = fakeClient({
      status: vi.fn(async () => ({ ...status, agents: agents.map((agent) => ({ ...agent, signIn: 'signed_out' as const })) })),
    })
    withServices(<Project />, client)
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
    withServices(<Project />, client)
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
    withServices(<Project />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Hold' }))
    expect(await screen.findByText("That plan isn't there any more.")).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Show' }))
    expect(await screen.findByText('Gone.')).toBeTruthy()
  })
})

describe('a send to the coordinator that fails', () => {
  it('takes its copy out of the conversation again, and says why', async () => {
    const { client } = fakeClient({ getCoordinator: vi.fn(async () => coordinatorSnapshot()) })
    vi.mocked(client.send).mockRejectedValueOnce(new ApiError({ reason: 'NotFound', message: 'The project went away.' }))
    withServices(<Project />, client)
    await userEvent.type(await screen.findByRole('textbox', { name: 'Tell the coordinator something' }), 'Plan it{Enter}')
    expect(await screen.findByText('The project went away.')).toBeTruthy()
    expect(screen.queryByText('Plan it')).toBeNull()
  })
})
