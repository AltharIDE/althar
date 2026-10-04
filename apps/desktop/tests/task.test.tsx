import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type StuckStep, type ThreadSnapshot } from '@althar/contracts'
import { TaskStatus } from '@althar/ui'

import { text as stuckWords } from '../src/renderer/features/task/StuckCall'
import { statusOf, TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { changed, fakeClient, items, models, snapshot, streamed } from './fixtures'
import { clock } from '../src/renderer/shared/time'
import { withServices } from './render'

function Task({ onBack = vi.fn() }: { onBack?: () => void }) {
  return <TaskView model={useTask('th1')} onBack={onBack} />
}

const thread = (overrides: Partial<ThreadSnapshot> = {}) =>
  snapshot({
    items: [
      items.you('Add a retry'),
      items.thinks('Where is the call?'),
      items.tool({ locations: [{ path: '/w/meridian/src/checkout.ts' }] }),
      items.says('Found **it**.', 'claude-code', 'reply'),
      items.plan([{ content: 'Write the test', status: 'completed' }]),
      items.notice({ severity: 'warning', title: 'Context is filling up' }),
      items.notice({ source: 'runtime', title: 'Codex took over from Claude Code.' }, null),
      items.says('Carrying on.', 'codex'),
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
    // The lead's model, by the name its agent gives it.
    expect((await screen.findAllByText('Claude Code · Opus')).length).toBeGreaterThan(0)
    expect(screen.getByText('althar/add-a-retry')).toBeTruthy()
    // Work under way has no pull request to open yet.
    expect(screen.queryByRole('button', { name: 'Open a pull request' })).toBeNull()
    expect(screen.getByText('Idle')).toBeTruthy()
    expect(screen.getByText('it')).toBeTruthy()
    // The turn is over: what it did before its last message is folded.
    expect(screen.queryByText('src/checkout.ts')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^Worked for 0s/ }))
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

  it('changes how hard its lead thinks and its model, hands it to another agent, and stops it', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => thread()) })
    withServices(<Task />, client)
    // The lead's model and effort, in the composer.
    await userEvent.click(await screen.findByRole('button', { name: 'Lead: Opus High' }))
    await userEvent.click(await screen.findByRole('radio', { name: 'Low' }))
    await waitFor(() => expect(client.setEffort).toHaveBeenCalledWith({ threadId: 'th1', effort: 'low' }))
    // Every model is one step away, whichever agent offers it.
    await userEvent.click(screen.getByRole('button', { name: /All models/ }))
    const browser = await screen.findByRole('dialog')
    expect(within(browser).getByRole('button', { name: 'Use gpt-5.2' })).toBeTruthy()
    // An agent that is signed out offers nothing.
    expect(within(browser).queryByText(/OpenCode/)).toBeNull()
    await userEvent.click(within(browser).getByRole('button', { name: 'Use Sonnet' }))
    await waitFor(() => expect(client.setModel).toHaveBeenCalledWith({ threadId: 'th1', model: 'sonnet' }))
    expect(client.setEffort).toHaveBeenCalledTimes(1)
    // Another agent's model hands the task to that agent, on its own effort.
    await userEvent.click(screen.getByRole('button', { name: 'Lead: Opus High' }))
    await userEvent.click(await screen.findByRole('radio', { name: /gpt-5\.2-codex/ }))
    await waitFor(() => expect(client.switchAgent).toHaveBeenCalledWith({ threadId: 'th1', agentId: 'codex', model: 'gpt-5.2-codex' }))
    await userEvent.click(screen.getByRole('button', { name: 'More for this task' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Stop the task/ }))
    expect(client.stopSession).toHaveBeenCalledWith('th1')
  })

  it('opens the pull request of work that ended on its branch', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async () => thread({ session: null, task: { ...snapshot().task, phase: 'ready', commits: 2 } })),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Open a pull request' }))
    await waitFor(() => expect(client.openChange).toHaveBeenCalledWith('t1'))
  })

  it('keeps the person’s pinned models in this window, and their default efforts in Althar', async () => {
    // The runtime keeps defaults: what is set is what the models say when read again.
    const kept = new Map<string, Array<{ model: string; effort: string }>>()
    const getModels = vi.fn(async () => models.map((offered) => ({ ...offered, defaults: kept.get(offered.agentId) ?? [] })))
    const setDefaultEffort = vi.fn(async (input: { agentId: string; model: string; effort: string }) => {
      kept.set(input.agentId, [...(kept.get(input.agentId) ?? []), { model: input.model, effort: input.effort }])
    })
    const { client } = fakeClient({ getThread: vi.fn(async () => thread()), getModels, setDefaultEffort })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Lead: Opus High' }))
    // Until the person pins one, each agent's current model is pinned; the one in use shows first.
    const pinned = await screen.findByRole('radiogroup', { name: 'Pinned models' })
    expect(
      within(pinned)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['Opusnot pinned', 'Claude Code default', 'gpt-5.2-codexhands the task to Codex'])
    // High is not what Claude Code is on; the person makes it Opus's.
    expect(screen.getByText(/default Medium/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Make this default' }))
    expect(setDefaultEffort).toHaveBeenCalledWith({ agentId: 'claude-code', model: 'opus', effort: 'high' })
    expect(await screen.findByText('Opus default')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /All models/ }))
    const browser = await screen.findByRole('dialog')
    await userEvent.click(within(browser).getByRole('button', { name: 'Pin Opus' }))
    await userEvent.click(within(browser).getByRole('combobox', { name: 'Default effort for gpt-5.2' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Extra high' }))
    await waitFor(() => expect(setDefaultEffort).toHaveBeenCalledWith({ agentId: 'codex', model: 'gpt-5.2', effort: 'extra-high' }))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(JSON.parse(window.localStorage.getItem('althar.models') ?? '{}')).toEqual({
      pins: ['claude-code:default', 'codex:gpt-5.2-codex', 'claude-code:opus'],
    })

    // A model with the person's default effort starts on it.
    await userEvent.click(screen.getByRole('button', { name: 'Lead: Opus High' }))
    await userEvent.click(screen.getByRole('button', { name: /All models/ }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Use gpt-5.2' }))
    await waitFor(() =>
      expect(client.switchAgent).toHaveBeenCalledWith({ threadId: 'th1', agentId: 'codex', model: 'gpt-5.2', effort: 'extra-high' }),
    )
  })

  it('asks before another agent takes over from a lead at work, from the list or from every model', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => thread({ session: { ...snapshot().session!, turnRunning: true } })) })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Lead: Opus High' }))
    await userEvent.click(await screen.findByRole('radio', { name: /gpt-5\.2-codex/ }))
    expect(screen.getByText('Codex takes over from a brief; Claude Code’s turn stops.')).toBeTruthy()
    expect(client.switchAgent).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText(/takes over from a brief/)).toBeNull()
    // From every model, the question waits in the picker.
    await userEvent.click(screen.getByRole('button', { name: /All models/ }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Use gpt-5.2' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Hand it over' }))
    await waitFor(() => expect(client.switchAgent).toHaveBeenCalledWith({ threadId: 'th1', agentId: 'codex', model: 'gpt-5.2' }))
    // Its own models change without asking.
    await userEvent.click(await screen.findByRole('radio', { name: /Claude Code default/ }))
    await waitFor(() => expect(client.setModel).toHaveBeenCalledWith({ threadId: 'th1', model: 'default' }))
  })

  it('answers what the rules keep for the person', async () => {
    const call = {
      id: 'a1',
      kind: 'permission' as const,
      stuck: null,
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

  it('shows a step that needs the person, and takes their answer: tell the lead, hand it on, or abandon it', async () => {
    const stuck = (overrides: Partial<StuckStep> = {}) => ({
      id: 'st1',
      kind: 'stuck' as const,
      title: '',
      reason: '',
      command: null,
      createdAt: '2026-09-29T12:00:00.000Z',
      stuck: {
        step: 'implement' as const,
        why: 'no_report' as const,
        detail: null,
        agentId: 'claude-code',
        round: 0,
        open: 0,
        ...overrides,
      },
    })
    const { client } = fakeClient({ getThread: vi.fn(async () => thread({ attention: [stuck()] })) })
    const view = withServices(<Task />, client)
    expect(await screen.findByText('Claude Code ended its turn twice without saying the step is done.')).toBeTruthy()
    expect(screen.getByText('Reminded it to report')).toBeTruthy()
    expect(screen.getByText('Needs you')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Tell the lead' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'What should it do instead?' }), 'Report it now.')
    await userEvent.click(screen.getByRole('button', { name: 'Send to the lead' }))
    await waitFor(() =>
      expect(client.answerStuck).toHaveBeenCalledWith({ attentionId: 'st1', answer: { kind: 'tell', note: 'Report it now.' } }),
    )

    // A review that couldn't start: another reviewer, or none.
    view.unmount()
    vi.mocked(client.getThread).mockImplementation(async () =>
      thread({ attention: [stuck({ step: 'review', why: 'failed_to_start', detail: 'It isn’t signed in.', agentId: 'codex' })] }),
    )
    const again = withServices(<Task />, client)
    expect(await screen.findByText("Codex couldn't start. It isn’t signed in.")).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Tell the lead' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Review again' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Claude Code/ }))
    await waitFor(() =>
      expect(client.answerStuck).toHaveBeenCalledWith({ attentionId: 'st1', answer: { kind: 'retry', agentId: 'claude-code' } }),
    )

    // Out of review rounds: accepted as it is.
    again.unmount()
    vi.mocked(client.getThread).mockImplementation(async () =>
      thread({ attention: [stuck({ step: 'review', why: 'round_limit', open: 2 })] }),
    )
    withServices(<Task />, client)
    expect(await screen.findByText(/Three rounds of review are done.*2 findings are still open\./)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Accept it as it is' }))
    await waitFor(() => expect(client.answerStuck).toHaveBeenCalledWith({ attentionId: 'st1', answer: { kind: 'abandon' } }))
  })

  it('says why each step needed the person', () => {
    const at = (why: StuckStep['why'], detail: string | null = null, open = 0) =>
      stuckWords.what({ step: 'implement', why, detail, agentId: null, round: 0, open }, 'Codex')
    expect([at('session_ended'), at('restarted'), at('failed_to_start'), at('round_limit', null, 1), at('usage_limit')]).toEqual([
      'Codex stopped before the step was done.',
      'Althar restarted while this step was running.',
      "Codex couldn't start.",
      "Three rounds of review are done, and the lead's last changes haven't been reviewed. One finding is still open.",
      "Codex reached its usage limit and didn't say when it resets.",
    ])
    expect([at('stalled'), at('looping', 'npm test'), at('over_budget', '6 hours'), at('refused')]).toEqual([
      'Codex stopped showing any sign of work on this step.',
      'Codex kept running `npm test` to the same end.',
      "Codex has worked on this step for 6 hours since you last said anything, and isn't done.",
      'Codex declined to go on with this step.',
    ])
  })

  it('shows what Althar tried for a lead that went quiet, and starts it again', async () => {
    const quiet = {
      id: 'st7',
      kind: 'stuck' as const,
      title: 'Implement',
      reason: '',
      command: null,
      createdAt: '2026-09-29T12:00:00.000Z',
      stuck: {
        step: 'implement' as const,
        why: 'stalled' as const,
        detail: null,
        agentId: 'codex',
        round: 0,
        open: 0,
        tried: ['carried_on' as const, 'restarted' as const],
      },
    }
    const { client } = fakeClient({ getThread: vi.fn(async () => thread({ attention: [quiet] })) })
    withServices(<Task />, client)
    await screen.findByText('Codex stopped showing any sign of work on this step.')
    expect(screen.getByText('Stopped its turn and told it to carry on')).toBeTruthy()
    expect(screen.getByText('Started Codex afresh')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tell the lead' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Start Codex again' }))
    await waitFor(() =>
      expect(client.answerStuck).toHaveBeenCalledWith({ attentionId: 'st7', answer: { kind: 'retry', agentId: 'codex' } }),
    )
  })

  it('hands a step whose agent is out of usage on, or tries it again, and never tells it anything', async () => {
    const out = {
      id: 'st9',
      kind: 'stuck' as const,
      title: 'Implement',
      reason: '',
      command: null,
      createdAt: '2026-09-29T12:00:00.000Z',
      stuck: { step: 'implement' as const, why: 'usage_limit' as const, detail: null, agentId: 'codex', round: 0, open: 0 },
    }
    const { client } = fakeClient({ getThread: vi.fn(async () => thread({ attention: [out] })) })
    withServices(<Task />, client)
    await screen.findByText("Codex reached its usage limit and didn't say when it resets.")
    expect(screen.queryByRole('button', { name: 'Tell the lead' })).toBeNull()
    // Handing it on is offered only to the agents that aren't out.
    await userEvent.click(screen.getByRole('button', { name: 'Try another agent' }))
    expect(screen.queryByRole('menuitem', { name: /Codex/ })).toBeNull()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Try Codex again' }))
    await waitFor(() =>
      expect(client.answerStuck).toHaveBeenCalledWith({ attentionId: 'st9', answer: { kind: 'retry', agentId: 'codex' } }),
    )
  })

  it('starts the lead picked when the person says something to a task none is working on, with that as its first turn', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => thread({ session: null })) })
    withServices(<Task />, client)
    expect(await screen.findByText('Stopped')).toBeTruthy()
    // No button to start one that has nothing to do: saying something starts it.
    expect(screen.queryByRole('button', { name: 'Start the lead' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'More for this task' })).toBeNull()
    await userEvent.click(await screen.findByRole('button', { name: 'Lead: gpt-5.2-codex Medium' }))
    await userEvent.click(await screen.findByRole('radio', { name: /Claude Code default/ }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Tell Claude Code something' }), 'Carry on with the retry.{Enter}')
    await waitFor(() => expect(client.startSession).toHaveBeenCalledWith({ threadId: 'th1', agentId: 'claude-code', model: 'default' }))
    expect(client.send).toHaveBeenCalledWith({ threadId: 'th1', body: 'Carry on with the retry.', disposition: 'after_current' })
    // Queued before the lead starts, so it reads it in its first turn.
    expect(vi.mocked(client.send).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(client.startSession).mock.invocationCallOrder[0] ?? 0)
  })

  it('shows text as it streams; reads a changed item alone, and the head alone for anything else', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { client, emit, watching } = fakeClient({ getThread: vi.fn(async () => thread()) })
      withServices(<Task />, client)
      await screen.findByText('it')
      // It watches from the cursor its first read had.
      expect(watching).toEqual([10])
      act(() => emit(streamed('reply', 'Found it, and a second call.')))
      act(() => emit(streamed('reply', 'Not this thread', 'other')))
      await screen.findByText('Found it, and a second call.')

      vi.mocked(client.getThreadItem).mockImplementation(async (_threadId, itemId) =>
        itemId === 'reply'
          ? items.says('Found it, and a second call. Done.', 'claude-code', 'reply')
          : items.says('A new line.', 'codex', itemId),
      )
      vi.mocked(client.getThread).mockImplementation(async () => ({ ...thread({ items: [] }), attention: [], session: null }))
      act(() => {
        emit(changed('thread_item', 'reply'))
        emit(changed('thread_item', 'reply'))
        emit(changed('thread_item', 'fresh'))
        emit(changed('thread_item', 'x', 'th9'))
        emit(changed('provider_session', 's1'))
      })
      await act(() => vi.advanceTimersByTimeAsync(100))
      await screen.findByText('Found it, and a second call. Done.')
      await screen.findByText('A new line.')
      expect(vi.mocked(client.getThreadItem).mock.calls.map(([, itemId]) => itemId)).toEqual(['reply', 'fresh'])
      // The head is read without items, and the items read so far stay.
      expect(client.getThread).toHaveBeenLastCalledWith('th1', { limit: 0 })
      await screen.findByText('Stopped')
      expect(screen.getByText('Carrying on.')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows a command over several lines on one, and all of it when its row opens', async () => {
    const script = "python3 - <<'EOF'\nprint('hi')\nEOF"
    const { client } = fakeClient({
      getThread: vi.fn(async () => thread({ items: [items.tool({ title: 'python3', toolKind: 'execute', command: script })] })),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: /^Worked for/ }))
    await userEvent.click(await screen.findByText("python3 - <<'EOF' …"))
    expect(await screen.findByText("print('hi')")).toBeTruthy()
  })

  it('opens a long one-line command too, since its row clips it', async () => {
    const pipeline = `python3 -c "import json,sys; print(json.load(sys.stdin)['name'])" < package.json | tr a-z A-Z | tee out.txt`
    const short = 'bun test'
    const { client } = fakeClient({
      getThread: vi.fn(async () =>
        thread({
          items: [
            items.tool({ title: 'python3', toolKind: 'execute', command: pipeline }),
            items.tool({ title: 'bun', toolKind: 'execute', command: short }),
          ],
        }),
      ),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: /^Worked for/ }))
    await userEvent.click(await screen.findByText(pipeline))
    expect(await screen.findByRole('figure')).toBeTruthy()
    // A short one has nothing more to show, so its row doesn't open.
    expect(screen.getByText(short).closest('button')).toBeNull()
  })

  it("folds the lead's work under what its step reported, and shows what the review found", async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async () =>
        thread({
          items: [
            items.tool({ title: 'Edit checkout.ts', toolKind: 'edit' }),
            items.step({ summary: 'Added the retry, and a test.' }),
            items.step({
              step: 'review',
              verdict: 'changes_requested',
              summary: 'One thing to fix.',
              agentId: 'codex',
              findings: [
                { severity: 'major', file: 'src/checkout.ts', line: 12, claim: 'The retry never stops.' },
                { severity: 'nit', file: 'README.md', line: null, claim: 'A typo.' },
                { severity: 'minor', file: null, line: null, claim: 'Name it better.' },
              ],
            }),
            items.step({ step: 'settle', summary: 'Capped the retries at three.' }),
            items.step({ step: 'review', round: 1, verdict: 'pass', summary: '', agentId: 'mystery' }),
          ],
        }),
      ),
    })
    withServices(<Task />, client)
    expect(await screen.findByText('Added the retry, and a test.')).toBeTruthy()
    expect(screen.queryByText('checkout.ts')).toBeNull()
    expect(screen.getByText('Capped the retries at three.')).toBeTruthy()
    expect(screen.getByText('One thing to fix.')).toBeTruthy()
    expect(screen.getByText(/round 2/)).toBeTruthy()
    await userEvent.click(screen.getAllByRole('button', { name: /findings|Details/i })[0]!)
    expect(await screen.findByText('The retry never stops.')).toBeTruthy()
    expect(screen.getByText('src/checkout.ts:12')).toBeTruthy()
    expect(screen.getByText('README.md')).toBeTruthy()
  })

  it('shows earlier items when asked', async () => {
    const newest = thread({ items: [items.says('The newest.', 'claude-code', 'newest')], earlier: true })
    const { client } = fakeClient({
      getThread: vi.fn(async (_threadId: string, page?: { before?: number }) =>
        page?.before === undefined
          ? newest
          : { ...newest, items: [items.says('An earlier one.', 'claude-code', 'earlier')], earlier: false },
      ),
    })
    withServices(<Task />, client)
    await screen.findByText('The newest.')
    await userEvent.click(screen.getByRole('button', { name: 'Show' }))
    await screen.findByText('An earlier one.')
    expect(client.getThread).toHaveBeenLastCalledWith('th1', { before: newest.items[0]?.sequence, limit: 100 })
    expect(screen.queryByText('Earlier in this task')).toBeNull()
  })

  it('says what went wrong, and lets it go', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async () => thread()),
      setModel: vi.fn(async () =>
        Promise.reject(
          new ApiError({ reason: 'ModelUnchanged', message: "Claude Code is still on its old model. The agent doesn't offer sonnet." }),
        ),
      ),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Lead: Opus High' }))
    await userEvent.click(screen.getByRole('button', { name: /All models/ }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Use Sonnet' }))
    await screen.findByText(/still on its old model/)
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText(/still on its old model/)).toBeNull()
  })

  it('waits for its thread, and says when it cannot have it', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async () => Promise.reject(new ApiError({ reason: 'NotFound', message: "That task isn't there any more." }))),
      status: vi.fn(async () => Promise.reject(new Error('The port closed'))),
    })
    withServices(<Task />, client)
    expect((await screen.findAllByText(/That task isn't there any more.|didn't answer/)).length).toBeGreaterThan(0)
  })

  it('reads nothing earlier when it has nothing yet', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => thread({ items: [], earlier: true })) })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Show' }))
    expect(client.getThread).toHaveBeenCalledTimes(1)
  })

  it('says where it stands', () => {
    const base = snapshot()
    expect(statusOf(base)).toEqual({ status: TaskStatus.Running, state: 'Idle' })
    // A step held for a usage limit says whom it waits for, and until when.
    const until = '2026-10-03T15:40:00.000Z'
    expect(
      statusOf({ ...base, task: { ...base.task, waits: { agentId: 'codex', until } } }, (id) => (id === 'codex' ? 'Codex' : id)),
    ).toEqual({
      status: TaskStatus.Paused,
      state: `Waits for Codex, back at ${clock(until)}`,
    })
    expect(statusOf(running())).toEqual({ status: TaskStatus.Running, state: 'Working' })
    expect(statusOf({ ...base, session: null })).toEqual({ status: TaskStatus.Stopped, state: 'Stopped' })
    expect(statusOf({ ...base, task: { ...base.task, phase: 'ready' } })).toEqual({ status: TaskStatus.Done, state: 'Ready' })
    expect(statusOf({ ...running(), task: { ...base.task, phase: 'ready' } })).toEqual({ status: TaskStatus.Running, state: 'Working' })
    expect(
      statusOf({
        ...base,
        attention: [{ id: 'a', kind: 'permission', title: 't', reason: 'r', command: null, stuck: null, createdAt: '' }],
      }).state,
    ).toBe('Needs you')
  })
})
