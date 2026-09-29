import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ThreadSnapshot } from '@charrette/contracts'
import { TaskStatus } from '@charrette/ui'

import { statusOf, TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { fakeClient, item, snapshot } from './fixtures'
import { withServices } from './render'

function Task({ onBack = vi.fn() }: { onBack?: () => void }) {
  return <TaskView model={useTask('th1')} onBack={onBack} />
}

const thread = (overrides: Partial<ThreadSnapshot> = {}) =>
  snapshot({
    items: [
      item('user_message', { text: 'Add a retry' }),
      item('agent_thought', { text: 'Where is the call?' }),
      item('tool_call', {
        title: 'Read checkout.ts',
        kind: 'read',
        status: 'completed',
        locations: [{ path: '/w/meridian/src/checkout.ts' }],
      }),
      item('agent_message', { text: 'Found **it**.' }, { id: 'reply' }),
      item('plan', { entries: [{ content: 'Write the test', status: 'completed' }] }),
      item('notice', { source: 'agent', severity: 'warning', title: 'Context is filling up' }),
      item('notice', { source: 'runtime', severity: 'info', title: 'Codex took over from Claude Code.' }),
      item('agent_message', { text: 'Carrying on.' }, { agentId: 'codex' }),
    ],
    ...overrides,
  })

const running = (overrides: Partial<ThreadSnapshot> = {}) => {
  const base = thread(overrides)
  return { ...base, session: base.session === null ? null : { ...base.session, turnRunning: true } }
}

describe('a task', () => {
  it('shows its header and its thread', async () => {
    const onBack = vi.fn()
    const { client } = fakeClient({ getThread: vi.fn(async () => thread()) })
    withServices(<Task onBack={onBack} />, client)
    await screen.findByRole('heading', { name: 'Add a retry', level: 1 })
    expect(screen.getAllByText('Claude Code · opus').length).toBeGreaterThan(0)
    expect(screen.getByText('charrette/add-a-retry')).toBeTruthy()
    expect(screen.getByText('Idle')).toBeTruthy()
    expect(screen.getByText('it')).toBeTruthy()
    expect(screen.getByText('src/checkout.ts')).toBeTruthy()
    expect(screen.getByText('Write the test')).toBeTruthy()
    expect(screen.getByText('Context is filling up')).toBeTruthy()
    expect(screen.getByText('Codex took over from Claude Code.')).toBeTruthy()
    expect(screen.getByText('Codex')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Thought' }))
    expect(screen.getByText('Where is the call?')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /meridian/ }))
    expect(onBack).toHaveBeenCalled()
  })

  it('talks to its lead: sends, queues while it works, sends now, and interrupts', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => thread()) })
    const view = withServices(<Task />, client)
    const box = await screen.findByRole('textbox', { name: 'Tell Claude Code something' })
    await userEvent.type(box, 'Add a test{Enter}')
    await waitFor(() => expect(client.send).toHaveBeenCalledWith({ threadId: 'th1', body: 'Add a test', disposition: 'after_current' }))
    expect((box as HTMLTextAreaElement).value).toBe('')

    vi.mocked(client.getThread).mockImplementation(async () => running())
    view.rerender(<></>)
    withServices(<Task />, client)
    const busy = await screen.findByRole('textbox', { name: 'Add to the queue, or interrupt the lead' })
    expect(screen.getByText('Working')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Interrupt the lead/ }))
    expect(client.interrupt).toHaveBeenCalledWith('th1')
    await userEvent.type(busy, 'Stop, use the helper{Meta>}{Enter}{/Meta}')
    await waitFor(() =>
      expect(client.send).toHaveBeenCalledWith({ threadId: 'th1', body: 'Stop, use the helper', disposition: 'interrupt_and_continue' }),
    )
  })

  it('changes its model, hands it to another agent, and stops it', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => thread()) })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('combobox', { name: 'Model' }))
    await userEvent.click(await screen.findByRole('option', { name: 'sonnet' }))
    expect(client.setModel).toHaveBeenCalledWith({ threadId: 'th1', model: 'sonnet' })
    await userEvent.click(screen.getByRole('combobox', { name: 'Hand to' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Codex' }))
    expect(client.switchAgent).toHaveBeenCalledWith({ threadId: 'th1', agentId: 'codex' })
    await userEvent.click(screen.getByRole('button', { name: 'More for this task' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Stop the task/ }))
    expect(client.stopSession).toHaveBeenCalledWith('th1')
  })

  it('answers what the rules keep for the person', async () => {
    const call = {
      id: 'a1',
      title: 'Run git push',
      reason: 'Pushing leaves the worktree.',
      command: 'git push',
      createdAt: '2026-09-29T12:00:00.000Z',
    }
    const { client } = fakeClient({
      getThread: vi.fn(async () => thread({ attention: [call, { ...call, id: 'a2', command: null, title: 'Fetch a page' }] })),
    })
    withServices(<Task />, client)
    await screen.findByText('Needs you')
    const [first, second] = await screen
      .findAllByRole('group', { name: 'Your answer' })
      .then((groups) => groups.map((group) => group.closest('div') as HTMLElement))
    await userEvent.click(within(first!.parentElement!).getByRole('button', { name: /^Allow/ }))
    await waitFor(() => expect(client.answer).toHaveBeenCalledWith({ attentionId: 'a1', decision: 'allow' }))
    const card = second!.parentElement!
    await userEvent.click(within(card).getByRole('radio', { name: /No, and say what to do instead/ }))
    await userEvent.type(within(card).getByPlaceholderText('Say what to do instead'), 'Open a PR instead')
    await userEvent.click(within(card).getByRole('button', { name: /^Deny/ }))
    await waitFor(() => expect(client.answer).toHaveBeenCalledWith({ attentionId: 'a2', decision: 'reject', reason: 'Open a PR instead' }))
  })

  it('starts a lead when none is working, with the one that last led', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => thread({ session: null })) })
    withServices(<Task />, client)
    await screen.findByText('No agent is working on this task.')
    expect(screen.getByText('Stopped')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Start a lead to talk to it' })).toBeTruthy()
    expect(within(screen.getByRole('combobox', { name: 'Lead' })).getByText('Codex')).toBeTruthy()
    await userEvent.click(screen.getByRole('combobox', { name: 'Lead' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Claude Code' }))
    await userEvent.click(screen.getByRole('button', { name: 'Start the lead' }))
    expect(client.startSession).toHaveBeenCalledWith({ threadId: 'th1', agentId: 'claude-code' })
    await userEvent.click(screen.getByRole('button', { name: 'More for this task' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Resume/ }))
    expect(client.startSession).toHaveBeenCalledTimes(2)
  })

  it('shows text as it streams, and reads the thread again when its project changes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { client, emit } = fakeClient({ getThread: vi.fn(async () => thread()) })
      withServices(<Task />, client)
      await screen.findByText('it')
      act(() => emit({ _tag: 'Streaming', threadId: 'th1', itemId: 'reply', text: 'Found it, and a second call.' }))
      act(() => emit({ _tag: 'Streaming', threadId: 'other', itemId: 'reply', text: 'Not this thread' }))
      await screen.findByText('Found it, and a second call.')

      vi.mocked(client.getThread).mockImplementation(async () =>
        thread({ items: [item('agent_message', { text: 'Found it, and a second call. Done.' }, { id: 'reply' })] }),
      )
      act(() => {
        emit({ _tag: 'Changed', aggregateType: 'thread_item', aggregateId: 'reply', projectId: 'p1' })
        emit({ _tag: 'Changed', aggregateType: 'thread_item', aggregateId: 'reply', projectId: 'p1' })
        emit({ _tag: 'Changed', aggregateType: 'thread_item', aggregateId: 'x', projectId: 'p9' })
      })
      await act(() => vi.advanceTimersByTimeAsync(100))
      await screen.findByText('Found it, and a second call. Done.')
      expect(client.getThread).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('says what went wrong, and lets it go', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async () => thread()),
      setModel: vi.fn(async () => Promise.reject(new Error('That model is not offered'))),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('combobox', { name: 'Model' }))
    await userEvent.click(await screen.findByRole('option', { name: 'sonnet' }))
    await screen.findByText(/That model is not offered/)
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText(/That model is not offered/)).toBeNull()
  })

  it('waits for its thread, and says when it cannot have it', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async () => Promise.reject(new Error('No such thread'))),
      status: vi.fn(async () => Promise.reject(new Error('No such thread'))),
    })
    withServices(<Task />, client)
    expect((await screen.findAllByText('No such thread')).length).toBeGreaterThan(0)
  })

  it('says where it stands', () => {
    const base = snapshot()
    expect(statusOf(base)).toEqual({ status: TaskStatus.Running, state: 'Idle' })
    expect(statusOf(running())).toEqual({ status: TaskStatus.Running, state: 'Working' })
    expect(statusOf({ ...base, session: null })).toEqual({ status: TaskStatus.Stopped, state: 'Stopped' })
    expect(statusOf({ ...base, attention: [{ id: 'a', title: 't', reason: 'r', command: null, createdAt: '' }] }).state).toBe('Needs you')
  })
})
