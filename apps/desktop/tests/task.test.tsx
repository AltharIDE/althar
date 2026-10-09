import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type StuckStep, type ThreadSnapshot } from '@althar/contracts'
import { TaskStatus } from '@althar/ui'

import { text as stuckWords } from '../src/renderer/features/task/StuckCall'
import { conflictsOf } from '../src/renderer/features/task/Outputs'
import { elapsedOf, sinceOf, statusOf, TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { change, changed, fakeClient, items, models, snapshot, status, streamed } from './fixtures'
import type { ChangedFile } from '@althar/contracts'
import { clock } from '../src/renderer/shared/time'
import { reads } from '../src/renderer/data/reads'
import { ServicesProvider } from '../src/renderer/data/services'
import { servicesFor, withServices } from './render'

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
  it('catches up on what changed between its route reading it and its first listening', async () => {
    const meanwhile = items.says('Said meanwhile', 'claude-code', 'i-meanwhile')
    const getThread = vi
      .fn()
      .mockResolvedValueOnce(thread())
      .mockResolvedValue(thread({ items: [...thread().items, meanwhile] }))
    const { client, emit } = fakeClient({ getThread })
    const services = servicesFor(client)
    // The route's loader reads the thread; an item arrives before the screen has mounted and listens.
    await services.cache.fetchQuery(reads(client).thread('th1'))
    act(() => emit(changed('thread_item', 'i-meanwhile')))
    render(
      <ServicesProvider value={services}>
        <Task />
      </ServicesProvider>,
    )
    expect(await screen.findByText('Said meanwhile')).toBeTruthy()
    // Read again whole as it showed, beside reading what it changed.
    expect(getThread.mock.calls.filter(([, page]) => page === undefined)).toHaveLength(2)
  })

  it('reads what it changed from git as it opens, and again as its outputs or its changes show', async () => {
    const file: ChangedFile = { path: 'src/checkout.ts', from: null, status: 'modified', add: 4, del: 1, binary: false, uncommitted: false }
    const ready = thread({ task: { ...thread().task, phase: 'ready', files: [file] } })
    const { client } = fakeClient({ getThread: vi.fn(async () => ready) })
    withServices(<Task />, client)
    await screen.findByRole('heading', { name: 'Add a retry', level: 1 })
    const fresh = () => vi.mocked(client.getThread).mock.calls.filter(([, page]) => page?.fresh === true).length
    // Ready, it opens on its outputs: one read.
    await waitFor(() => expect(fresh()).toBe(1))
    ;(document.activeElement as HTMLElement | null)?.blur()
    await userEvent.keyboard('c')
    expect(fresh()).toBe(1)
    await userEvent.keyboard('o')
    await waitFor(() => expect(fresh()).toBe(2))
    // And the changes, over the window.
    await userEvent.keyboard('{Meta>}d{/Meta}')
    await waitFor(() => expect(fresh()).toBe(3))
  })

  it('shows its header and its thread', async () => {
    const onBack = vi.fn()
    const { client } = fakeClient({ getThread: vi.fn(async () => thread()) })
    withServices(<Task onBack={onBack} />, client)
    await screen.findByRole('heading', { name: 'Add a retry', level: 1 })
    // The lead's model, by the name its agent gives it.
    expect((await screen.findAllByText('Claude Opus')).length).toBeGreaterThan(0)
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
    // Its turns are named by model, the agent said on hover.
    expect(screen.getAllByText('gpt-5.2-codex').length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('button', { name: 'Thought' }))
    expect(screen.getByText('Where is the call?')).toBeTruthy()
    // Escape, with nothing else open, goes back to the project.
    ;(document.activeElement as HTMLElement | null)?.blur()
    await userEvent.keyboard('{Escape}')
    expect(onBack).toHaveBeenCalled()
  })

  it('opens its thread with what the person asked for, and names its last lead when none runs', async () => {
    const base = snapshot()
    const { client } = fakeClient({
      getThread: vi.fn(async () =>
        thread({
          items: [items.says('On it.', 'codex')],
          task: {
            ...base.task,
            request: 'Add a retry with backoff so a flaky provider doesn’t fail the order',
            lead: { agentId: 'codex', model: 'gpt-5.2-codex', account: null },
          },
          session: null,
        }),
      ),
    })
    withServices(<Task />, client)
    const asked = await screen.findByText('Add a retry with backoff so a flaky provider doesn’t fail the order')
    // Said before anything the lead did.
    expect(asked.compareDocumentPosition(screen.getByText('On it.')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Stopped, the task is still led by who led it last, not by nobody.
    expect(screen.queryByText('No lead yet')).toBeNull()
    expect(screen.getAllByText('gpt-5.2-codex').length).toBeGreaterThan(0)
  })

  it('starts a stopped task on its last lead and model, and not on an agent signed out since', async () => {
    const base = snapshot()
    const stopped = thread({
      task: { ...base.task, lead: { agentId: 'claude-code', model: 'claude-opus-5', account: null } },
      session: null,
    })
    const { client } = fakeClient({ getThread: vi.fn(async () => stopped) })
    const first = withServices(<Task />, client)
    await waitFor(() => expect(client.status).toHaveBeenCalled())
    await userEvent.type(await screen.findByRole('textbox', { name: /^Tell .* something$/ }), 'Carry on{Enter}')
    await waitFor(() =>
      expect(client.startSession).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'claude-code', model: 'claude-opus-5' })),
    )
    first.unmount()

    // Every agent signed out now: none is started that can't, the person is told why, and what they send waits.
    const out = { ...status, agents: status.agents.map((agent) => ({ ...agent, signIn: 'signed_out' as const })) }
    const again = fakeClient({ getThread: vi.fn(async () => stopped), status: vi.fn(async () => out) }).client
    withServices(<Task />, again)
    expect(await screen.findByText(/No agent is signed in, so nothing can pick this up\./)).toBeTruthy()
    await userEvent.type(screen.getByRole('textbox', { name: 'Tell the lead something' }), 'Carry on{Enter}')
    await waitFor(() => expect(again.send).toHaveBeenCalled())
    expect(again.startSession).not.toHaveBeenCalled()
  })

  it('shows its steps as a track, the one it is on by what it does, and how long it has run', async () => {
    const steps = [
      { key: 'implement' as const, agentId: 'claude-code', model: null, skipped: false },
      { key: 'review' as const, agentId: 'codex', model: null, skipped: false },
    ]
    const startedAt = new Date(Date.now() - 64 * 60_000).toISOString()
    const base = thread()
    const { client } = fakeClient({
      getThread: vi.fn(async () => ({ ...base, task: { ...base.task, steps, step: 'review', startedAt } })),
    })
    withServices(<Task />, client)
    // Its lead waits while another agent reviews.
    expect(await screen.findByText('Reviewing')).toBeTruthy()
    const track = screen.getByRole('list', { name: 'Steps' })
    expect(
      within(track)
        .getAllByRole('listitem')
        .map((step) => step.textContent),
    ).toEqual(['Implement, done', 'Review, now'])
    expect(screen.getByText(/1h 4m/)).toBeTruthy()
  })

  it('opens on its outputs once ready, switches faces by c and o, and goes back on Escape', async () => {
    const onBack = vi.fn()
    const file: ChangedFile = { path: 'src/checkout.ts', from: null, status: 'modified', add: 4, del: 1, binary: false, uncommitted: false }
    const here = [{ repository: 'meridian', name: 'meridian', branch: 'main', head: 'abc111' }]
    const base = thread({ session: null })
    const { client } = fakeClient({
      getThread: vi.fn(async () => ({ ...base, task: { ...base.task, phase: 'ready' as const, files: [file], commits: 1, here } })),
    })
    withServices(<Task onBack={onBack} />, client)
    // What it made, on its branch: merged here, as the person says.
    const outputs = within(await screen.findByRole('article', { name: 'Add a retry' }))
    expect(outputs.getByText('On its branch')).toBeTruthy()
    expect(outputs.getByText('checkout.ts')).toBeTruthy()
    expect(screen.getByText('Ready for you')).toBeTruthy()
    await userEvent.click(outputs.getByRole('button', { name: 'Merge into main' }))
    await waitFor(() => expect(client.mergeHere).toHaveBeenCalledWith('t1', [{ repository: 'meridian', head: 'abc111' }]))
    // c for the conversation, o for the outputs; not while typing.
    await userEvent.keyboard('c')
    expect(await screen.findByRole('region', { name: 'Thread' })).toBeTruthy()
    expect(screen.queryByRole('article', { name: 'Add a retry' })).toBeNull()
    await userEvent.type(screen.getByRole('textbox'), 'o')
    expect(screen.queryByRole('article', { name: 'Add a retry' })).toBeNull()
    ;(document.activeElement as HTMLElement | null)?.blur()
    await userEvent.keyboard('o')
    expect(await screen.findByRole('article', { name: 'Add a retry' })).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(onBack).toHaveBeenCalled()
  })

  it('says what merged here and whether its remote has it, and pushes it when the person says', async () => {
    const merged = [{ repository: 'meridian', name: 'meridian', branch: 'main', remote: 'origin/main', ahead: 1 }]
    const base = thread({ session: null })
    const { client } = fakeClient({
      getThread: vi.fn(async () => ({ ...base, task: { ...base.task, phase: 'settled' as const, merged } })),
    })
    withServices(<Task />, client)
    const outputs = within(await screen.findByRole('article', { name: 'Add a retry' }))
    expect(outputs.getByText('Into main on this Mac. origin doesn’t have it yet.')).toBeTruthy()
    expect(outputs.getByText('Repository')).toBeTruthy()
    await userEvent.click(outputs.getByRole('button', { name: 'Push main to origin' }))
    await waitFor(() => expect(client.pushHere).toHaveBeenCalledWith('t1'))
    expect(outputs.queryByRole('button', { name: /^Merge into/ })).toBeNull()
  })

  it('offers the push of what merged here beside a pull request for the rest', async () => {
    const merged = [{ repository: 'web', name: 'web', branch: 'main', remote: 'origin/main', ahead: 2 }]
    const base = thread({ session: null })
    const { client } = fakeClient({
      getThread: vi.fn(async () => ({ ...base, task: { ...base.task, phase: 'settled' as const, changes: [change()], merged } })),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Push main to origin' }))
    await waitFor(() => expect(client.pushHere).toHaveBeenCalledWith('t1'))
  })

  it('says a merge here was pushed, or that there is nowhere to push it', async () => {
    const base = thread({ session: null })
    const once = (merged: ReadonlyArray<{ remote: string | null; ahead: number }>) =>
      fakeClient({
        getThread: vi.fn(async () => ({
          ...base,
          task: {
            ...base.task,
            phase: 'settled' as const,
            merged: merged.map((one) => ({ repository: 'meridian', name: 'meridian', branch: 'main', ...one })),
          },
        })),
      }).client
    const view = withServices(<Task />, once([{ remote: 'origin/main', ahead: 0 }]))
    // Nothing left to do there, it opens on its conversation, and what it made is a press away, in a line.
    await userEvent.click(await screen.findByRole('radio', { name: /Outputs/ }))
    expect(await screen.findByText('Merged into main, and pushed to origin.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Push/ })).toBeNull()
    view.unmount()
    withServices(<Task />, once([{ remote: null, ahead: 0 }]))
    await userEvent.click(await screen.findByRole('radio', { name: /Outputs/ }))
    expect(await screen.findByText('Merged into main on this Mac.')).toBeTruthy()
  })

  it('offers to have the lead settle a merge that conflicts, in words it acts on', async () => {
    const file: ChangedFile = { path: 'README.md', from: null, status: 'modified', add: 1, del: 1, binary: false, uncommitted: false }
    const here = [{ repository: 'meridian', name: 'meridian', branch: 'main', head: 'abc111' }]
    const base = thread({ session: null })
    const { client } = fakeClient({
      getThread: vi.fn(async () => ({ ...base, task: { ...base.task, phase: 'ready' as const, files: [file], commits: 1, here } })),
    })
    vi.mocked(client.mergeHere).mockRejectedValueOnce(
      new ApiError({
        reason: 'CantMerge',
        message: 'It conflicts with the default branch, in README.md.',
        why: 'conflicts',
        detail: 'README.md',
      }),
    )
    withServices(<Task />, client)
    const outputs = within(await screen.findByRole('article', { name: 'Add a retry' }))
    await userEvent.click(outputs.getByRole('button', { name: 'Merge into main' }))
    expect(await outputs.findByText(/It conflicts with main as it is now, in README\.md\./)).toBeTruthy()
    await userEvent.click(outputs.getByRole('button', { name: 'Ask the lead to resolve it' }))
    await waitFor(() =>
      expect(client.send).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringMatching(/^main has moved on, and merging this task's branch into it conflicts in README\.md\./),
        }),
      ),
    )
    expect(outputs.queryByRole('button', { name: 'Ask the lead to resolve it' })).toBeNull()
  })

  it('says what merged in each of several repositories, pushes them all, and names the branch a conflict is with', async () => {
    const merged = [
      { repository: 'api', name: 'api', branch: 'main', remote: 'origin/main', ahead: 1 },
      { repository: 'web', name: 'web', branch: 'develop', remote: 'upstream/develop', ahead: 0 },
    ]
    const base = thread({ session: null })
    const { client } = fakeClient({
      getThread: vi.fn(async () => ({ ...base, task: { ...base.task, phase: 'settled' as const, commits: 2, merged } })),
    })
    const view = withServices(<Task />, client)
    expect(await screen.findByText('Into main and develop on this Mac. origin and upstream don’t have it yet.')).toBeTruthy()
    expect(screen.getByText('Repositories')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Push main to origin' }))
    await waitFor(() => expect(client.pushHere).toHaveBeenCalledWith('t1'))
    view.unmount()
    // Ahead on both: one press pushes each.
    const both = fakeClient({
      getThread: vi.fn(async () => ({
        ...base,
        task: { ...base.task, phase: 'settled' as const, commits: 2, merged: merged.map((one) => ({ ...one, ahead: 1 })) },
      })),
    })
    const again = withServices(<Task />, both.client)
    expect(await screen.findByRole('button', { name: 'Push to each remote' })).toBeTruthy()
    again.unmount()
    // A conflict in one of several says whose branch it is with.
    const here = [
      { repository: 'api', name: 'api', branch: 'main', head: 'abc111' },
      { repository: 'web', name: 'web', branch: 'develop', head: 'def222' },
    ]
    const file: ChangedFile = { path: 'web/README.md', from: null, status: 'modified', add: 1, del: 1, binary: false, uncommitted: false }
    const conflicted = fakeClient({
      getThread: vi.fn(async () => ({ ...base, task: { ...base.task, phase: 'ready' as const, files: [file], commits: 1, here } })),
    })
    vi.mocked(conflicted.client.mergeHere).mockRejectedValueOnce(
      new ApiError({ reason: 'CantMerge', message: 'It conflicts.', why: 'conflicts', detail: 'web: README.md' }),
    )
    withServices(<Task />, conflicted.client)
    await userEvent.click(await screen.findByRole('button', { name: 'Merge into each default branch' }))
    expect(await screen.findByText(/It conflicts with web’s develop as it is now, in README\.md\./)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Ask the lead to resolve it' }))
    await waitFor(() =>
      expect(conflicted.client.send).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringMatching(/in web, develop conflicts in README\.md/) }),
      ),
    )
  })

  it('tells the lead of a task across repositories which default branch each conflicts with', () => {
    const here = [
      { name: 'api', branch: 'main' },
      { name: 'web', branch: 'develop' },
    ]
    expect(conflictsOf('web: README.md', here)).toEqual([{ name: 'web', branch: 'develop', files: 'README.md' }])
    expect(conflictsOf('api: a.ts; web: b.ts, c.ts', here).map((one) => [one.name, one.branch, one.files])).toEqual([
      ['api', 'main', 'a.ts'],
      ['web', 'develop', 'b.ts, c.ts'],
    ])
    expect(conflictsOf('README.md', [{ name: 'meridian', branch: 'trunk' }])).toEqual([{ name: null, branch: 'trunk', files: 'README.md' }])
  })

  it('stays on the conversation the person is reading when the task becomes ready', async () => {
    const file: ChangedFile = { path: 'src/checkout.ts', from: null, status: 'modified', add: 4, del: 1, binary: false, uncommitted: false }
    const base = thread()
    const getThread = vi.fn(async () => ({ ...base, task: { ...base.task, files: [file] } }))
    const { client, emit } = fakeClient({ getThread })
    withServices(<Task />, client)
    expect(await screen.findByRole('region', { name: 'Thread' })).toBeTruthy()
    getThread.mockResolvedValue({ ...base, task: { ...base.task, files: [file], phase: 'ready' as const } })
    emit(changed('task', 't1', 'th1'))
    expect(await screen.findByText('Ready for you')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Thread' })).toBeTruthy()
    expect(screen.queryByRole('article', { name: 'Add a retry' })).toBeNull()
  })

  it('accepts a ready pull request at the head it showed, or sends it back as a note to its lead', async () => {
    const base = thread()
    const { client } = fakeClient({
      getThread: vi.fn(async () => ({
        ...base,
        task: { ...base.task, phase: 'ready' as const, changes: [change({ draft: false })], commits: 2 },
      })),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Accept and merge' }))
    await waitFor(() => expect(client.merge).toHaveBeenCalledWith('t1', 'abc123', 'https://github.com/meridian/api/pull/12'))
    await userEvent.click(screen.getByRole('button', { name: 'Ask for changes' }))
    await userEvent.type(screen.getByRole('textbox', { name: /What should change/ }), 'Name the retry')
    await userEvent.click(screen.getByRole('button', { name: 'Send to the lead' }))
    await waitFor(() => expect(client.send).toHaveBeenCalledWith(expect.objectContaining({ body: 'Name the retry' })))
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

  it('names its lead by model, with the agent and account it runs on said on hover, and switches a model off from every model', async () => {
    const base = thread()
    const { client } = fakeClient({
      getThread: vi.fn(async () => ({ ...base, session: base.session === null ? null : { ...base.session, account: 'work' } })),
      getModels: vi.fn(async () => models.map((offered) => (offered.agentId === 'codex' ? { ...offered, blocked: ['gpt-5.2'] } : offered))),
    })
    withServices(<Task />, client)
    expect((await screen.findAllByText(', via Claude Code · work')).length).toBeGreaterThan(0)
    await userEvent.click(await screen.findByRole('button', { name: 'Lead: Claude Opus High' }))
    await userEvent.click(screen.getByRole('button', { name: /All models/ }))
    const browser = await screen.findByRole('dialog')
    // Switched off: there, and not to be chosen, until it is switched on again.
    expect(within(browser).getByRole('button', { name: 'Use gpt-5.2' })).toHaveProperty('disabled', true)
    await userEvent.click(within(browser).getByRole('button', { name: 'Don’t use gpt-5.2' }))
    expect(client.setModelBlocked).toHaveBeenCalledWith({ agentId: 'codex', model: 'gpt-5.2', blocked: false })
    await userEvent.click(within(browser).getByRole('button', { name: 'Don’t use Claude Sonnet' }))
    expect(client.setModelBlocked).toHaveBeenLastCalledWith({ agentId: 'claude-code', model: 'sonnet', blocked: true })
  })

  it('shows what the person sends at once, before Althar has it, and takes it out again if the send fails', async () => {
    let answer: () => void = () => undefined
    let refuse: (failure: Error) => void = () => undefined
    const { client } = fakeClient({ getThread: vi.fn(async () => thread()) })
    vi.mocked(client.send).mockImplementationOnce(() => new Promise<void>((resolve) => (answer = resolve)))
    withServices(<Task />, client)
    const box = await screen.findByRole('textbox', { name: 'Tell Claude Code something' })
    await userEvent.type(box, 'Add a test{Enter}')
    // In the thread while the send is still on its way.
    expect(screen.getByText('Add a test')).toBeTruthy()
    answer()
    vi.mocked(client.send).mockImplementationOnce(() => new Promise<void>((_, reject) => (refuse = reject)))
    await userEvent.type(box, 'Never mind{Enter}')
    expect(screen.getByText('Never mind')).toBeTruthy()
    refuse(new Error('Althar is restarting.'))
    await waitFor(() => expect(screen.queryByText('Never mind')).toBeNull())
    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('takes back a queued message, or puts it back in the composer to change', async () => {
    const edited = items.you('Use the helper', { state: 'queued', interrupting: false })
    const dropped = items.you('Skip the docs', { state: 'queued', interrupting: false })
    const { client } = fakeClient({ getThread: vi.fn(async () => running({ items: [items.you('Add a retry'), edited, dropped] })) })
    withServices(<Task />, client)
    const busy = await screen.findByRole('textbox', { name: 'Add to the queue, or interrupt the lead' })
    expect(screen.getByRole('region', { name: '2 queued; the lead reads them in order' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Take “Skip the docs” out of the queue' }))
    expect(client.takeBack).toHaveBeenCalledWith(dropped.id)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(client.takeBack).toHaveBeenCalledWith(edited.id)
    await waitFor(() => expect((busy as HTMLTextAreaElement).value).toBe('Use the helper'))
    expect(screen.queryByRole('region', { name: /queued/ })).toBeNull()
    expect(screen.queryByText('Skip the docs')).toBeNull()
  })

  it('changes how hard its lead thinks and its model, hands it to another agent, and stops it', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => thread()) })
    withServices(<Task />, client)
    // The lead's model and effort, in the composer.
    await userEvent.click(await screen.findByRole('button', { name: 'Lead: Claude Opus High' }))
    await userEvent.click(await screen.findByRole('radio', { name: 'Low' }))
    await waitFor(() => expect(client.setEffort).toHaveBeenCalledWith({ threadId: 'th1', effort: 'low' }))
    // Every model is one step away, whichever agent offers it.
    await userEvent.click(screen.getByRole('button', { name: /All models/ }))
    const browser = await screen.findByRole('dialog')
    expect(within(browser).getByRole('button', { name: 'Use gpt-5.2' })).toBeTruthy()
    // An agent that is signed out offers nothing.
    expect(within(browser).queryByText(/OpenCode/)).toBeNull()
    await userEvent.click(within(browser).getByRole('button', { name: 'Use Claude Sonnet' }))
    await waitFor(() => expect(client.setModel).toHaveBeenCalledWith({ threadId: 'th1', model: 'sonnet' }))
    expect(client.setEffort).toHaveBeenCalledTimes(1)
    // Another agent's model hands the task to that agent, on its own effort, with what the person says next: nothing happens until then.
    await userEvent.click(screen.getByRole('button', { name: 'Lead: Claude Opus High' }))
    await userEvent.click(await screen.findByRole('radio', { name: /gpt-5\.2-codex/ }))
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByText(/gpt-5\.2-codex takes over from Claude Opus when you send\./)).toBeTruthy()
    expect(client.switchAgent).not.toHaveBeenCalled()
    await userEvent.type(screen.getByRole('textbox', { name: /^Tell .* something$/ }), 'Over to you{Enter}')
    await waitFor(() =>
      expect(client.switchAgent).toHaveBeenCalledWith({ threadId: 'th1', agentId: 'codex', model: 'gpt-5.2-codex', body: 'Over to you' }),
    )
    expect(client.send).not.toHaveBeenCalledWith(expect.objectContaining({ body: 'Over to you' }))
    expect(screen.queryByText(/takes over from/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'More for this task' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Stop the task/ }))
    expect(client.stopSession).toHaveBeenCalledWith('th1')
  })

  it('opens the pull request of work that ended on its branch', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async () => thread({ session: null, task: { ...snapshot().task, phase: 'ready', commits: 2 } })),
    })
    const view = withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Open a pull request' }))
    await waitFor(() => expect(client.openChange).toHaveBeenCalledWith('t1'))
    view.unmount()
    // With its host not connected, there is no pull request a press could open.
    const unconnected = fakeClient({
      getThread: vi.fn(async () => ({
        ...thread({ session: null, task: { ...snapshot().task, phase: 'ready', commits: 2 } }),
        host: { product: 'github' as const, name: 'GitHub', webUrl: 'https://github.com', connected: false },
      })),
    })
    withServices(<Task />, unconnected.client)
    expect(await screen.findByText('Ready for you')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open a pull request' })).toBeNull()
  })

  it('merges work that ended on its branch here, up to the heads it showed', async () => {
    const here = [
      { repository: 'api', name: 'api', branch: 'main', head: 'abc111' },
      { repository: 'web', name: 'web', branch: 'develop', head: 'def222' },
    ]
    const { client } = fakeClient({
      getThread: vi.fn(async () => thread({ session: null, task: { ...snapshot().task, phase: 'ready', commits: 2, here } })),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Merge into each default branch' }))
    await waitFor(() =>
      expect(client.mergeHere).toHaveBeenCalledWith('t1', [
        { repository: 'api', head: 'abc111' },
        { repository: 'web', head: 'def222' },
      ]),
    )
  })

  it('merges a repository that ended on its branch here, beside the pull request of the rest', async () => {
    const here = [
      { repository: 'tools', name: 'tools', branch: 'main', head: 'abc111' },
      { repository: 'docs', name: 'docs', branch: 'main', head: 'def222' },
    ]
    const { client } = fakeClient({
      getThread: vi.fn(async () =>
        thread({ session: null, task: { ...snapshot().task, phase: 'ready', commits: 2, here, changes: [change()] } }),
      ),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Merge tools and docs into main' }))
    await waitFor(() =>
      expect(client.mergeHere).toHaveBeenCalledWith('t1', [
        { repository: 'tools', head: 'abc111' },
        { repository: 'docs', head: 'def222' },
      ]),
    )
    // Its pull request is open already.
    expect(screen.queryByRole('button', { name: 'Open a pull request' })).toBeNull()
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
    await userEvent.click(await screen.findByRole('button', { name: 'Lead: Claude Opus High' }))
    // Until the person pins one, each agent's current model is pinned; the one in use shows first.
    const pinned = await screen.findByRole('radiogroup', { name: 'Pinned models' })
    expect(
      within(pinned)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual([
      'Claude Opus, via Claude Codenot pinned',
      'Claude Code default, via Claude Code',
      'gpt-5.2-codex, via Codexhands the task to Codex',
    ])
    // High is not what Claude Code is on; the person makes it Opus's.
    expect(screen.getByText(/default Medium/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Make this default' }))
    expect(setDefaultEffort).toHaveBeenCalledWith({ agentId: 'claude-code', model: 'opus', effort: 'high' })
    expect(await screen.findByText('Claude Opus default')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /All models/ }))
    const browser = await screen.findByRole('dialog')
    await userEvent.click(within(browser).getByRole('button', { name: 'Pin Claude Opus' }))
    await userEvent.click(within(browser).getByRole('combobox', { name: 'Default effort for gpt-5.2' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Extra high' }))
    await waitFor(() => expect(setDefaultEffort).toHaveBeenCalledWith({ agentId: 'codex', model: 'gpt-5.2', effort: 'extra-high' }))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(JSON.parse(window.localStorage.getItem('althar.models') ?? '{}')).toEqual({
      pins: ['claude-code:default', 'codex:gpt-5.2-codex', 'claude-code:opus'],
    })

    // A model with the person's default effort starts on it.
    await userEvent.click(screen.getByRole('button', { name: 'Lead: Claude Opus High' }))
    await userEvent.click(screen.getByRole('button', { name: /All models/ }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Use gpt-5.2' }))
    await userEvent.type(screen.getByRole('textbox', { name: /^Tell .* something$/ }), 'Go{Enter}')
    await waitFor(() =>
      expect(client.switchAgent).toHaveBeenCalledWith({
        threadId: 'th1',
        agentId: 'codex',
        model: 'gpt-5.2',
        effort: 'extra-high',
        body: 'Go',
      }),
    )
  })

  it('leaves a lead at work alone when another agent is picked, until the person says something, and keeps it if asked', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => thread({ session: { ...snapshot().session!, turnRunning: true } })) })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'Lead: Claude Opus High' }))
    await userEvent.click(await screen.findByRole('radio', { name: /gpt-5\.2-codex/ }))
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByText(/gpt-5\.2-codex takes over from Claude Opus when you send\./)).toBeTruthy()
    // The picker says who will lead; the lead at work goes on.
    expect(screen.getByRole('button', { name: /^Lead: gpt-5\.2-codex/ })).toBeTruthy()
    expect([client.switchAgent, client.interrupt, client.setModel].map((call) => vi.mocked(call).mock.calls.length)).toEqual([0, 0, 0])
    await userEvent.click(screen.getByRole('button', { name: 'Keep Claude Opus' }))
    expect(screen.queryByText(/takes over from/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Lead: Claude Opus High' })).toBeTruthy()
    // From every model too; what the person says then is the new lead's, not a message queued for the old one.
    await userEvent.click(screen.getByRole('button', { name: 'Lead: Claude Opus High' }))
    await userEvent.click(screen.getByRole('button', { name: /All models/ }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Use gpt-5.2' }))
    await userEvent.type(screen.getByRole('textbox', { name: /^Add to the queue/ }), 'Take it from here{Enter}')
    await waitFor(() =>
      expect(client.switchAgent).toHaveBeenCalledWith({ threadId: 'th1', agentId: 'codex', model: 'gpt-5.2', body: 'Take it from here' }),
    )
    expect(client.send).not.toHaveBeenCalled()
    // Its own models change without waiting.
    await userEvent.click(screen.getByRole('button', { name: 'Lead: Claude Opus High' }))
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
      // The window watches once, for every screen.
      expect(watching).toHaveLength(1)
      act(() => emit(streamed('reply', 'Found it, and a second call.')))
      act(() => emit(streamed('reply', 'Not this thread', 'other')))
      await screen.findByText('Found it, and a second call.')
      // How full the lead's context is shows in the composer as it says, for this thread only.
      expect(screen.queryByRole('button', { name: /^Context/ })).toBeNull()
      act(() => emit({ _tag: 'Context', threadId: 'other', used: 190_000, size: 200_000 }))
      act(() => emit({ _tag: 'Context', threadId: 'th1', used: 50_000, size: 200_000 }))
      expect(await screen.findByRole('button', { name: 'Context 25% used' })).toBeTruthy()

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
    await userEvent.click(await screen.findByRole('button', { name: 'Lead: Claude Opus High' }))
    await userEvent.click(screen.getByRole('button', { name: /All models/ }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Use Claude Sonnet' }))
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
    // Only the thread, and what it changed as it opened: no page before nothing.
    expect(vi.mocked(client.getThread).mock.calls.filter(([, page]) => page?.before !== undefined)).toEqual([])
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
    // Ready, accepting it is the person's; settled, it is done.
    expect(statusOf({ ...base, task: { ...base.task, phase: 'ready' } })).toEqual({ status: TaskStatus.Yours, state: 'Ready for you' })
    expect(statusOf({ ...base, task: { ...base.task, phase: 'settled' } })).toEqual({ status: TaskStatus.Done, state: 'Done' })
    expect(statusOf({ ...running(), task: { ...base.task, phase: 'ready' } })).toEqual({ status: TaskStatus.Running, state: 'Working' })
    expect(
      statusOf({
        ...base,
        attention: [{ id: 'a', kind: 'permission', title: 't', reason: 'r', command: null, stuck: null, createdAt: '' }],
      }).state,
    ).toBe('Needs you')
    // On a step, it says what it does there: while its lead works, and while another agent reviews.
    expect(statusOf({ ...running(), task: { ...base.task, step: 'implement' } }).state).toBe('Implementing')
    expect(statusOf({ ...base, task: { ...base.task, step: 'settle' } })).toEqual({
      status: TaskStatus.Running,
      state: 'Settling the review',
    })
  })

  it('says since when it has been where it stands', () => {
    const base = snapshot()
    const at = (minutes: number) => new Date(Date.UTC(2026, 9, 7, 9, minutes)).toISOString()
    const on = (step: string) => ({ ...base, task: { ...base.task, step, stepAt: at(0) } })
    expect(sinceOf(on('implement'), at(6))).toBe('implement · 6m')
    // Settling the review's findings is part of the review.
    expect(sinceOf(on('settle'), at(6))).toBe('review · 6m')
    expect(sinceOf(base, at(6))).toBeNull()
    const call = { id: 'a', kind: 'permission' as const, title: 't', reason: 'r', command: null, stuck: null, createdAt: at(3) }
    expect(sinceOf({ ...on('implement'), attention: [call] }, at(6))).toBe('waiting · 3m')
    expect(sinceOf({ ...on('implement'), task: { ...on('implement').task, waits: { agentId: 'codex', until: at(60) } } }, at(6))).toBeNull()
    const reported = { ...items.step({ step: 'review' }), createdAt: new Date(Date.now() - 4 * 60_000).toISOString() }
    const now = new Date().toISOString()
    expect(sinceOf({ ...base, task: { ...base.task, phase: 'ready' }, items: [reported] }, now)).toBe('ready · 4m ago')
    expect(sinceOf({ ...base, task: { ...base.task, phase: 'stopped' }, items: [reported] }, now)).toBe('stopped · 4m ago')
    expect(sinceOf({ ...base, task: { ...base.task, phase: 'settled', settledAt: reported.createdAt } }, now)).toBe('done · 4m ago')
  })

  it('says how long it has run, until it stopped', () => {
    const base = snapshot()
    const at = (minutes: number) => new Date(Date.UTC(2026, 9, 7, 9, minutes)).toISOString()
    const task = { ...base.task, startedAt: at(0) }
    expect(elapsedOf(base, at(30))).toBeNull()
    // Under way, until now.
    expect(elapsedOf({ ...base, task }, at(6))).toBe('6m')
    // Ready, until its last step reported; stopped, until the last thing said; settled, until it settled.
    const said = { ...items.says('Done.'), createdAt: at(50) }
    const reported = { ...items.step({ step: 'review' }), createdAt: at(40) }
    expect(elapsedOf({ ...base, task: { ...task, phase: 'ready' }, items: [reported, said] }, at(59))).toBe('40m')
    expect(elapsedOf({ ...base, task: { ...task, phase: 'stopped' }, items: [reported, said] }, at(59))).toBe('50m')
    expect(elapsedOf({ ...base, task: { ...task, phase: 'settled', settledAt: at(20) } }, at(59))).toBe('20m')
  })
})
